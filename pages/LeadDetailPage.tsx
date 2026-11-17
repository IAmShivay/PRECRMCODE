import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import DealCustomFieldsForm from '../components/DealCustomFieldsForm';
import { activeDealFieldValues, dealFieldErrors } from '../lib/dealFields';
import { readDealConfiguration, saveDeal, type DealConfiguration } from '../lib/api-client';
import type { DealFieldValues } from '../components/types';
import LeadsSidebarList from '../components/LeadsSidebarList';
import {
  ArrowLeftIcon,
  PhoneIcon,
  EnvelopeIcon,
  ChevronDownIcon,
  CheckIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  GlobeAltIcon,
  UserCircleIcon,
  HashtagIcon,
  TrashIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  CurrencyDollarIcon,
  PencilSquareIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { ActivityTimeline } from '../components/ActivityLogger';
import CustomFieldsManager from '../components/CustomFieldsManager';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Lead, LeadStatus, LeadActivity, LeadCustomField, LeadCustomFieldValue, User } from '../components/types';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaceAccess } from '../lib/useWorkspaceAccess';
import { useToast } from '../contexts/ToastContext';
import { getAuthToken } from '../lib/storage';
import { getCustomFieldOptions } from '../lib/customFields';
import { formatMySqlDateTimeUtc, validatePhone } from '../lib/validation';
import { verifyEmail, updateLeadCustomFieldValue, createLeadCustomFieldValue, deleteLeadCustomFieldValue } from '../lib/api-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export default function LeadDetailPageWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <LeadDetailPage />
    </ErrorBoundary>
  );
}

function LeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  // Safe destructure with default in case context is missing
  const { collapsed } = useOutletContext<{ collapsed: boolean }>() || { collapsed: false };
  const [activeTab, setActiveTab] = useState<'lead-details' | 'send-e-mail' | 'activity'>('lead-details');
  const [noteContent, setNoteContent] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  const [lead, setLead] = useState<Lead | null>(null);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [customFields, setCustomFields] = useState<LeadCustomField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<LeadCustomFieldValue[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ id: number; user_id: number; user: User }>>([]);
  const [assigneeId, setAssigneeId] = useState<number | 'unassigned'>('unassigned');
  const [sourceNameById, setSourceNameById] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [phoneEditValue, setPhoneEditValue] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);

  // Inline edit state for individual custom field values
  const [editingFieldId, setEditingFieldId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [savingFieldId, setSavingFieldId] = useState<number | null>(null);

  // Email verification states
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailVerificationStatus, setEmailVerificationStatus] = useState<string | null>(null);

  // Deal creation state
  const [isCreatingDeal, setIsCreatingDeal] = useState(false);
  const [dealConfiguration, setDealConfiguration] = useState<DealConfiguration | null>(null);
  const [dealFieldValues, setDealFieldValues] = useState<DealFieldValues>({});
  useEffect(() => { setDealConfiguration(null); setDealFieldValues({}); }, [leadId]);

  // Custom dropdown states
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  const { user, getUserRole } = useAuth();
  const { addToast } = useToast();
  const { access: workspaceAccess } = useWorkspaceAccess(lead?.workspace_id);
  const canReply = workspaceAccess?.permissions.conversations === 'reply';
  const canEditDeals = workspaceAccess?.permissions.deals === 'edit';

  // Helper function to format dates
  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isValidFlag = (value: unknown): boolean => Number(value) === 1;
  const pendingEmailStatuses = new Set(['', 'pending', 'not verified', 'not_verified', 'unknown']);
  const validEmailStatuses = new Set(['valid', 'safe', 'deliverable']);
  const invalidEmailStatuses = new Set(['invalid', 'disposable', 'spamtrap', 'risky', 'undeliverable', 'unknown_accept_all']);

  const getEmailValidationState = (currentLead: Lead): 'valid' | 'invalid' | 'pending' => {
    if (isValidFlag(currentLead.email_valid)) return 'valid';

    const verificationStatus = String(currentLead.email_verification_status || '').trim().toLowerCase();
    if (validEmailStatuses.has(verificationStatus)) return 'valid';
    if (invalidEmailStatuses.has(verificationStatus)) return 'invalid';
    if (pendingEmailStatuses.has(verificationStatus)) return 'pending';

    return 'pending';
  };

  const getEmailStatusDescription = (status: string): { text: string; isError: boolean } => {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'safe' || s === 'valid' || s === 'deliverable') {
      return { text: 'Email is deliverable and safe.', isError: false };
    }
    if (s === 'disposable') {
      return { text: 'Disposable / temporary email address.', isError: true };
    }
    if (s === 'spamtrap') {
      return { text: 'Spam trap / high bounce risk.', isError: true };
    }
    if (s === 'unknown_accept_all') {
      return { text: 'Accepts all emails (deliverability uncertain).', isError: false };
    }
    if (s === 'risky') {
      return { text: 'Risky / catch-all server.', isError: true };
    }
    if (s === 'invalid' || s === 'undeliverable') {
      return { text: 'Invalid / undeliverable email address.', isError: true };
    }
    return { text: `Verification status: ${s}`, isError: true };
  };

  const toTitleCase = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const getSourceLabel = (currentLead: Lead) => {
    const rawSource = (currentLead.source_old || '').trim();

    if (rawSource && sourceNameById[rawSource]) {
      return sourceNameById[rawSource];
    }

    if (currentLead.source_ref && sourceNameById[currentLead.source_ref]) {
      return sourceNameById[currentLead.source_ref];
    }

    if (!rawSource) {
      return 'Unknown';
    }

    if (rawSource.startsWith('src_')) {
      return 'Unregistered Source';
    }

    return toTitleCase(rawSource);
  };

  const isWorkspaceAdmin = lead?.workspace_id ? getUserRole(lead.workspace_id) === 'admin' : false;

  useEffect(() => {
    const fetchLeadData = async () => {
      if (!leadId) return;
      setLoading(true);
      try {
        const token = getAuthToken();
        const headers: any = token ? { Authorization: `Bearer ${token}` } : {};

        const leadRes = await fetch(`${API_BASE_URL}/api/leads/${leadId}`, { headers });
        const leadResponse = await leadRes.json();

        if (leadRes.ok && leadResponse.status === 'success' && leadResponse.data) {
          const loadedLead: Lead = leadResponse.data;
          setLead(loadedLead);
          setEmailVerificationStatus(loadedLead.email_verification_status || null);
          const parsedAssigneeId = loadedLead.user_id === null || loadedLead.user_id === undefined
            ? null
            : Number(loadedLead.user_id);
          if (parsedAssigneeId && Number.isFinite(parsedAssigneeId) && parsedAssigneeId > 0) {
            setAssigneeId(parsedAssigneeId);
          } else {
            setAssigneeId('unassigned');
          }

          const [statusesRes, activitiesRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/lead-statuses?workspace_id=${loadedLead.workspace_id}`, { headers }),
            fetch(`${API_BASE_URL}/api/leads/${leadId}/activities`, { headers }),
          ]);

          const [statusesResponse, activitiesResponse] = await Promise.all([
            statusesRes.json(),
            activitiesRes.json(),
          ]);

          if (statusesResponse.status === 'success') {
            setStatuses((statusesResponse.data as LeadStatus[])
              .filter(s => s.is_active === 1)
              .sort((a, b) => a.order_index - b.order_index));
          }
          if (activitiesResponse.status === 'success') {
            setActivities(activitiesResponse.data);
          }
        } else {
          console.error('Failed to load lead details');
        }
      } catch (err) {
        console.error('Failed to load lead details:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLeadData();
  }, [leadId]);

  useEffect(() => {
    let isActive = true;

    const fetchSources = async () => {
      if (!lead?.workspace_id) {
        if (isActive) setSourceNameById({});
        return;
      }

      try {
        const token = getAuthToken();
        const headers: any = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_BASE_URL}/api/sources/${lead.workspace_id}`, { headers });
        const data = await res.json();

        if (!isActive) return;

        if (res.ok && data.status === 'success' && Array.isArray(data.data)) {
          const map: Record<string, string> = {};
          data.data.forEach((log: any) => {
            if (log?.event_id) {
              map[log.event_id] = log.source || log.event_id;
            }
          });
          setSourceNameById(map);
        } else {
          setSourceNameById({});
        }
      } catch (err) {
        console.error('Error fetching sources:', err);
        if (isActive) {
          setSourceNameById({});
        }
      }
    };

    fetchSources();

    return () => {
      isActive = false;
    };
  }, [lead?.workspace_id]);

  const fetchCustomFields = React.useCallback(async () => {
    if (!lead) return;
    try {
      const token = getAuthToken();
      const headers: any = token ? { Authorization: `Bearer ${token}` } : {};
      const [fieldsRes, valuesRes, membersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/workspaces/${lead.workspace_id}/custom-fields`, { headers }),
        fetch(`${API_BASE_URL}/api/leads/${lead.id}/custom-field-values`, { headers }),
        fetch(`${API_BASE_URL}/api/workspaces/${lead.workspace_id}/members`, { headers }),
      ]);
      const [fR, vR, mR] = await Promise.all([fieldsRes.json(), valuesRes.json(), membersRes.json()]);
      if (fieldsRes.ok) setCustomFields(fR.data.filter((f: any) => f.is_active === 1));
      if (valuesRes.ok) {
        if (vR.status === 'success' && Array.isArray(vR.data)) {
          setCustomFieldValues(vR.data);
          if (import.meta.env.DEV) {
            console.log('[LeadDetailPage] Loaded custom field values:', vR.data);
          }
        } else if (Array.isArray(vR)) {
          // Handle case where API returns array directly
          setCustomFieldValues(vR);
          if (import.meta.env.DEV) {
            console.log('[LeadDetailPage] Loaded custom field values (direct array):', vR);
          }
        } else {
          console.warn('[LeadDetailPage] Unexpected custom field values response format:', vR);
          setCustomFieldValues([]);
        }
      } else {
        console.error('[LeadDetailPage] Failed to fetch custom field values:', vR);
        setCustomFieldValues([]);
      }
      if (membersRes.ok && mR.status === 'success' && mR.data) {
        const membersWithUsers = mR.data
          .map((member: any) => ({
            ...member,
            user: (member.user_name || member.user_email)
              ? { id: member.user_id, name: member.user_name || '', email: member.user_email || '' } as User
              : undefined,
          }))
          .filter((m: any) => m.user);
        setWorkspaceMembers(membersWithUsers);
      }
    } catch (err) { console.error(err); }
  }, [lead]);

  useEffect(() => { fetchCustomFields(); }, [fetchCustomFields]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStatusSelect = useCallback(async (newStatusId: number) => {
    if (!lead) return;
    setStatusDropdownOpen(false);
    setLead({ ...lead, status_id: newStatusId });
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          status_id: newStatusId,
          updated_by_user_id: user?.id || 1
        }),
      });
      if (res.ok) {
        await refreshActivities();
      }
    } catch (err) {
      console.error('Error updating lead status:', err);
    }
  }, [lead, user]);

  const handleAssigneeSelect = useCallback(async (newAssigneeId: number | 'unassigned') => {
    if (!lead) return;
    setAssigneeDropdownOpen(false);
    const oldAssigneeId = assigneeId;
    setAssigneeId(newAssigneeId);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          assignee_id: newAssigneeId === 'unassigned' ? null : newAssigneeId,
          updated_by_user_id: user?.id || 1
        }),
      });
      const responseData = await res.json().catch(() => null);

      if (!res.ok || responseData?.status !== 'success') {
        throw new Error(responseData?.message || responseData?.error || 'Failed to update lead assignment');
      }

      await refreshActivities();
      setLead(prev => prev ? { ...prev, user_id: newAssigneeId === 'unassigned' ? null : newAssigneeId } : prev);
      window.dispatchEvent(new CustomEvent('notificationsChanged'));
    } catch (err) {
      console.error('Error updating lead assignment:', err);
      setAssigneeId(oldAssigneeId);
    }
  }, [lead, assigneeId, user]);

  const handleAddNote = async () => {
    if (!lead || !noteContent.trim() || noteSubmitting) return;
    
    setNoteSubmitting(true);
    const noteToSubmit = noteContent.trim();
    setNoteContent(''); // Clear immediately to prevent duplicate submissions
    
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          lead_id: lead.id,
          workspace_id: lead.workspace_id,
          user_id: user?.id || 1,
          type: 'note',
          title: 'Note added',
          description: noteToSubmit,
          created_at: new Date().toISOString()
        }),
      });
      const response = await res.json();
      if (res.ok && response.status === 'success') {
        await refreshActivities();
      } else {
        // Restore note content if submission failed
        setNoteContent(noteToSubmit);
      }
    } catch (err) {
      console.error('Error adding note:', err);
      // Restore note content if submission failed
      setNoteContent(noteToSubmit);
    } finally {
      setNoteSubmitting(false);
    }
  };

  const refreshActivities = async () => {
    if (!lead) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setActivities(data.data);
        }
      }
    } catch (err) {
      console.error('Error refreshing activities:', err);
    }
  };

  // Get current value for a custom field (for display or edit buffer)
  const getCurrentValueForField = (field: LeadCustomField): string => {
    const valuesForField = customFieldValues.filter(v => v.field_id === field.id);
    if (valuesForField.length === 0) return '';
    if (field.field_type === 'multiselect') {
      return valuesForField.map(v => v.value).filter(Boolean).join(', ');
    }
    const raw = valuesForField[0]?.value ?? '';
    if (field.field_type === 'checkbox') {
      return raw === '1' || raw === 'true' ? '1' : '0';
    }
    return String(raw);
  };

  const startEditingField = (field: LeadCustomField) => {
    setEditingFieldId(field.id);
    setEditingValue(getCurrentValueForField(field));
  };

  const cancelEditingField = () => {
    setEditingFieldId(null);
    setEditingValue('');
  };

  const saveCustomFieldValue = async (field: LeadCustomField, value: string) => {
    if (!lead) return;
    setSavingFieldId(field.id);
    try {
      const valuesForField = customFieldValues.filter(v => v.field_id === field.id);

      if (field.field_type === 'multiselect') {
        const selectedOptions = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
        for (const v of valuesForField) {
          await deleteLeadCustomFieldValue(v.id);
        }
        for (const option of selectedOptions) {
          await createLeadCustomFieldValue({
            lead_id: lead.id,
            field_id: field.id,
            value: option,
          });
        }
      } else {
        const valueToSave = field.field_type === 'checkbox' ? (value === '1' || value === 'true' ? '1' : '0') : value;
        if (valuesForField.length > 0 && valuesForField[0]?.id) {
          await updateLeadCustomFieldValue(valuesForField[0].id, { value: valueToSave });
        } else {
          await createLeadCustomFieldValue({
            lead_id: lead.id,
            field_id: field.id,
            value: valueToSave,
          });
        }
      }
      await fetchCustomFields();
      setEditingFieldId(null);
      setEditingValue('');
      addToast('success', 'Custom field updated');
    } catch (err: any) {
      console.error('Error saving custom field value:', err);
      addToast('error', err?.message || 'Failed to update custom field');
    } finally {
      setSavingFieldId(null);
    }
  };

  const handleCallAction = async () => {
    if (!canReply) return;
    if (!lead || !lead.phone) { addToast('warning', 'No phone number'); return; }
    const phoneValidation = validatePhone(lead.phone, false);
    const phoneNumber = phoneValidation.normalized?.trim() || '';
    if (!phoneValidation.valid || !phoneNumber) { addToast('warning', phoneValidation.error || 'Invalid phone number'); return; }
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          lead_id: lead.id,
          workspace_id: lead.workspace_id,
          user_id: user?.id || 1,
          type: 'call',
          title: `Called ${lead.name}`,
          description: `Call initiated to ${phoneNumber}`,
          metadata: JSON.stringify({ phone: phoneNumber }),
          created_at: new Date().toISOString()
        }),
      });
      if (!res.ok) throw new Error('Unable to start conversation. Check your access with a workspace admin.');
      await refreshActivities();
      window.location.href = `tel:${phoneNumber}`;
    } catch (err) { addToast('error', err instanceof Error ? err.message : 'Unable to start conversation'); }
  };

  const handleWhatsAppAction = async () => {
    if (!canReply) return;
    if (!lead || !lead.phone) { addToast('warning', 'No phone number'); return; }
    const phoneValidation = validatePhone(lead.phone, false);
    const phoneNumber = (phoneValidation.normalized || '').replace(/\D/g, '');
    if (!phoneValidation.valid || !phoneNumber) { addToast('warning', phoneValidation.error || 'Invalid phone number'); return; }
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          lead_id: lead.id,
          workspace_id: lead.workspace_id,
          user_id: user?.id || 1,
          type: 'whatsapp',
          title: `WhatsApp message sent to ${lead.name}`,
          description: `WhatsApp message initiated to ${lead.phone}`,
          metadata: JSON.stringify({ phone: lead.phone, formatted_phone: phoneNumber }),
          created_at: new Date().toISOString()
        }),
      });
      if (!res.ok) throw new Error('Unable to start conversation. Check your access with a workspace admin.');
      await refreshActivities();
      window.open(`https://wa.me/${phoneNumber}`, '_blank');
    } catch (err) { addToast('error', err instanceof Error ? err.message : 'Unable to start conversation'); }
  };

  const handleEmailAction = async () => {
    if (!canReply) return;
    if (!lead || !lead.email) { addToast('warning', 'No email address'); return; }
    const email = lead.email.trim();
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          lead_id: lead.id,
          workspace_id: lead.workspace_id,
          user_id: user?.id || 1,
          type: 'email',
          title: `Email sent to ${lead.name}`,
          description: `Email initiated to ${email}`,
          metadata: JSON.stringify({ email: email }),
          created_at: new Date().toISOString()
        }),
      });
      if (!res.ok) throw new Error('Unable to start conversation. Check your access with a workspace admin.');
      await refreshActivities();
      window.location.href = `mailto:${email}`;
    } catch (err) { addToast('error', err instanceof Error ? err.message : 'Unable to start conversation'); }
  };

  const handleEmailVerification = async () => {
    if (!lead || !lead.email) return;

    setEmailVerifying(true);
    setEmailVerificationStatus(null);
    try {
      const result = await verifyEmail(lead.email, 'auto');
      const verificationStatus =
        typeof result.status === 'string' && result.status.trim()
          ? result.status.trim().toLowerCase()
          : (result.email_valid ? 'valid' : 'invalid');
      const verifiedAt = formatMySqlDateTimeUtc(new Date());

      // Update the lead with new verification status
      const token = getAuthToken();
      const updateRes = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email_valid: result.email_valid ? 1 : 0,
          email_verification_status: verificationStatus,
          email_verified_at: verifiedAt,
        }),
      });

      if (updateRes.ok) {
        // Update local state
        setLead({
          ...lead,
          email_valid: result.email_valid ? 1 : 0,
          email_verification_status: verificationStatus,
          email_verified_at: verifiedAt,
        });
        setEmailVerificationStatus(verificationStatus);

        if (result.email_valid) {
          addToast(
            'success',
            result.email_verification_mode === 'quick'
              ? 'Email looks deliverable (quick check)'
              : result.status === 'safe'
                ? 'Email looks deliverable (safe check)'
                : 'Email looks deliverable'
          );
        } else {
          const statusMessage =
            result.email_verdict === 'unknown_accept_all'
              ? 'Cannot confirm mailbox (accept-all domain)'
              : result.status === 'disposable'
                ? 'Disposable email'
                : result.status === 'spamtrap'
                  ? 'Spam trap detected'
                  : 'Email is not deliverable';
          addToast('error', `Email verification failed: ${statusMessage}`);
        }
      } else {
        addToast('error', 'Failed to update lead verification status');
      }
    } catch (error) {
      console.error('Email verification failed:', error);
      addToast('error', 'Failed to verify email. Please try again.');
    } finally {
      setEmailVerifying(false);
    }
  };

  const startPhoneEdit = () => {
    if (!lead || !isWorkspaceAdmin) return;
    setPhoneEditValue(lead.phone || '');
    setIsEditingPhone(true);
  };

  const cancelPhoneEdit = () => {
    setIsEditingPhone(false);
    setPhoneEditValue('');
  };

  const savePhoneEdit = async () => {
    if (!lead || !isWorkspaceAdmin || phoneSaving) return;

    const trimmedPhone = phoneEditValue.trim();
    if (!trimmedPhone) {
      addToast('warning', 'Phone number is required');
      return;
    }

    const phoneValidation = validatePhone(trimmedPhone, false);
    if (!phoneValidation.valid) {
      addToast('warning', phoneValidation.error || 'Invalid phone number');
      return;
    }

    setPhoneSaving(true);
    try {
      const token = getAuthToken();
      const updateRes = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          phone: trimmedPhone,
          updated_by_user_id: user?.id || 1,
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok || updateData.status !== 'success') {
        throw new Error(updateData.message || 'Failed to update phone number');
      }

      const leadRes = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const leadData = await leadRes.json();

      if (leadRes.ok && leadData.status === 'success' && leadData.data) {
        setLead(leadData.data);
      } else {
        setLead((prev) => prev ? {
          ...prev,
          phone: phoneValidation.normalized || trimmedPhone,
          phone_valid: 1,
        } : prev);
      }

      setIsEditingPhone(false);
      setPhoneEditValue('');
      addToast('success', 'Phone number updated');
    } catch (err: any) {
      console.error('Error updating phone number:', err);
      addToast('error', err?.message || 'Failed to update phone number');
    } finally {
      setPhoneSaving(false);
    }
  };

  const handleDeleteLead = () => {
    setShowDeleteModal(true);
  };

  const handleCreateDeal = async (confirmFields = false) => {
    if (!lead || isCreatingDeal || !canEditDeals) return;
    setIsCreatingDeal(true);
    try {
      const configuration = confirmFields && dealConfiguration ? dealConfiguration : await readDealConfiguration(lead.workspace_id);
      if (!confirmFields && configuration.fields.some((field) => !field.archived)) {
        setDealFieldValues({});
        setDealConfiguration(configuration);
        return;
      }
      const stage = configuration.stages[0]?.slug;
      if (!stage) throw new Error('No deal stage is configured for this workspace');
      const values = activeDealFieldValues(configuration.fields, confirmFields ? dealFieldValues : {});
      const errors = dealFieldErrors(configuration.fields, values, stage);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join('. '));
      await saveDeal({
        workspace_id: lead.workspace_id, lead_id: lead.id, name: lead.name,
        contact: lead.email || lead.phone || lead.name,
        owner_id: workspaceAccess?.role === 'admin' ? (assigneeId === 'unassigned' ? null : assigneeId) : user?.id,
        value: 0, pipeline_slug: 'default', stage, custom_fields: values,
      });
      setDealConfiguration(null);
      addToast('success', 'Deal created successfully');
      await refreshActivities();
      navigate('/deals');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to create deal');
    } finally {
      setIsCreatingDeal(false);
    }
  };

  const confirmDeleteLead = async () => {
    if (!lead) return;

    setIsDeleting(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${lead.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        // Create activity log for deletion
        try {
          await fetch(`${API_BASE_URL}/api/leads/${lead.id}/activities`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              lead_id: lead.id,
              workspace_id: lead.workspace_id,
              user_id: user?.id || 1,
              type: 'deletion',
              title: `Lead deleted`,
              description: `Lead "${lead.name}" was moved to trash`,
              created_at: new Date().toISOString()
            }),
          });
        } catch (activityErr) {
          console.error('Error creating deletion activity:', activityErr);
        }

        addToast('success', `Lead "${lead.name}" moved to trash`);
        // Notify sidebar to refresh count
        window.dispatchEvent(new CustomEvent('leadsChanged'));
        // Navigate back to leads list
        navigate('/leads');
      } else {
        const errorData = await res.json();
        addToast('error', errorData.message || errorData.error || 'Failed to delete lead');
      }
    } catch (err) {
      console.error('Error deleting lead:', err);
      addToast('error', 'Failed to delete lead. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (loading && !lead) return <div className="flex h-screen items-center justify-center font-sans bg-gray-50">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>;
  if (!lead) return <div className="p-8 text-center font-sans">Lead not found.</div>;

  const currentStatus = statuses.find(s => s.id === lead.status_id);
  const statusColor = currentStatus?.color || '#3B82F6';
  const emailValidationState = getEmailValidationState(lead);

  return (
    <div className="flex flex-col h-screen bg-[#F3F4F6] overflow-hidden font-sans">
      {dealConfiguration && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div role="dialog" aria-modal="true" aria-labelledby="lead-deal-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <h2 id="lead-deal-title" className="text-lg font-semibold text-gray-900">Create deal for {lead.name}</h2>
          <p className="my-3 text-sm text-gray-500">Starting stage: {dealConfiguration.stages[0]?.name}</p>
          <DealCustomFieldsForm fields={dealConfiguration.fields} values={dealFieldValues} stage={dealConfiguration.stages[0]?.slug || ''} stageName={dealConfiguration.stages[0]?.name} onChange={setDealFieldValues} disabled={isCreatingDeal} />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={isCreatingDeal} onClick={() => setDealConfiguration(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700">Cancel</button>
            <button type="button" disabled={isCreatingDeal || Boolean(Object.keys(dealFieldErrors(dealConfiguration.fields, dealFieldValues, dealConfiguration.stages[0]?.slug || '')).length)} onClick={() => void handleCreateDeal(true)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{isCreatingDeal ? 'Creating…' : 'Create deal'}</button>
          </div>
        </div>
      </div>}
      {/* --- HEADER --- */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 shadow-sm z-20">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          {/* Left Side: Back Button, Lead Name, and Metadata */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
            <button
              onClick={() => navigate('/leads')}
              className="p-1 sm:p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
              aria-label="Back to leads"
            >
              <ArrowLeftIcon className="w-5 h-5" />
            </button>

            <div className="flex-1 min-w-0 overflow-hidden">
              <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate leading-tight">{lead.name}</h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:gap-x-3 mt-0.5 text-xs text-gray-500">
                <div className="flex items-center gap-1 min-w-0">
                  <GlobeAltIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="truncate max-w-[100px] sm:max-w-none">{getSourceLabel(lead)}</span>
                </div>
                <span className="hidden sm:inline text-gray-300">|</span>
                <div className="flex items-center gap-1 min-w-0">
                  <CalendarDaysIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="whitespace-nowrap">{formatDate(lead.created_at)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Dropdowns + Actions - all in one aligned row */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap sm:flex-nowrap">
            {/* Status Dropdown (custom) */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                type="button"
                onClick={() => { setStatusDropdownOpen(!statusDropdownOpen); setAssigneeDropdownOpen(false); }}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-md text-xs font-semibold border transition-all hover:shadow-sm"
                style={{
                  backgroundColor: statusColor + '14',
                  color: statusColor,
                  borderColor: statusColor + '33',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
                {currentStatus?.name || 'Status'}
                <ChevronDownIcon className="w-3 h-3 opacity-60" style={{ color: statusColor }} />
              </button>
              {statusDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-40">
                  {statuses.map((s) => {
                    const c = s.color || '#3B82F6';
                    const isSelected = s.id === lead.status_id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleStatusSelect(s.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${isSelected ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                        <span style={{ color: isSelected ? c : '#374151' }}>{s.name}</span>
                        {isSelected && <CheckIcon className="w-3.5 h-3.5 ml-auto" style={{ color: c }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assignee Dropdown (custom) */}
            <div className="relative" ref={assigneeDropdownRef}>
              <button
                type="button"
                onClick={() => { setAssigneeDropdownOpen(!assigneeDropdownOpen); setStatusDropdownOpen(false); }}
                className="inline-flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-md text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <UserCircleIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="max-w-[100px] truncate">
                  {assigneeId === 'unassigned'
                    ? 'Unassigned'
                    : (workspaceMembers.find(m => m.user_id === assigneeId)?.user?.name || `User ${assigneeId}`)}
                </span>
                <ChevronDownIcon className="w-3 h-3 text-gray-400" />
              </button>
              {assigneeDropdownOpen && (
                <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-40">
                  <button
                    type="button"
                    onClick={() => handleAssigneeSelect('unassigned')}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${assigneeId === 'unassigned' ? 'bg-gray-50 font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    <UserCircleIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    Unassigned
                    {assigneeId === 'unassigned' && <CheckIcon className="w-3.5 h-3.5 ml-auto text-blue-600" />}
                  </button>
                  {workspaceMembers.map((member) => {
                    const isSelected = assigneeId === member.user_id;
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        onClick={() => handleAssigneeSelect(member.user_id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${isSelected ? 'bg-gray-50 font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <UserCircleIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        {member.user?.name || `User ${member.user_id}`}
                        {isSelected && <CheckIcon className="w-3.5 h-3.5 ml-auto text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="hidden sm:block w-px h-5 bg-gray-200 mx-0.5" />

            {/* Action Icons */}
            <div className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50/80 p-0.5 flex-shrink-0">
              <button
                onClick={handleCallAction}
                disabled={!canReply}
                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-white rounded transition-colors"
                title="Call"
                aria-label="Call"
              >
                <PhoneIcon className="w-4 h-4" />
              </button>
              <button
                onClick={handleWhatsAppAction}
                disabled={!canReply}
                className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-white rounded transition-colors"
                title="Open WhatsApp"
                aria-label="Open WhatsApp"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
              </button>

              <button
                onClick={handleEmailAction}
                disabled={!canReply}
                className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-white rounded transition-colors"
                title="Email"
                aria-label="Email"
              >
                <EnvelopeIcon className="w-4 h-4" />
              </button>
            </div>

            {/* More Actions */}
            <details className="relative flex-shrink-0">
              <summary
                className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                style={{ listStyle: 'none' }}
                aria-label="More actions"
              >
                <EllipsisVerticalIcon className="w-4 h-4" />
              </summary>
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1 z-30">
                  <button
                    type="button"
                    onClick={(e) => {
                      const details = (e.currentTarget as HTMLElement).closest('details');
                      if (details) (details as HTMLDetailsElement).open = false;
                      handleCreateDeal();
                    }}
                    disabled={isCreatingDeal || !lead || !canEditDeals}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingDeal ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    ) : (
                      <CurrencyDollarIcon className="w-4 h-4" />
                    )}
                    {isCreatingDeal ? 'Creating deal...' : 'Create deal'}
                  </button>

                  <div className="h-px bg-gray-100 my-1" />
                  <button
                    type="button"
                    onClick={(e) => {
                      const details = (e.currentTarget as HTMLElement).closest('details');
                      if (details) (details as HTMLDetailsElement).open = false;
                      handleDeleteLead();
                    }}
                    disabled={isDeleting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrashIcon className="w-4 h-4" />
                    Delete lead
                  </button>
                </div>
            </details>
          </div>
        </div>

        {/* --- TABS --- */}
        <div className="flex items-center gap-3 sm:gap-6 md:gap-8 mt-2.5 sm:mt-3 -mb-2.5 overflow-x-auto scrollbar-hide -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 pb-1">
          {['Lead Details', 'Activity', 'Send E-mail'].map((tab) => {
            const id = tab.toLowerCase().replace(' ', '-');
            const isActive = activeTab === id;
            // Hide Activity tab on Desktop (lg) since it's shown in the sidebar
            const visibilityClass = tab === 'Activity' ? 'lg:hidden' : '';

            return (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`pb-2 sm:pb-2.5 text-xs sm:text-sm font-semibold transition-all border-b-2 whitespace-nowrap flex-shrink-0 ${visibilityClass} ${isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- CONTENT --- */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-[#F3F4F6]">

        {/* Collapsed Sidebar Leads List */}
        {collapsed && (
          <div className="hidden md:block w-[320px] h-full border-r border-gray-200 bg-white z-10 shrink-0">
            <LeadsSidebarList />
          </div>
        )}

        {/* LEFT PANEL: Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent relative">
          {loading && (
            <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] z-30 flex items-center justify-center">
              <div className="bg-white/80 p-3 rounded-lg shadow-sm border border-gray-100 flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-xs text-gray-500 font-medium">Loading details...</span>
              </div>
            </div>
          )}

          {activeTab === 'lead-details' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto pb-20">
              {/* Contact Information */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                    <UserCircleIcon className="w-4 h-4 text-gray-500" />
                    Contact Information
                  </h3>
                </div>
                <div className="p-6 grid grid-cols-1 gap-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">First Name</label>
                      <div className="text-base font-medium text-gray-900">{lead.name.split(' ')[0]}</div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Last Name</label>
                      <div className="text-base font-medium text-gray-900">{lead.name.split(' ')[1] || '-'}</div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Phone</label>
                    {isEditingPhone ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={phoneEditValue}
                          onChange={(e) => setPhoneEditValue(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                          placeholder="Enter phone number"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={savePhoneEdit}
                            disabled={phoneSaving}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {phoneSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelPhoneEdit}
                            disabled={phoneSaving}
                            className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                        <div className="text-base font-medium text-gray-900 flex items-center gap-2 min-w-0">
                          <PhoneIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="truncate">{lead.phone || '-'}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isValidFlag(lead.phone_valid) && <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200 font-bold flex items-center gap-1"><CheckIcon className="w-3 h-3" /> VALID</span>}
                          {isWorkspaceAdmin && (
                            <button
                              type="button"
                              onClick={startPhoneEdit}
                              className="flex-shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              title="Edit phone number"
                              aria-label="Edit phone number"
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Email</label>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <EnvelopeIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-base font-medium text-gray-900 truncate" title={lead.email || ''}>{lead.email || '-'}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {emailValidationState === 'valid' && (
                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200 font-bold flex items-center gap-1">
                            <CheckIcon className="w-3 h-3" /> VALID
                          </span>
                        )}
                        {emailValidationState === 'invalid' && (
                          <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-200 font-bold">
                            INVALID
                          </span>
                        )}
                        <button
                          onClick={handleEmailVerification}
                          disabled={emailVerifying}
                          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded border border-gray-300 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {emailVerifying ? (
                            <>
                              <ArrowPathIcon className="w-3 h-3 animate-spin" />
                              Verifying
                            </>
                          ) : (
                            <>
                              <ArrowPathIcon className="w-3 h-3" />
                              {emailValidationState === 'pending' ? 'Verify' : 'Recheck'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    {emailVerificationStatus && emailValidationState === 'invalid' && (
                      <p className="mt-1 text-xs text-red-600 font-medium">
                        {getEmailStatusDescription(emailVerificationStatus).text}
                      </p>
                    )}
                    {emailVerificationStatus && emailVerificationStatus === 'unknown_accept_all' && (
                      <p className="mt-1 text-xs text-amber-600 font-medium">
                        Accepts all emails (deliverability uncertain).
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* System Information */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                    <HashtagIcon className="w-4 h-4 text-gray-500" />
                    System Details
                  </h3>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Lead ID</label>
                    <div className="text-sm font-mono bg-gray-100 px-2 py-1 rounded inline-block text-gray-700">#{lead.id}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Created At</label>
                    <div className="text-sm text-gray-700">{formatDate(lead.created_at)}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Source</label>
                    <div className="text-sm text-gray-700">{getSourceLabel(lead)}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Status</label>
                    <div className="text-sm text-gray-700">{currentStatus?.name}</div>
                  </div>
                </div>
              </div>

              {/* Custom Fields */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden xl:col-span-2">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                    <DocumentTextIcon className="w-4 h-4 text-gray-500" />
                    Additional Information
                  </h3>
                  <button
                    onClick={() => setShowCustomFieldsModal(true)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                  >
                    + EDIT FIELDS
                  </button>
                </div>
                <div className="p-6">
                  {customFields.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {customFields.map((field) => {
                        const valuesForField = customFieldValues.filter(v => v.field_id === field.id);
                        let displayValue = '-';
                        if (valuesForField.length > 0 && valuesForField[0]?.value !== null && valuesForField[0]?.value !== undefined && valuesForField[0]?.value !== '') {
                          if (field.field_type === 'multiselect') {
                            displayValue = valuesForField.map(v => v.value).filter(Boolean).join(', ');
                          } else if (field.field_type === 'checkbox') {
                            displayValue = (valuesForField[0]?.value === '1' || valuesForField[0]?.value === 'true') ? 'Yes' : 'No';
                          } else {
                            displayValue = valuesForField[0]?.value || '-';
                          }
                        }
                        const isEditing = editingFieldId === field.id;
                        const isSaving = savingFieldId === field.id;
                        const options = getCustomFieldOptions(field.options);

                        return (
                          <div key={field.id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">{field.label}</label>
                            {isEditing ? (
                              <div className="space-y-2">
                                {field.field_type === 'text' && (
                                  <input
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    placeholder={`Enter ${field.label.toLowerCase()}`}
                                    autoFocus
                                  />
                                )}
                                {field.field_type === 'textarea' && (
                                  <textarea
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    placeholder={`Enter ${field.label.toLowerCase()}`}
                                    autoFocus
                                  />
                                )}
                                {field.field_type === 'number' && (
                                  <input
                                    type="number"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    autoFocus
                                  />
                                )}
                                {field.field_type === 'date' && (
                                  <input
                                    type="date"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    autoFocus
                                  />
                                )}
                                {field.field_type === 'select' && (
                                  <select
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                                    autoFocus
                                  >
                                    <option value="">Select {field.label.toLowerCase()}</option>
                                    {options.map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                )}
                                {field.field_type === 'checkbox' && (
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editingValue === '1' || editingValue === 'true'}
                                      onChange={(e) => setEditingValue(e.target.checked ? '1' : '0')}
                                      className="h-4 w-4 text-gray-900 focus:ring-gray-900 border-gray-300 rounded"
                                    />
                                    <span className="text-sm text-gray-700">Yes</span>
                                  </label>
                                )}
                                {field.field_type === 'multiselect' && (
                                  <div className="space-y-1.5">
                                    {options.length > 0 ? options.map(opt => {
                                      const selected = editingValue.split(',').map(s => s.trim()).includes(opt);
                                      return (
                                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => {
                                              const parts = editingValue.split(',').map(s => s.trim()).filter(Boolean);
                                              if (selected) {
                                                setEditingValue(parts.filter(p => p !== opt).join(', '));
                                              } else {
                                                setEditingValue([...parts, opt].join(', '));
                                              }
                                            }}
                                            className="h-4 w-4 text-gray-900 focus:ring-gray-900 border-gray-300 rounded"
                                          />
                                          <span className="text-sm text-gray-700">{opt}</span>
                                        </label>
                                      );
                                    }) : (
                                      <input
                                        type="text"
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        placeholder="Comma-separated values"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        autoFocus
                                      />
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => saveCustomFieldValue(field, editingValue)}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditingField}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm text-gray-900 min-w-0">{displayValue}</div>
                                <button
                                  type="button"
                                  onClick={() => startEditingField(field)}
                                  className="flex-shrink-0 p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                  title="Edit field"
                                  aria-label={`Edit ${field.label}`}
                                >
                                  <PencilSquareIcon className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400 text-sm">No custom fields configured.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'send-e-mail' && (
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[500px]">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <EnvelopeIcon className="w-6 h-6 text-gray-400" />
                Compose Email
              </h2>

              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!canReply) { addToast('warning', 'You cannot send messages with your current conversation access'); return; }
                if (!lead.email) { addToast('warning', 'No email'); return; }
                setEmailSending(true);
                try {
                  const token = getAuthToken();
                  const res = await fetch(`${API_BASE_URL}/api/leads/${leadId}/activities`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({
                      lead_id: lead.id,
                      workspace_id: lead.workspace_id,
                      user_id: user?.id || 1,
                      type: 'email',
                      title: `Email sent to ${lead.name}`,
                      description: emailSubject ? `Subject: ${emailSubject}` : 'Email sent',
                      metadata: JSON.stringify({ email: lead.email, subject: emailSubject, body: emailBody }),
                      created_at: new Date().toISOString()
                    }),
                  });
                  if (res.ok) {
                    await refreshActivities();
                    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
                    setEmailSubject(''); setEmailBody('');
                  }
                } catch (err) { console.error(err); }
                finally { setEmailSending(false); }
              }}>
                <div className="space-y-4">
                  <div className="flex bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <span className="text-gray-500 text-sm font-medium w-16 pt-0.5">To:</span>
                    <span className="text-gray-900 text-sm font-semibold">{lead.email}</span>
                  </div>
                  <div>
                    <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-900 placeholder-gray-400"
                      placeholder="Subject" />
                  </div>
                  <div>
                    <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={12}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900 placeholder-gray-400 resize-none font-mono text-sm leading-relaxed"
                      placeholder="Write your message..." />
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onClick={() => { setEmailSubject(''); setEmailBody('') }} className="px-6 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors">Clear</button>
                    <button type="submit" disabled={emailSending || !lead.email || !canReply} className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2">
                      {emailSending ? 'Sending...' : <><PaperAirplaneIcon className="w-4 h-4" /> Send Email</>}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* Activity Tab Content (Mobile Only) */}
          {activeTab === 'activity' && (
            <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="flex-1 overflow-y-auto min-h-[50vh]">
                <ActivityTimeline
                  leadId={lead.id}
                  workspaceId={lead.workspace_id}
                  activities={activities}
                />
              </div>
              <div className="p-4 bg-gray-50 border-t border-gray-200">
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all overflow-hidden">
                  <textarea
                    className="w-full p-4 bg-transparent text-sm focus:outline-none placeholder-gray-400 resize-none min-h-[80px]"
                    placeholder="Write a note..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                  />
                  <div className="flex justify-between items-center px-2 pb-2 bg-gray-50/50 border-t border-gray-100 py-2">
                    <div className="flex gap-2 text-gray-400 px-2"></div>
                    <button
                      onClick={handleAddNote}
                      disabled={!noteContent.trim() || noteSubmitting}
                      className="px-4 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-800 uppercase tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {noteSubmitting ? 'Adding...' : 'Add Note'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* RIGHT PANEL: Activity Sidebar (Desktop Only) */}
        <div className="hidden lg:flex w-[400px] xl:w-[450px] bg-white border-l border-gray-200 flex-col z-10 shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.02)] h-full">
          <div className="flex-1 overflow-hidden relative">
            <ActivityTimeline
              leadId={lead.id}
              workspaceId={lead.workspace_id}
              activities={activities}
            />
          </div>

          {/* Note Input - Sticky at Bottom */}
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all overflow-hidden">
              <textarea
                className="w-full p-4 bg-transparent text-sm focus:outline-none placeholder-gray-400 resize-none min-h-[80px]"
                placeholder="Write a note..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
              <div className="flex justify-between items-center px-2 pb-2 bg-gray-50/50 border-t border-gray-100 py-2">
                <div className="flex gap-2 text-gray-400 px-2">
                  {/* Toolbar icons could go here */}
                </div>
                <button
                  onClick={handleAddNote}
                  disabled={!noteContent.trim() || noteSubmitting}
                  className="px-4 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-800 uppercase tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {noteSubmitting ? 'Adding...' : 'Add Note'}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Custom Fields Modal */}
      {showCustomFieldsModal && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-800">Manage Custom Fields</h3>
              <button onClick={() => setShowCustomFieldsModal(false)} className="text-gray-400 hover:text-gray-600 bg-white p-1 rounded-full border border-gray-200 hover:border-gray-300 transition-all">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-0 overflow-y-auto flex-1">
              <div className="p-8">
                <CustomFieldsManager workspaceId={lead.workspace_id} onFieldsChange={fetchCustomFields} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Lead Confirmation Modal */}
      {showDeleteModal && lead && (
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
                  <h3 className="text-lg font-semibold text-gray-900">Delete Lead</h3>
                  <p className="text-sm text-gray-500">
                    Are you sure you want to delete <span className="font-medium">{lead.name}</span>?
                  </p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-red-700">
                  <strong>Warning:</strong> This lead will be moved to trash and permanently deleted after 7 days.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteLead}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4}></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    'Delete Lead'
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
