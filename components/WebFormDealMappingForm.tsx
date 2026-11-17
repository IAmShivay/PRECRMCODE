import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuthToken } from '../lib/storage';
import {
  getPipelines,
  readPipelineConfiguration,
  readWebFormDealMapping,
  saveWebFormDealMapping,
} from '../lib/api-client';
import type {
  DealCustomField,
  DealStageConfig,
  WebFormDealFieldMap,
  WebFormDealMapping,
} from '../components/types';

const LEAD_FIELD_OPTIONS = [
  { value: 'lead.name', label: 'Lead name' },
  { value: 'lead.email', label: 'Lead email' },
  { value: 'lead.phone', label: 'Lead phone' },
];

const MAPPED_FIELDS: { key: keyof WebFormDealFieldMap; label: string; hint: string }[] = [
  { key: 'name', label: 'Deal name', hint: 'Falls back to the lead name when it is not mapped.' },
  { key: 'contact', label: 'Contact', hint: 'Falls back to the lead email or phone number.' },
  { key: 'value', label: 'Deal value', hint: 'The form field carrying the budget. It has to be a number.' },
  { key: 'priority', label: 'Priority', hint: 'The form field carrying low, medium or high.' },
  { key: 'expected_close_date', label: 'Expected close date', hint: 'The form field carrying a date such as 2026-03-31.' },
];

interface MemberOption {
  user_id: number;
  name: string;
}

interface PipelineOption {
  slug: string;
  name: string;
}

interface WebFormDealMappingFormProps {
  workspaceId: number;
  sourceId: string;
  availableFieldKeys: string[];
  onSaved?: (mapping: WebFormDealMapping) => void;
}

const EMPTY_FIELDS: WebFormDealFieldMap = {
  name: '',
  contact: '',
  value: '',
  priority: '',
  expected_close_date: '',
};

