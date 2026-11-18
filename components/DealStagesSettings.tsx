import React from 'react';
import { PlusIcon, TrashIcon, Bars3Icon } from '@heroicons/react/24/outline';
import { readPipelineConfiguration, savePipelineConfiguration, getWorkspaceCustomFields } from '../lib/api-client';
import { PIPELINE_STATUS_TYPES, PIPELINE_STATUS_OPEN, type PipelineStatusType } from '../types/constants';
import type { DealStageConfig, DealCustomField, DealFieldType, LeadCustomField } from './types';

const STATUS_TYPE_LABELS: Record<PipelineStatusType, string> = {
  open: 'Open',
  closed: 'Closed',
  won: 'Won',
  lost: 'Lost',
};

type Pipeline = { id: number; workspace_id: number; slug: string; name: string };

async function fetchPipelines(workspaceId: number, signal?: AbortSignal): Promise<Pipeline[]> {
  const token = localStorage.getItem('scraft_auth_token');
  const base = (import.meta as any).env?.VITE_API_BASE_URL || '';
  const res = await fetch(`${base}/api/deals/pipelines?workspace_id=${workspaceId}&limit=10000`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
    signal,
  });
  if (!res.ok) throw new Error('Failed to load pipelines');
  const payload = await res.json() as { status: string; data?: unknown };
  if (payload.status !== 'success') throw new Error('Failed to load pipelines');
  const data = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
  const pipelines: Pipeline[] = (data as any[])
    .filter((p) => p?.slug && p?.name)
    .map((p) => ({
      id: Number(p.id || 0),
      workspace_id: Number(p.workspace_id || workspaceId),
      slug: String(p.slug).trim(),
      name: String(p.name).trim(),
    }));
  // Always surface the Default pipeline even if it's not stored.
  if (!pipelines.some((p) => p.slug === 'default')) {
    pipelines.unshift({ id: 0, workspace_id: workspaceId, slug: 'default', name: 'Default' });
  }
  return pipelines;
}

