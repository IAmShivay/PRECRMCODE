import { useWorkspaceAccess } from '../lib/useWorkspaceAccess';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  getWhatsAppConfig,
  updateWhatsAppConfig,
  sendWhatsAppTestMessage,
  getWhatsAppTriggers,
  updateWhatsAppTriggers,
  getWhatsAppTemplates,
  updateWhatsAppTemplate,
  getWhatsAppMessages,
  resendWhatsAppMessage,
  getWhatsAppCampaigns,
  createWhatsAppCampaign,
  cancelWhatsAppCampaign,
} from '../lib/api-client';
import type {
  WhatsAppTemplateConfig,
  WhatsAppTriggerConfig,
  WhatsAppTriggerKind,
  WhatsAppCampaignSummary,
  WhatsAppMessageLogEntry,
  LeadStatus,
} from '../components/types';
import { getAuthToken } from '../lib/storage';
import WhatsAppConnectButton from '../components/WhatsAppConnectButton';
import WhatsAppMetaTemplates from '../components/WhatsAppMetaTemplates';
import WhatsAppPhoneSetup from '../components/WhatsAppPhoneSetup';
import ConversationAccessState from '../components/ConversationAccessState';
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type TabKey = 'connect' | 'templates' | 'triggers' | 'campaigns' | 'logs';

const TRIGGER_LABELS: Record<WhatsAppTriggerKind, string> = {
  new_lead: 'New Lead Welcome',
  hello_world: 'Hello World (Meta Sandbox)',
  call_no_answer: 'Call Not Answered',
  lead_done: 'Lead Marked Done',
  bulk_marketing: 'Marketing / Bulk',
};

const TRIGGER_DESCRIPTIONS: Record<WhatsAppTriggerKind, string> = {
  new_lead: 'Sent automatically when a new lead is captured.',
  hello_world:
    'Meta sandbox template. Use {{lead.name}} here — add matching {{1}} in Meta. For auto new-lead messages while new_lead_welcome is in review, copy this template name into New Lead Welcome.',
  call_no_answer: 'Sent when you click "No answer — send WhatsApp" on a lead.',
  lead_done: 'Sent when lead status changes to a configured "done" status.',
  bulk_marketing: 'Used for bulk marketing campaigns.',
};

const TEMPLATE_BODY_HINTS: Partial<Record<WhatsAppTriggerKind, string>> = {
  hello_world:
    'Use {{lead.name}} for the recipient name (maps to {{1}} in Meta). If Meta template has no variables, remove {{lead.name}} from the body.',
};

type WhatsAppTestMode = 'sandbox' | 'production' | 'plain_text';

const PRODUCTION_TEST_TEMPLATES: WhatsAppTriggerKind[] = [
  'new_lead',
  'call_no_answer',
  'lead_done',
  'bulk_marketing',
];

function isLikelyMetaSandboxPhone(displayPhone: string): boolean {
  const digits = String(displayPhone || '').replace(/\D/g, '');
  return /^1555/.test(digits) || displayPhone.includes('555 199');
}

export default function WhatsAppIntegration() {
  const { currentWorkspace } = useAuth();
  const { access, error, errorStatus, retry } = useWorkspaceAccess(currentWorkspace?.id);
  if (!currentWorkspace) return <p className="p-6 text-gray-500">Select a workspace to view WhatsApp.</p>;
  if (!access) return <ConversationAccessState service="WhatsApp" error={error} errorStatus={errorStatus} onRetry={retry} />;
  if (access.permissions.conversations === 'none') return <p className="p-6 text-gray-500">Conversation access is disabled. Ask a workspace administrator for access.</p>;
  return <WhatsAppWorkspace key={`${currentWorkspace?.id}:${access.permissions.conversations}`} />;
}