export default function WebFormDealMappingForm({
  workspaceId,
  sourceId,
  availableFieldKeys,
  onSaved,
}: WebFormDealMappingFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pipelineSlug, setPipelineSlug] = useState('default');
  const [stage, setStage] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [fields, setFields] = useState<WebFormDealFieldMap>(EMPTY_FIELDS);
  const [dealCustomFields, setDealCustomFields] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<DealStageConfig[]>([]);
  const [dealFields, setDealFields] = useState<DealCustomField[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4000);
  }, []);

  const loadMembers = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/workspaces/${workspaceId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'success') {
        setMembers([]);
        return;
      }
      const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
      setMembers(
        rows
          .filter((row: any) => Number(row?.user_id) > 0)
          .map((row: any) => ({
            user_id: Number(row.user_id),
            name: String(row.user_name || row.name || row.user_email || '').trim(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      setMembers([]);
    }
  }, [workspaceId]);

  const loadPipelines = useCallback(async () => {
    try {
      const rows = await getPipelines(workspaceId);
      setPipelines(
        (Array.isArray(rows) ? rows : [])
          .map((row: any) => ({ slug: String(row?.slug || '').trim(), name: String(row?.name || '').trim() }))
          .filter((row: PipelineOption) => row.slug && row.name),
      );
    } catch {
      setPipelines([]);
    }
  }, [workspaceId]);

  const loadPipelineConfiguration = useCallback(async (slug: string) => {
    try {
      const configuration = await readPipelineConfiguration(workspaceId, slug);
      setStages(configuration.stages || []);
      setDealFields((configuration.fields || []).filter((field) => !field.archived));
      return configuration;
    } catch {
      setStages([]);
      setDealFields([]);
      return null;
    }
  }, [workspaceId]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [mapping, pipelineRows] = await Promise.all([
          readWebFormDealMapping(workspaceId, sourceId),
          getPipelines(workspaceId),
        ]);
        if (!active) return;

        setPipelines(
          (Array.isArray(pipelineRows) ? pipelineRows : [])
            .map((row: any) => ({ slug: String(row?.slug || '').trim(), name: String(row?.name || '').trim() }))
            .filter((row: PipelineOption) => row.slug && row.name),
        );

        const resolvedPipeline = String(mapping?.pipeline_slug || 'default');
        setEnabled(Boolean(mapping?.enabled));
        setPipelineSlug(resolvedPipeline);
        setStage(String(mapping?.stage || ''));
        setOwnerUserId(mapping?.owner_user_id ? String(mapping.owner_user_id) : '');
        setFields({ ...EMPTY_FIELDS, ...(mapping?.fields || {}) });
        setDealCustomFields(mapping?.deal_custom_fields || {});

        await Promise.all([loadMembers(), loadPipelineConfiguration(resolvedPipeline)]);
      } catch (error: any) {
        if (active) showMessage('error', error?.message || 'Failed to load the deal automation settings');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [workspaceId, sourceId, loadMembers, loadPipelineConfiguration, showMessage]);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  const fieldOptions = useMemo(() => {
    const unique = Array.from(new Set(availableFieldKeys.filter(Boolean)));
    return [
      ...LEAD_FIELD_OPTIONS,
      ...unique.map((key) => ({ value: key, label: key })),
    ];
  }, [availableFieldKeys]);

  const handlePipelineChange = async (nextSlug: string) => {
    setPipelineSlug(nextSlug);
    setDealCustomFields({});
    const configuration = await loadPipelineConfiguration(nextSlug);
    const firstStage = configuration?.stages?.[0]?.slug;
    if (firstStage) setStage(firstStage);
  };

  const handleSave = async () => {
    if (!stage) {
      showMessage('error', 'Choose the stage where new deals should land');
      return;
    }
    setSaving(true);
    try {
      const cleanedFields: WebFormDealFieldMap = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value) cleanedFields[key as keyof WebFormDealFieldMap] = value;
      }
      const cleanedCustomFields: Record<string, string> = {};
      for (const [fieldId, value] of Object.entries(dealCustomFields)) {
        if (value) cleanedCustomFields[fieldId] = value;
      }

      const saved = await saveWebFormDealMapping(workspaceId, sourceId, {
        enabled,
        pipeline_slug: pipelineSlug,
        stage,
        owner_user_id: ownerUserId ? Number(ownerUserId) : null,
        fields: cleanedFields,
        deal_custom_fields: cleanedCustomFields,
      });

      setFields({ ...EMPTY_FIELDS, ...(saved?.fields || {}) });
      setDealCustomFields(saved?.deal_custom_fields || {});
      showMessage('success', enabled ? 'Deal automation saved' : 'Deal automation disabled');
      onSaved?.(saved);
    } catch (error: any) {
      showMessage('error', error?.message || 'Failed to save the deal automation settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-3"></div>
        <p className="text-gray-500">Loading deal automation...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Deal Automation</h2>
          <p className="text-sm text-gray-500">
            Automatically create a deal whenever this form creates a lead
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Create a deal for every submission</span>
            <span className="block text-xs text-gray-500">
              One submission produces one lead and one linked deal. Nothing is created while this is off.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Pipeline</label>
            <select
              value={pipelineSlug}
              onChange={(event) => void handlePipelineChange(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              {pipelines.length === 0 && <option value="default">Default</option>}
              {pipelines.map((pipeline) => (
                <option key={pipeline.slug} value={pipeline.slug}>{pipeline.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Stage</label>
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="">Choose a stage</option>
              {stages.map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Deal owner</label>
            <select
              value={ownerUserId}
              onChange={(event) => setOwnerUserId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>{member.name || `Member ${member.user_id}`}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Field mapping</h3>
          <p className="text-xs text-gray-500 mb-3">
            Pick which part of the form submission fills each deal property.
          </p>
          <div className="space-y-3">
            {MAPPED_FIELDS.map((item) => (
              <div key={item.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="sm:w-64">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.hint}</p>
                </div>
                <select
                  value={fields[item.key] || ''}
                  onChange={(event) => setFields((current) => ({ ...current, [item.key]: event.target.value }))}
                  className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="">Not mapped</option>
                  {fieldOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {dealFields.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Deal custom fields</h3>
            <p className="text-xs text-gray-500 mb-3">
              Map the form fields onto the custom fields configured for this pipeline.
            </p>
            <div className="space-y-3">
              {dealFields.map((field) => (
                <div key={field.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="sm:w-64">
                    <p className="text-sm font-medium text-gray-900">{field.label}</p>
                    <p className="text-xs text-gray-500">Type: {field.type}</p>
                  </div>
                  <select
                    value={dealCustomFields[field.id] || ''}
                    onChange={(event) => setDealCustomFields((current) => ({ ...current, [field.id]: event.target.value }))}
                    className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="">Not mapped</option>
                    {fieldOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200">
          <div>
            {message && (
              <p className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {message.text}
              </p>
            )}
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save deal automation'}
          </button>
        </div>
      </div>
    </div>
  );
}