export default function DealStagesSettings({ workspaceId, canEdit }: { workspaceId: number; canEdit: boolean }) {
  // ── Pipelines ──────────────────────────────────────────────────────────────
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = React.useState(true);
  const [selectedPipelineSlug, setSelectedPipelineSlug] = React.useState('default');

  React.useEffect(() => {
    const controller = new AbortController();
    setPipelinesLoading(true);
    void fetchPipelines(workspaceId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setPipelines(data);
        // Keep current selection if still valid, otherwise default.
        setSelectedPipelineSlug((prev) =>
          data.some((p) => p.slug === prev) ? prev : (data[0]?.slug ?? 'default')
        );
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setPipelines([{ id: 0, workspace_id: workspaceId, slug: 'default', name: 'Default' }]);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setPipelinesLoading(false);
    });
    return () => controller.abort();
  }, [workspaceId]);

  // ── Stage / field configuration for the selected pipeline ─────────────────
  const [stages, setStages] = React.useState<DealStageConfig[]>([]);
  const [savedStages, setSavedStages] = React.useState<DealStageConfig[]>([]);
  const [fields, setFields] = React.useState<DealCustomField[]>([]);
  const [savedFields, setSavedFields] = React.useState<DealCustomField[]>([]);
  const [requiredDocuments, setRequiredDocuments] = React.useState<string[]>([]);
  const [savedRequiredDocuments, setSavedRequiredDocuments] = React.useState<string[]>([]);
  const [newName, setNewName] = React.useState('');
  const [newRequiredKind, setNewRequiredKind] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [draggedStageIndex, setDraggedStageIndex] = React.useState<number | null>(null);
  const [dragOverStageIndex, setDragOverStageIndex] = React.useState<number | null>(null);
  const [workspaceCustomFields, setWorkspaceCustomFields] = React.useState<LeadCustomField[]>([]);

  React.useEffect(() => {
    const controller = new AbortController();
    void getWorkspaceCustomFields(workspaceId).then((res) => {
      if (res?.status === 'success' && Array.isArray(res.data)) {
        setWorkspaceCustomFields(res.data.filter((f) => f.is_active === 1));
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [workspaceId]);

  const existingFieldTemplates = React.useMemo(() => {
    const standard: Array<{ key: string; label: string; type: DealFieldType; options: string[] }> = [
      { key: 'std_value', label: 'Deal Value', type: 'number', options: [] },
      { key: 'std_expected_close_date', label: 'Expected Close Date', type: 'date', options: [] },
      { key: 'std_contact', label: 'Contact', type: 'text', options: [] },
      { key: 'std_priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'] },
    ];
    const custom = workspaceCustomFields.map((wf) => {
      let type: DealFieldType = 'text';
      if (wf.field_type === 'number') type = 'number';
      else if (wf.field_type === 'date') type = 'date';
      else if (wf.field_type === 'textarea') type = 'textarea';
      else if (wf.field_type === 'select' || wf.field_type === 'multiselect') type = 'select';
      const options = wf.options ? wf.options.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : [];
      return {
        key: `wf_${wf.id}`,
        label: wf.label,
        type,
        options,
      };
    });
    return [...standard, ...custom];
  }, [workspaceCustomFields]);

  // Reload stages whenever the workspace or selected pipeline changes.
  React.useEffect(() => {
    if (pipelinesLoading) return; // Wait until pipelines are loaded before fetching config.
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSuccess('');
    void readPipelineConfiguration(workspaceId, selectedPipelineSlug, controller.signal).then((configuration) => {
      if (!controller.signal.aborted) {
        setStages(configuration.stages);
        setSavedStages(configuration.stages);
        setFields(configuration.fields);
        setSavedFields(configuration.fields);
        const required = Array.isArray((configuration as { required_documents?: unknown }).required_documents)
          ? (configuration as { required_documents: unknown[] }).required_documents.map((kind) => String(kind || '').trim().toLowerCase()).filter(Boolean)
          : [];
        setRequiredDocuments(required);
        setSavedRequiredDocuments(required);
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load deal stages');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [workspaceId, selectedPipelineSlug, pipelinesLoading]);

  const update = (slug: string, patch: Partial<DealStageConfig>) => {
    setStages((current) => current.map((stage) => stage.slug === slug ? { ...stage, ...patch } : stage));
    setSuccess('');
  };

  const reorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setStages((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
    setSuccess('');
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    const slugBase = /^[a-z]/.test(base) ? base : 'stage';
    let slug = slugBase;
    let suffix = 2;
    while (stages.some((stage) => stage.slug === slug)) slug = `${slugBase}_${suffix++}`;
    setStages((current) => [...current, { slug, name, color: '#2563EB', counts_as_conversion: false, status_type: PIPELINE_STATUS_OPEN }]);
    setNewName('');
    setSuccess('');
  };

  const save = async () => {
    const names = stages.map((stage) => stage.name.trim());
    if (names.some((name) => !name || name.length > 80)) {
      setError('Each stage needs a name of 1 to 80 characters.');
      return;
    }
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      setError('Stage names must be unique.');
      return;
    }
    if (fields.some((field) => !field.label.trim() || (field.type === 'select' && !field.options.some((option) => option.trim())))) {
      setError('Each field needs a name, and dropdown fields need at least one option.');
      return;
    }
    if (new Set(fields.map((field) => field.label.trim().toLowerCase())).size !== fields.length) {
      setError('Custom field names must be unique, including archived fields.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const normalizedRequired = requiredDocuments.map((kind) => kind.trim().toLowerCase()).filter(Boolean);
      if (new Set(normalizedRequired).size !== normalizedRequired.length) {
        setError('Required document kinds must be unique.');
        setSaving(false);
        return;
      }
      const configuration = await savePipelineConfiguration(workspaceId, selectedPipelineSlug, {
        stages: stages.map((stage) => ({ ...stage, name: stage.name.trim() })),
        fields: fields.map((field) => ({ ...field, label: field.label.trim(), options: field.type === 'select' ? field.options.map((option) => option.trim()).filter(Boolean) : [],
          required_in_stages: field.required_in_stages.filter((slug) => stages.some((stage) => stage.slug === slug)),
        })),
        required_documents: normalizedRequired,
      });
      setStages(configuration.stages);
      setSavedStages(configuration.stages);
      setFields(configuration.fields);
      setSavedFields(configuration.fields);
      const savedRequired = Array.isArray((configuration as { required_documents?: unknown }).required_documents)
        ? (configuration as { required_documents: unknown[] }).required_documents.map((kind) => String(kind || '').trim().toLowerCase()).filter(Boolean)
        : normalizedRequired;
      setRequiredDocuments(savedRequired);
      setSavedRequiredDocuments(savedRequired);
      const pipelineName = pipelines.find((p) => p.slug === selectedPipelineSlug)?.name ?? selectedPipelineSlug;
      setSuccess(`Stages and custom fields saved for the "${pipelineName}" pipeline.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save deal stages');
    } finally {
      setSaving(false);
    }
  };

  const changed = JSON.stringify(stages) !== JSON.stringify(savedStages) || JSON.stringify(fields) !== JSON.stringify(savedFields) || JSON.stringify(requiredDocuments) !== JSON.stringify(savedRequiredDocuments);
  const updateField = (id: string, patch: Partial<DealCustomField>) => {
    setFields((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field));
    setSuccess('');
  };

  const selectedPipelineName = pipelines.find((p) => p.slug === selectedPipelineSlug)?.name ?? 'Pipeline';

  return (
    <div className="px-6 pb-8 max-w-4xl">
      <h2 className="text-lg font-semibold text-gray-900">Deals</h2>
      <p className="mt-1 text-sm text-gray-500">Configure stages per pipeline. Each pipeline has its own independent stage list. Mark each stage that counts as a conversion.</p>

      {/* ── Pipeline selector ─────────────────────────────────────────────── */}
      {pipelinesLoading ? (
        <p className="mt-4 text-sm text-gray-500">Loading pipelines…</p>
      ) : (
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Pipeline
          </label>
          <select
            aria-label="Select pipeline"
            value={selectedPipelineSlug}
            onChange={(e) => {
              setSelectedPipelineSlug(e.target.value);
              setSuccess('');
              setError('');
            }}
            className="w-full max-w-xs rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
          >
            {pipelines.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Stages below apply only to the <span className="font-medium">{selectedPipelineName}</span> pipeline.
          </p>
        </div>
      )}

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      {/* ── Stage list ────────────────────────────────────────────────────── */}
      {loading ? <p className="mt-6 text-sm text-gray-500">Loading stages for {selectedPipelineName}…</p> : (
        <div className="mt-5 overflow-hidden rounded-xl border border-gray-200">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span className="w-5"></span><span>Stage name</span><span>Compulsory properties</span><span>Status</span><span>Conversion</span><span className="w-10 text-right">Actions</span>
          </div>
          {stages.map((stage, index) => {
            const isDragging = draggedStageIndex === index;
            const isOver = dragOverStageIndex === index && draggedStageIndex !== null && draggedStageIndex !== index;
            const isDropTop = isOver && draggedStageIndex > index;
            const isDropBottom = isOver && draggedStageIndex < index;
            
            return (
              <div 
                key={stage.slug}
                draggable={canEdit && !saving}
                onDragStart={(e) => {
                  setDraggedStageIndex(index);
                  e.dataTransfer.effectAllowed = 'move';
                  // Needed for Firefox
                  e.dataTransfer.setData('text/plain', index.toString());
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverStageIndex !== index) {
                    setDragOverStageIndex(index);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverStageIndex === index) {
                    setDragOverStageIndex(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedStageIndex !== null && draggedStageIndex !== index) {
                    reorder(draggedStageIndex, index);
                  }
                  setDraggedStageIndex(null);
                  setDragOverStageIndex(null);
                }}
                onDragEnd={() => {
                  setDraggedStageIndex(null);
                  setDragOverStageIndex(null);
                }}
                className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3 transition-colors ${
                  isDragging ? 'opacity-50 bg-gray-50' : 'bg-white hover:bg-gray-50'
                } ${
                  isDropTop ? 'border-t-2 border-t-blue-500 border-b border-b-transparent' : 
                  isDropBottom ? 'border-b-2 border-b-blue-500 border-t border-t-transparent' : 
                  'border-t border-t-gray-100 border-b border-b-transparent'
                } ${index === 0 && !isDropTop ? 'border-t-transparent' : ''}`}
              >
                <div className={`flex items-center justify-center ${canEdit && !saving ? 'cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600' : 'text-gray-300'}`}>
                  <Bars3Icon className="h-5 w-5" />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <input type="color" aria-label={`Color for ${stage.name}`} value={stage.color} disabled={!canEdit || saving}
                    onChange={(event) => update(stage.slug, { color: event.target.value })}
                    className="h-7 w-7 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-50" />
                  <input aria-label={`Name for ${stage.name}`} value={stage.name} maxLength={80} disabled={!canEdit || saving}
                    onChange={(event) => update(stage.slug, { name: event.target.value })}
                    className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50" />
                </div>
                <div className="flex items-center justify-center">
                  {(() => {
                    const count = fields.filter((f) => !f.archived && f.required_in_stages.includes(stage.slug)).length;
                    return (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${count > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-gray-100 text-gray-500'}`}>
                        {count} required
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-center">
                  <select aria-label={`Status type for ${stage.name}`} value={stage.status_type ?? PIPELINE_STATUS_OPEN}
                    disabled={!canEdit || saving} onChange={(event) => update(stage.slug, { status_type: event.target.value as PipelineStatusType })}
                    className="rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50">
                    {PIPELINE_STATUS_TYPES.map((type) => (
                      <option key={type} value={type}>{STATUS_TYPE_LABELS[type]}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center justify-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" aria-label={`${stage.name} counts as conversion`} checked={stage.counts_as_conversion}
                    disabled={!canEdit || saving} onChange={(event) => update(stage.slug, { counts_as_conversion: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                </label>
                <div className="flex w-10 justify-end gap-1">
                  <button type="button" title="Remove stage" aria-label={`Remove ${stage.name}`} disabled={!canEdit || saving || stages.length === 1}
                    onClick={() => { setStages((current) => current.filter((item) => item.slug !== stage.slug)); setSuccess(''); }}
                    className="rounded p-1.5 text-gray-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><TrashIcon className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
          {canEdit && <div className="flex gap-2 border-t border-gray-100 px-4 py-3">
            <input aria-label="New stage name" value={newName} maxLength={80} disabled={saving} placeholder="New stage name"
              onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            <button type="button" onClick={add} disabled={!newName.trim() || saving}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"><PlusIcon className="h-4 w-4" /> Add stage</button>
          </div>}
        </div>
      )}

      {/* ── Custom fields ─────────────────────────────────────────────────── */}
      {!loading && <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900">Deal properties & compulsory stage workflows</h3>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Add existing field"
                disabled={saving || fields.length >= 50}
                value=""
                onChange={(event) => {
                  const chosen = existingFieldTemplates.find((t) => t.key === event.target.value);
                  if (chosen) {
                    setFields((current) => [
                      ...current,
                      {
                        id: `df_${crypto.randomUUID()}`,
                        label: chosen.label,
                        type: chosen.type,
                        options: chosen.options,
                        required_in_stages: [],
                        archived: false,
                      },
                    ]);
                    setSuccess('');
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <option value="">+ Add existing field...</option>
                <optgroup label="Standard Deal Properties">
                  <option value="std_value">Deal Value (Number)</option>
                  <option value="std_expected_close_date">Expected Close Date (Date)</option>
                  <option value="std_contact">Contact (Text)</option>
                  <option value="std_priority">Priority (Dropdown)</option>
                </optgroup>
                {workspaceCustomFields.length > 0 && (
                  <optgroup label="Workspace Custom Fields">
                    {workspaceCustomFields.map((wf) => (
                      <option key={`wf_${wf.id}`} value={`wf_${wf.id}`}>
                        {wf.label} ({wf.field_type})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                type="button"
                disabled={saving || fields.length >= 50}
                onClick={() => {
                  setFields((current) => [
                    ...current,
                    {
                      id: `df_${crypto.randomUUID()}`,
                      label: '',
                      type: 'text',
                      options: [],
                      required_in_stages: [],
                      archived: false,
                    },
                  ]);
                  setSuccess('');
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" /> Add custom property
              </button>
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">Choose the stages where each field is compulsory. Requirements apply when creating or saving a deal in the selected stage, including moving it there.</p>
        <p className="mt-1 text-xs text-gray-500">Select every stage that needs the field; requirements do not carry forward automatically. Existing deals stay in place. Archive a field to stop requesting it while keeping its saved values.</p>
        {!fields.length && <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">No custom fields yet. Add details such as budget, delivery address or purchase order number.</div>}
        <div className="mt-4 space-y-4">
          {fields.map((field, index) => <fieldset key={field.id} disabled={!canEdit || saving} className={`rounded-xl border border-gray-200 p-4 ${field.archived ? 'bg-gray-50' : 'bg-white'}`}>
            <legend className="px-1 text-xs font-medium text-gray-500">{field.archived ? 'Archived field' : `Field ${index + 1}`}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-44 text-xs font-medium text-gray-600">Existing field
                <select
                  aria-label={`Field ${index + 1} template`}
                  value=""
                  onChange={(event) => {
                    const chosen = existingFieldTemplates.find((t) => t.key === event.target.value);
                    if (chosen) {
                      updateField(field.id, {
                        label: chosen.label,
                        type: chosen.type,
                        options: chosen.options,
                      });
                    }
                  }}
                  className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="">Choose to auto-fill...</option>
                  <optgroup label="Standard Deal Properties">
                    <option value="std_value">Deal Value (Number)</option>
                    <option value="std_expected_close_date">Expected Close Date (Date)</option>
                    <option value="std_contact">Contact (Text)</option>
                    <option value="std_priority">Priority (Dropdown)</option>
                  </optgroup>
                  {workspaceCustomFields.length > 0 && (
                    <optgroup label="Workspace Custom Fields">
                      {workspaceCustomFields.map((wf) => (
                        <option key={`wf_${wf.id}`} value={`wf_${wf.id}`}>
                          {wf.label} ({wf.field_type})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="min-w-40 flex-1 text-xs font-medium text-gray-600">Field name
                <input aria-label={`Field ${index + 1} name`} value={field.label} maxLength={80} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="e.g. Purchase order number" className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
              </label>
              <label className="text-xs font-medium text-gray-600">Type
                <select aria-label={`Field ${index + 1} type`} value={field.type} disabled={savedFields.some((saved) => saved.id === field.id)} onChange={(event) => updateField(field.id, { type: event.target.value as DealFieldType })} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50">
                  <option value="text">Text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="email">Email</option><option value="phone">Phone</option><option value="select">Dropdown</option>
                </select>
              </label>
              <button type="button" onClick={() => savedFields.some((saved) => saved.id === field.id) ? updateField(field.id, { archived: !field.archived }) : setFields((current) => current.filter((item) => item.id !== field.id))} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">{savedFields.some((saved) => saved.id === field.id) ? field.archived ? 'Restore field' : 'Archive field' : 'Remove field'}</button>
            </div>
            {savedFields.some((saved) => saved.id === field.id) && <p className="mt-2 text-xs text-gray-500">Saved field types stay fixed to protect existing values. Add a new field to use another type.</p>}
            {field.type === 'select' && <label className="mt-3 block text-xs font-medium text-gray-600">Options (one per line)
              <textarea aria-label={`Options for ${field.label || `field ${index + 1}`}`} rows={3} value={field.options.join('\n')} onChange={(event) => updateField(field.id, { options: event.target.value.split('\n') })} className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
            </label>}
            {!field.archived && <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600">Compulsory in stages</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{stages.map((stage) => <label key={stage.slug} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" aria-label={`${field.label || `Field ${index + 1}`} required in ${stage.name}`} checked={field.required_in_stages.includes(stage.slug)} onChange={(event) => updateField(field.id, { required_in_stages: event.target.checked ? [...field.required_in_stages, stage.slug] : field.required_in_stages.filter((slug) => slug !== stage.slug) })} className="h-4 w-4 rounded border-gray-300 text-blue-600" />{stage.name}
              </label>)}</div>
              {!field.required_in_stages.length && <p className="mt-2 text-xs text-gray-500">Optional in all stages.</p>}
            </div>}
          </fieldset>)}
        </div>
      </section>}

      {!loading && <section className="mt-8">
        <h3 className="text-base font-semibold text-gray-900">Required documents</h3>
        <p className="mt-1 text-sm text-gray-500">Deals in this pipeline cannot move into a conversion stage until every listed document kind is attached. Use short kinds such as MOU, quotation, or NDA.</p>
        {requiredDocuments.length === 0 && <p className="mt-3 text-sm text-gray-500">No paperwork required. Deals can convert without attachments.</p>}
        {requiredDocuments.length > 0 && <ul className="mt-3 space-y-2">
          {requiredDocuments.map((kind) => (
            <li key={kind} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
              <span className="flex-1 text-sm font-semibold uppercase text-gray-900">{kind}</span>
              {canEdit && <button type="button" disabled={saving} aria-label={`Remove required ${kind}`}
                onClick={() => { setRequiredDocuments((current) => current.filter((item) => item !== kind)); setSuccess(''); }}
                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><TrashIcon className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>}
        {canEdit && <div className="mt-3 flex gap-2">
          <input aria-label="New required document kind" value={newRequiredKind} maxLength={60} disabled={saving} placeholder="e.g. MOU"
            onChange={(event) => setNewRequiredKind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const kind = newRequiredKind.trim().toLowerCase();
              if (kind && !requiredDocuments.includes(kind)) {
                setRequiredDocuments((current) => [...current, kind]);
                setNewRequiredKind('');
                setSuccess('');
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          <button type="button" disabled={saving || !newRequiredKind.trim() || requiredDocuments.includes(newRequiredKind.trim().toLowerCase())}
            onClick={() => {
              const kind = newRequiredKind.trim().toLowerCase();
              if (kind && !requiredDocuments.includes(kind)) {
                setRequiredDocuments((current) => [...current, kind]);
                setNewRequiredKind('');
                setSuccess('');
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"><PlusIcon className="h-4 w-4" /> Add requirement</button>
        </div>}
      </section>}

      {canEdit && !loading && <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={!changed || saving} onClick={() => { setStages(savedStages); setFields(savedFields); setRequiredDocuments(savedRequiredDocuments); setNewRequiredKind(''); setError(''); setSuccess(''); }}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 disabled:opacity-50">Discard</button>
        <button type="button" disabled={!changed || saving} onClick={save}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save pipeline settings'}</button>
      </div>}
    </div>
  );
}
