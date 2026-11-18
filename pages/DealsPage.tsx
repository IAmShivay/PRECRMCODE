import type { WorkspaceAccess } from '../types/permissions';
import { useWorkspaceAccess } from '../lib/useWorkspaceAccess';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getAuthToken } from '../lib/storage';
import {
  formatWorkspaceCurrency,
  getCurrencyInputPlaceholder,
  normalizeWorkspaceCurrency,
  type WorkspaceCurrencyCode,
} from '../lib/currency';
import DealCustomFieldsForm from '../components/DealCustomFieldsForm';
import DealDocuments from '../components/DealDocuments';
import DealAssociations from '../components/DealAssociations';
import DealStageRequirementsModal from '../components/DealStageRequirementsModal';
import { activeDealFieldValues, dealFieldErrors } from '../lib/dealFields';
import { readPipelineConfiguration, saveDeal, renamePipeline, deletePipeline } from '../lib/api-client';
import type { Deal, DealStage, DealStageConfig, DealCustomField, DealFieldValues } from '../components/types';
import { ArrowsUpDownIcon, FunnelIcon, PencilSquareIcon, PlusIcon, XMarkIcon, PencilIcon, LinkIcon, EllipsisVerticalIcon, TrashIcon } from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const resolveApiBaseUrl = () => {
  const configured = String(API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return '';
};

const apiUrl = (path: string) => {
  const base = resolveApiBaseUrl();
  if (!base) return path;
  return `${base}${path}`;
};

const readJson = async (res: Response) => {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (!contentType.includes('application/json')) {
    const preview = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(
      `API returned non-JSON (HTTP ${res.status}). ` +
        `Check VITE_API_BASE_URL / dev proxy. ` +
        (preview ? `Response: ${preview}` : '')
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned invalid JSON (HTTP ${res.status}).`);
  }
};

type StageConfig = {
  slug: DealStage;
  label: string;
  color: string;
};

const DEFAULT_STAGES: StageConfig[] = [
  { slug: 'new_lead', label: 'New Lead', color: '#111827' },
  { slug: 'qualified', label: 'Qualified', color: '#059669' },
  { slug: 'in_discussion', label: 'In Discussion', color: '#F59E0B' },
  { slug: 'proposal', label: 'Proposal', color: '#4F46E5' },
  { slug: 'negotiation', label: 'Negotiation', color: '#9333EA' },
  { slug: 'won', label: 'Won', color: '#16A34A' },
  { slug: 'lost', label: 'Lost', color: '#E11D48' },
];

type StageCardStyle = {
  card: string;
  badge: string;
  divider: string;
  pill: string;
  avatar: string;
};

const STAGE_CARD_STYLES: Record<DealStage, StageCardStyle> = {
  new_lead: {
    card: 'border-gray-200 bg-white text-gray-900',
    badge: 'bg-gray-50 border-gray-200 text-gray-700',
    divider: 'border-gray-200',
    pill: 'border-gray-200 bg-gray-50 text-gray-700',
    avatar: 'bg-gray-100 text-gray-700',
  },
  qualified: {
    card: 'border-emerald-200 bg-emerald-50 text-gray-900',
    badge: 'bg-emerald-100 border-emerald-200 text-emerald-800',
    divider: 'border-emerald-200',
    pill: 'border-emerald-200 bg-emerald-100 text-emerald-800',
    avatar: 'bg-emerald-100 text-emerald-800',
  },
  in_discussion: {
    card: 'border-amber-200 bg-amber-50 text-gray-900',
    badge: 'bg-amber-100 border-amber-200 text-amber-800',
    divider: 'border-amber-200',
    pill: 'border-amber-200 bg-amber-100 text-amber-800',
    avatar: 'bg-amber-100 text-amber-800',
  },
  proposal: {
    card: 'border-indigo-200 bg-indigo-50 text-gray-900',
    badge: 'bg-indigo-100 border-indigo-200 text-indigo-800',
    divider: 'border-indigo-200',
    pill: 'border-indigo-200 bg-indigo-100 text-indigo-800',
    avatar: 'bg-indigo-100 text-indigo-800',
  },
  negotiation: {
    card: 'border-purple-200 bg-purple-50 text-gray-900',
    badge: 'bg-purple-100 border-purple-200 text-purple-800',
    divider: 'border-purple-200',
    pill: 'border-purple-200 bg-purple-100 text-purple-800',
    avatar: 'bg-purple-100 text-purple-800',
  },
  won: {
    card: 'border-green-200 bg-green-50 text-gray-900',
    badge: 'bg-green-100 border-green-200 text-green-800',
    divider: 'border-green-200',
    pill: 'border-green-200 bg-green-100 text-green-800',
    avatar: 'bg-green-100 text-green-800',
  },
  lost: {
    card: 'border-rose-200 bg-rose-50 text-gray-900',
    badge: 'bg-rose-100 border-rose-200 text-rose-800',
    divider: 'border-rose-200',
    pill: 'border-rose-200 bg-rose-100 text-rose-800',
    avatar: 'bg-rose-100 text-rose-800',
  },
};

const CUSTOM_STAGE_CARD_STYLE: StageCardStyle = {
  card: 'border-blue-200 bg-blue-50 text-gray-900',
  badge: 'bg-blue-100 border-blue-200 text-blue-800',
  divider: 'border-blue-200',
  pill: 'border-blue-200 bg-blue-100 text-blue-800',
  avatar: 'bg-blue-100 text-blue-800',
};

const formatDate = (dateString: string | undefined): string | null => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return null;
  }
};

type MemberOption = { user_id: number; name: string; email: string };
type DealPipeline = { id: number; workspace_id: number; slug: string; name: string };

function DealCard({
  stage,
  deal,
  currency,
  ownerLabel,
  ownerInitial,
  dragging,
  readOnly,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onMoveStage,
  allStages,
}: {
  stage: DealStage;
  deal: Deal;
  currency: WorkspaceCurrencyCode;
  ownerLabel?: string;
  ownerInitial?: string;
  dragging: boolean;
  readOnly: boolean;
  onDragStart: (dealId: number) => void;
  onDragEnd: () => void;
  onEdit?: (deal: Deal) => void;
  onDelete?: (dealId: number) => void;
  onMoveStage?: (deal: Deal, targetStage: DealStage) => void;
  allStages?: StageConfig[];
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const style = STAGE_CARD_STYLES[stage] || CUSTOM_STAGE_CARD_STYLE;
  const formattedDate = formatDate(deal.expected_close_date);

  const handleEdit = () => {
    setMenuOpen(false);
    if (onEdit) {
      onEdit(deal);
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);
    if (onDelete && deal.id) {
      onDelete(deal.id);
    }
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return undefined;
  }, [menuOpen]);

  return (
    <div
      draggable={!readOnly}
      onDragStart={() => onDragStart(deal.id)}
      onDragEnd={onDragEnd}
      className={[
        'select-none rounded-xl border shadow-sm',
        'px-4 py-3 transition-transform duration-150',
        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        style.card,
        dragging ? 'opacity-60 scale-[0.99]' : 'hover:shadow-md',
      ].join(' ')}
    >
      {/* Header with Deal Name, ID, and Menu */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {deal.name}
            {deal.name.length > 20 ? '...' : ''}
          </div>
          <div className="text-[10px] font-medium text-gray-500 mt-0.5">
            #{deal.id}
          </div>
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            disabled={dragging}
            className={[
              'p-1.5 rounded-lg transition-colors',
              'hover:bg-gray-100 active:bg-gray-200',
              dragging ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
            aria-label="Deal actions"
            title="More actions"
          >
            <EllipsisVerticalIcon className="w-4 h-4 text-gray-600" />
          </button>
          {menuOpen && !dragging && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-gray-700 bg-gray-900 shadow-lg z-50 py-1">
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit();
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center gap-2 transition-colors"
                >
                  <PencilIcon className="w-4 h-4" />
                  <span>{readOnly ? 'View Deal' : 'Edit Deal'}</span>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Delete Deal</span>
                </button>
              )}
              {!readOnly && onMoveStage && allStages && allStages.length > 1 && (
                <div className="border-t border-gray-700 my-1 pt-1">
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Move to
                  </div>
                  {allStages
                    .filter((s) => s.slug !== stage)
                    .map((s) => (
                      <button
                        key={s.slug}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          onMoveStage(deal, s.slug);
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-white/10 flex items-center gap-2 transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="truncate">{s.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Deal Details with Labeled Fields */}
      <div className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-2">
          <span className="text-gray-600 font-medium">Project Name:</span>
          <span className="text-gray-900 text-right truncate flex-1 min-w-0">{deal.name}</span>
        </div>

        {deal.contact && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-gray-600 font-medium">Contact:</span>
            <span className="text-gray-900 text-right truncate flex-1 min-w-0">{deal.contact}</span>
          </div>
        )}

        {ownerLabel && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-gray-600 font-medium">Assigned to:</span>
            <div className="flex items-center gap-1.5 text-right">
              {ownerInitial && (
                <span
                  className={[
                    'inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold shrink-0',
                    style.avatar,
                  ].join(' ')}
                >
                  {ownerInitial.toUpperCase()}
                </span>
              )}
              <span className="text-gray-900 truncate">{ownerLabel}</span>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <span className="text-gray-600 font-medium">Estimated Value:</span>
          <span className="text-gray-200 font-semibold">
            {formatWorkspaceCurrency(Number(deal.value || 0), currency)}
          </span>
        </div>

        {formattedDate && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-gray-600 font-medium">Closure Date:</span>
            <span className="text-gray-200">{formattedDate}</span>
          </div>
        )}

        {deal.priority && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-gray-600 font-medium">Priority:</span>
            <span className={['inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]', style.pill].join(' ')}>
              {String(deal.priority).trim().charAt(0).toUpperCase() + String(deal.priority).trim().slice(1)}
            </span>
          </div>
        )}

        {deal.lead_id && (
          <div className="flex items-start justify-between gap-2 pt-1 border-t border-gray-200">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/leads/${deal.lead_id}`);
              }}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 hover:text-gray-200 transition-colors"
              title="View source lead"
            >
              <LinkIcon className="w-3 h-3" />
              <span>From Lead</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TagsEditor({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = React.useState('');

  const commit = (raw: string) => {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...tags];
    for (const part of parts) {
      if (!next.some((tag) => tag.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 min-h-[38px]">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {tag}
          {!disabled && (
            <button type="button" onClick={() => onChange(tags.filter((item) => item !== tag))} aria-label={`Remove tag ${tag}`} className="text-gray-400 hover:text-gray-700">
              <XMarkIcon className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value;
          if (value.includes(',')) commit(value);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={tags.length ? 'Add tag…' : 'Add tag and press Enter'}
        className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-gray-900 focus:outline-none disabled:bg-transparent"
      />
    </div>
  );
}

function CreateDealModal({
  workspaceId,
  currency,
  initialStage,
  pipelineSlug,
  open,
  members,
  stages,
  fields,
  access,
  onClose,
  onCreated,
}: {
  workspaceId: number;
  currency: WorkspaceCurrencyCode;
  initialStage?: DealStage;
  pipelineSlug?: string;
  open: boolean;
  members: MemberOption[];
  stages: StageConfig[];
  fields: DealCustomField[];
  access: WorkspaceAccess;
  onClose: () => void;
  onCreated: (deal: Deal) => void;
}) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldValues, setFieldValues] = React.useState<DealFieldValues>({});
  const [tags, setTags] = React.useState<string[]>([]);
  const [form, setForm] = React.useState<{
    name: string;
    value: string;
    contact: string;
    owner_id: string;
    stage: DealStage;
    expected_close_date: string;
    priority: string;
  }>({
    name: '',
    value: '',
    contact: '',
    owner_id: '',
    stage: 'new_lead',
    expected_close_date: '',
    priority: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setFieldValues({});
    setTags([]);
    setForm({
      name: '',
      value: '',
      contact: '',
      owner_id: access.role === 'admin' ? '' : String(access.user_id),
      stage: initialStage || stages[0]?.slug || 'new_lead',
      expected_close_date: '',
      priority: '',
    });
    setSubmitting(false);
  }, [open, initialStage, stages]);

  const canSubmit = form.name.trim().length > 0 && form.contact.trim().length > 0 && !submitting && access.permissions.deals === 'edit' && !Object.keys(dealFieldErrors(fields, fieldValues, form.stage)).length;

  const submit = async () => {
    if (!canSubmit) return;
    const token = getAuthToken();
    if (!token) {
      addToast('error', 'Authentication required');
      return;
    }

    const valueNumber =
      form.value.trim() === '' ? 0 : Number(String(form.value).replaceAll(',', '').trim());
    if (!Number.isFinite(valueNumber) || valueNumber < 0) {
      addToast('error', 'Deal value must be a valid number');
      return;
    }

    setSubmitting(true);
    try {
      const created = await saveDeal({
          custom_fields: activeDealFieldValues(fields, fieldValues),
          workspace_id: workspaceId,
          name: form.name.trim(),
          value: valueNumber,
          contact: form.contact.trim(),
          owner_id: access.role === 'admin' ? (form.owner_id ? Number(form.owner_id) : null) : access.user_id,
          stage: form.stage,
          pipeline_slug: String(pipelineSlug || 'default'),
          expected_close_date: form.expected_close_date ? String(form.expected_close_date).trim() : null,
          priority: form.priority ? String(form.priority).trim() : null,
          tags,
        });
      if (!created?.id) {
        throw new Error('Invalid create response');
      }

      onCreated(created);
      addToast('success', 'Deal created');
      onClose();
    } catch (error: any) {
      addToast('error', error?.message || 'Failed to create deal');
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white border border-gray-200 shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Create a deal</div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Deal name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  placeholder="Enter deal name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Deal value
                  </label>
                  <input
                    value={form.value}
                    onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                    placeholder={getCurrencyInputPlaceholder(currency)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    <option value="">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Contact
                </label>
                <input
                  value={form.contact}
                  onChange={(e) => setForm((p) => ({ ...p, contact: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  placeholder="e.g. Tirth (phone)"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Assigned to
                  </label>
                  <select
                    aria-label="Assigned to"
                    disabled={access.role !== 'admin'}
                    value={form.owner_id}
                    onChange={(e) => setForm((p) => ({ ...p, owner_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={String(m.user_id)}>
                        {m.name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Stage
                  </label>
                  <select
                    value={form.stage}
                    onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value as DealStage }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    {stages.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Expected close date
                </label>
                <input
                  type="date"
                  value={form.expected_close_date}
                  onChange={(e) => setForm((p) => ({ ...p, expected_close_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Custom fields</div>
                <DealCustomFieldsForm fields={fields} values={fieldValues} stage={form.stage} stageName={stages.find((stage) => stage.slug === form.stage)?.label} onChange={setFieldValues} disabled={submitting} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Tags</div>
                <TagsEditor tags={tags} onChange={setTags} disabled={submitting} />
              </div>
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Documents</div>
                <div className="flex flex-col items-center justify-center rounded-lg bg-gray-50 border border-gray-200 px-4 py-6 text-center">
                  <p className="text-xs font-medium text-gray-500">Documents available after creating deal</p>
                  <p className="text-[11px] text-gray-400 mt-1">Save the deal first, then upload in Edit → Documents (drag & drop)</p>
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Linked deals</div>
                <p className="text-xs text-gray-500">Link deals after creation in Edit → Linked deals</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition',
              canSubmit ? 'bg-gray-900 hover:bg-gray-800' : 'bg-gray-300 cursor-not-allowed',
            ].join(' ')}
            disabled={!canSubmit}
          >
            Create deal
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDealModal({
  deal,
  currency,
  pipelineSlug,
  open,
  members,
  stages,
  fields,
  requiredDocuments,
  access,
  onClose,
  onUpdated,
  onDeleted,
  showDeleteOnOpen,
}: {
  deal: Deal | null;
  currency: WorkspaceCurrencyCode;
  pipelineSlug?: string;
  open: boolean;
  members: MemberOption[];
  stages: StageConfig[];
  fields: DealCustomField[];
  requiredDocuments: string[];
  access: WorkspaceAccess;
  onClose: () => void;
  onUpdated: (deal: Deal) => void;
  onDeleted?: (dealId: number) => void;
  showDeleteOnOpen?: boolean;
}) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldValues, setFieldValues] = React.useState<DealFieldValues>({});
  const [tags, setTags] = React.useState<string[]>([]);
  const [deleting, setDeleting] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const dealIdRef = React.useRef<number | null>(null);
  const [form, setForm] = React.useState<{
    name: string;
    value: string;
    contact: string;
    owner_id: string;
    stage: DealStage;
    expected_close_date: string;
    priority: string;
  }>({
    name: '',
    value: '',
    contact: '',
    owner_id: '',
    stage: 'new_lead',
    expected_close_date: '',
    priority: '',
  });

  React.useEffect(() => {
    if (!open) {
      dealIdRef.current = null;
      setShowDeleteConfirm(false);
      setDeleting(false);
      setSubmitting(false);
      return;
    }
    
    if (!deal) return;
    
    // Only reset form if this is a different deal
    const currentDealId = deal.id;
    if (dealIdRef.current === currentDealId) {
      // Same deal, don't reset the form (user might be editing)
      return;
    }
    
    dealIdRef.current = currentDealId;
    let dateValue = '';
    if (deal.expected_close_date) {
      const dateStr = String(deal.expected_close_date).trim();
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          dateValue = date.toISOString().split('T')[0];
        } else {
          dateValue = dateStr.split(' ')[0].split('T')[0];
        }
      } catch {
        dateValue = dateStr.split(' ')[0].split('T')[0];
      }
    }
    const initialFieldValues: DealFieldValues = { ...(deal.custom_fields ?? {}) };
    for (const field of fields) {
      if (initialFieldValues[field.id]) continue;
      const lower = field.label.trim().toLowerCase();
      if ((lower === 'deal value' || lower === 'value' || lower === 'amount') && deal.value !== undefined && deal.value !== null) {
        initialFieldValues[field.id] = String(deal.value);
      } else if ((lower === 'expected close date' || lower === 'close date') && dateValue) {
        initialFieldValues[field.id] = dateValue;
      } else if (lower === 'contact' && deal.contact) {
        initialFieldValues[field.id] = String(deal.contact);
      } else if (lower === 'priority' && deal.priority) {
        initialFieldValues[field.id] = String(deal.priority);
      }
    }
    setFieldValues(initialFieldValues);
    setTags(Array.isArray(deal.tags) ? deal.tags : []);
    setForm({
      name: String(deal.name || '').trim(),
      value: String(deal.value || 0),
      contact: String(deal.contact || '').trim(),
      owner_id: deal.owner_id ? String(deal.owner_id) : '',
      stage: (deal.stage || 'new_lead') as DealStage,
      expected_close_date: dateValue,
      priority: String(deal.priority || '').trim(),
    });
    setSubmitting(false);
    setDeleting(false);
    setShowDeleteConfirm(showDeleteOnOpen || false);
  }, [open, deal?.id, showDeleteOnOpen]);

  const canSubmit = access.permissions.deals === 'edit' && form.name.trim().length > 0 && form.contact.trim().length > 0 && !submitting && deal && !Object.keys(dealFieldErrors(fields, fieldValues, form.stage)).length;

  const submit = async () => {
    if (!canSubmit || !deal) return;
    const token = getAuthToken();
    if (!token) {
      addToast('error', 'Authentication required');
      return;
    }

    const valueNumber =
      form.value.trim() === '' ? 0 : Number(String(form.value).replaceAll(',', '').trim());
    if (!Number.isFinite(valueNumber) || valueNumber < 0) {
      addToast('error', 'Deal value must be a valid number');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await saveDeal({
          custom_fields: activeDealFieldValues(fields, fieldValues),
          name: form.name.trim(),
          value: valueNumber,
          contact: form.contact.trim(),
          owner_id: form.owner_id ? Number(form.owner_id) : null,
          stage: form.stage,
          pipeline_slug: String(pipelineSlug || deal.pipeline_slug || 'default'),
          expected_close_date: form.expected_close_date ? String(form.expected_close_date).trim() : null,
          priority: form.priority ? String(form.priority).trim() : null,
          tags,
        }, deal.id);
      if (!updated?.id) {
        throw new Error('Invalid update response');
      }

      onUpdated(updated);
      addToast('success', 'Deal updated');
      onClose();
    } catch (error: any) {
      addToast('error', error?.message || 'Failed to update deal');
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deal || access.role !== 'admin') return;
    const token = getAuthToken();
    if (!token) {
      addToast('error', 'Authentication required');
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/deals/${deal.id}`), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await readJson(res);
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload?.message || payload?.error || 'Failed to delete deal');
      }

      addToast('success', 'Deal deleted successfully');
      if (onDeleted) {
        onDeleted(deal.id);
      }
      setShowDeleteConfirm(false);
      setDeleting(false);
      onClose();
    } catch (error: any) {
      addToast('error', error?.message || 'Failed to delete deal');
      setDeleting(false);
    }
  };

  if (!open || !deal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div 
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white border border-gray-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">{access.permissions.deals === 'edit' ? 'Edit deal' : 'View deal'}</div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <fieldset disabled={access.permissions.deals !== 'edit' || submitting} className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Deal name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  placeholder="Enter deal name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Deal value
                  </label>
                  <input
                    value={form.value}
                    onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                    placeholder={getCurrencyInputPlaceholder(currency)}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    <option value="">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Contact
                </label>
                <input
                  value={form.contact}
                  onChange={(e) => setForm((p) => ({ ...p, contact: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  placeholder="e.g. Tirth (phone)"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Assigned to
                  </label>
                  <select
                    aria-label="Assigned to"
                    disabled={access.role !== 'admin'}
                    value={form.owner_id}
                    onChange={(e) => setForm((p) => ({ ...p, owner_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={String(m.user_id)}>
                        {m.name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Stage
                  </label>
                  <select
                    value={form.stage}
                    onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value as DealStage }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                  >
                    {stages.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Expected close date
                </label>
                <input
                  type="date"
                  value={form.expected_close_date}
                  onChange={(e) => setForm((p) => ({ ...p, expected_close_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Custom fields</div>
                <DealCustomFieldsForm fields={fields} values={fieldValues} stage={form.stage} stageName={stages.find((stage) => stage.slug === form.stage)?.label} onChange={setFieldValues} disabled={submitting || access.permissions.deals !== 'edit'} />
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Tags</div>
                <TagsEditor tags={tags} onChange={setTags} disabled={submitting || access.permissions.deals !== 'edit'} />
              </div>
              {deal && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Documents</div>
                  <DealDocuments
                    dealId={deal.id}
                    initialDocuments={deal.documents ?? []}
                    canEdit={access.permissions.deals === 'edit' && !submitting}
                    canDownload
                    requiredDocuments={requiredDocuments}
                    onChanged={(documents) => onUpdated({ ...deal, documents })}
                  />
                </div>
              )}
              {deal && deal.id && deal.workspace_id && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2.5">Linked deals</div>
                  <DealAssociations workspaceId={deal.workspace_id} dealId={deal.id} />
                </div>
              )}
            </div>
          </div>
        </fieldset>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {access.role === 'admin' && <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-700 hover:bg-red-50 transition disabled:opacity-50"
              disabled={submitting || deleting}
            >
              Delete
            </button>}
          </div>
          <div className="flex items-center gap-2">
            {Object.keys(dealFieldErrors(fields, fieldValues, form.stage)).length > 0 && (
              <span className="text-xs text-amber-600 font-medium">
                Compulsory fields required for {stages.find((s) => s.slug === form.stage)?.label || 'stage'}
              </span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              disabled={submitting || deleting}
            >
              Cancel
            </button>
            {access.permissions.deals === 'edit' && <button
              onClick={submit}
              className={[
                'px-4 py-2 rounded-lg text-sm font-medium text-white transition',
                canSubmit ? 'bg-gray-900 hover:bg-gray-800' : 'bg-gray-300 cursor-not-allowed',
              ].join(' ')}
              disabled={!canSubmit || deleting}
            >
              Update deal
            </button>}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && access.role === 'admin' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowDeleteConfirm(false)} />
          <div 
            className="relative w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="text-sm font-semibold text-gray-900">Delete Deal</div>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700 mb-4">
                Are you sure you want to delete the deal <span className="font-semibold">"{deal.name}"</span>? This action cannot be undone.
              </p>
              {deal.lead_id && (
                <p className="text-xs text-gray-500 mb-4">
                  Note: The original lead will not be affected by this deletion.
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Deal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePipelineModal({
  workspaceId,
  open,
  onClose,
  onCreated,
}: {
  workspaceId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (pipeline: DealPipeline) => void;
}) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setSubmitting(false);
  }, [open]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    const token = getAuthToken();
    if (!token) {
      addToast('error', 'Authentication required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl(`/api/deals/pipelines`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: name.trim(),
        }),
      });

      const payload = await readJson(res);
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload?.message || payload?.error || 'Failed to create pipeline');
      }

      const created: DealPipeline = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      if (!created?.slug) {
        throw new Error('Invalid create response');
      }

      onCreated(created);
      addToast('success', 'Pipeline created');
      onClose();
    } catch (error: any) {
      addToast('error', error?.message || 'Failed to create pipeline');
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Create a pipeline</div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Pipeline name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
              placeholder="e.g. Sales"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition',
              canSubmit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-300 cursor-not-allowed',
            ].join(' ')}
            disabled={!canSubmit}
          >
            Create pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

function ManagePipelineModal({
  workspaceId,
  target,
  onClose,
  onRenamed,
  onDeleted,
}: {
  workspaceId: number;
  target: { mode: 'rename' | 'delete'; slug: string; name: string } | null;
  onClose: () => void;
  onRenamed: (slug: string, name: string) => void;
  onDeleted: (slug: string) => void;
}) {
  const { addToast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState('');

  React.useEffect(() => {
    if (!target) return;
    setName(target.name);
    setSubmitting(false);
  }, [target]);

  if (!target) return null;

  const isRename = target.mode === 'rename';
  const canSubmit = !submitting && (!isRename || (name.trim().length > 0 && name.trim() !== target.name));

  const submit = async () => {
    if (isRename && !canSubmit) return;
    setSubmitting(true);
    try {
      if (isRename) {
        await renamePipeline(workspaceId, target.slug, name.trim());
        onRenamed(target.slug, name.trim());
        addToast('success', 'Pipeline renamed');
      } else {
        await deletePipeline(workspaceId, target.slug);
        onDeleted(target.slug);
        addToast('success', 'Pipeline deleted');
      }
      onClose();
    } catch (error: any) {
      addToast('error', error?.message || (isRename ? 'Failed to rename pipeline' : 'Failed to delete pipeline'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">{isRename ? 'Rename pipeline' : 'Delete pipeline'}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {isRename ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Pipeline name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Pipeline name"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                placeholder="e.g. Sales"
              />
            </div>
          ) : (
            <p className="text-sm text-gray-700">Delete the pipeline <span className="font-semibold">{target.name}</span>? This cannot be undone. A pipeline that still has deals cannot be deleted.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition" disabled={submitting}>Cancel</button>
          <button
            onClick={submit}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium text-white transition',
              isRename
                ? (canSubmit ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-300 cursor-not-allowed')
                : (submitting ? 'bg-gray-300 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-500'),
            ].join(' ')}
            disabled={isRename ? !canSubmit : submitting}
          >
            {isRename ? 'Save' : 'Delete pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DealsBoard({ access }: { access: WorkspaceAccess }) {
  const { currentWorkspace, user } = useAuth();
  const { addToast } = useToast();

  const [deals, setDeals] = React.useState<Deal[]>([]);
  const loadedDealScope = React.useRef('');
  const [customFields, setCustomFields] = React.useState<DealCustomField[]>([]);
  const [requiredDocuments, setRequiredDocuments] = React.useState<string[]>([]);
  const [stageConfiguration, setStageConfiguration] = React.useState<DealStageConfig[] | null>(null);
  const STAGES = React.useMemo<StageConfig[]>(() => stageConfiguration && stageConfiguration.length > 0
    ? stageConfiguration.map((stage) => ({ slug: stage.slug, label: stage.name, color: stage.color }))
    : DEFAULT_STAGES, [stageConfiguration]);
  const [loading, setLoading] = React.useState(false);
  const [members, setMembers] = React.useState<MemberOption[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createStage, setCreateStage] = React.useState<DealStage>('new_lead');
  const [editOpen, setEditOpen] = React.useState(false);
  const [editingDeal, setEditingDeal] = React.useState<Deal | null>(null);
  const [showDeleteOnOpen, setShowDeleteOnOpen] = React.useState(false);
  const [stageCheckDeal, setStageCheckDeal] = React.useState<Deal | null>(null);
  const [stageCheckTargetStage, setStageCheckTargetStage] = React.useState<StageConfig | null>(null);
  const [pipelines, setPipelines] = React.useState<DealPipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = React.useState(false);
  const [currentPipelineSlug, setCurrentPipelineSlug] = React.useState<string>('default');
  const [createPipelineOpen, setCreatePipelineOpen] = React.useState(false);
  const [managePipeline, setManagePipeline] = React.useState<{ mode: 'rename' | 'delete'; slug: string; name: string } | null>(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [filterQuery, setFilterQuery] = React.useState('');
  const [filterOwnerId, setFilterOwnerId] = React.useState<'any' | 'unassigned' | string>('any');
  const [filterPriority, setFilterPriority] = React.useState<'any' | 'low' | 'medium' | 'high'>('any');
  const [filterStage, setFilterStage] = React.useState<'any' | DealStage>('any');
  const [hideEmptyStages, setHideEmptyStages] = React.useState(false);
  const [sortField, setSortField] = React.useState<'value' | 'name' | 'updated_at' | 'created_at'>('value');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const [draggingDealId, setDraggingDealId] = React.useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = React.useState<DealStage | null>(null);
  const optimisticRef = React.useRef<Map<number, DealStage>>(new Map());
  const recentToastRef = React.useRef<Map<string, number>>(new Map());
  const pipelineScrollRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const autoScrollRef = React.useRef<{ dir: -1 | 0 | 1; speed: number; raf: number | null }>({
    dir: 0,
    speed: 0,
    raf: null,
  });

  const setAutoScroll = React.useCallback((dir: -1 | 0 | 1, speed: number) => {
    autoScrollRef.current.dir = dir;
    autoScrollRef.current.speed = speed;

    if (dir === 0) {
      if (autoScrollRef.current.raf !== null) {
        cancelAnimationFrame(autoScrollRef.current.raf);
        autoScrollRef.current.raf = null;
      }
      return;
    }

    if (autoScrollRef.current.raf !== null) return;

    const step = () => {
      const container = pipelineScrollRef.current;
      if (!container || !draggingRef.current || autoScrollRef.current.dir === 0) {
        autoScrollRef.current.raf = null;
        return;
      }

      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxScrollLeft === 0) {
        autoScrollRef.current.raf = null;
        return;
      }

      const next = Math.min(
        maxScrollLeft,
        Math.max(0, container.scrollLeft + autoScrollRef.current.dir * autoScrollRef.current.speed)
      );
      container.scrollLeft = next;
      autoScrollRef.current.raf = requestAnimationFrame(step);
    };

    autoScrollRef.current.raf = requestAnimationFrame(step);
  }, []);

  const handleAutoScrollEvent = React.useCallback(
    (e: React.DragEvent) => {
      if (!draggingRef.current) return;
      const container = pipelineScrollRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const threshold = 80;
      const leftDist = e.clientX - rect.left;
      const rightDist = rect.right - e.clientX;

      if (leftDist < threshold) {
        const ratio = Math.max(0, Math.min(1, (threshold - leftDist) / threshold));
        setAutoScroll(-1, 8 + ratio * 18);
        return;
      }

      if (rightDist < threshold) {
        const ratio = Math.max(0, Math.min(1, (threshold - rightDist) / threshold));
        setAutoScroll(1, 8 + ratio * 18);
        return;
      }

      setAutoScroll(0, 0);
    },
    [setAutoScroll]
  );

  React.useEffect(() => {
    draggingRef.current = draggingDealId !== null;
    if (!draggingRef.current) {
      setAutoScroll(0, 0);
    }
  }, [draggingDealId, setAutoScroll]);

  const pushErrorOnce = React.useCallback(
    (message: string) => {
      const key = String(message || 'Unknown error');
      const now = Date.now();
      const last = recentToastRef.current.get(key) || 0;
      if (now - last < 1500) return;
      recentToastRef.current.set(key, now);
      addToast('error', key);
    },
    [addToast]
  );

  const fetchMembers = React.useCallback(async (workspaceId: number) => {
    const token = getAuthToken();
    if (!token) return;

    try {
      const membersRes = await fetch(apiUrl(`/api/workspaces/${workspaceId}/members`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const membersPayload = await readJson(membersRes);
      if (!membersRes.ok || membersPayload.status !== 'success') {
        setMembers([]);
        return;
      }

      const rawMembers = Array.isArray(membersPayload.data) ? membersPayload.data : [membersPayload.data];
      const users: MemberOption[] = rawMembers
        .filter((m: any) => Number.isFinite(Number(m.user_id)) && Number(m.user_id) > 0)
        .map((m: any) => ({
          user_id: Number(m.user_id),
          name: String(m.user_name || '').trim(),
          email: String(m.user_email || '').trim(),
        }));
      // Older workspaces may store the owner only on the workspace, without a member row.
      const workspaceOwnerId = Number(currentWorkspace?.owner_id);
      if (currentWorkspace?.id === workspaceId && workspaceOwnerId > 0 && !users.some((member) => member.user_id === workspaceOwnerId)) {
        users.push({ user_id: workspaceOwnerId, name: Number(user?.id) === workspaceOwnerId ? user?.name || 'Workspace owner' : 'Workspace owner', email: '' });
      }
      users.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
      setMembers(users);
    } catch {
      setMembers([]);
    }
  }, [currentWorkspace?.id, currentWorkspace?.owner_id, user?.id, user?.name]);

  const fetchPipelines = React.useCallback(
    async (workspaceId: number) => {
      const token = getAuthToken();
      if (!token) {
        pushErrorOnce('Authentication required');
        return;
      }

      setPipelinesLoading(true);
      try {
        const res = await fetch(
          apiUrl(`/api/deals/pipelines?workspace_id=${workspaceId}&limit=10000`),
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const payload = await readJson(res);
        if (!res.ok || payload?.status !== 'success') {
          throw new Error(payload?.message || payload?.error || 'Failed to load pipelines');
        }
        const data = Array.isArray(payload?.data) ? payload.data : [payload?.data];
        const normalized: DealPipeline[] = data
          .filter(Boolean)
          .map((p: any) => ({
            id: Number(p?.id || 0),
            workspace_id: Number(p?.workspace_id || workspaceId),
            slug: String(p?.slug || '').trim(),
            name: String(p?.name || '').trim(),
          }))
          .filter((p: { slug: string; name: string; }) => p.slug && p.name);

        const withDefault = normalized.some((p) => p.slug === 'default')
          ? normalized
          : [{ id: 0, workspace_id: workspaceId, slug: 'default', name: 'Default' }, ...normalized];

        setPipelines(withDefault);
        setCurrentPipelineSlug((prev) => {
          const next = String(prev || 'default').trim() || 'default';
          return withDefault.some((p) => p.slug === next) ? next : 'default';
        });
      } catch (error: any) {
        setPipelines([{ id: 0, workspace_id: workspaceId, slug: 'default', name: 'Default' }]);
        setCurrentPipelineSlug('default');
        pushErrorOnce(error?.message || 'Failed to load pipelines');
      } finally {
        setPipelinesLoading(false);
      }
    },
    [pushErrorOnce]
  );

  React.useEffect(() => {
    if (!currentWorkspace?.id) return;
    const controller = new AbortController();
    setStageConfiguration(null);
    setCustomFields([]);
    setRequiredDocuments([]);
    // Load pipeline-specific stages. currentPipelineSlug may be 'default' on first render.
    void readPipelineConfiguration(currentWorkspace.id, currentPipelineSlug, controller.signal).then((configuration) => {
      if (!controller.signal.aborted) {
        setStageConfiguration(configuration?.stages ?? []);
        setCustomFields(configuration?.fields ?? []);
        setRequiredDocuments(Array.isArray(configuration?.required_documents) ? configuration.required_documents : []);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) pushErrorOnce(error?.message || 'Failed to load deal settings');
    });
    return () => controller.abort();
  }, [currentWorkspace?.id, currentPipelineSlug, pushErrorOnce]);

  const fetchDeals = React.useCallback(async (workspaceId: number, pipelineSlug: string, signal: AbortSignal, foreground: boolean) => {
    const token = getAuthToken();
    if (!token) {
      pushErrorOnce('Authentication required');
      return;
    }

    if (foreground) setLoading(true);
    try {
      const query = new URLSearchParams({
        workspace_id: String(workspaceId),
        limit: '10000',
        pipeline_slug: String(pipelineSlug || 'default'),
      });
      const res = await fetch(apiUrl(`/api/deals?${query.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const payload = await readJson(res);
      if (!res.ok || payload?.status !== 'success') {
        throw new Error(payload?.message || payload?.error || 'Failed to load deals');
      }
      const data = Array.isArray(payload?.data) ? payload.data : [payload?.data];
      if (!signal.aborted) setDeals(data.filter(Boolean));
    } catch (error: any) {
      if (!signal.aborted) {
        setDeals([]);
        pushErrorOnce(error?.message || 'Failed to load deals');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [pushErrorOnce]);

  React.useEffect(() => {
    if (!currentWorkspace?.id) return;
    void fetchPipelines(currentWorkspace.id);
    void fetchMembers(currentWorkspace.id);
  }, [currentWorkspace?.id, fetchMembers, fetchPipelines]);

  React.useEffect(() => {
    if (!currentWorkspace?.id) return;
    const controller = new AbortController();
    const scope = `${currentWorkspace.id}:${currentPipelineSlug}`;
    void fetchDeals(currentWorkspace.id, currentPipelineSlug, controller.signal, loadedDealScope.current !== scope);
    loadedDealScope.current = scope;
    return () => controller.abort();
  }, [currentWorkspace?.id, currentPipelineSlug, fetchDeals, access]);

  React.useEffect(() => {
    if (editingDeal && !deals.some((deal) => deal.id === editingDeal.id)) {
      setEditingDeal(null);
      setEditOpen(false);
      setShowDeleteOnOpen(false);
    }
  }, [deals, editingDeal]);

  const filteredDeals = React.useMemo(() => {
    const query = String(filterQuery || '').trim().toLowerCase();
    const stageFilter = filterStage;
    const ownerFilter = String(filterOwnerId || 'any');
    const priorityFilter = filterPriority;

    return deals.filter((d) => {
      if (query) {
        const name = String(d.name || '').toLowerCase();
        const contact = String(d.contact || '').toLowerCase();
        if (!name.includes(query) && !contact.includes(query)) return false;
      }

      if (stageFilter !== 'any') {
        const stage = (d.stage || 'new_lead') as DealStage;
        if (stage !== stageFilter) return false;
      }

      if (ownerFilter !== 'any') {
        const ownerId = d.owner_id === null || d.owner_id === undefined ? null : Number(d.owner_id);
        if (ownerFilter === 'unassigned') {
          if (ownerId !== null) return false;
        } else {
          if (ownerId === null) return false;
          if (String(ownerId) !== ownerFilter) return false;
        }
      }

      if (priorityFilter !== 'any') {
        const priority = String(d.priority || '').trim().toLowerCase();
        if (priority !== priorityFilter) return false;
      }

      return true;
    });
  }, [deals, filterOwnerId, filterPriority, filterQuery, filterStage]);

  const dealsCountLabel = React.useMemo(() => {
    const active =
      String(filterQuery || '').trim() ||
      filterOwnerId !== 'any' ||
      filterPriority !== 'any' ||
      filterStage !== 'any';

    return active ? `${filteredDeals.length} Deals` : `${deals.length} Deals`;
  }, [deals.length, filterOwnerId, filterPriority, filterQuery, filterStage, filteredDeals.length]);

  const sortLabel = React.useMemo(() => {
    if (sortField === 'name') return 'Name';
    if (sortField === 'updated_at') return 'Recently Updated';
    if (sortField === 'created_at') return 'Created';
    return 'Deal Value';
  }, [sortField]);

  const dealsByStage = React.useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    for (const s of STAGES) map.set(s.slug, []);

    const timestamp = (value: unknown) => {
      const raw = String(value || '').trim();
      if (!raw) return 0;
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const compare = (a: Deal, b: Deal) => {
      const dir = sortDir === 'asc' ? 1 : -1;

      if (sortField === 'value') {
        const av = Number(a.value || 0);
        const bv = Number(b.value || 0);
        if (av !== bv) return (av - bv) * dir;
      } else if (sortField === 'name') {
        const an = String(a.name || '').toLowerCase();
        const bn = String(b.name || '').toLowerCase();
        if (an !== bn) return an.localeCompare(bn) * dir;
      } else if (sortField === 'updated_at') {
        const at = timestamp((a as any).updated_at);
        const bt = timestamp((b as any).updated_at);
        if (at !== bt) return (at - bt) * dir;
      } else if (sortField === 'created_at') {
        const at = timestamp((a as any).created_at);
        const bt = timestamp((b as any).created_at);
        if (at !== bt) return (at - bt) * dir;
      }

      return Number(a.id || 0) - Number(b.id || 0);
    };

    for (const d of filteredDeals) {
      const stage = (d.stage || 'new_lead') as DealStage;
      if (!map.has(stage)) continue;
      map.get(stage)!.push(d);
    }

    for (const stage of STAGES) {
      const list = map.get(stage.slug);
      if (list && list.length > 1) list.sort(compare);
    }

    return map;
  }, [filteredDeals, sortDir, sortField, STAGES]);

  const membersById = React.useMemo(() => {
    const map = new Map<number, MemberOption>();
    for (const m of members) {
      const id = Number(m.user_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      map.set(id, m);
    }
    return map;
  }, [members]);

  const totalsByStage = React.useMemo(() => {
    const totals = new Map<DealStage, { count: number; value: number }>();
    for (const s of STAGES) totals.set(s.slug, { count: 0, value: 0 });
    for (const d of filteredDeals) {
      const stage = (d.stage || 'new_lead') as DealStage;
      const current = totals.get(stage);
      if (!current) continue;
      current.count += 1;
      current.value += Number(d.value || 0);
    }
    return totals;
  }, [filteredDeals, STAGES]);

  const visibleStages = React.useMemo(() => {
    if (!hideEmptyStages || loading) return STAGES;
    return STAGES.filter((s) => (dealsByStage.get(s.slug)?.length || 0) > 0);
  }, [dealsByStage, hideEmptyStages, loading, STAGES]);

  const moveDealOptimistic = React.useCallback(
    (dealId: number, nextStage: DealStage) => {
      setDeals((prev) => {
        const current = prev.find((d) => d.id === dealId);
        if (!current) return prev;
        const currentStage = (current.stage || 'new_lead') as DealStage;
        if (currentStage === nextStage) return prev;
        optimisticRef.current.set(dealId, currentStage);
        return prev.map((d) => (d.id === dealId ? { ...d, stage: nextStage } : d));
      });
    },
    []
  );

  const revertOptimistic = React.useCallback((dealId: number) => {
    const previous = optimisticRef.current.get(dealId);
    if (!previous) return;
    optimisticRef.current.delete(dealId);
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage: previous } : d)));
  }, []);

  const persistStage = React.useCallback(
    async (dealId: number, nextStage: DealStage) => {
      const token = getAuthToken();
      if (!token) {
        revertOptimistic(dealId);
        pushErrorOnce('Authentication required');
        return;
      }

      try {
        const updated = await saveDeal({ stage: nextStage }, dealId);
        setDeals((current) => current.map((deal) => deal.id === dealId ? updated : deal));
        optimisticRef.current.delete(dealId);
      } catch (error: any) {
        revertOptimistic(dealId);
        pushErrorOnce(error?.message || 'Failed to update deal stage');
      }
    },
    [pushErrorOnce, revertOptimistic]
  );

  const handleRequestStageTransition = React.useCallback(
    async (deal: Deal, targetStageSlug: DealStage) => {
      if (access.permissions.deals !== 'edit' || !stageConfiguration || optimisticRef.current.has(deal.id)) return;
      const currentStage = (deal.stage || 'new_lead') as DealStage;
      if (currentStage === targetStageSlug) return;

      const targetStageObj = STAGES.find((s) => s.slug === targetStageSlug);
      const fieldErrors = dealFieldErrors(customFields, deal.custom_fields ?? {}, targetStageSlug);
      const targetStageConfig = stageConfiguration.find((s) => s.slug === targetStageSlug);
      const isConversionStage = Boolean(targetStageConfig?.counts_as_conversion);
      const reqDocs = isConversionStage ? requiredDocuments : [];
      const attachedDocs = new Set((deal.documents || []).map((d) => String(d.kind || '').trim().toLowerCase()));
      const hasMissingDocs = reqDocs.some((req) => !attachedDocs.has(req.toLowerCase()));

      if (Object.keys(fieldErrors).length > 0 || hasMissingDocs) {
        setDraggingDealId(null);
        setDragOverStage(null);
        setStageCheckDeal(deal);
        setStageCheckTargetStage(targetStageObj || null);
        return;
      }

      moveDealOptimistic(deal.id, targetStageSlug);
      await persistStage(deal.id, targetStageSlug);
    },
    [access.permissions.deals, customFields, moveDealOptimistic, persistStage, requiredDocuments, STAGES, stageConfiguration]
  );

  const onDropToStage = async (stage: DealStage) => {
    if (access.permissions.deals !== 'edit' || !draggingDealId || !stageConfiguration || optimisticRef.current.has(draggingDealId)) return;
    const deal = deals.find((d) => d.id === draggingDealId);
    if (!deal) return;
    await handleRequestStageTransition(deal, stage);
  };

  const openCreateDeal = React.useCallback((stage: DealStage) => {
    if (!stageConfiguration) { pushErrorOnce('Deal settings are still loading. Refresh if this continues.'); return; }
    setCreateStage(stage);
    setCreateOpen(true);
  }, [stageConfiguration, pushErrorOnce]);

  const canRender = Boolean(currentWorkspace?.id);

  if (!canRender) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-gray-500">
        Select a workspace to view deals.
      </div>
    );
  }

  const workspaceCurrency = normalizeWorkspaceCurrency(currentWorkspace?.currency);

  return (
    <div>
      <div className="sticky top-16 z-30 bg-white border-b border-gray-200 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-lg sm:text-xl font-semibold text-gray-900">Deals</div>{access.role !== 'admin' && <p className="mt-1 text-xs text-gray-500">Only deals assigned to you · {access.permissions.deals === 'edit' ? 'Can edit and move' : 'View only'}</p>}</div>

          <button
            type="button"
            disabled={access.role !== 'admin'} onClick={() => setCreatePipelineOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-4 h-4" />
            New Pipeline
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0 relative">
            <div className="text-xs font-medium text-gray-600">{dealsCountLabel}</div>

            <select
              value={currentPipelineSlug}
              onChange={(e) => {
                setStageConfiguration(null);
                setCurrentPipelineSlug(e.target.value);
              }}
              className="h-8 px-2.5 rounded-md border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={pipelinesLoading}
            >
              {pipelines.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>

            {access.role === 'admin' && currentPipelineSlug !== 'default' && (
              <>
                <button
                  type="button"
                  aria-label="Rename pipeline"
                  onClick={() => {
                    const p = pipelines.find((x) => x.slug === currentPipelineSlug);
                    if (p) setManagePipeline({ mode: 'rename', slug: p.slug, name: p.name });
                  }}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete pipeline"
                  onClick={() => {
                    const p = pipelines.find((x) => x.slug === currentPipelineSlug);
                    if (p) setManagePipeline({ mode: 'delete', slug: p.slug, name: p.name });
                  }}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-600 transition"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setFilterOpen((p) => !p);
                setViewOpen(false);
                setSortOpen(false);
              }}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 transition"
            >
              <FunnelIcon className="w-4 h-4 text-gray-500" />
              Filter
            </button>

            {filterOpen ? (
              <div className="absolute left-0 top-full mt-2 w-[340px] rounded-xl border border-gray-200 bg-white shadow-lg p-3 z-40">
                <div className="grid gap-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-1">Search</div>
                    <input
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Name or contact…"
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs font-semibold text-gray-700 mb-1">Assigned to</div>
                      <select
                        value={filterOwnerId}
                        onChange={(e) => setFilterOwnerId(e.target.value as any)}
                        className="w-full h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                      >
                        <option value="any">Any</option>
                        <option value="unassigned">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={String(m.user_id)}>
                            {m.name || m.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-700 mb-1">Priority</div>
                      <select
                        value={filterPriority}
                        onChange={(e) => setFilterPriority(e.target.value as any)}
                        className="w-full h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                      >
                        <option value="any">Any</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-1">Stage</div>
                    <select
                      value={filterStage}
                      onChange={(e) => setFilterStage(e.target.value as any)}
                      className="w-full h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition"
                    >
                      <option value="any">Any</option>
                      {STAGES.map((s) => (
                        <option key={s.slug} value={s.slug}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setFilterQuery('');
                        setFilterOwnerId('any');
                        setFilterPriority('any');
                        setFilterStage('any');
                      }}
                      className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterOpen(false)}
                      className="h-9 px-3 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              type="button"
              onClick={() => {
                setViewOpen((p) => !p);
                setFilterOpen(false);
                setSortOpen(false);
              }}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 transition"
            >
              <PencilSquareIcon className="w-4 h-4 text-gray-500" />
              Edit View
            </button>
            {viewOpen ? (
              <div className="absolute right-0 top-full mt-2 w-[240px] rounded-xl border border-gray-200 bg-white shadow-lg p-3 z-40">
                <button
                  type="button"
                  onClick={() => setHideEmptyStages((p) => !p)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 transition"
                >
                  <span>Hide empty stages</span>
                  <span className={hideEmptyStages ? 'text-gray-900' : 'text-gray-400'}>
                    {hideEmptyStages ? 'On' : 'Off'}
                  </span>
                </button>
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setViewOpen(false)}
                    className="h-9 px-3 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSortOpen((p) => !p);
                setFilterOpen(false);
                setViewOpen(false);
              }}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 transition"
            >
              <ArrowsUpDownIcon className="w-4 h-4 text-gray-500" />
              Sort: {sortLabel}
            </button>
            {sortOpen ? (
              <div className="absolute right-0 top-full mt-2 w-[260px] rounded-xl border border-gray-200 bg-white shadow-lg p-2 z-40">
                <button
                  type="button"
                  onClick={() => {
                    setSortField('value');
                    setSortDir('desc');
                    setSortOpen(false);
                  }}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    sortField === 'value' && sortDir === 'desc' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span>Deal Value</span>
                  <span className="text-xs opacity-80">High → Low</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortField('value');
                    setSortDir('asc');
                    setSortOpen(false);
                  }}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    sortField === 'value' && sortDir === 'asc' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span>Deal Value</span>
                  <span className="text-xs opacity-80">Low → High</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortField('name');
                    setSortDir('asc');
                    setSortOpen(false);
                  }}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    sortField === 'name' && sortDir === 'asc' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span>Name</span>
                  <span className="text-xs opacity-80">A → Z</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortField('updated_at');
                    setSortDir('desc');
                    setSortOpen(false);
                  }}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    sortField === 'updated_at' && sortDir === 'desc'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-800 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span>Recently Updated</span>
                  <span className="text-xs opacity-80">New → Old</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <CreateDealModal
        workspaceId={currentWorkspace!.id}
        currency={workspaceCurrency}
        initialStage={createStage}
        pipelineSlug={currentPipelineSlug}
        open={createOpen}
        members={members}
        stages={STAGES}
        fields={customFields}
        access={access}
        onClose={() => setCreateOpen(false)}
        onCreated={(deal) => {
          setDeals((prev) => [deal, ...prev]);
        }}
      />

      <CreatePipelineModal
        workspaceId={currentWorkspace!.id}
        open={createPipelineOpen}
        onClose={() => setCreatePipelineOpen(false)}
        onCreated={(pipeline) => {
          setPipelines((prev) => {
            const next = [...prev];
            if (!next.some((p) => p.slug === pipeline.slug)) {
              next.push(pipeline);
            }
            next.sort((a, b) => {
              if (a.slug === 'default') return -1;
              if (b.slug === 'default') return 1;
              return String(a.name).localeCompare(String(b.name));
            });
            return next;
          });
          setStageConfiguration(null);
          setCurrentPipelineSlug(pipeline.slug);
          setDeals([]);
        }}
      />

      <ManagePipelineModal
        workspaceId={currentWorkspace!.id}
        target={managePipeline}
        onClose={() => setManagePipeline(null)}
        onRenamed={(slug, name) => {
          setPipelines((prev) => prev.map((p) => (p.slug === slug ? { ...p, name } : p)));
        }}
        onDeleted={(slug) => {
          setPipelines((prev) => prev.filter((p) => p.slug !== slug));
          if (currentPipelineSlug === slug) {
            setStageConfiguration(null);
            setCurrentPipelineSlug('default');
            setDeals([]);
          }
        }}
      />

      <DealStageRequirementsModal
        open={Boolean(stageCheckDeal && stageCheckTargetStage)}
        deal={stageCheckDeal}
        sourceStage={STAGES.find((s) => s.slug === stageCheckDeal?.stage) || null}
        targetStage={stageCheckTargetStage}
        fields={customFields}
        requiredDocuments={requiredDocuments}
        onClose={() => {
          setStageCheckDeal(null);
          setStageCheckTargetStage(null);
        }}
        onSuccess={(updatedDeal) => {
          setDeals((prev) => prev.map((d) => (d.id === updatedDeal.id ? updatedDeal : d)));
          setStageCheckDeal(null);
          setStageCheckTargetStage(null);
        }}
      />

      <EditDealModal
        deal={editingDeal}
        currency={workspaceCurrency}
        pipelineSlug={currentPipelineSlug}
        open={editOpen}
        members={members}
        stages={STAGES}
        fields={customFields}
        requiredDocuments={requiredDocuments}
        access={access}
        showDeleteOnOpen={showDeleteOnOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingDeal(null);
          setShowDeleteOnOpen(false);
        }}
        onUpdated={(updatedDeal) => {
          setDeals((prev) => prev.map((d) => (d.id === updatedDeal.id ? updatedDeal : d)));
        }}
        onDeleted={(dealId) => {
          setDeals((prev) => prev.filter((d) => d.id !== dealId));
        }}
      />

      <div className="mt-3 rounded-2xl border border-gray-200 bg-white min-w-0">
        <div className="p-3">
          <div
            ref={pipelineScrollRef}
            className="flex gap-3 overflow-x-auto pb-2 w-full min-w-0"
            onDragOver={handleAutoScrollEvent}
            onDragLeave={() => setAutoScroll(0, 0)}
            onDrop={() => setAutoScroll(0, 0)}
          >
            {stageConfiguration === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="min-w-[280px] w-[320px] shrink-0 rounded-2xl border border-gray-200 bg-gray-50/50 animate-pulse">
                  <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                      <div className="h-4 w-24 bg-gray-200 rounded" />
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="h-24 bg-white rounded-xl border border-gray-100" />
                    <div className="h-24 bg-white rounded-xl border border-gray-100" />
                  </div>
                </div>
              ))
            ) : (
              visibleStages.map((stage) => {
                const stageDeals = dealsByStage.get(stage.slug) || [];
                const totals = totalsByStage.get(stage.slug) || { count: 0, value: 0 };
                const isOver = dragOverStage === stage.slug;

              return (
                <div
                  key={stage.slug}
                  className={[
                    'min-w-[280px] w-[320px] shrink-0 rounded-2xl border',
                    isOver ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-gray-50/50',
                    'transition-colors',
                  ].join(' ')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    handleAutoScrollEvent(e);
                    setDragOverStage(stage.slug);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    handleAutoScrollEvent(e);
                    setDragOverStage(stage.slug);
                  }}
                  onDragLeave={() => {
                    setDragOverStage((prev) => (prev === stage.slug ? null : prev));
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setAutoScroll(0, 0);
                    setDragOverStage(null);
                    await onDropToStage(stage.slug);
                  }}
                >
                  <div className="px-3 py-2.5 border-b border-gray-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <div className="text-sm font-semibold text-gray-900 truncate">{stage.label}</div>
                      {customFields.some((f) => !f.archived && f.required_in_stages.includes(stage.slug)) && (
                        <span
                          title="Stage has compulsory properties"
                          className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                        />
                      )}
                      <div className="text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                        {totals.count}
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-gray-900">
                      {formatWorkspaceCurrency(totals.value, workspaceCurrency)}
                    </div>
                  </div>

                  <div className="p-3 space-y-2.5 min-h-[100px]">
                    {isOver ? (
                      <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white/60 h-16 transition-all" />
                    ) : null}

                    {loading ? (
                      <div className="text-sm text-gray-500">Loading…</div>
                    ) : stageDeals.length === 0 ? (
                      <div className="text-sm text-gray-500">No deals</div>
                    ) : (
                      stageDeals.map((deal) => {
                        const ownerId = deal.owner_id !== null && deal.owner_id !== undefined ? Number(deal.owner_id) : null;
                        const owner = ownerId !== null && Number.isFinite(ownerId) && ownerId > 0 ? membersById.get(ownerId) : undefined;
                        const ownerLabel = owner ? String(owner.name || owner.email).trim() : undefined;
                        const ownerInitial = ownerLabel ? ownerLabel.charAt(0).toUpperCase() : undefined;

                        return (
                          <DealCard
                            key={deal.id}
                            stage={stage.slug}
                            deal={deal}
                            currency={workspaceCurrency}
                            ownerLabel={ownerLabel}
                            ownerInitial={ownerInitial}
                            dragging={draggingDealId === deal.id}
                            readOnly={access.permissions.deals !== 'edit'}
                            onDragStart={(dealId) => setDraggingDealId(dealId)}
                            onDragEnd={() => {
                              setDraggingDealId(null);
                              setDragOverStage(null);
                            }}
                            onEdit={(deal) => {
                              setEditingDeal(deal);
                              setEditOpen(true);
                            }}
                            onDelete={access.role === 'admin' ? (dealId) => {
                              const dealToDelete = deals.find((d) => d.id === dealId);
                              if (dealToDelete) {
                                setEditingDeal(dealToDelete);
                                setShowDeleteOnOpen(true);
                                setEditOpen(true);
                              }
                            } : undefined}
                            onMoveStage={handleRequestStageTransition}
                            allStages={STAGES}
                          />
                        );
                      })
                    )}
                    <button
                      type="button"
                      disabled={access.permissions.deals !== 'edit'}
                      onClick={() => openCreateDeal(stage.slug)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white/70 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-white hover:border-gray-400 transition"
                    >
                      <PlusIcon className="w-4 h-4" />
                      {access.permissions.deals === 'edit' ? 'New Deal' : 'View only'}
                    </button>
                  </div>
                </div>
              );
            }))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const { currentWorkspace } = useAuth();
  const { access, error } = useWorkspaceAccess(currentWorkspace?.id);
  if (!access) return <p className="p-6 text-sm text-gray-500">{error || 'Loading deal access…'}</p>;
  if (access.permissions.deals === 'none') return <p className="p-6 text-sm text-gray-500">Deal access is disabled. Ask a workspace administrator for access.</p>;
  return <DealsBoard key={`${currentWorkspace?.id}:${access.role}:${access.permissions.deals}`} access={access} />;
}