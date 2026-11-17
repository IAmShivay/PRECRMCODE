import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BoltIcon,
  EnvelopeIcon,
  ArrowsRightLeftIcon,
  UserIcon,
  TagIcon,
  ClipboardDocumentCheckIcon,
  BellIcon,
  GlobeAltIcon,
  PlusIcon,
  XMarkIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { WhatsAppIcon } from '../components/SocialIcons';
import {
  getPipelines,
  readPipelineConfiguration,
  getWorkspaceMembers,
  listAutomations,
  saveAutomation,
  deleteAutomation,
  listAutomationRuns,
  type AutomationAction,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
  type WorkspaceMemberWithUser,
} from '../lib/api-client';

const BLUE = 'bg-[#3F7DF4] hover:bg-[#2F6BE0] text-white';
const LEAD_COLUMN = '__lead__';
const OWNER = 'owner';

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_created: 'When created in this stage',
  deal_moved: 'When moved to this stage',
  deal_created_or_moved: 'When created in or moved to this stage',
  deal_owner_changed: 'When the owner changes',
  lead_created: 'When a new lead arrives',
};
const STAGE_TRIGGERS: AutomationTrigger[] = ['deal_created_or_moved', 'deal_moved', 'deal_created', 'deal_owner_changed'];

const ACTIONS: { key: AutomationAction; label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; dealOnly?: boolean }[] = [
  { key: 'send_email', label: 'Send email', icon: EnvelopeIcon },
  { key: 'send_whatsapp', label: 'Send WhatsApp template', icon: WhatsAppIcon },
  { key: 'create_task', label: 'Add task', icon: ClipboardDocumentCheckIcon },
  { key: 'move_stage', label: 'Change stage', icon: ArrowsRightLeftIcon, dealOnly: true },
  { key: 'assign_owner', label: 'Change owner', icon: UserIcon, dealOnly: true },
  { key: 'add_tags', label: 'Add tags', icon: TagIcon, dealOnly: true },
  { key: 'remove_tags', label: 'Remove tags', icon: TagIcon, dealOnly: true },
  { key: 'notify_user', label: 'Notify a teammate', icon: BellIcon },
  { key: 'send_webhook', label: 'Send webhook', icon: GlobeAltIcon },
];
const actionMeta = (key: AutomationAction) => ACTIONS.find((a) => a.key === key) ?? ACTIONS[0]!;

const DELAYS = [
  { label: 'Immediately', minutes: 0 },
  { label: 'After 5 minutes', minutes: 5 },
  { label: 'After 10 minutes', minutes: 10 },
  { label: 'After 1 hour', minutes: 60 },
  { label: 'After 1 day', minutes: 1440 },
  { label: 'After 3 days', minutes: 4320 },
];
const describeDelay = (minutes: number) =>
  DELAYS.find((d) => d.minutes === minutes)?.label ??
  (minutes % 1440 === 0 ? `After ${minutes / 1440} days` : minutes % 60 === 0 ? `After ${minutes / 60} hours` : `After ${minutes} minutes`);

const VARIABLES = ['{{lead.name}}', '{{lead.email}}', '{{lead.phone}}', '{{deal.name}}', '{{deal.value}}', '{{deal.stage}}'];

const RUN_STYLE: Record<AutomationRun['status'], string> = {
  done: 'bg-[#E6F6EC] text-[#1E8E4E]',
  skipped: 'bg-gray-100 text-gray-600',
  pending: 'bg-[#EAF1FE] text-[#1F5FD6]',
  running: 'bg-[#EAF1FE] text-[#1F5FD6]',
  failed: 'bg-[#FDECEC] text-[#C62828]',
};

const csv = (value: unknown) => (Array.isArray(value) ? value.join(', ') : '');
const fromCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

interface Stage { slug: string; name: string; color: string }
interface Pipeline { slug: string; name: string }

const blankRule = (workspaceId: number, pipeline: string, column: string): AutomationRule => ({
  workspace_id: workspaceId,
  name: '',
  pipeline_slug: pipeline,
  stage: column === LEAD_COLUMN ? '' : column,
  trigger_type: column === LEAD_COLUMN ? 'lead_created' : 'deal_created_or_moved',
  delay_minutes: 0,
  conditions: { still_in_stage: true },
  action_type: 'send_email',
  action_config: {},
  active: true,
  sort_order: 0,
});

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm text-gray-700">{label}</span>
    <span className="mt-1 block">{children}</span>
    {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
  </label>
);
const INPUT = 'w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#3F7DF4] focus:outline-none focus:ring-2 focus:ring-[#3F7DF4]/20';

