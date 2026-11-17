import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import WorkspaceMembersManager from '../components/WorkspaceMembersManager';
import DealStagesSettings from '../components/DealStagesSettings';
import { getAuthToken } from '../lib/storage';
import {
  getWorkspaceInviteEmailTemplate,
  updateWorkspaceInviteEmailTemplate,
  type WorkspaceInviteEmailTemplate,
  getWorkspaceSmtpConfig,
  updateWorkspaceSmtpConfig,
  sendWorkspaceSmtpTestEmail,
  type WorkspaceSmtpConfig,
  type WorkspaceSmtpConfigInput,
  getLeadAutoReplyTemplate,
  updateLeadAutoReplyTemplate,
  sendLeadAutoReplyTemplateTestEmail,
  type LeadAutoReplyTemplate,
  getLeadNotificationTemplate,
  updateLeadNotificationTemplate,
  type LeadNotificationTemplate,
  getLeadAssignmentTemplate,
  updateLeadAssignmentTemplate,
  type LeadAssignmentTemplate,
  getEmailVerifierBalance,
  updateWorkspace,
} from '../lib/api-client';
import {
  WORKSPACE_CURRENCY_OPTIONS,
  formatWorkspaceCurrency,
  normalizeWorkspaceCurrency,
  type WorkspaceCurrencyCode,
} from '../lib/currency';
import type { LeadStatus } from '../components/types';
import {
  Bars3Icon,
  QuestionMarkCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

type TabKey = 'workspace' | 'statuses' | 'deals' | 'members' | 'email' | 'facebook';

interface EditableStatus extends LeadStatus {
  // Extended field coming from backend – 0/1 flag for “qualified” status
  is_qualified: number;
}

// Status color palette — vibrant, accessible colors for visual distinction
const STATUS_COLORS: { value: string; label: string; group: string }[] = [
  // Neutrals
  { value: '#374151', label: 'Charcoal', group: 'Neutral' },
  { value: '#6B7280', label: 'Gray', group: 'Neutral' },
  // Cool tones
  { value: '#2563EB', label: 'Blue', group: 'Cool' },
  { value: '#0891B2', label: 'Cyan', group: 'Cool' },
  { value: '#7C3AED', label: 'Violet', group: 'Cool' },
  { value: '#6D28D9', label: 'Purple', group: 'Cool' },
  // Warm tones
  { value: '#DC2626', label: 'Red', group: 'Warm' },
  { value: '#EA580C', label: 'Orange', group: 'Warm' },
  { value: '#D97706', label: 'Amber', group: 'Warm' },
  { value: '#CA8A04', label: 'Yellow', group: 'Warm' },
  // Nature tones
  { value: '#16A34A', label: 'Green', group: 'Nature' },
  { value: '#0D9488', label: 'Teal', group: 'Nature' },
  // Accent
  { value: '#DB2777', label: 'Pink', group: 'Accent' },
  { value: '#4F46E5', label: 'Indigo', group: 'Accent' },
];

const DEFAULT_INVITE_EMAIL_TEMPLATE: WorkspaceInviteEmailTemplate = {
  subject: 'You’ve been invited to {{workspaceName}}',
  intro:
    "Hello! {{inviterName}} has invited you to collaborate on {{workspaceName}}, and we're excited to have you join their team! To get started, just click the button below.",
  buttonText: 'Accept invite',
  whatsTitle: "What's {{appName}}",
  whatsBody:
    '{{appName}} is a CRM workspace where your team can collaborate on leads, sources, and activity. Learn more about us {{learnMoreLink}}.',
};

const SMTP_PROVIDER_PRESETS = {
  google: { host: 'smtp.gmail.com', port: 587, secure: false },
  office365: { host: 'smtp.office365.com', port: 587, secure: false },
  custom: { host: '', port: 587, secure: false },
} as const;

type SmtpProviderPreset = keyof typeof SMTP_PROVIDER_PRESETS;

const DEFAULT_SMTP_DRAFT: WorkspaceSmtpConfigInput = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  from_name: '',
  from_email: '',
  reply_to: '',
};

const DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT: Omit<LeadAutoReplyTemplate, 'workspace_id' | 'updated_at'> = {
  enabled: false,
  subject: 'Thanks {{lead.name}} - we got your request',
  html: '<p>Hi {{lead.name}},</p><p>Thanks for contacting us. Our team will get back to you shortly.</p>',
  text: 'Hi {{lead.name}}, Thanks for contacting us. Our team will get back to you shortly.',
  attachments: [],
};

const DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT: Omit<LeadNotificationTemplate, 'workspace_id' | 'updated_at'> = {
  enabled: false,
  recipient_email: '',
  additional_recipients: [],
  subject: 'New lead received: {{lead.name}} (ID {{lead.id}})',
  html:
    '<p>A new lead has been captured in your workspace.</p>' +
    '<ul>' +
    '<li><strong>Lead ID:</strong> {{lead.id}}</li>' +
    '<li><strong>Name:</strong> {{lead.name}}</li>' +
    '<li><strong>Email:</strong> {{lead.email}}</li>' +
    '<li><strong>Phone:</strong> {{lead.phone}}</li>' +
    '<li><strong>Source:</strong> {{lead.source_old}}</li>' +
    '<li><strong>Source Ref:</strong> {{lead.source_ref}}</li>' +
    '<li><strong>Created At:</strong> {{lead.created_at}}</li>' +
    '<li><strong>Workspace ID:</strong> {{workspace.id}}</li>' +
    '</ul>',
  text:
    'A new lead has been captured in your workspace.\n' +
    'Lead ID: {{lead.id}}\n' +
    'Name: {{lead.name}}\n' +
    'Email: {{lead.email}}\n' +
    'Phone: {{lead.phone}}\n' +
    'Source: {{lead.source_old}}\n' +
    'Source Ref: {{lead.source_ref}}\n' +
    'Created At: {{lead.created_at}}\n' +
    'Workspace ID: {{workspace.id}}',
};

const DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT: Omit<LeadAssignmentTemplate, 'workspace_id' | 'updated_at'> = {
  enabled: false,
  subject: 'Lead assigned to you: {{lead.name}} (ID {{lead.id}})',
  html:
    '<p>Hi {{assignee.name}},</p>' +
    '<p>A lead has been assigned to you.</p>' +
    '<ul>' +
    '<li><strong>Lead ID:</strong> {{lead.id}}</li>' +
    '<li><strong>Name:</strong> {{lead.name}}</li>' +
    '<li><strong>Email:</strong> {{lead.email}}</li>' +
    '<li><strong>Phone:</strong> {{lead.phone}}</li>' +
    '<li><strong>Assigned by:</strong> {{assigner.name}}</li>' +
    '</ul>',
  text:
    'Hi {{assignee.name}},\n\n' +
    'A lead has been assigned to you.\n\n' +
    'Lead ID: {{lead.id}}\n' +
    'Name: {{lead.name}}\n' +
    'Email: {{lead.email}}\n' +
    'Phone: {{lead.phone}}\n' +
    'Assigned by: {{assigner.name}}',
};

const interpolate = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');