function WhatsAppWorkspace() {
  const { currentWorkspace, getUserRole } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const isAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;

  const [activeTab, setActiveTab] = useState<TabKey>('connect');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);

  // Connect tab
  const [configDraft, setConfigDraft] = useState({
    enabled: false,
    phone_number_id: '',
    waba_id: '',
    access_token: '',
    display_phone: '',
  });
  const [testPhone, setTestPhone] = useState('');
  const [testTriggerKind, setTestTriggerKind] = useState<WhatsAppTriggerKind>('new_lead');
  const [testMode, setTestMode] = useState<WhatsAppTestMode>('production');
  const [testMessageBody, setTestMessageBody] = useState(
    'Hello from Scraft CRM — this is a WhatsApp connection test.'
  );

  // Templates
  const [templates, setTemplates] = useState<WhatsAppTemplateConfig[]>([]);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, WhatsAppTemplateConfig>>({});

  // Triggers
  const [_triggers, setTriggers] = useState<WhatsAppTriggerConfig | null>(null);
  const [triggerDraft, setTriggerDraft] = useState<WhatsAppTriggerConfig | null>(null);
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([]);

  // Campaigns
  const [campaigns, setCampaigns] = useState<WhatsAppCampaignSummary[]>([]);
  const [campaignName, setCampaignName] = useState('');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<number[]>([]);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [resendingLeadId, setResendingLeadId] = useState<number | null>(null);

  // Logs
  const [messages, setMessages] = useState<WhatsAppMessageLogEntry[]>([]);

  const workspaceId = currentWorkspace?.id;

  const fetchLeadStatuses = useCallback(async () => {
    if (!workspaceId) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/lead-statuses?workspace_id=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status === 'success' && Array.isArray(data.data)) {
        setLeadStatuses(data.data);
      }
    } catch {
      // non-fatal
    }
  }, [workspaceId]);

  const loadConfig = useCallback(async () => {
    if (!workspaceId) return;
    const config = await getWhatsAppConfig(workspaceId);
    setConnected(Boolean(config.connected));
    setConfigDraft({
      enabled: config.enabled,
      phone_number_id: config.phone_number_id || '',
      waba_id: config.waba_id || '',
      access_token: '',
      display_phone: config.display_phone || '',
    });
  }, [workspaceId]);

  const loadTemplates = useCallback(async () => {
    if (!workspaceId) return;
    const data = await getWhatsAppTemplates(workspaceId);
    setTemplates(data);
    const drafts: Record<string, WhatsAppTemplateConfig> = {};
    data.forEach((t) => {
      drafts[t.kind] = { ...t };
    });
    setTemplateDrafts(drafts);
  }, [workspaceId]);

  const loadTriggers = useCallback(async () => {
    if (!workspaceId) return;
    const data = await getWhatsAppTriggers(workspaceId);
    setTriggers(data);
    setTriggerDraft(data);
  }, [workspaceId]);

  const loadCampaigns = useCallback(async () => {
    if (!workspaceId) return;
    const data = await getWhatsAppCampaigns(workspaceId);
    setCampaigns(data);
  }, [workspaceId]);

  const loadMessages = useCallback(async () => {
    if (!workspaceId) return;
    const data = await getWhatsAppMessages(workspaceId, { limit: 100 });
    setMessages(data);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([loadConfig(), fetchLeadStatuses()])
      .catch((err) => addToast('error', err?.message || 'Failed to load WhatsApp settings'))
      .finally(() => setLoading(false));
  }, [workspaceId, loadConfig, fetchLeadStatuses, addToast]);

  useEffect(() => {
    if (!workspaceId || !configDraft.display_phone) return;
    setTestMode(isLikelyMetaSandboxPhone(configDraft.display_phone) ? 'sandbox' : 'production');
  }, [workspaceId, configDraft.display_phone]);

  useEffect(() => {
    if (!workspaceId) return;
    if (activeTab === 'connect' || activeTab === 'templates') {
      loadTemplates().catch((err) => addToast('error', err?.message || 'Failed to load templates'));
    } else if (activeTab === 'triggers') {
      Promise.all([loadTriggers(), fetchLeadStatuses()]).catch((err) =>
        addToast('error', err?.message || 'Failed to load triggers')
      );
    } else if (activeTab === 'campaigns') {
      loadCampaigns().catch((err) => addToast('error', err?.message || 'Failed to load campaigns'));
    } else if (activeTab === 'logs') {
      loadMessages().catch((err) => addToast('error', err?.message || 'Failed to load message log'));
    }
  }, [
    activeTab,
    workspaceId,
    loadTemplates,
    loadTriggers,
    loadCampaigns,
    loadMessages,
    fetchLeadStatuses,
    addToast,
  ]);

  const handleSaveConfig = async () => {
    if (!workspaceId || !isAdmin) return;
    setSaving(true);
    try {
      const updated = await updateWhatsAppConfig(workspaceId, {
        enabled: configDraft.enabled,
        phone_number_id: configDraft.phone_number_id,
        waba_id: configDraft.waba_id,
        ...(configDraft.access_token ? { access_token: configDraft.access_token } : {}),
        display_phone: configDraft.display_phone,
      });
      setConnected(Boolean(updated.connected));
      setConfigDraft((prev) => ({ ...prev, access_token: '' }));
      addToast('success', 'WhatsApp connection saved');
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleTestMessage = async () => {
    if (!workspaceId || !testPhone.trim()) {
      addToast('warning', 'Enter a test phone number');
      return;
    }
    setSaving(true);
    try {
      const result = await sendWhatsAppTestMessage(workspaceId, testPhone.trim(), testTriggerKind, {
        useSandboxTemplate: testMode === 'sandbox',
        usePlainText: testMode === 'plain_text',
        messageBody: testMessageBody,
      });
      const idNote = result.message_id ? ` (ID: ${result.message_id.slice(0, 20)}…)` : '';
      const successLabel =
        testMode === 'sandbox'
          ? 'hello_world sent'
          : testMode === 'plain_text'
            ? 'Accepted by Meta'
            : 'Production test accepted';
      addToast('success', `${successLabel}${idNote}. Check WhatsApp on ${testPhone.trim()}.`);
      if (result.message) {
        addToast('warning', result.message);
      }
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Test send failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async (kind: WhatsAppTriggerKind) => {
    if (!workspaceId || !isAdmin) return;
    const draft = templateDrafts[kind];
    if (!draft) return;
    setSaving(true);
    try {
      await updateWhatsAppTemplate(workspaceId, kind, {
        enabled: draft.enabled,
        meta_template_name: draft.meta_template_name,
        language: draft.language,
        body: draft.body,
        meta_approved: draft.meta_approved,
      });
      addToast('success', `${TRIGGER_LABELS[kind]} template saved`);
      await loadTemplates();
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTriggers = async () => {
    if (!workspaceId || !isAdmin || !triggerDraft) return;
    setSaving(true);
    try {
      const updated = await updateWhatsAppTriggers(workspaceId, {
        new_lead: triggerDraft.new_lead,
        call_no_answer: triggerDraft.call_no_answer,
        lead_done: triggerDraft.lead_done,
        done_status_ids: triggerDraft.done_status_ids,
        done_status_types: triggerDraft.done_status_types,
        no_answer_cooldown_hours: triggerDraft.no_answer_cooldown_hours,
      });
      setTriggers(updated);
      setTriggerDraft(updated);
      addToast('success', 'Trigger settings saved');
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Failed to save triggers');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!workspaceId || !isAdmin) return;
    if (!campaignName.trim()) {
      addToast('warning', 'Enter a campaign name');
      return;
    }
    setCreatingCampaign(true);
    try {
      const result = await createWhatsAppCampaign(workspaceId, {
        name: campaignName.trim(),
        template_kind: 'bulk_marketing',
        status_ids: campaignStatusFilter.length > 0 ? campaignStatusFilter : undefined,
      });
      addToast(
        'success',
        `Campaign started: ${result.queued || 0} queued, ${result.skipped || 0} skipped`
      );
      setCampaignName('');
      await loadCampaigns();
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Failed to create campaign');
    } finally {
      setCreatingCampaign(false);
    }
  };

  const handleCancelCampaign = async (campaignId: string) => {
    if (!workspaceId || !isAdmin) return;
    try {
      await cancelWhatsAppCampaign(workspaceId, campaignId);
      addToast('success', 'Campaign cancelled');
      await loadCampaigns();
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Failed to cancel campaign');
    }
  };

  const handleResendMessage = async (msg: WhatsAppMessageLogEntry) => {
    if (!workspaceId || !isAdmin || !msg.lead_id) return;
    const triggerKind = (msg.trigger_kind as WhatsAppTriggerKind) || 'new_lead';
    setResendingLeadId(msg.lead_id);
    try {
      const result = await resendWhatsAppMessage(workspaceId, msg.lead_id, triggerKind);
      if (result.queued) {
        addToast('success', `Resend queued for lead #${msg.lead_id}. Check back in Message Log shortly.`);
        await loadMessages();
      } else {
        addToast('error', result.reason || 'Failed to queue resend');
      }
    } catch (err: unknown) {
      addToast('error', (err as Error)?.message || 'Resend failed');
    } finally {
      setResendingLeadId(null);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'connect', label: 'Connect' },
    { key: 'templates', label: 'Templates' },
    { key: 'triggers', label: 'Triggers' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'logs', label: 'Message Log' },
  ];

  if (!currentWorkspace) {
    return (
      <div className="p-8 text-center text-gray-500">Select a workspace to configure WhatsApp.</div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading WhatsApp integration...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <ChatBubbleLeftRightIcon className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">WhatsApp Integration</h1>
            <p className="text-sm text-gray-500">Automated and bulk WhatsApp messaging via Meta Cloud API</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {connected ? (
            <>
              <CheckCircleIcon className="w-5 h-5 text-green-500" />
              <span className="text-green-700 font-medium">Connected</span>
            </>
          ) : (
            <>
              <ExclamationCircleIcon className="w-5 h-5 text-amber-500" />
              <span className="text-amber-700">Not connected</span>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                activeTab === tab.key
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {!isAdmin && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Admin access is required to change WhatsApp settings.
        </div>
      )}

      {activeTab === 'connect' && (
        <div className="space-y-6">
          {isAdmin && workspaceId && <WhatsAppConnectButton key={workspaceId} workspaceId={workspaceId} onConnected={loadConfig} />}
          {isAdmin && connected && workspaceId && <WhatsAppPhoneSetup key={`${workspaceId}:${configDraft.phone_number_id}`} workspaceId={workspaceId} />}
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Connection settings</h2>
            <p className="text-sm text-gray-500">
              Connect with Meta above to select your account. Use approved templates for proactive messages to recipients who have opted in.
            </p>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={configDraft.enabled}
                disabled={!isAdmin}
                onChange={(e) => setConfigDraft((p) => ({ ...p, enabled: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">Enable WhatsApp integration for this workspace</span>
            </label>

            <details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium">Advanced manual connection</summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={configDraft.phone_number_id}
                  disabled={!isAdmin}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, phone_number_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="From Meta Developer Console"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WABA ID</label>
                <input
                  type="text"
                  value={configDraft.waba_id}
                  disabled={!isAdmin}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, waba_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="WhatsApp Business Account ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Phone</label>
                <input
                  type="text"
                  value={configDraft.display_phone}
                  disabled={!isAdmin}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, display_phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="+1 555 000 0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                <input
                  type="password"
                  value={configDraft.access_token}
                  disabled={!isAdmin}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, access_token: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder={connected ? 'Leave blank to keep existing token' : 'System user access token'}
                />
              </div>
            </div>
            </details>

            {isAdmin && (
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Connection'}
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Send Test Message</h2>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Test mode</p>
              <div className="space-y-2 text-sm text-gray-700">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="wa-test-mode"
                    checked={testMode === 'production'}
                    onChange={() => setTestMode('production')}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Production</strong> — sends an approved workspace template to a recipient who has opted in. Requires a connected, registered business number.
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="wa-test-mode"
                    checked={testMode === 'sandbox'}
                    onChange={() => setTestMode('sandbox')}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Meta sandbox (hello_world)</strong> — Developer Console test only.
                    Recipient must be on Meta&apos;s test list (#131030 otherwise).
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="wa-test-mode"
                    checked={testMode === 'plain_text'}
                    onChange={() => setTestMode('plain_text')}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>Plain text</strong> — only works if this number messaged your WhatsApp
                    business in the last 24 hours.
                  </span>
                </label>
              </div>
            </div>

            {testMode === 'production' && isLikelyMetaSandboxPhone(configDraft.display_phone) && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Display phone looks like a Meta test number (+1 555…). Production tests to arbitrary
                numbers will fail with <strong>#131030</strong> until you connect a verified business
                number and system user token above.
              </p>
            )}

            {testMode === 'production' && !isLikelyMetaSandboxPhone(configDraft.display_phone) && (
              <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Use a test number you control. The template must be{' '}
                <strong>Approved</strong> in Meta and match the Templates tab (name, language,{' '}
                {'{{lead.name}}'} ↔ {'{{1}}'}).
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
                placeholder="+251911234567"
              />
              {testMode === 'production' && (
                <select
                  value={testTriggerKind}
                  onChange={(e) => setTestTriggerKind(e.target.value as WhatsAppTriggerKind)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {PRODUCTION_TEST_TEMPLATES.map((k) => (
                    <option key={k} value={k}>
                      {TRIGGER_LABELS[k]}
                      {templateDrafts[k]?.meta_template_name
                        ? ` (${templateDrafts[k].meta_template_name})`
                        : ''}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleTestMessage}
                disabled={saving || !isAdmin}
                className="px-4 py-2 border border-green-600 text-green-700 text-sm font-medium rounded-lg hover:bg-green-50 disabled:opacity-50"
              >
                Send Test
              </button>
            </div>
            {testMode === 'plain_text' && (
              <textarea
                value={testMessageBody}
                onChange={(e) => setTestMessageBody(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Test message text"
              />
            )}
          </div>

          {isAdmin && <details className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-800 mb-2">Advanced webhook configuration</summary>
            <code className="text-xs break-all">
              {API_BASE_URL || window.location.origin}/api/whatsapp/webhook
            </code>
            <p className="mt-2 text-xs">
              Set verify token via WHATSAPP_WEBHOOK_VERIFY_TOKEN in server env.
            </p>
          </details>}
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-4">
          {connected && <WhatsAppMetaTemplates key={workspaceId} workspaceId={workspaceId!} isAdmin={isAdmin} />}
          {(templates.length > 0 ? templates : Object.keys(TRIGGER_LABELS).map((k) => ({
            kind: k as WhatsAppTriggerKind,
            enabled: false,
            meta_template_name: '',
            language: 'en',
            body: '',
            meta_approved: false,
            updated_at: '',
          }))).map((template) => {
            const kind = template.kind;
            const draft = templateDrafts[kind] || template;
            return (
              <div key={kind} className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{TRIGGER_LABELS[kind]}</h3>
                    <p className="text-sm text-gray-500">{TRIGGER_DESCRIPTIONS[kind]}</p>
                  </div>
                  <label className="flex items-center gap-2 shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setTemplateDrafts((p) => ({
                          ...p,
                          [kind]: { ...draft, enabled: e.target.checked },
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Enabled</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Meta Template Name</label>
                    <input
                      type="text"
                      value={draft.meta_template_name}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setTemplateDrafts((p) => ({
                          ...p,
                          [kind]: { ...draft, meta_template_name: e.target.value },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Language Code</label>
                    <input
                      type="text"
                      value={draft.language}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setTemplateDrafts((p) => ({
                          ...p,
                          [kind]: { ...draft, language: e.target.value },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Message body (use {'{{lead.name}}'}, {'{{workspace.name}}'})
                  </label>
                  {TEMPLATE_BODY_HINTS[kind] && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                      {TEMPLATE_BODY_HINTS[kind]}
                    </p>
                  )}
                  <textarea
                    value={draft.body}
                    disabled={!isAdmin}
                    rows={3}
                    onChange={(e) =>
                      setTemplateDrafts((p) => ({
                        ...p,
                        [kind]: { ...draft, body: e.target.value },
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.meta_approved}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setTemplateDrafts((p) => ({
                        ...p,
                        [kind]: { ...draft, meta_approved: e.target.checked },
                      }))
                    }
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">Template approved in Meta Business Manager</span>
                </label>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleSaveTemplate(kind)}
                    disabled={saving}
                    className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    Save Template
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'triggers' && triggerDraft && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-gray-900">Automation Triggers</h2>

          {[
            { key: 'new_lead' as const, label: 'New lead captured' },
            { key: 'call_no_answer' as const, label: 'Call not answered (manual button)' },
            { key: 'lead_done' as const, label: 'Lead marked as done (status change)' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={triggerDraft[key]}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTriggerDraft((p) => (p ? { ...p, [key]: e.target.checked } : p))
                }
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-800">{label}</span>
            </label>
          ))}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              &quot;Done&quot; status types (trigger lead_done message)
            </label>
            <div className="flex flex-wrap gap-3">
              {(['won', 'closed', 'lost', 'open'] as const).map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={triggerDraft.done_status_types.includes(type)}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      setTriggerDraft((p) => {
                        if (!p) return p;
                        const types = e.target.checked
                          ? [...p.done_status_types, type]
                          : p.done_status_types.filter((t) => t !== type);
                        return { ...p, done_status_types: types };
                      });
                    }}
                    className="rounded border-gray-300"
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>

          {leadStatuses.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or specific statuses
              </label>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {leadStatuses.map((status) => (
                  <label
                    key={status.id}
                    className="flex items-center gap-1.5 text-sm bg-gray-50 px-2 py-1 rounded border border-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={triggerDraft.done_status_ids.includes(status.id)}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        setTriggerDraft((p) => {
                          if (!p) return p;
                          const ids = e.target.checked
                            ? [...p.done_status_ids, status.id]
                            : p.done_status_ids.filter((id) => id !== status.id);
                          return { ...p, done_status_ids: ids };
                        });
                      }}
                      className="rounded border-gray-300"
                    />
                    {status.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              No-answer cooldown (hours)
            </label>
            <input
              type="number"
              min={1}
              max={168}
              value={triggerDraft.no_answer_cooldown_hours}
              disabled={!isAdmin}
              onChange={(e) =>
                setTriggerDraft((p) =>
                  p ? { ...p, no_answer_cooldown_hours: Number(e.target.value) || 24 } : p
                )
              }
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={handleSaveTriggers}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Save Triggers
            </button>
          )}
        </div>
      )}

      {activeTab === 'campaigns' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            Bulk marketing requires a <strong>MARKETING</strong> category template approved by Meta.
            Only leads with valid phone numbers will receive messages.
          </div>

          {isAdmin && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">New Bulk Campaign</h2>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Campaign name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              {leadStatuses.length > 0 && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Filter by status (optional)</p>
                  <div className="flex flex-wrap gap-2">
                    {leadStatuses.map((status) => (
                      <label
                        key={status.id}
                        className="flex items-center gap-1.5 text-sm bg-gray-50 px-2 py-1 rounded border"
                      >
                        <input
                          type="checkbox"
                          checked={campaignStatusFilter.includes(status.id)}
                          onChange={(e) => {
                            setCampaignStatusFilter((prev) =>
                              e.target.checked
                                ? [...prev, status.id]
                                : prev.filter((id) => id !== status.id)
                            );
                          }}
                          className="rounded border-gray-300"
                        />
                        {status.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleCreateCampaign}
                disabled={creatingCampaign}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {creatingCampaign ? 'Starting...' : 'Send Campaign Now'}
              </button>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Progress</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      No campaigns yet
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr key={c.campaignId}>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                      <td className="px-4 py-3 capitalize">{c.status}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {c.sent}/{c.totalRecipients} sent
                        {c.skipped > 0 && ` (${c.skipped} skipped)`}
                        {c.delivered > 0 && ` · ${c.delivered} delivered`}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(c.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && (c.status === 'running' || c.status === 'pending') && (
                          <button
                            type="button"
                            onClick={() => handleCancelCampaign(c.campaignId)}
                            className="text-red-600 hover:text-red-800 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Lead</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-left px-4 py-3 font-medium">Trigger</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Error</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No messages logged yet
                  </td>
                </tr>
              ) : (
                messages.map((msg) => {
                  const canResend =
                    isAdmin &&
                    msg.lead_id > 0 &&
                    msg.delivery_status === 'failed';
                  return (
                  <tr
                    key={msg.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => msg.lead_id && navigate(`/leads/${msg.lead_id}`)}
                  >
                    <td className="px-4 py-3 text-gray-500">
                      {msg.created_at ? new Date(msg.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">#{msg.lead_id}</td>
                    <td className="px-4 py-3">{msg.to_phone || '—'}</td>
                    <td className="px-4 py-3 capitalize">{msg.trigger_kind?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          msg.delivery_status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : msg.delivery_status === 'delivered' || msg.delivery_status === 'read'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {msg.delivery_status || 'sent'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-red-700 max-w-xs truncate" title={msg.error || ''}>
                      {msg.error || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {canResend ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleResendMessage(msg);
                          }}
                          disabled={resendingLeadId === msg.lead_id}
                          className="px-2.5 py-1 text-xs font-medium border border-green-600 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50"
                        >
                          {resendingLeadId === msg.lead_id ? 'Sending…' : 'Resend'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