const AutomationsPage: React.FC = () => {
  const { currentWorkspace, getUserRole } = useAuth();
  const { addToast } = useToast();
  const workspaceId = currentWorkspace?.id ?? 0;
  const isAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;

  const [tab, setTab] = useState<'rules' | 'log'>('rules');
  const [pipelines, setPipelines] = useState<Pipeline[]>([{ slug: 'default', name: 'Default' }]);
  const [pipeline, setPipeline] = useState('default');
  const [stages, setStages] = useState<Stage[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberWithUser[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    if (!workspaceId) return;
    setLoadError(null);
    try {
      setRules(await listAutomations(workspaceId));
    } catch (error) {
      setLoadError((error as Error).message || 'Could not load automations');
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      getPipelines(workspaceId).then((list) => {
        const mapped = (list || []).map((p: any) => ({ slug: String(p.slug), name: String(p.name || p.slug) }));
        if (mapped.length) setPipelines(mapped);
      }).catch(() => undefined),
      getWorkspaceMembers(workspaceId).then((res) => setMembers(res.data || [])).catch(() => undefined),
      loadRules(),
    ]).finally(() => setLoading(false));
  }, [workspaceId, loadRules]);

  useEffect(() => {
    if (!workspaceId) return;
    readPipelineConfiguration(workspaceId, pipeline)
      .then((config) => setStages((config?.stages || []).map((s: any) => ({ slug: s.slug, name: s.name, color: s.color }))))
      .catch(() => setStages([]));
  }, [workspaceId, pipeline]);

  useEffect(() => {
    if (tab !== 'log' || !workspaceId) return;
    listAutomationRuns(workspaceId).then(setRuns).catch((error) => addToast('error', (error as Error).message));
  }, [tab, workspaceId, addToast]);

  const columns = useMemo(
    () => [{ slug: LEAD_COLUMN, name: 'New leads', color: '#94A3B8' }, ...stages],
    [stages]
  );
  const rulesFor = (column: string) =>
    rules.filter((rule) =>
      column === LEAD_COLUMN
        ? rule.trigger_type === 'lead_created'
        : rule.trigger_type !== 'lead_created' && rule.pipeline_slug === pipeline && rule.stage === column
    );
  const ruleName = (id: number) => rules.find((r) => r.id === id)?.name || actionMeta(rules.find((r) => r.id === id)?.action_type || 'send_email').label;

  const toggleActive = async (rule: AutomationRule) => {
    try {
      await saveAutomation({ ...rule, active: !rule.active });
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    } catch (error) {
      addToast('error', (error as Error).message);
    }
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await saveAutomation({ ...editing, name: editing.name.trim() || actionMeta(editing.action_type).label });
      addToast('success', 'Automation saved');
      setEditing(null);
      await loadRules();
    } catch (error) {
      addToast('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    try {
      await deleteAutomation(workspaceId, editing.id);
      addToast('success', 'Automation deleted');
      setEditing(null);
      await loadRules();
    } catch (error) {
      addToast('error', (error as Error).message);
    }
  };

  if (!isAdmin) {
    return (
      <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7] p-8">
        <p className="rounded-md border border-gray-200 bg-white p-6 text-gray-700">Only workspace admins can manage automations.</p>
      </div>
    );
  }

  const set = <K extends keyof AutomationRule>(key: K, value: AutomationRule[K]) =>
    setEditing((current) => (current ? { ...current, [key]: value } : current));
  const setCfg = (key: string, value: unknown) =>
    setEditing((current) => (current ? { ...current, action_config: { ...current.action_config, [key]: value } } : current));
  const setCond = (key: string, value: unknown) =>
    setEditing((current) => (current ? { ...current, conditions: { ...current.conditions, [key]: value } } : current));
  const isLeadRule = editing?.trigger_type === 'lead_created';
  const cfg = editing?.action_config || {};

  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center gap-6">
          <h1 className="text-[15px] font-bold uppercase tracking-wide text-gray-800">Automations</h1>
          <div role="tablist" className="flex gap-5">
            {(['rules', 'log'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-3 border-b-2 pb-2.5 text-[15px] ${tab === key ? 'border-[#3F7DF4] text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
              >
                {key === 'rules' ? 'Pipeline rules' : 'Run log'}
              </button>
            ))}
          </div>
        </div>
        {tab === 'rules' && (
          <select value={pipeline} onChange={(e) => setPipeline(e.target.value)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm" aria-label="Pipeline">
            {pipelines.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        )}
      </div>

      {loadError && (
        <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 rounded-md border border-[#F5C2C2] bg-[#FDECEC] px-4 py-3 text-sm text-[#9B1C1C]">
          {loadError}
        </div>
      )}

      {tab === 'rules' ? (
        <div className="overflow-x-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex min-w-max gap-3">
            {columns.map((column) => (
              <section key={column.slug} className="flex w-72 flex-shrink-0 flex-col rounded-md border border-gray-200 bg-white">
                <header className="border-b border-gray-100 px-3 py-2.5">
                  <div className="h-1 rounded-full mb-2" style={{ background: column.color?.startsWith('#') ? column.color : '#3F7DF4' }} />
                  <p className="text-sm font-semibold uppercase tracking-wide text-gray-800">{column.name}</p>
                  <p className="text-xs text-gray-500">{column.slug === LEAD_COLUMN ? 'Any source, any pipeline' : `${rulesFor(column.slug).length} automation${rulesFor(column.slug).length === 1 ? '' : 's'}`}</p>
                </header>
                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  {loading && <div className="h-16 rounded-md bg-gray-100 animate-pulse" />}
                  {rulesFor(column.slug).map((rule) => {
                    const meta = actionMeta(rule.action_type);
                    return (
                      <div key={rule.id} className={`rounded-md border p-3 ${rule.active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
                        <button type="button" onClick={() => setEditing(rule)} className="block w-full text-left">
                          <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                            <meta.icon className="h-4 w-4 flex-shrink-0 text-[#3F7DF4]" aria-hidden="true" />
                            <span className="truncate">{rule.name || meta.label}</span>
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">{TRIGGER_LABEL[rule.trigger_type]}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                            <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" /> {describeDelay(rule.delay_minutes)}
                          </span>
                        </button>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                          <input type="checkbox" checked={rule.active} onChange={() => toggleActive(rule)} className="h-3.5 w-3.5 accent-[#3F7DF4]" />
                          {rule.active ? 'On' : 'Off'}
                        </label>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setEditing(blankRule(workspaceId, pipeline, column.slug))}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-2.5 text-sm text-gray-600 hover:border-[#3F7DF4] hover:text-[#1F5FD6]"
                  >
                    <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add automation
                  </button>
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-5">
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Automation</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No runs yet. Runs appear here as soon as an automation fires.</td></tr>
                )}
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{run.run_at}</td>
                    <td className="px-4 py-2.5 text-gray-900">{ruleName(run.automation_id)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{run.deal_id ? `Deal #${run.deal_id}` : `Lead #${run.lead_id}`}</td>
                    <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${RUN_STYLE[run.status] || RUN_STYLE.skipped}`}>{run.status}</span></td>
                    <td className="px-4 py-2.5 text-gray-600">{run.error || run.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/30" onClick={() => setEditing(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Edit automation"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <BoltIcon className="h-5 w-5 text-[#3F7DF4]" aria-hidden="true" /> {editing.id ? 'Edit automation' : 'New automation'}
              </h2>
              <button onClick={() => setEditing(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close"><XMarkIcon className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <Field label="Name"><input className={INPUT} value={editing.name} onChange={(e) => set('name', e.target.value)} placeholder={actionMeta(editing.action_type).label} /></Field>

              <fieldset className="space-y-3 rounded-md border border-gray-200 p-4">
                <legend className="px-1 text-sm font-semibold text-gray-900">When</legend>
                {isLeadRule ? (
                  <p className="text-sm text-gray-700">{TRIGGER_LABEL.lead_created}</p>
                ) : (
                  <Field label="Trigger">
                    <select className={INPUT} value={editing.trigger_type} onChange={(e) => set('trigger_type', e.target.value as AutomationTrigger)}>
                      {STAGE_TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Run">
                  <select
                    className={INPUT}
                    value={DELAYS.some((d) => d.minutes === editing.delay_minutes) ? String(editing.delay_minutes) : 'custom'}
                    onChange={(e) => set('delay_minutes', e.target.value === 'custom' ? 120 : Number(e.target.value))}
                  >
                    {DELAYS.map((d) => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
                    <option value="custom">Custom delay</option>
                  </select>
                </Field>
                {!DELAYS.some((d) => d.minutes === editing.delay_minutes) && (
                  <Field label="Delay in minutes"><input type="number" min={1} className={INPUT} value={editing.delay_minutes} onChange={(e) => set('delay_minutes', Math.max(0, Number(e.target.value) || 0))} /></Field>
                )}
                {!isLeadRule && editing.delay_minutes > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="accent-[#3F7DF4]" checked={editing.conditions.still_in_stage !== false} onChange={(e) => setCond('still_in_stage', e.target.checked)} />
                    Only if the deal is still in this stage
                  </label>
                )}
              </fieldset>

              <fieldset className="space-y-3 rounded-md border border-gray-200 p-4">
                <legend className="px-1 text-sm font-semibold text-gray-900">Only if (optional)</legend>
                {!isLeadRule && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Min value"><input type="number" className={INPUT} value={editing.conditions.min_value ?? ''} onChange={(e) => setCond('min_value', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                    <Field label="Max value"><input type="number" className={INPUT} value={editing.conditions.max_value ?? ''} onChange={(e) => setCond('max_value', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                  </div>
                )}
                {!isLeadRule && (
                  <>
                    <Field label="Has any of these tags" hint="Comma separated"><input className={INPUT} value={csv(editing.conditions.tags_any)} onChange={(e) => setCond('tags_any', fromCsv(e.target.value))} /></Field>
                    <Field label="Does not have these tags" hint="Comma separated"><input className={INPUT} value={csv(editing.conditions.tags_none)} onChange={(e) => setCond('tags_none', fromCsv(e.target.value))} /></Field>
                  </>
                )}
                <Field label="Lead source contains" hint="e.g. facebook, website. Comma separated"><input className={INPUT} value={csv(editing.conditions.lead_sources)} onChange={(e) => setCond('lead_sources', fromCsv(e.target.value))} /></Field>
                <Field label="Owner is">
                  <select
                    className={INPUT}
                    value={String(editing.conditions.owner_ids?.[0] ?? '')}
                    onChange={(e) => setCond('owner_ids', e.target.value ? [Number(e.target.value)] : [])}
                  >
                    <option value="">Anyone</option>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
                  </select>
                </Field>
              </fieldset>

              <fieldset className="space-y-3 rounded-md border border-gray-200 p-4">
                <legend className="px-1 text-sm font-semibold text-gray-900">Then</legend>
                <Field label="Action">
                  <select className={INPUT} value={editing.action_type} onChange={(e) => setEditing({ ...editing, action_type: e.target.value as AutomationAction, action_config: {} })}>
                    {ACTIONS.filter((a) => !(isLeadRule && a.dealOnly)).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </Field>

                {editing.action_type === 'send_email' && (
                  <>
                    <Field label="Subject"><input className={INPUT} value={String(cfg.subject ?? '')} onChange={(e) => setCfg('subject', e.target.value)} /></Field>
                    <Field label="Message" hint={`Sent from your workspace SMTP to the lead. Variables: ${VARIABLES.join(' ')}`}>
                      <textarea rows={6} className={INPUT} value={String(cfg.body ?? '')} onChange={(e) => setCfg('body', e.target.value)} />
                    </Field>
                  </>
                )}

                {editing.action_type === 'send_whatsapp' && (
                  <>
                    <Field label="Approved template name" hint="Exactly as approved in Meta, e.g. welcome_message"><input className={INPUT} value={String(cfg.template_name ?? '')} onChange={(e) => setCfg('template_name', e.target.value)} /></Field>
                    <Field label="Language code"><input className={INPUT} value={String(cfg.language ?? 'en')} onChange={(e) => setCfg('language', e.target.value)} /></Field>
                    <Field label="Template variables" hint={`One per {{1}}, {{2}}…, comma separated. You can use ${VARIABLES.slice(0, 2).join(' ')}`}>
                      <input className={INPUT} value={csv(cfg.params)} onChange={(e) => setCfg('params', fromCsv(e.target.value))} />
                    </Field>
                  </>
                )}

                {editing.action_type === 'move_stage' && (
                  <Field label="Move to stage">
                    <select className={INPUT} value={String(cfg.stage ?? '')} onChange={(e) => setCfg('stage', e.target.value)}>
                      <option value="">Choose a stage</option>
                      {stages.filter((s) => s.slug !== editing.stage).map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                    </select>
                  </Field>
                )}

                {editing.action_type === 'assign_owner' && (
                  <Field label="New owner">
                    <select className={INPUT} value={String(cfg.user_id ?? '')} onChange={(e) => setCfg('user_id', Number(e.target.value) || '')}>
                      <option value="">Choose a teammate</option>
                      {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
                    </select>
                  </Field>
                )}

                {(editing.action_type === 'add_tags' || editing.action_type === 'remove_tags') && (
                  <Field label="Tags" hint="Comma separated"><input className={INPUT} value={csv(cfg.tags)} onChange={(e) => setCfg('tags', fromCsv(e.target.value))} /></Field>
                )}

                {editing.action_type === 'create_task' && (
                  <>
                    <Field label="Task"><input className={INPUT} value={String(cfg.title ?? '')} onChange={(e) => setCfg('title', e.target.value)} placeholder="Call {{lead.name}}" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Type">
                        <select className={INPUT} value={String(cfg.task_type ?? 'follow_up')} onChange={(e) => setCfg('task_type', e.target.value)}>
                          <option value="follow_up">Follow-up</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="other">Other</option>
                        </select>
                      </Field>
                      <Field label="Due">
                        <select className={INPUT} value={String(cfg.due_in_minutes ?? 0)} onChange={(e) => setCfg('due_in_minutes', Number(e.target.value))}>
                          <option value={0}>Immediately</option><option value={60}>In 1 hour</option><option value={1440}>In 1 day</option><option value={4320}>In 3 days</option><option value={10080}>In 1 week</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Assign to">
                      <select className={INPUT} value={String(cfg.assign_to ?? OWNER)} onChange={(e) => setCfg('assign_to', e.target.value === OWNER ? OWNER : Number(e.target.value))}>
                        <option value={OWNER}>The deal or lead owner</option>
                        {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes"><textarea rows={3} className={INPUT} value={String(cfg.description ?? '')} onChange={(e) => setCfg('description', e.target.value)} /></Field>
                  </>
                )}

                {editing.action_type === 'notify_user' && (
                  <>
                    <Field label="Who">
                      <select className={INPUT} value={String(cfg.user ?? OWNER)} onChange={(e) => setCfg('user', e.target.value === OWNER ? OWNER : Number(e.target.value))}>
                        <option value={OWNER}>The deal or lead owner</option>
                        {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
                      </select>
                    </Field>
                    <Field label="Message" hint={`Variables: ${VARIABLES.join(' ')}`}><textarea rows={3} className={INPUT} value={String(cfg.message ?? '')} onChange={(e) => setCfg('message', e.target.value)} /></Field>
                  </>
                )}

                {editing.action_type === 'send_webhook' && (
                  <Field label="URL" hint="Public https:// address. Receives the deal and lead as JSON."><input className={INPUT} value={String(cfg.url ?? '')} onChange={(e) => setCfg('url', e.target.value)} placeholder="https://" /></Field>
                )}
              </fieldset>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="accent-[#3F7DF4]" checked={editing.active} onChange={(e) => set('active', e.target.checked)} />
                Automation is on
              </label>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3.5">
              {editing.id ? (
                <button onClick={remove} className="rounded px-3 py-1.5 text-sm font-semibold text-[#C62828] hover:bg-[#FDECEC]">Delete</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50">Cancel</button>
                <button onClick={submit} disabled={saving} className={`rounded px-4 py-1.5 text-sm font-semibold disabled:opacity-60 ${BLUE}`}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default AutomationsPage;