const detectSmtpPreset = (config: Partial<WorkspaceSmtpConfigInput>): SmtpProviderPreset => {
  const host = String(config.host || '').trim().toLowerCase();
  const port = Number(config.port || 587);
  const secure = Boolean(config.secure);

  if (host === SMTP_PROVIDER_PRESETS.google.host && port === 587 && secure === false) {
    return 'google';
  }
  if (host === SMTP_PROVIDER_PRESETS.office365.host && port === 587 && secure === false) {
    return 'office365';
  }
  return 'custom';
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export default function WorkspaceSettings() {
  const { currentWorkspace, user, getUserRole, refreshWorkspaces, workspaceMembersLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem('workspaceSettingsActiveTab');
    return (saved as TabKey) || 'statuses';
  });

  // Persist active tab selection
  useEffect(() => {
    localStorage.setItem('workspaceSettingsActiveTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    setWorkspaceName(currentWorkspace?.name || '');
    setWorkspaceCurrency(normalizeWorkspaceCurrency(currentWorkspace?.currency));
    setWorkspaceSettingsSuccess(null);
    setWorkspaceSettingsError(null);
  }, [currentWorkspace?.id, currentWorkspace?.name, currentWorkspace?.currency]);

  const [statuses, setStatuses] = useState<EditableStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headerSaving, setHeaderSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingStatus, setEditingStatus] = useState<EditableStatus | null>(null);
  const [openMenuStatusId, setOpenMenuStatusId] = useState<number | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceCurrency, setWorkspaceCurrency] = useState<WorkspaceCurrencyCode>('INR');
  const [workspaceSettingsSaving, setWorkspaceSettingsSaving] = useState(false);
  const [workspaceSettingsSuccess, setWorkspaceSettingsSuccess] = useState<string | null>(null);
  const [workspaceSettingsError, setWorkspaceSettingsError] = useState<string | null>(null);
  const [inviteTemplate, setInviteTemplate] = useState<WorkspaceInviteEmailTemplate | null>(null);
  const [inviteTemplateDraft, setInviteTemplateDraft] = useState<WorkspaceInviteEmailTemplate>(
    DEFAULT_INVITE_EMAIL_TEMPLATE
  );
  const [emailTemplateLoading, setEmailTemplateLoading] = useState(false);
  const [emailTemplateSaving, setEmailTemplateSaving] = useState(false);
  const [emailTemplateError, setEmailTemplateError] = useState<string | null>(null);
  const [emailTemplateSuccess, setEmailTemplateSuccess] = useState<string | null>(null);
  const [smtpConfig, setSmtpConfig] = useState<WorkspaceSmtpConfig | null>(null);
  const [smtpDraft, setSmtpDraft] = useState<WorkspaceSmtpConfigInput>(DEFAULT_SMTP_DRAFT);
  const [smtpProviderPreset, setSmtpProviderPreset] = useState<SmtpProviderPreset>('custom');
  const [smtpConfigLoading, setSmtpConfigLoading] = useState(false);
  const [smtpConfigSaving, setSmtpConfigSaving] = useState(false);
  const [smtpConfigTesting, setSmtpConfigTesting] = useState(false);
  const [smtpConfigError, setSmtpConfigError] = useState<string | null>(null);
  const [smtpConfigSuccess, setSmtpConfigSuccess] = useState<string | null>(null);
  const [smtpTestEmail, setSmtpTestEmail] = useState<string>('');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [leadAutoReplyTemplate, setLeadAutoReplyTemplate] = useState<LeadAutoReplyTemplate | null>(null);
  const [leadAutoReplyDraft, setLeadAutoReplyDraft] = useState<
    Omit<LeadAutoReplyTemplate, 'workspace_id' | 'updated_at'>
  >(DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT);
  const [leadAutoReplyLoading, setLeadAutoReplyLoading] = useState(false);
  const [leadAutoReplySaving, setLeadAutoReplySaving] = useState(false);
  const [leadAutoReplyTesting, setLeadAutoReplyTesting] = useState(false);
  const [leadAutoReplyError, setLeadAutoReplyError] = useState<string | null>(null);
  const [leadAutoReplySuccess, setLeadAutoReplySuccess] = useState<string | null>(null);
  const [leadAutoReplyTestEmail, setLeadAutoReplyTestEmail] = useState<string>('');
  const [leadNotificationTemplate, setLeadNotificationTemplate] = useState<LeadNotificationTemplate | null>(null);
  const [leadNotificationDraft, setLeadNotificationDraft] = useState<
    Omit<LeadNotificationTemplate, 'workspace_id' | 'updated_at'>
  >(DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT);
  const [leadNotificationLoading, setLeadNotificationLoading] = useState(false);
  const [leadNotificationSaving, setLeadNotificationSaving] = useState(false);
  const [leadNotificationError, setLeadNotificationError] = useState<string | null>(null);
  const [leadNotificationSuccess, setLeadNotificationSuccess] = useState<string | null>(null);
  const [leadAssignmentTemplate, setLeadAssignmentTemplate] = useState<LeadAssignmentTemplate | null>(null);
  const [leadAssignmentDraft, setLeadAssignmentDraft] = useState<
    Omit<LeadAssignmentTemplate, 'workspace_id' | 'updated_at'>
  >(DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT);
  const [leadAssignmentLoading, setLeadAssignmentLoading] = useState(false);
  const [leadAssignmentSaving, setLeadAssignmentSaving] = useState(false);
  const [leadAssignmentError, setLeadAssignmentError] = useState<string | null>(null);
  const [leadAssignmentSuccess, setLeadAssignmentSuccess] = useState<string | null>(null);
  const [emailVerifierBalance, setEmailVerifierBalance] = useState<{
    remaining_daily_credits: number;
    remaining_instant_credits: number;
    last_updated: string;
  } | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [checkingFacebookConnection, setCheckingFacebookConnection] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    slug: string;
    type: 'open' | 'closed_won' | 'closed_lost';
    color: string;
    is_active: number;
    is_qualified: number;
  }>({
    name: '',
    slug: '',
    type: 'open',
    color: '#6B7280',
    is_active: 1,
    is_qualified: 0,
  });

  const loadStatuses = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE_URL}/api/lead-statuses?workspace_id=${currentWorkspace.id}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const data = await res.json();

      if (res.ok && data.status === 'success' && data.data) {
        let workspaceStatuses = (data.data as EditableStatus[])
          .filter(s => s.workspace_id === currentWorkspace.id)
          .sort((a, b) => a.order_index - b.order_index);

        // Ensure there is always a single default; prefer Pending if none marked
        const hasDefault = workspaceStatuses.some(s => s.is_default === 1);
        if (!hasDefault && workspaceStatuses.length > 0) {
          const pendingStatus = workspaceStatuses.find(
            s => s.slug === 'pending' || s.name.toLowerCase() === 'pending'
          );
          if (pendingStatus) {
            workspaceStatuses = workspaceStatuses.map(s => ({
              ...s,
              is_default: s.id === pendingStatus.id ? 1 : 0,
            }));

            // Persist default flag in the background
            try {
              const token = getAuthToken();
              await fetch(`${API_BASE_URL}/api/lead-statuses/${pendingStatus.id}`, {
                method: 'PUT',
                headers: { 
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ is_default: 1 }),
              });
            } catch (err) {
              console.error('Failed to persist Pending as default status', err);
            }
          }
        }

        setStatuses(workspaceStatuses);
      } else {
        setError('Failed to load lead statuses');
      }
    } catch (e) {
      console.error('Failed to load statuses', e);
      setError('Failed to load lead statuses');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  const loadInviteTemplate = useCallback(async () => {
    if (!currentWorkspace) return;
    setEmailTemplateLoading(true);
    setEmailTemplateError(null);
    setEmailTemplateSuccess(null);
    try {
      const response = await getWorkspaceInviteEmailTemplate(currentWorkspace.id);
      if (response.status === 'success' && response.data) {
        setInviteTemplate(response.data);
        setInviteTemplateDraft(response.data);
      } else {
        // Shouldn't happen because api-client throws on error, but keep a safe fallback.
        setInviteTemplate(null);
        setInviteTemplateDraft(DEFAULT_INVITE_EMAIL_TEMPLATE);
      }
    } catch (err: any) {
      setEmailTemplateError(err?.message || 'Failed to load email template');
      setInviteTemplate(null);
      setInviteTemplateDraft(DEFAULT_INVITE_EMAIL_TEMPLATE);
    } finally {
      setEmailTemplateLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (activeTab !== 'email') return;
    loadInviteTemplate();
  }, [activeTab, loadInviteTemplate]);

  const loadLeadAutoReplySettings = useCallback(async () => {
    if (!currentWorkspace || workspaceMembersLoading) return;

    setSmtpConfigLoading(true);
    setLeadAutoReplyLoading(true);
    setLeadNotificationLoading(true);
    setLeadAssignmentLoading(true);
    setSmtpConfigError(null);
    setSmtpConfigSuccess(null);
    setLeadAutoReplyError(null);
    setLeadAutoReplySuccess(null);
    setLeadNotificationError(null);
    setLeadNotificationSuccess(null);
    setLeadAssignmentError(null);
    setLeadAssignmentSuccess(null);

    const workspaceId = currentWorkspace.id;
    const canManageSmtp = getUserRole(workspaceId) === 'admin';

    const [smtpResult, templateResult, notificationTemplateResult, assignmentTemplateResult] = await Promise.allSettled([
      canManageSmtp
        ? getWorkspaceSmtpConfig(workspaceId)
        : Promise.resolve({ status: 'success', data: null as WorkspaceSmtpConfig | null }),
      getLeadAutoReplyTemplate(workspaceId),
      getLeadNotificationTemplate(workspaceId),
      getLeadAssignmentTemplate(workspaceId),
    ]);

    if (smtpResult.status === 'fulfilled') {
      const response = smtpResult.value;
      if (response.status === 'success' && response.data) {
        const config = response.data;
        setSmtpConfig(config);
        setSmtpDraft({
          enabled: config.enabled,
          host: config.host,
          port: config.port,
          secure: config.secure,
          username: config.username,
          password: '',
          from_name: config.from_name,
          from_email: config.from_email,
          reply_to: config.reply_to || '',
        });
        setSmtpProviderPreset(detectSmtpPreset(config));
        setSmtpTestEmail((prev) =>
          prev.trim() ? prev : (user?.email || config.from_email || '').trim()
        );
      } else {
        setSmtpConfig(null);
        setSmtpDraft(DEFAULT_SMTP_DRAFT);
        setSmtpProviderPreset('custom');
      }
    } else {
      setSmtpConfig(null);
      setSmtpDraft(DEFAULT_SMTP_DRAFT);
      setSmtpProviderPreset('custom');
      setSmtpConfigError(
        smtpResult.reason instanceof Error
          ? smtpResult.reason.message
          : 'Failed to load SMTP configuration'
      );
    }

    if (templateResult.status === 'fulfilled') {
      const response = templateResult.value;
      if (response.status === 'success' && response.data) {
        setLeadAutoReplyTemplate(response.data);
        setLeadAutoReplyDraft({
          enabled: response.data.enabled,
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
          attachments: response.data.attachments || [],
        });
      } else {
        setLeadAutoReplyTemplate(null);
        setLeadAutoReplyDraft(DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT);
      }
    } else {
      setLeadAutoReplyTemplate(null);
      setLeadAutoReplyDraft(DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT);
      setLeadAutoReplyError(
        templateResult.reason instanceof Error
          ? templateResult.reason.message
          : 'Failed to load lead auto-reply template'
      );
    }

    if (notificationTemplateResult.status === 'fulfilled') {
      const response = notificationTemplateResult.value;
      if (response.status === 'success' && response.data) {
        setLeadNotificationTemplate(response.data);
        setLeadNotificationDraft({
          enabled: response.data.enabled,
          recipient_email: response.data.recipient_email,
          additional_recipients: response.data.additional_recipients || [],
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
        });
      } else {
        setLeadNotificationTemplate(null);
        setLeadNotificationDraft(DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT);
      }
    } else {
      setLeadNotificationTemplate(null);
      setLeadNotificationDraft(DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT);
      setLeadNotificationError(
        notificationTemplateResult.reason instanceof Error
          ? notificationTemplateResult.reason.message
          : 'Failed to load lead notification template'
      );
    }

    if (assignmentTemplateResult.status === 'fulfilled') {
      const response = assignmentTemplateResult.value;
      if (response.status === 'success' && response.data) {
        setLeadAssignmentTemplate(response.data);
        setLeadAssignmentDraft({
          enabled: response.data.enabled,
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
        });
      } else {
        setLeadAssignmentTemplate(null);
        setLeadAssignmentDraft(DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT);
      }
    } else {
      setLeadAssignmentTemplate(null);
      setLeadAssignmentDraft(DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT);
      setLeadAssignmentError(
        assignmentTemplateResult.reason instanceof Error
          ? assignmentTemplateResult.reason.message
          : 'Failed to load lead assignment template'
      );
    }

    setLeadAutoReplyTestEmail((prev) => (prev.trim() ? prev : (user?.email || '').trim()));

    setSmtpConfigLoading(false);
    setLeadAutoReplyLoading(false);
    setLeadNotificationLoading(false);
    setLeadAssignmentLoading(false);
  }, [currentWorkspace, getUserRole, user?.email, workspaceMembersLoading]);

  useEffect(() => {
    if (activeTab !== 'email') return;
    loadLeadAutoReplySettings();
  }, [activeTab, loadLeadAutoReplySettings]);

  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true);
    setBalanceError(null);
    try {
      const balance = await getEmailVerifierBalance();
      setEmailVerifierBalance({
        remaining_daily_credits: balance.remaining_daily_credits,
        remaining_instant_credits: balance.remaining_instant_credits,
        last_updated: new Date().toLocaleString(),
      });
    } catch (error) {
      console.error('Failed to fetch email verifier balance:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load balance information';
      setBalanceError(errorMessage);
      setEmailVerifierBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'email') return;
    fetchBalance();
  }, [activeTab, fetchBalance]);


  // Check Facebook connection status when Facebook tab is active
  useEffect(() => {
    const checkFacebookConnection = async () => {
      if (activeTab !== 'facebook' || !currentWorkspace?.id) return;
      setCheckingFacebookConnection(true);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/facebook/${currentWorkspace.id}/pages`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = await res.json();
        if (data.status === 'success' && data.data) {
          setFacebookConnected(true);
        } else {
          setFacebookConnected(false);
        }
      } catch (error) {
        setFacebookConnected(false);
      } finally {
        setCheckingFacebookConnection(false);
      }
    };
    checkFacebookConnection();
  }, [activeTab, currentWorkspace?.id]);

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Please select a workspace to manage settings.</p>
      </div>
    );
  }

  // Role check: admin can manage, members cannot
  const userRole = currentWorkspace ? getUserRole(currentWorkspace.id) : null;
  const isWorkspaceManager = userRole === 'admin';
  const trimmedWorkspaceName = workspaceName.trim();
  const currentWorkspaceCurrency = normalizeWorkspaceCurrency(currentWorkspace.currency);
  const workspaceNameHasChanged = trimmedWorkspaceName !== currentWorkspace.name;
  const workspaceCurrencyHasChanged = workspaceCurrency !== currentWorkspaceCurrency;
  const workspaceSettingsHaveChanges = workspaceNameHasChanged || workspaceCurrencyHasChanged;
  const workspaceNameError =
    trimmedWorkspaceName.length === 0
      ? 'Workspace name is required'
      : trimmedWorkspaceName.length < 2
        ? 'Workspace name must be at least 2 characters'
        : trimmedWorkspaceName.length > 50
          ? 'Workspace name must be less than 50 characters'
          : null;
  const inviteTemplateHasChanges =
    JSON.stringify(inviteTemplateDraft) !==
    JSON.stringify(inviteTemplate || DEFAULT_INVITE_EMAIL_TEMPLATE);

  const handleRestoreInviteTemplateDefaults = () => {
    setInviteTemplateDraft(DEFAULT_INVITE_EMAIL_TEMPLATE);
    setEmailTemplateError(null);
    setEmailTemplateSuccess(null);
  };

  const handleSaveInviteTemplate = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;
    setEmailTemplateSaving(true);
    setEmailTemplateError(null);
    setEmailTemplateSuccess(null);
    try {
      const res = await updateWorkspaceInviteEmailTemplate(currentWorkspace.id, inviteTemplateDraft);
      if (res.status === 'success' && res.data) {
        setInviteTemplate(res.data);
        setInviteTemplateDraft(res.data);
        setEmailTemplateSuccess('Template saved.');
      } else {
        setEmailTemplateError('Failed to save template');
      }
    } catch (err: any) {
      setEmailTemplateError(err?.message || 'Failed to save template');
    } finally {
      setEmailTemplateSaving(false);
    }
  };

  const smtpConfigComparable = smtpConfig
    ? {
        enabled: smtpConfig.enabled,
        host: smtpConfig.host || '',
        port: smtpConfig.port || 587,
        secure: smtpConfig.secure,
        username: smtpConfig.username || '',
        from_name: smtpConfig.from_name || '',
        from_email: smtpConfig.from_email || '',
        reply_to: smtpConfig.reply_to || '',
      }
    : {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        username: '',
        from_name: '',
        from_email: '',
        reply_to: '',
      };

  const smtpDraftComparable = {
    enabled: Boolean(smtpDraft.enabled),
    host: String(smtpDraft.host || '').trim(),
    port: Number(smtpDraft.port || 587),
    secure: Boolean(smtpDraft.secure),
    username: String(smtpDraft.username || '').trim(),
    from_name: String(smtpDraft.from_name || '').trim(),
    from_email: String(smtpDraft.from_email || '').trim().toLowerCase(),
    reply_to: String(smtpDraft.reply_to || '').trim().toLowerCase(),
  };

  const smtpPasswordDirty = Boolean(String(smtpDraft.password || '').trim());
  const smtpConfigHasChanges =
    smtpPasswordDirty ||
    JSON.stringify(smtpDraftComparable) !== JSON.stringify(smtpConfigComparable);

  const leadAutoReplyHasChanges =
    JSON.stringify(leadAutoReplyDraft) !==
    JSON.stringify(
      leadAutoReplyTemplate
        ? {
            enabled: leadAutoReplyTemplate.enabled,
            subject: leadAutoReplyTemplate.subject,
            html: leadAutoReplyTemplate.html,
            text: leadAutoReplyTemplate.text,
            attachments: leadAutoReplyTemplate.attachments || [],
          }
        : DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT
    );

  const leadNotificationHasChanges =
    JSON.stringify(leadNotificationDraft) !==
    JSON.stringify(
      leadNotificationTemplate
        ? {
            enabled: leadNotificationTemplate.enabled,
            recipient_email: leadNotificationTemplate.recipient_email,
            additional_recipients: leadNotificationTemplate.additional_recipients || [],
            subject: leadNotificationTemplate.subject,
            html: leadNotificationTemplate.html,
            text: leadNotificationTemplate.text,
          }
        : DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT
    );

  const leadAssignmentHasChanges =
    JSON.stringify(leadAssignmentDraft) !==
    JSON.stringify(
      leadAssignmentTemplate
        ? {
            enabled: leadAssignmentTemplate.enabled,
            subject: leadAssignmentTemplate.subject,
            html: leadAssignmentTemplate.html,
            text: leadAssignmentTemplate.text,
          }
        : DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT
    );

  const handleSmtpProviderPresetChange = (preset: SmtpProviderPreset) => {
    setSmtpProviderPreset(preset);
    if (preset === 'custom') return;
    const presetValues = SMTP_PROVIDER_PRESETS[preset];
    setSmtpDraft((prev) => ({
      ...prev,
      host: presetValues.host,
      port: presetValues.port,
      secure: presetValues.secure,
    }));
  };

  const handleSaveSmtpConfig = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;
    setSmtpConfigSaving(true);
    setSmtpConfigError(null);
    setSmtpConfigSuccess(null);
    try {
      const payload: WorkspaceSmtpConfigInput = {
        enabled: Boolean(smtpDraft.enabled),
        host: String(smtpDraft.host || '').trim(),
        port: Number(smtpDraft.port || 587),
        secure: Boolean(smtpDraft.secure),
        username: String(smtpDraft.username || '').trim(),
        from_name: String(smtpDraft.from_name || '').trim(),
        from_email: String(smtpDraft.from_email || '').trim().toLowerCase(),
        reply_to: String(smtpDraft.reply_to || '').trim().toLowerCase(),
      };

      const password = String(smtpDraft.password || '').trim();
      if (password) {
        payload.password = password;
      }

      const response = await updateWorkspaceSmtpConfig(currentWorkspace.id, payload);
      if (response.status === 'success' && response.data) {
        const saved = response.data;
        setSmtpConfig(saved);
        setSmtpDraft({
          enabled: saved.enabled,
          host: saved.host,
          port: saved.port,
          secure: saved.secure,
          username: saved.username,
          password: '',
          from_name: saved.from_name,
          from_email: saved.from_email,
          reply_to: saved.reply_to || '',
        });
        setSmtpProviderPreset(detectSmtpPreset(saved));
        setSmtpConfigSuccess('SMTP configuration saved.');
      } else {
        setSmtpConfigError('Failed to save SMTP configuration');
      }
    } catch (err: any) {
      setSmtpConfigError(err?.message || 'Failed to save SMTP configuration');
    } finally {
      setSmtpConfigSaving(false);
      setShowSmtpPassword(false);
    }
  };

  const handleSendSmtpTestEmail = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;
    const to = smtpTestEmail.trim().toLowerCase();
    if (!to) {
      setSmtpConfigError('Enter a test recipient email first.');
      return;
    }

    setSmtpConfigTesting(true);
    setSmtpConfigError(null);
    setSmtpConfigSuccess(null);

    try {
      const response = await sendWorkspaceSmtpTestEmail(currentWorkspace.id, to);
      if (response.status === 'success') {
        setSmtpConfigSuccess('SMTP test email sent.');
      } else {
        setSmtpConfigError('Failed to send SMTP test email');
      }
    } catch (err: any) {
      setSmtpConfigError(err?.message || 'Failed to send SMTP test email');
    } finally {
      setSmtpConfigTesting(false);
    }
  };

  const handleRestoreLeadAutoReplyDefaults = () => {
    setLeadAutoReplyDraft(DEFAULT_LEAD_AUTOREPLY_TEMPLATE_DRAFT);
    setLeadAutoReplyError(null);
    setLeadAutoReplySuccess(null);
  };

  const handleSaveLeadAutoReplyTemplate = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;

    setLeadAutoReplySaving(true);
    setLeadAutoReplyError(null);
    setLeadAutoReplySuccess(null);
    try {
      const response = await updateLeadAutoReplyTemplate(currentWorkspace.id, {
        enabled: leadAutoReplyDraft.enabled,
        subject: leadAutoReplyDraft.subject,
        html: leadAutoReplyDraft.html,
        text: leadAutoReplyDraft.text,
        attachments: leadAutoReplyDraft.attachments,
      });

      if (response.status === 'success' && response.data) {
        setLeadAutoReplyTemplate(response.data);
        setLeadAutoReplyDraft({
          enabled: response.data.enabled,
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
          attachments: response.data.attachments || [],
        });
        setLeadAutoReplySuccess('Lead auto-reply template saved.');
      } else {
        setLeadAutoReplyError('Failed to save lead auto-reply template');
      }
    } catch (err: any) {
      setLeadAutoReplyError(err?.message || 'Failed to save lead auto-reply template');
    } finally {
      setLeadAutoReplySaving(false);
    }
  };

  const handleSendLeadAutoReplyTestEmail = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;

    const to = leadAutoReplyTestEmail.trim().toLowerCase();
    if (!to) {
      setLeadAutoReplyError('Enter a test recipient email first.');
      return;
    }

    setLeadAutoReplyTesting(true);
    setLeadAutoReplyError(null);
    setLeadAutoReplySuccess(null);

    try {
      const response = await sendLeadAutoReplyTemplateTestEmail(currentWorkspace.id, {
        to,
        lead: {
          name: 'Sample Lead',
          email: to,
          source_old: 'MANUAL',
          source_ref: 'preview-test',
        },
      });

      if (response.status === 'success') {
        setLeadAutoReplySuccess('Lead auto-reply test email sent.');
      } else {
        setLeadAutoReplyError('Failed to send lead auto-reply test email');
      }
    } catch (err: any) {
      setLeadAutoReplyError(err?.message || 'Failed to send lead auto-reply test email');
    } finally {
      setLeadAutoReplyTesting(false);
    }
  };

  const handleRestoreLeadNotificationDefaults = () => {
    setLeadNotificationDraft(DEFAULT_LEAD_NOTIFICATION_TEMPLATE_DRAFT);
    setLeadNotificationError(null);
    setLeadNotificationSuccess(null);
  };

  const handleSaveLeadNotificationTemplate = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;

    setLeadNotificationSaving(true);
    setLeadNotificationError(null);
    setLeadNotificationSuccess(null);
    try {
      const response = await updateLeadNotificationTemplate(currentWorkspace.id, {
        enabled: leadNotificationDraft.enabled,
        recipient_email: leadNotificationDraft.recipient_email,
        additional_recipients: leadNotificationDraft.additional_recipients,
        subject: leadNotificationDraft.subject,
        html: leadNotificationDraft.html,
        text: leadNotificationDraft.text,
      });

      if (response.status === 'success' && response.data) {
        setLeadNotificationTemplate(response.data);
        setLeadNotificationDraft({
          enabled: response.data.enabled,
          recipient_email: response.data.recipient_email,
          additional_recipients: response.data.additional_recipients || [],
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
        });
        setLeadNotificationSuccess('Lead notification template saved.');
      } else {
        setLeadNotificationError('Failed to save lead notification template');
      }
    } catch (err: any) {
      setLeadNotificationError(err?.message || 'Failed to save lead notification template');
    } finally {
      setLeadNotificationSaving(false);
    }
  };

  const handleRestoreLeadAssignmentDefaults = () => {
    setLeadAssignmentDraft(DEFAULT_LEAD_ASSIGNMENT_TEMPLATE_DRAFT);
    setLeadAssignmentError(null);
    setLeadAssignmentSuccess(null);
  };

  const handleSaveLeadAssignmentTemplate = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;

    setLeadAssignmentSaving(true);
    setLeadAssignmentError(null);
    setLeadAssignmentSuccess(null);
    try {
      const response = await updateLeadAssignmentTemplate(currentWorkspace.id, {
        enabled: leadAssignmentDraft.enabled,
        subject: leadAssignmentDraft.subject,
        html: leadAssignmentDraft.html,
        text: leadAssignmentDraft.text,
      });

      if (response.status === 'success' && response.data) {
        setLeadAssignmentTemplate(response.data);
        setLeadAssignmentDraft({
          enabled: response.data.enabled,
          subject: response.data.subject,
          html: response.data.html,
          text: response.data.text,
        });
        setLeadAssignmentSuccess('Lead assignment notification template saved.');
      } else {
        setLeadAssignmentError('Failed to save lead assignment notification template');
      }
    } catch (err: any) {
      setLeadAssignmentError(err?.message || 'Failed to save lead assignment notification template');
    } finally {
      setLeadAssignmentSaving(false);
    }
  };

  const handleToggleDefault = async (statusId: number) => {
    if (!isWorkspaceManager) return;
    try {
      // Only one default per workspace – clear others locally
      const updated = statuses.map(s => ({
        ...s,
        is_default: s.id === statusId ? 1 : 0,
      }));
      setStatuses(updated);

      // Persist via API – update changed rows
      const token = getAuthToken();
      await Promise.all(
        updated.map(s =>
          fetch(`${API_BASE_URL}/api/lead-statuses/${s.id}`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              is_default: s.is_default,
              order_index: s.order_index,
              is_active: s.is_active,
              is_qualified: s.is_qualified,
            }),
          })
        )
      );
    } catch (e) {
      console.error('Failed to update default status', e);
      setError('Failed to update default status');
    }
  };

  const handleToggleShow = async (status: EditableStatus) => {
    if (!isWorkspaceManager) return;
    try {
      const nextActive = status.is_active === 1 ? 0 : 1;
      setStatuses(prev =>
        prev.map(s => (s.id === status.id ? { ...s, is_active: nextActive } : s))
      );
      const token = getAuthToken();
      await fetch(`${API_BASE_URL}/api/lead-statuses/${status.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_active: nextActive }),
      });
    } catch (e) {
      console.error('Failed to toggle visibility', e);
      setError('Failed to update visibility');
    }
  };

  const handleToggleQualified = async (status: EditableStatus) => {
    if (!isWorkspaceManager) return;
    try {
      const nextQualified = status.is_qualified === 1 ? 0 : 1;
      setStatuses(prev =>
        prev.map(s => (s.id === status.id ? { ...s, is_qualified: nextQualified } : s))
      );
      const token = getAuthToken();
      await fetch(`${API_BASE_URL}/api/lead-statuses/${status.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_qualified: nextQualified }),
      });
    } catch (e) {
      console.error('Failed to toggle qualified flag', e);
      setError('Failed to update qualification');
    }
  };

  const moveStatus = (id: number, direction: 'up' | 'down') => {
    if (!isWorkspaceManager) return;
    setStatuses(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const clone = [...prev];
      const [removed] = clone.splice(index, 1);
      clone.splice(newIndex, 0, removed);
      return clone.map((s, idx) => ({ ...s, order_index: idx + 1 }));
    });
  };

  const pendingExists = statuses.some(
    s => s.slug === 'pending' || s.name.toLowerCase() === 'pending'
  );

  const generateSlug = (label: string): string =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 50);

  const openCreateForm = () => {
    setEditingStatus(null);
    setFormData({
      name: '',
      slug: '',
      type: 'open',
      color: '#6B7280',
      is_active: 1,
      is_qualified: 0,
    });
    setShowForm(true);
    setError(null);
  };

  const openEditForm = (status: EditableStatus) => {
    setEditingStatus(status);
    setFormData({
      name: status.name,
      slug: status.slug,
      type: status.type,
      color: status.color || '#6B7280',
      is_active: status.is_active,
      is_qualified: status.is_qualified ?? 0,
    });
    setShowForm(true);
    setError(null);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingStatus(null);
    setFormData({
      name: '',
      slug: '',
      type: 'open',
      color: '#6B7280',
      is_active: 1,
      is_qualified: 0,
    });
  };

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    if (!formData.name.trim()) {
      setError('Status name is required');
      return;
    }

    setSaving(true);
    setHeaderSaving(true);
    setError(null);

    const slug = formData.slug || generateSlug(formData.name);

    try {
      const token = getAuthToken();
      if (editingStatus) {
        await fetch(`${API_BASE_URL}/api/lead-statuses/${editingStatus.id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            name: formData.name.trim(),
            slug,
            type: formData.type,
            color: formData.color,
            is_active: formData.is_active,
            is_qualified: formData.is_qualified,
          }),
        });
      } else {
        const nextOrder =
          statuses.length > 0 ? Math.max(...statuses.map(s => s.order_index)) + 1 : 1;
        await fetch(`${API_BASE_URL}/api/lead-statuses`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            workspace_id: currentWorkspace.id,
            name: formData.name.trim(),
            slug,
            color: formData.color,
            order_index: nextOrder,
            type: formData.type,
            is_default: 0,
            is_active: formData.is_active,
            is_qualified: formData.is_qualified,
          }),
        });
      }

      await loadStatuses();
      resetForm();
    } catch (e) {
      console.error('Failed to save status', e);
      setError('Failed to save status');
    } finally {
      setSaving(false);
      setHeaderSaving(false);
    }
  };

  const handleDeleteStatus = async (status: EditableStatus) => {
    if (!isWorkspaceManager) return;
    const isPending =
      status.slug === 'pending' || status.name.toLowerCase() === 'pending';
    if (isPending) {
      setError('Pending status cannot be deleted');
      return;
    }
    if (statuses.length <= 1) {
      setError('At least one lead status must remain in this workspace');
      return;
    }
    if (!window.confirm('Delete this status? Leads using it will be moved to another available status.')) {
      return;
    }

    setSaving(true);
    setHeaderSaving(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/lead-statuses/${status.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      let payload: { status?: string; message?: string; error?: string } | null = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || payload?.message || 'Failed to delete status');
      }

      await loadStatuses();
    } catch (e) {
      console.error('Failed to delete status', e);
      setError(e instanceof Error ? e.message : 'Failed to delete status');
    } finally {
      setSaving(false);
      setHeaderSaving(false);
    }
  };

  const handleSaveWorkspaceSettings = async () => {
    if (!isWorkspaceManager || !currentWorkspace) return;

    if (workspaceNameError) {
      setWorkspaceSettingsError(workspaceNameError);
      setWorkspaceSettingsSuccess(null);
      return;
    }

    if (!workspaceSettingsHaveChanges) return;

    setWorkspaceSettingsSaving(true);
    setWorkspaceSettingsError(null);
    setWorkspaceSettingsSuccess(null);

    try {
      const updates: { name?: string; currency?: WorkspaceCurrencyCode } = {};
      if (workspaceNameHasChanged) {
        updates.name = trimmedWorkspaceName;
      }
      if (workspaceCurrencyHasChanged) {
        updates.currency = workspaceCurrency;
      }

      const response = await updateWorkspace(currentWorkspace.id, {
        ...updates,
      });

      if (response.status !== 'success') {
        throw new Error(response.message || response.error || 'Failed to update workspace settings');
      }

      await refreshWorkspaces();
      setWorkspaceSettingsSuccess('Workspace settings updated');
    } catch (e) {
      console.error('Failed to update workspace settings', e);
      setWorkspaceSettingsError(e instanceof Error ? e.message : 'Failed to update workspace settings');
    } finally {
      setWorkspaceSettingsSaving(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!currentWorkspace || !user) return;

    setDeletingWorkspace(true);
    setError(null);

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/workspaces/${currentWorkspace.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (response.ok) {
        // Refresh workspaces list
        await refreshWorkspaces();

        // Navigate to dashboard
        navigate('/dashboard');
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to delete workspace');
      }
    } catch (e) {
      console.error('Failed to delete workspace', e);
      setError('Failed to delete workspace');
    } finally {
      setDeletingWorkspace(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="w-full bg-white">
      <div className="mb-6 px-6">
        <h1 className="text-2xl font-bold text-gray-900">Workspace Settings</h1>
        <p className="text-gray-500 mt-1">
          Configure lead statuses, deal stages, and workspace preferences for {currentWorkspace.name}.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 px-6">
        <nav className="-mb-px flex space-x-8 text-sm overflow-x-auto whitespace-nowrap scrollbar-none">
          <button
            className={`pb-3 border-b-2 flex-shrink-0 ${
              activeTab === 'workspace'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('workspace')}
          >
            Workspace
          </button>
          <button
            className={`pb-3 border-b-2 flex-shrink-0 ${
              activeTab === 'statuses'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('statuses')}
          >
            Lead status
          </button>
          <button
            className={`pb-3 border-b-2 flex-shrink-0 ${
              activeTab === 'deals'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('deals')}
          >
            Deals
          </button>
          <button
            className={`pb-3 border-b-2 flex-shrink-0 ${
              activeTab === 'members'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('members')}
          >
            Members
          </button>
          <button
            className={`pb-3 border-b-2 flex-shrink-0 flex items-center gap-1 ${
              activeTab === 'email'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('email')}
          >
            <span>Email Templates</span>
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-gray-900 text-white text-[10px]">
              2
            </span>
          </button>
          <button
            className={`pb-3 border-b-2 flex-shrink-0 ${
              activeTab === 'facebook'
                ? 'border-black text-black font-semibold bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('facebook')}
          >
            Facebook Integration
          </button>
        </nav>
      </div>

      {/* Workspace Tab */}
      {activeTab === 'workspace' && (
        <div className="bg-white text-sm text-gray-700 px-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Workspace</h2>
          <p>
            Manage high-level settings for <span className="font-semibold">{currentWorkspace.name}</span>.
            Additional workspace configuration can be added here.
          </p>

          <div className="mt-6 border border-gray-200 rounded-lg p-4 max-w-2xl">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Workspace name
                </label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => {
                    setWorkspaceName(e.target.value);
                    setWorkspaceSettingsSuccess(null);
                    setWorkspaceSettingsError(null);
                  }}
                  disabled={!isWorkspaceManager || workspaceSettingsSaving}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="Enter workspace name"
                />
                <p className="mt-2 text-xs text-gray-500">
                  This name appears in your workspace switcher, sidebar, and invite emails.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Workspace currency
                </label>
                <select
                  value={workspaceCurrency}
                  onChange={(e) => {
                    setWorkspaceCurrency(normalizeWorkspaceCurrency(e.target.value));
                    setWorkspaceSettingsSuccess(null);
                    setWorkspaceSettingsError(null);
                  }}
                  disabled={!isWorkspaceManager || workspaceSettingsSaving}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {WORKSPACE_CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} - {currency.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-gray-500">
                  Example: {formatWorkspaceCurrency(20000, workspaceCurrency)}
                </p>
              </div>

              {isWorkspaceManager && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveWorkspaceSettings}
                    disabled={
                      workspaceSettingsSaving ||
                      !workspaceSettingsHaveChanges ||
                      Boolean(workspaceNameError)
                    }
                    className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {workspaceSettingsSaving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              )}
            </div>

            {workspaceSettingsError && (
              <div className="mt-3 border border-red-200 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {workspaceSettingsError}
              </div>
            )}
            {workspaceSettingsSuccess && (
              <div className="mt-3 border border-green-200 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
                {workspaceSettingsSuccess}
              </div>
            )}
          </div>

          {/* Delete Workspace Section */}
          {isWorkspaceManager && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-red-900 mb-1">Delete Workspace</h3>
                    <p className="text-red-700 text-xs">
                      Permanently delete this workspace and all its data. This action cannot be undone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(true)}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    Delete Workspace
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lead Status Tab */}
      {activeTab === 'deals' && <DealStagesSettings key={currentWorkspace.id} workspaceId={currentWorkspace.id} canEdit={isWorkspaceManager} />}

      {activeTab === 'statuses' && (
        <div className="bg-white px-0">
          <div className="px-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">Lead status</h2>
                  {isWorkspaceManager && (
                    <button
                      type="button"
                      onClick={openCreateForm}
                      className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white text-xs leading-none"
                    >
                      +
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Lead Status represent a Lead&apos;s current relationship to your company. You will
                  notice that we have pre-loaded some commonly-used Lead Statuses into your Ohmylead
                  account as examples. These can be changed to reflect your team&apos;s specific lead
                  management process.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {headerSaving && (
                  <div className="flex items-center text-xs text-gray-500">
                    <span className="mr-2 h-3 w-3 border-b-2 border-gray-500 rounded-full animate-spin" />
                    Saving…
                  </div>
                )}
              </div>
            </div>

          {error && (
            <div
              className="mb-4 border border-red-200 rounded bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading lead statuses…</div>
          ) : (
            <>
              <div className="border-t border-gray-200">
                <div className="grid grid-cols-12 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 px-6 py-2">
                  <div className="col-span-4 text-left">
                    Status label
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <span>Show</span>
                    <QuestionMarkCircleIcon
                      className="h-3.5 w-3.5 text-blue-500"
                      title="Toggle to show or hide this status for your team."
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <span>Default</span>
                    <QuestionMarkCircleIcon
                      className="h-3.5 w-3.5 text-blue-500"
                      title="Set this status as the default for new leads in this workspace."
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <span>Is qualified</span>
                    <QuestionMarkCircleIcon
                      className="h-3.5 w-3.5 text-blue-500"
                      title="Mark leads in this status as qualified."
                    />
                  </div>
                  <div className="col-span-2 text-right">Action</div>
                </div>
                {statuses.map((status, index) => {
                  return (
                    <div
                      key={status.id}
                      className="grid grid-cols-12 items-center px-6 py-3 text-sm bg-white"
                    >
                      <div className="col-span-4 flex items-center gap-3">
                        <button
                          type="button"
                          className="flex-1 flex items-center bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800"
                          disabled
                        >
                          <Bars3Icon className="h-4 w-4 text-gray-400 mr-2 cursor-move select-none" />
                          <span className="font-medium truncate">{status.name}</span>
                        </button>
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-gray-200"
                          style={{ backgroundColor: status.color || '#000000' }}
                        />
                      </div>
                      <div className="col-span-2 text-center">
                        <button
                          type="button"
                          disabled={!isWorkspaceManager}
                          onClick={() => handleToggleShow(status)}
                          className={`relative inline-flex h-4 w-8 items-center rounded-full border transition-colors px-0.5 disabled:opacity-60 disabled:cursor-not-allowed ${
                            status.is_active === 1
                              ? 'bg-blue-500 border-blue-500'
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
                              status.is_active === 1 ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                          <span className="sr-only">Toggle visibility</span>
                        </button>
                      </div>
                      <div className="col-span-2 text-center">
                        <input
                          type="checkbox"
                          checked={status.is_default === 1}
                          onChange={() => handleToggleDefault(status.id)}
                          disabled={!isWorkspaceManager}
                          className="h-4 w-4 rounded border-2 border-gray-400 focus:outline-none focus:ring-0"
                          style={{ accentColor: '#3b82f6' }}
                        />
                      </div>
                      <div className="col-span-2 text-center">
                        <input
                          type="checkbox"
                          checked={status.is_qualified === 1}
                          onChange={() => handleToggleQualified(status)}
                          disabled={!isWorkspaceManager}
                          className="h-4 w-4 rounded border-2 border-gray-400 focus:outline-none focus:ring-0"
                          style={{ accentColor: '#3b82f6' }}
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        {isWorkspaceManager && (
                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuStatusId(prev =>
                                  prev === status.id ? null : status.id
                                )
                              }
                              className="px-2 py-1 rounded hover:bg-gray-100 text-gray-700"
                            >
                              <span className="text-xl leading-none">⋮</span>
                            </button>
                            {openMenuStatusId === status.id && (
                              <div className="origin-top-right absolute right-0 mt-1 w-40 rounded-md shadow-lg bg-white border border-gray-200 z-10">
                                <div className="py-1 text-sm text-gray-700">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      moveStatus(status.id, 'up');
                                      setOpenMenuStatusId(null);
                                    }}
                                    disabled={index === 0}
                                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                                  >
                                    Move up
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      moveStatus(status.id, 'down');
                                      setOpenMenuStatusId(null);
                                    }}
                                    disabled={index === statuses.length - 1}
                                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                                  >
                                    Move down
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openEditForm(status);
                                      setOpenMenuStatusId(null);
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleDeleteStatus(status);
                                      setOpenMenuStatusId(null);
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {isWorkspaceManager && (
                <div className="px-6 pt-3 text-sm">
                  <button
                    type="button"
                    onClick={openCreateForm}
                    className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 font-medium"
                  >
                    <span className="text-base leading-none">+</span>
                    <span>Add custom status</span>
                  </button>
                </div>
              )}
            </>
          )}

          {!pendingExists && (
            <div className="mt-4 text-xs text-gray-500">
              Note: backend must ensure a <span className="font-semibold">Pending</span> status exists per workspace.
            </div>
          )}
        </div>
      </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="bg-white px-6">
          {currentWorkspace && <WorkspaceMembersManager key={currentWorkspace.id} workspaceId={currentWorkspace.id} />}
        </div>
      )}

      {/* Email Templates Tab */}
      {activeTab === 'email' && (
        <div className="bg-white px-6 text-sm text-gray-700">
          {/* Email Verification Credits */}
          <div className="border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Email Verification Credits</h3>
              <button
                onClick={fetchBalance}
                disabled={loadingBalance}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
                title="Refresh balance"
              >
                <ArrowPathIcon className={`w-4 h-4 ${loadingBalance ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {loadingBalance ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400"></div>
              </div>
            ) : emailVerifierBalance ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Daily Credits</p>
                    <p className="text-lg font-bold text-gray-900">{emailVerifierBalance.remaining_daily_credits}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Instant Credits</p>
                    <p className="text-lg font-bold text-gray-900">{emailVerifierBalance.remaining_instant_credits}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Last updated: {emailVerifierBalance.last_updated}</p>
              </>
            ) : balanceError ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-xs font-medium text-yellow-800 mb-1">Unable to load balance information</p>
                <p className="text-[11px] text-yellow-700">{balanceError}</p>
                {balanceError.includes('REOON_API_KEY') && (
                  <p className="text-[11px] text-yellow-600 mt-1">
                    Please ensure the REOON_API_KEY environment variable is set on the server.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">Unable to load balance information.</p>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-white">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Lead Auto-reply SMTP</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Configure workspace-owned SMTP credentials for lead acknowledgement emails.
                </p>
              </div>
              {!isWorkspaceManager && (
                <div className="text-xs text-gray-500 border border-gray-200 bg-gray-50 rounded px-3 py-2">
                  Admin only
                </div>
              )}
            </div>

            {(smtpConfigError || smtpConfigSuccess) && (
              <div
                className={`mb-4 border rounded px-3 py-2 text-sm ${
                  smtpConfigError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-green-200 bg-green-50 text-green-700'
                }`}
                role="alert"
                aria-live="polite"
                aria-atomic="true"
              >
                {smtpConfigError || smtpConfigSuccess}
              </div>
            )}

            {smtpConfigLoading ? (
              <div className="py-6 text-center text-sm text-gray-500">
                <span className="mr-2 h-3 w-3 border-b-2 border-gray-500 rounded-full animate-spin inline-block" />
                Loading SMTP configuration...
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(smtpDraft.enabled)}
                    onChange={(e) =>
                      setSmtpDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    disabled={!isWorkspaceManager || smtpConfigSaving}
                    className="h-4 w-4 rounded border-2 border-gray-400 focus:outline-none focus:ring-0"
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Enable lead auto-reply SMTP</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Disabled means leads are still created normally, but no auto-email is queued.
                    </div>
                  </div>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Provider preset</label>
                    <select
                      value={smtpProviderPreset}
                      onChange={(e) =>
                        handleSmtpProviderPresetChange(e.target.value as SmtpProviderPreset)
                      }
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    >
                      <option value="google">Google Workspace / Gmail</option>
                      <option value="office365">Microsoft 365 / Outlook</option>
                      <option value="custom">Custom SMTP</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Host</label>
                    <input
                      type="text"
                      value={smtpDraft.host || ''}
                      onChange={(e) => {
                        const host = e.target.value;
                        setSmtpDraft((prev) => ({ ...prev, host }));
                        setSmtpProviderPreset(detectSmtpPreset({ ...smtpDraft, host }));
                      }}
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      placeholder="smtp.example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Port</label>
                    <input
                      type="number"
                      value={smtpDraft.port ?? 587}
                      onChange={(e) => {
                        const port = Number(e.target.value) || 587;
                        setSmtpDraft((prev) => ({ ...prev, port }));
                        setSmtpProviderPreset(detectSmtpPreset({ ...smtpDraft, port }));
                      }}
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Secure (TLS)</label>
                    <select
                      value={smtpDraft.secure ? 'true' : 'false'}
                      onChange={(e) => {
                        const secure = e.target.value === 'true';
                        setSmtpDraft((prev) => ({ ...prev, secure }));
                        setSmtpProviderPreset(detectSmtpPreset({ ...smtpDraft, secure }));
                      }}
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
                    <input
                      type="text"
                      value={smtpDraft.username || ''}
                      onChange={(e) =>
                        setSmtpDraft((prev) => ({ ...prev, username: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      placeholder="sales@client.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showSmtpPassword ? 'text' : 'password'}
                        value={smtpDraft.password || ''}
                        onChange={(e) =>
                          setSmtpDraft((prev) => ({ ...prev, password: e.target.value }))
                        }
                        disabled={!isWorkspaceManager || smtpConfigSaving}
                        placeholder={smtpConfig?.password_set ? 'Saved password (leave empty to keep)' : 'Enter SMTP password'}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPassword((prev) => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 focus:outline-none"
                        aria-label={showSmtpPassword ? 'Hide SMTP password' : 'Show SMTP password'}
                        disabled={!isWorkspaceManager}
                      >
                        {showSmtpPassword ? (
                          <EyeSlashIcon className="h-5 w-5" />
                        ) : (
                          <EyeIcon className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    {smtpConfig?.password_set && (
                      <p className="mt-1 text-[11px] text-gray-500">A password is already stored securely.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">From name</label>
                    <input
                      type="text"
                      value={smtpDraft.from_name || ''}
                      onChange={(e) =>
                        setSmtpDraft((prev) => ({ ...prev, from_name: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      placeholder="Client Sales Team"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">From email</label>
                    <input
                      type="email"
                      value={smtpDraft.from_email || ''}
                      onChange={(e) =>
                        setSmtpDraft((prev) => ({ ...prev, from_email: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      placeholder="sales@client.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Reply-to (optional)</label>
                    <input
                      type="email"
                      value={smtpDraft.reply_to || ''}
                      onChange={(e) =>
                        setSmtpDraft((prev) => ({ ...prev, reply_to: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || smtpConfigSaving}
                      placeholder="sales@client.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Test recipient email</label>
                    <input
                      type="email"
                      value={smtpTestEmail}
                      onChange={(e) => setSmtpTestEmail(e.target.value)}
                      disabled={!isWorkspaceManager || smtpConfigTesting}
                      placeholder="you@client.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendSmtpTestEmail}
                    disabled={!isWorkspaceManager || smtpConfigTesting || smtpConfigHasChanges}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {smtpConfigTesting ? 'Sending…' : 'Send test'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSmtpConfig}
                    disabled={!isWorkspaceManager || smtpConfigSaving || !smtpConfigHasChanges}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {smtpConfigSaving ? 'Saving…' : 'Save SMTP'}
                  </button>
                </div>

                {smtpConfigHasChanges && (
                  <p className="text-[11px] text-gray-500 text-right">Unsaved SMTP changes (save before test)</p>
                )}
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-white">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Lead Auto-reply Template</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Sent automatically to new leads after creation, if SMTP and template are enabled.
                </p>
              </div>
            </div>

            {(leadAutoReplyError || leadAutoReplySuccess) && (
              <div
                className={`mb-4 border rounded px-3 py-2 text-sm ${
                  leadAutoReplyError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-green-200 bg-green-50 text-green-700'
                }`}
                role="alert"
                aria-live="polite"
                aria-atomic="true"
              >
                {leadAutoReplyError || leadAutoReplySuccess}
              </div>
            )}

            {leadAutoReplyLoading ? (
              <div className="py-6 text-center text-sm text-gray-500">
                <span className="mr-2 h-3 w-3 border-b-2 border-gray-500 rounded-full animate-spin inline-block" />
                Loading template...
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leadAutoReplyDraft.enabled}
                    onChange={(e) =>
                      setLeadAutoReplyDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    disabled={!isWorkspaceManager || leadAutoReplySaving}
                    className="h-4 w-4 rounded border-2 border-gray-400 focus:outline-none focus:ring-0"
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div className="text-sm text-gray-800">Enable lead auto-reply template</div>
                </label>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={leadAutoReplyDraft.subject}
                    onChange={(e) =>
                      setLeadAutoReplyDraft((prev) => ({ ...prev, subject: e.target.value }))
                    }
                    disabled={!isWorkspaceManager || leadAutoReplySaving}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    placeholder="Thanks {{lead.name}} - we got your request"
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">HTML body</label>
                    <textarea
                      value={leadAutoReplyDraft.html}
                      onChange={(e) =>
                        setLeadAutoReplyDraft((prev) => ({ ...prev, html: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadAutoReplySaving}
                      rows={7}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Plain text body</label>
                    <textarea
                      value={leadAutoReplyDraft.text}
                      onChange={(e) =>
                        setLeadAutoReplyDraft((prev) => ({ ...prev, text: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadAutoReplySaving}
                      rows={7}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700">Attachment URLs (HTTPS)</label>
                    <button
                      type="button"
                      onClick={() =>
                        setLeadAutoReplyDraft((prev) => ({
                          ...prev,
                          attachments: [...prev.attachments, { filename: '', url: '' }],
                        }))
                      }
                      disabled={!isWorkspaceManager || leadAutoReplySaving}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                    >
                      + Add attachment
                    </button>
                  </div>
                  <div className="space-y-2">
                    {leadAutoReplyDraft.attachments.length === 0 && (
                      <p className="text-[11px] text-gray-500">No attachments configured.</p>
                    )}
                    {leadAutoReplyDraft.attachments.map((attachment, index) => (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2">
                        <input
                          type="text"
                          value={attachment.filename}
                          onChange={(e) =>
                            setLeadAutoReplyDraft((prev) => {
                              const next = [...prev.attachments];
                              next[index] = { ...next[index], filename: e.target.value };
                              return { ...prev, attachments: next };
                            })
                          }
                          disabled={!isWorkspaceManager || leadAutoReplySaving}
                          placeholder="brochure.pdf"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                        />
                        <input
                          type="url"
                          value={attachment.url}
                          onChange={(e) =>
                            setLeadAutoReplyDraft((prev) => {
                              const next = [...prev.attachments];
                              next[index] = { ...next[index], url: e.target.value };
                              return { ...prev, attachments: next };
                            })
                          }
                          disabled={!isWorkspaceManager || leadAutoReplySaving}
                          placeholder="https://cdn.client.com/brochure.pdf"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLeadAutoReplyDraft((prev) => ({
                              ...prev,
                              attachments: prev.attachments.filter((_, i) => i !== index),
                            }))
                          }
                          disabled={!isWorkspaceManager || leadAutoReplySaving}
                          className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Template variables</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {['{{lead.name}}', '{{lead.email}}', '{{lead.phone}}', '{{lead.source_old}}'].map(
                      (token) => (
                        <code key={token} className="px-2 py-1 bg-white border border-gray-200 rounded">
                          {token}
                        </code>
                      )
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Test recipient email</label>
                    <input
                      type="email"
                      value={leadAutoReplyTestEmail}
                      onChange={(e) => setLeadAutoReplyTestEmail(e.target.value)}
                      disabled={!isWorkspaceManager || leadAutoReplyTesting}
                      placeholder="you@client.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSendLeadAutoReplyTestEmail}
                    disabled={!isWorkspaceManager || leadAutoReplyTesting || leadAutoReplyHasChanges}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {leadAutoReplyTesting ? 'Sending…' : 'Send test'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreLeadAutoReplyDefaults}
                    disabled={!isWorkspaceManager || leadAutoReplySaving}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Restore defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLeadAutoReplyTemplate}
                    disabled={!isWorkspaceManager || leadAutoReplySaving || !leadAutoReplyHasChanges}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {leadAutoReplySaving ? 'Saving…' : 'Save template'}
                  </button>
                </div>

                {leadAutoReplyHasChanges && (
                  <p className="text-[11px] text-gray-500 text-right">Unsaved template changes (save before test)</p>
                )}
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-white">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Lead Notification to Workspace Admin</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Sends every new lead to your configured inbox in real time. Requires SMTP and this template to be enabled.
                </p>
              </div>
            </div>

            {(leadNotificationError || leadNotificationSuccess) && (
              <div
                className={`mb-4 border rounded px-3 py-2 text-sm ${
                  leadNotificationError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-green-200 bg-green-50 text-green-700'
                }`}
                role="alert"
                aria-live="polite"
                aria-atomic="true"
              >
                {leadNotificationError || leadNotificationSuccess}
              </div>
            )}

            {leadNotificationLoading ? (
              <div className="py-6 text-center text-sm text-gray-500">
                <span className="mr-2 h-3 w-3 border-b-2 border-gray-500 rounded-full animate-spin inline-block" />
                Loading lead notification template...
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leadNotificationDraft.enabled}
                    onChange={(e) =>
                      setLeadNotificationDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    disabled={!isWorkspaceManager || leadNotificationSaving}
                    className="h-4 w-4 rounded border-2 border-gray-400 focus:outline-none focus:ring-0"
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <div className="text-sm text-gray-800">Enable lead notification email</div>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Notification recipient email</label>
                    <input
                      type="email"
                      value={leadNotificationDraft.recipient_email}
                      onChange={(e) =>
                        setLeadNotificationDraft((prev) => ({ ...prev, recipient_email: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadNotificationSaving}
                      placeholder="owner@company.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={leadNotificationDraft.subject}
                      onChange={(e) =>
                        setLeadNotificationDraft((prev) => ({ ...prev, subject: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadNotificationSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                      placeholder="New lead received: {{lead.name}}"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Additional recipient emails (optional)
                    </label>
                    <textarea
                      value={leadNotificationDraft.additional_recipients.join(', ')}
                      onChange={(e) => {
                        const nextRecipients = Array.from(
                          new Set(
                            e.target.value
                              .split(/[\n,;]+/)
                              .map((value) => value.trim().toLowerCase())
                              .filter(Boolean)
                          )
                        );
                        setLeadNotificationDraft((prev) => ({
                          ...prev,
                          additional_recipients: nextRecipients,
                        }));
                      }}
                      disabled={!isWorkspaceManager || leadNotificationSaving}
                      rows={2}
                      placeholder="manager@company.com, saleslead@company.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      Lead emails are always sent to the main recipient above; these emails are added as CC.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">HTML body</label>
                    <textarea
                      value={leadNotificationDraft.html}
                      onChange={(e) =>
                        setLeadNotificationDraft((prev) => ({ ...prev, html: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadNotificationSaving}
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Plain text body</label>
                    <textarea
                      value={leadNotificationDraft.text}
                      onChange={(e) =>
                        setLeadNotificationDraft((prev) => ({ ...prev, text: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadNotificationSaving}
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="border border-gray-200 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Template variables</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {[
                      '{{lead.id}}',
                      '{{lead.name}}',
                      '{{lead.email}}',
                      '{{lead.phone}}',
                      '{{lead.source_old}}',
                      '{{lead.source_ref}}',
                      '{{lead.created_at}}',
                      '{{workspace.id}}',
                    ].map((token) => (
                      <code key={token} className="px-2 py-1 bg-white border border-gray-200 rounded">
                        {token}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleRestoreLeadNotificationDefaults}
                    disabled={!isWorkspaceManager || leadNotificationSaving}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Restore defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLeadNotificationTemplate}
                    disabled={!isWorkspaceManager || leadNotificationSaving || !leadNotificationHasChanges}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {leadNotificationSaving ? 'Saving…' : 'Save template'}
                  </button>
                </div>

                {leadNotificationHasChanges && (
                  <p className="text-[11px] text-gray-500 text-right">Unsaved template changes</p>
                )}
              </div>
            )}
          </div>

          {/* Lead Assignment Notification Template */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Lead Assignment Notification</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Sends an email to the assignee when a lead is assigned to them. Requires SMTP to be enabled.
              </p>
            </div>

            {(leadAssignmentError || leadAssignmentSuccess) && (
              <div
                className={`mb-4 border rounded px-3 py-2 text-sm ${
                  leadAssignmentError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-green-200 bg-green-50 text-green-700'
                }`}
                role="alert"
              >
                {leadAssignmentError || leadAssignmentSuccess}
              </div>
            )}

            {leadAssignmentLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Loading assignment notification template...
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leadAssignmentDraft.enabled}
                    onChange={(e) =>
                      setLeadAssignmentDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    disabled={!isWorkspaceManager || leadAssignmentSaving}
                    className="mt-0.5 accent-gray-900"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Enable assignment notification</div>
                    <div className="text-[11px] text-gray-500">When enabled, assignees receive an email each time a lead is assigned to them.</div>
                  </div>
                </label>

                <div className="grid gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={leadAssignmentDraft.subject}
                      onChange={(e) =>
                        setLeadAssignmentDraft((prev) => ({ ...prev, subject: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadAssignmentSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">HTML body</label>
                    <textarea
                      value={leadAssignmentDraft.html}
                      onChange={(e) =>
                        setLeadAssignmentDraft((prev) => ({ ...prev, html: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadAssignmentSaving}
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Plain text body</label>
                    <textarea
                      value={leadAssignmentDraft.text}
                      onChange={(e) =>
                        setLeadAssignmentDraft((prev) => ({ ...prev, text: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || leadAssignmentSaving}
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="border border-gray-200 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Template variables</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {[
                      '{{lead.id}}',
                      '{{lead.name}}',
                      '{{lead.email}}',
                      '{{lead.phone}}',
                      '{{assignee.name}}',
                      '{{assignee.email}}',
                      '{{assigner.name}}',
                      '{{workspace.id}}',
                    ].map((token) => (
                      <code key={token} className="px-2 py-1 bg-white border border-gray-200 rounded">
                        {token}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleRestoreLeadAssignmentDefaults}
                    disabled={!isWorkspaceManager || leadAssignmentSaving}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Restore defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLeadAssignmentTemplate}
                    disabled={!isWorkspaceManager || leadAssignmentSaving || !leadAssignmentHasChanges}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {leadAssignmentSaving ? 'Saving…' : 'Save template'}
                  </button>
                </div>

                {leadAssignmentHasChanges && (
                  <p className="text-[11px] text-gray-500 text-right">Unsaved template changes</p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Email Templates</h2>
              <p className="text-sm text-gray-500">
                Customize the email sent when you invite a member to{' '}
                <span className="font-medium">{currentWorkspace.name}</span>.
              </p>
            </div>
            {!isWorkspaceManager && (
              <div className="text-xs text-gray-500 border border-gray-200 bg-gray-50 rounded px-3 py-2">
                You have view-only access.
              </div>
            )}
          </div>

          {(emailTemplateError || emailTemplateSuccess) && (
            <div
              className={`mb-4 border rounded px-3 py-2 text-sm ${
                emailTemplateError
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-green-200 bg-green-50 text-green-700'
              }`}
              role="alert"
              aria-live="polite"
              aria-atomic="true"
            >
              {emailTemplateError || emailTemplateSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Editor */}
            <div className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Workspace invite email</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Sent when an admin invites a user via Workspace Members.
                  </p>
                </div>
                {emailTemplateLoading && (
                  <div className="flex items-center text-xs text-gray-500">
                    <span className="mr-2 h-3 w-3 border-b-2 border-gray-500 rounded-full animate-spin" />
                    Loading…
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={inviteTemplateDraft.subject}
                    onChange={(e) =>
                      setInviteTemplateDraft((prev) => ({ ...prev, subject: e.target.value }))
                    }
                    disabled={!isWorkspaceManager || emailTemplateSaving}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    placeholder="You’ve been invited to {{workspaceName}}"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Intro text</label>
                  <textarea
                    value={inviteTemplateDraft.intro}
                    onChange={(e) =>
                      setInviteTemplateDraft((prev) => ({ ...prev, intro: e.target.value }))
                    }
                    disabled={!isWorkspaceManager || emailTemplateSaving}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    The “Accept invite” button and link are added automatically below.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Button label
                    </label>
                    <input
                      type="text"
                      value={inviteTemplateDraft.buttonText}
                      onChange={(e) =>
                        setInviteTemplateDraft((prev) => ({ ...prev, buttonText: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || emailTemplateSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      “What’s” title
                    </label>
                    <input
                      type="text"
                      value={inviteTemplateDraft.whatsTitle}
                      onChange={(e) =>
                        setInviteTemplateDraft((prev) => ({ ...prev, whatsTitle: e.target.value }))
                      }
                      disabled={!isWorkspaceManager || emailTemplateSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    “What’s” description
                  </label>
                  <textarea
                    value={inviteTemplateDraft.whatsBody}
                    onChange={(e) =>
                      setInviteTemplateDraft((prev) => ({ ...prev, whatsBody: e.target.value }))
                    }
                    disabled={!isWorkspaceManager || emailTemplateSaving}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-60"
                  />
                </div>

                <div className="border border-gray-200 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Variables</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {[
                      '{{inviterName}}',
                      '{{workspaceName}}',
                      '{{appName}}',
                      '{{learnMoreLink}}',
                    ].map((v) => (
                      <code
                        key={v}
                        className="px-2 py-1 bg-white border border-gray-200 rounded"
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Tip: Use <code className="font-mono">{"{{learnMoreLink}}"}</code> in the “What’s”
                    description to insert a clickable “here” link.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleRestoreInviteTemplateDefaults}
                    disabled={!isWorkspaceManager || emailTemplateSaving}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Restore defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveInviteTemplate}
                    disabled={!isWorkspaceManager || emailTemplateSaving || !inviteTemplateHasChanges}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                  >
                    {emailTemplateSaving ? (
                      <>
                        <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save template'
                    )}
                  </button>
                </div>
                {inviteTemplateHasChanges && (
                  <p className="text-[11px] text-gray-500 text-right">Unsaved changes</p>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="border border-gray-200 rounded-lg p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Preview</h3>
              {(() => {
                const inviter = user?.name || user?.email || 'Someone';
                const workspaceName = currentWorkspace.name;
                const appName = 'Break the ice';
                const learnMoreUrl = `${window.location.origin}/`;
                const acceptUrl = `${window.location.origin}/accept-invite/example-token`;
                const vars = {
                  inviterName: inviter,
                  workspaceName,
                  appName,
                  learnMoreUrl,
                  acceptUrl,
                  learnMoreLink: 'here',
                };

                const subject = interpolate(inviteTemplateDraft.subject, vars);
                const intro = interpolate(inviteTemplateDraft.intro, vars);
                const buttonText = interpolate(inviteTemplateDraft.buttonText, vars);
                const whatsTitle = interpolate(inviteTemplateDraft.whatsTitle, vars);
                const whatsBody = interpolate(inviteTemplateDraft.whatsBody, vars);

                return (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-[11px] text-gray-500 mb-1">Subject</div>
                    <div className="text-sm font-medium text-gray-900">{subject}</div>

                    <div className="mt-4 space-y-3 text-sm text-gray-700">
                      <p>{intro}</p>
                      <div>
                        <span className="inline-flex items-center justify-center px-3 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold">
                          {buttonText || 'Accept invite'}
                        </span>
                      </div>
                      <hr className="border-gray-200" />
                      <div className="text-xs font-semibold text-gray-900">{whatsTitle}</div>
                      <p className="text-sm text-gray-700">
                        {whatsBody}{' '}
                        <span className="text-gray-900 font-semibold underline">
                          {learnMoreUrl}
                        </span>
                      </p>
                      <p className="text-[11px] text-gray-500">
                        If the button doesn’t work, copy and paste this link: {acceptUrl}
                      </p>
                    </div>
                  </div>
                );
              })()}
              <p className="mt-2 text-[11px] text-gray-500">
                Preview uses sample values for variables. Actual emails use your configured
                <code className="mx-1 font-mono">APP_URL</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Facebook Integration Tab */}
      {activeTab === 'facebook' && (
        <div className="bg-white px-6 text-sm text-gray-700">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Facebook Lead Ads Integration</h2>
            <p className="text-gray-600 mb-4">
              Connect your Facebook account to automatically capture leads from Facebook Lead Ads campaigns.
              Set up field mapping and enable real-time synchronization.
            </p>
          </div>

          {!isWorkspaceManager ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
              <p className="font-medium mb-1">Permission Required</p>
              <p className="text-sm">Only workspace admins can manage Facebook integrations.</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg p-8 bg-gradient-to-br from-blue-50 to-blue-100">
              <div className="max-w-2xl">
                <div className="flex items-start gap-4 mb-6">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Get Started with Facebook Lead Ads</h3>
                    <p className="text-gray-700 mb-4">
                      Connect your Facebook account and configure field mapping to automatically sync leads 
                      from your Facebook Lead Ads campaigns directly into your CRM.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                      <div className="bg-white rounded-lg p-3 border border-blue-200">
                        <div className="text-xs font-medium text-gray-500 mb-1">Step 1</div>
                        <div className="text-sm font-semibold text-gray-900">Connect Account</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-blue-200">
                        <div className="text-xs font-medium text-gray-500 mb-1">Step 2</div>
                        <div className="text-sm font-semibold text-gray-900">Map Fields</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-blue-200">
                        <div className="text-xs font-medium text-gray-500 mb-1">Step 3</div>
                        <div className="text-sm font-semibold text-gray-900">Sync Leads</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-6">
                      <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-blue-200 text-blue-900">
                        Real-time Sync
                      </span>
                      <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-blue-200 text-blue-900">
                        Field Mapping
                      </span>
                      <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-blue-200 text-blue-900">
                        Historical Import
                      </span>
                      <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-blue-200 text-blue-900">
                        Automatic Webhooks
                      </span>
                    </div>
                    {currentWorkspace && (
                      checkingFacebookConnection ? (
                        <button
                          disabled
                          className="px-6 py-3 bg-gray-400 text-white rounded-lg font-medium flex items-center gap-2 shadow-sm cursor-not-allowed"
                        >
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          <span>Checking...</span>
                        </button>
                      ) : facebookConnected ? (
                        <button
                          onClick={() => navigate(`/workspace/${currentWorkspace.id}/integrations/facebook`)}
                          className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Manage Integration</span>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/workspace/${currentWorkspace.id}/integrations/facebook`)}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
                        >
                          <span>Configure Facebook Integration</span>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Status Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {editingStatus ? 'Edit status' : 'Add custom status'}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <span className="sr-only">Close</span>
                ×
              </button>
            </div>
            <form onSubmit={handleSaveStatus} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Status name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="e.g. Proposal Sent"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Slug
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={e => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="proposal_sent"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Used internally; auto-generated from name if left blank.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Color
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_COLORS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      title={option.label}
                      onClick={() =>
                        setFormData(prev => ({
                          ...prev,
                          color: option.value,
                        }))
                      }
                      className={`relative flex items-center justify-center w-7 h-7 rounded-full transition-all ${
                        formData.color === option.value
                          ? 'ring-2 ring-offset-2 ring-gray-900 scale-110'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: option.value }}
                    >
                      {formData.color === option.value && (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="4,10 8,14 16,6" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={formData.type}
                  onChange={e =>
                    setFormData(prev => ({
                      ...prev,
                      type: e.target.value as 'open' | 'closed_won' | 'closed_lost',
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                >
                  <option value="open">Open</option>
                  <option value="closed_won">Closed won</option>
                  <option value="closed_lost">Closed lost</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.is_active === 1}
                    onChange={e =>
                      setFormData(prev => ({
                        ...prev,
                        is_active: e.target.checked ? 1 : 0,
                      }))
                    }
                    className="h-3.5 w-3.5 text-black border-gray-400 focus:ring-black"
                  />
                  <span>Show in status lists</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.is_qualified === 1}
                    onChange={e =>
                      setFormData(prev => ({
                        ...prev,
                        is_qualified: e.target.checked ? 1 : 0,
                      }))
                    }
                    className="h-3.5 w-3.5 text-black border-gray-400 focus:ring-black"
                  />
                  <span>Is qualified</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  Save status
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Workspace Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Workspace</h3>
                  <p className="text-sm text-gray-500">
                    Are you sure you want to delete <span className="font-medium">{currentWorkspace.name}</span>?
                  </p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-red-700">
                  <strong>Warning:</strong> This action cannot be undone. All workspace data including leads, statuses, and settings will be permanently deleted.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deletingWorkspace}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteWorkspace}
                  disabled={deletingWorkspace}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {deletingWorkspace ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4}></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    'Delete Workspace'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
