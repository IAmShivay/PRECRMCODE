import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { useToast } from '../contexts/ToastContext';
import {
  CheckCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface FacebookPage {
  id: string;
  name: string;
}

interface FacebookForm {
  id: string;
  name: string;
}

interface FacebookFormField {
  name: string;
  label: string;
  type: string;
}

interface CustomField {
  id: number;
  label: string;
  slug: string;
  field_type: string;
}

interface FacebookFormMapping {
  workspace_id: number;
  user_id: number;
  page_id: string;
  form_id: string;
  mapping_config: {
    coreFields: Record<string, string>;
    customFields: Array<{
      facebookField: string;
      customFieldId: number;
      customFieldSlug?: string;
    }>;
  };
}

type SetupStep = 'connect' | 'select-form' | 'map-fields' | null;

const CORE_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
  { value: 'notes', label: 'Notes' },
];

export default function FacebookLeadAds() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    user,
    currentWorkspace,
    getUserRole,
    loadWorkspaceMembers,
    workspaceMembersLoading,
    isLoading: authLoading,
  } = useAuth();
  const { addToast } = useToast();

  const [step, setStep] = useState<SetupStep>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [forms, setForms] = useState<FacebookForm[]>([]);
  const [formsError, setFormsError] = useState<string>('');
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [configuredForms, setConfiguredForms] = useState<Array<{ formId: string; formName: string }>>([]);
  const [formFields, setFormFields] = useState<FacebookFormField[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [mapping, setMapping] = useState<FacebookFormMapping['mapping_config']>({
    coreFields: {},
    customFields: [],
  });
  const [creatingCustomField, setCreatingCustomField] = useState<string | null>(null);
  const [newCustomField, setNewCustomField] = useState({ label: '', field_type: 'text' });
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');
  const [webhookSubscribed, setWebhookSubscribed] = useState<boolean | null>(null);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [roleCheckWorkspaceId, setRoleCheckWorkspaceId] = useState<number | null>(null);

  const wsId = workspaceId ? Number(workspaceId) : null;
  const roleWorkspaceId = wsId || currentWorkspace?.id || null;
  const workspaceRole = roleWorkspaceId ? getUserRole(roleWorkspaceId) : null;
  const isWorkspaceAdmin = workspaceRole === 'admin';
  const isRoleLoading = Boolean(
    roleWorkspaceId
      && user
      && workspaceRole === null
      && (authLoading || workspaceMembersLoading || roleCheckWorkspaceId !== roleWorkspaceId)
  );

  useEffect(() => {
    if (workspaceId || authLoading || !currentWorkspace?.id) return;
    const currentRole = getUserRole(currentWorkspace.id);
    if (!currentRole) return;
    const query = searchParams.toString();
    navigate(
      currentRole === 'admin'
        ? `/workspace/${currentWorkspace.id}/integrations/facebook${query ? `?${query}` : ''}`
        : '/leads',
      { replace: true }
    );
  }, [authLoading, currentWorkspace?.id, getUserRole, navigate, searchParams, workspaceId]);

  useEffect(() => {
    if (!roleWorkspaceId || !user) return;
    let isActive = true;
    setRoleCheckWorkspaceId(null);
    loadWorkspaceMembers(roleWorkspaceId).finally(() => {
      if (isActive) {
        setRoleCheckWorkspaceId(roleWorkspaceId);
      }
    });
    return () => {
      isActive = false;
    };
  }, [roleWorkspaceId, user, loadWorkspaceMembers]);

  // Check OAuth callback result
  useEffect(() => {
    const status = searchParams.get('status');
    const error = searchParams.get('error');
    if (status === 'connected') {
      setConnected(true);
      setStep('select-form');
      addToast('success', 'Successfully connected to Facebook!');
    } else if (error) {
      if (error === 'access_denied') {
        addToast('error', 'Facebook permissions were declined. You must accept ALL permissions for the integration to work. Please try connecting again and accept all requested permissions.');
      } else {
        addToast('error', `Facebook connection failed: ${error}`);
      }
    }
  }, [searchParams, addToast]);

  // Load pages and check connection status
  useEffect(() => {
    if (!wsId || !user || !isWorkspaceAdmin) return;
    checkConnection();
  }, [wsId, user, isWorkspaceAdmin]);

  // Load forms when page is selected
  useEffect(() => {
    if (selectedPageId && wsId && isWorkspaceAdmin) {
      loadForms();
    }
  }, [selectedPageId, wsId, isWorkspaceAdmin]);

  // Load form fields when form is selected
  useEffect(() => {
    if (selectedFormId && wsId && isWorkspaceAdmin) {
      setMapping({ coreFields: {}, customFields: [] });
      setMappingSaved(false);
      setImportStatus('');
      loadFormFields();
      loadCustomFields();
      loadExistingMapping();
    }
  }, [selectedFormId, wsId, isWorkspaceAdmin]);

  // Load configured forms when page is selected
  useEffect(() => {
    if (selectedPageId && wsId && user && isWorkspaceAdmin) {
      loadConfiguredForms();
    }
  }, [selectedPageId, wsId, user, isWorkspaceAdmin]);

  // Check webhook subscription status when page is selected
  useEffect(() => {
    if (selectedPageId && wsId && connected && isWorkspaceAdmin) {
      checkWebhookStatus();
    }
  }, [selectedPageId, wsId, connected, isWorkspaceAdmin]);

  const checkConnection = async () => {
    if (!wsId || !isWorkspaceAdmin) return;
    setLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/pages`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setPages(data.data);
        setConnected(true);
        if (data.data.length > 0) {
          setStep('select-form');
        } else {
          setStep('connect');
        }
      } else if (data.status === 'error') {
        const msg = String(data.error || '');
        const lowered = msg.toLowerCase();
        const shouldReconnect =
          lowered.includes('expired') ||
          lowered.includes('revoked') ||
          lowered.includes('invalid') ||
          lowered.includes('active access token') ||
          lowered.includes('not found');

        if (shouldReconnect) {
          setConnected(false);
          setPages([]);
          setSelectedPageId('');
          setSelectedFormId('');
          setForms([]);
          setStep('connect');
          if (msg && !lowered.includes('not found')) {
            addToast('error', msg);
          }
        } else {
          setStep('connect');
        }
      } else {
        setStep('connect');
      }
    } catch (error) {
      console.error('Error checking connection:', error);
      setStep('connect');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!wsId || !isWorkspaceAdmin) return;
    setLoading(true);
    try {
      const token = getAuthToken();
      if (!token) {
        addToast('error', 'Please log in to connect Facebook');
        return;
      }

      const returnTo = window.location.origin;

      // Make an authenticated request to get the OAuth URL
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/oauth/start?return_to=${encodeURIComponent(returnTo)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (res.ok && data.status === 'success' && data.data?.authUrl) {
        // Redirect to Facebook OAuth URL
        window.location.href = data.data.authUrl;
      } else {
        addToast('error', data.error || 'Failed to start Facebook connection');
      }
    } catch (error: any) {
      console.error('Error starting Facebook OAuth:', error);
      addToast('error', 'Failed to connect to Facebook. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadForms = async () => {
    if (!wsId || !selectedPageId) return;
    setLoading(true);
    try {
      setFormsError('');
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE_URL}/api/facebook/${wsId}/forms?pageId=${selectedPageId}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setForms(data.data);
      } else {
        const msg = String(data.error || 'Failed to load forms');
        setForms([]);
        setSelectedFormId('');
        setFormsError(msg);
        addToast('error', msg);
      }
    } catch (error) {
      setForms([]);
      setSelectedFormId('');
      setFormsError('Error loading forms');
      addToast('error', 'Error loading forms');
    } finally {
      setLoading(false);
    }
  };

  const loadFormFields = async () => {
    if (!wsId || !selectedFormId) return;
    setLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE_URL}/api/facebook/${wsId}/forms/${selectedFormId}/fields`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setFormFields(data.data);
      } else {
        addToast('error', 'Failed to load form fields');
      }
    } catch (error) {
      addToast('error', 'Error loading form fields');
    } finally {
      setLoading(false);
    }
  };

  const loadCustomFields = async () => {
    if (!wsId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/workspaces/${wsId}/custom-fields`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setCustomFields(data.data.filter((f: CustomField) => f.field_type !== 'deleted'));
      }
    } catch (error) {
      console.error('Error loading custom fields:', error);
    }
  };

  const loadExistingMapping = async () => {
    if (!wsId || !user || !selectedFormId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/mappings/${selectedFormId}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setMapping(data.data.mapping_config);
        setMappingSaved(true);
      } else {
        setMappingSaved(false);
      }
    } catch (error) {
      setMappingSaved(false);
    }
  };

  const loadConfiguredForms = async () => {
    if (!wsId || !user) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/mappings`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        const formsForPage = data.data
          .filter((m: any) => m.page_id === selectedPageId)
          .map((m: any) => ({
            formId: m.form_id,
            formName: m.form_name || forms.find(f => f.id === m.form_id)?.name || m.form_id,
          }));
        setConfiguredForms(formsForPage);
      }
    } catch (error) {
      console.error('Error loading configured forms:', error);
    }
  };

  const handleCoreFieldMapping = (fbField: string, crmField: string) => {
    setMapping((prev) => ({
      ...prev,
      coreFields: {
        ...prev.coreFields,
        [fbField]: crmField || '',
      },
    }));
  };

  const handleCustomFieldMapping = (fbField: string, customFieldId: number | null) => {
    if (!customFieldId) {
      setMapping((prev) => ({
        ...prev,
        customFields: prev.customFields.filter((cf) => cf.facebookField !== fbField),
      }));
      return;
    }

    const customField = customFields.find((f) => f.id === customFieldId);
    setMapping((prev) => {
      const existing = prev.customFields.findIndex((cf) => cf.facebookField === fbField);
      const newMapping = {
        facebookField: fbField,
        customFieldId,
        customFieldSlug: customField?.slug,
      };

      if (existing >= 0) {
        const updated = [...prev.customFields];
        updated[existing] = newMapping;
        return { ...prev, customFields: updated };
      } else {
        return { ...prev, customFields: [...prev.customFields, newMapping] };
      }
    });
  };

  const handleCreateCustomField = async (fbField: string) => {
    if (!wsId || !newCustomField.label) return;
    setLoading(true);
    try {
      const token = getAuthToken();
      const slug = newCustomField.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const res = await fetch(`${API_BASE_URL}/api/workspaces/${wsId}/custom-fields`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          workspace_id: wsId,
          label: newCustomField.label,
          slug,
          field_type: newCustomField.field_type,
          is_required: 0,
          is_active: 1,
          sort_order: customFields.length + 1,
        }),
      });

      const data = await res.json();
      if (data.status === 'success' && data.data) {
        const newField = data.data;
        setCustomFields([...customFields, newField]);
        handleCustomFieldMapping(fbField, newField.id);
        setCreatingCustomField(null);
        setNewCustomField({ label: '', field_type: 'text' });
        addToast('success', 'Custom field created successfully');
      } else {
        const errorMsg = data.message || data.error || 'Failed to create custom field';
        console.error('Custom field creation error:', data);
        addToast('error', errorMsg);
      }
    } catch (error: any) {
      console.error('Error creating custom field:', error);
      addToast('error', error?.message || 'Error creating custom field');
    } finally {
      setLoading(false);
    }
  };

  const checkWebhookStatus = async () => {
    if (!wsId || !selectedPageId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE_URL}/api/facebook/${wsId}/pages/${selectedPageId}/webhook-status`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        setWebhookSubscribed(data.data.subscribed);
      }
    } catch (error) {
      console.error('Error checking webhook status:', error);
    }
  };

  const handleSaveMapping = async () => {
    if (!wsId || !user || !selectedPageId || !selectedFormId) return;
    setLoading(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/mappings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          pageId: selectedPageId,
          formId: selectedFormId,
          formName: forms.find(f => f.id === selectedFormId)?.name || selectedFormId,
          mapping_config: mapping,
        }),
      });

      const data = await res.json();
      if (data.status === 'success') {
        if (data.data?.mapping_config) {
          setMapping(data.data.mapping_config);
        }
        setMappingSaved(true);
        if (data.webhookSubscribed) {
          addToast('success', 'Field mapping saved! Real-time sync is now active.');
          setWebhookSubscribed(true);
        } else {
          setWebhookSubscribed(false);
          addToast(
            'warning',
            `Field mapping saved, but real-time sync is not active: ${data.webhookSubscriptionError || 'Facebook webhook subscription failed.'}`,
            7000
          );
        }
        // Reload configured forms list
        await loadConfiguredForms();
      } else {
        setMappingSaved(false);
        addToast('error', data.message || data.error || 'Failed to save mapping');
      }
    } catch (error: any) {
      addToast('error', error?.message || 'Error saving mapping');
    } finally {
      setLoading(false);
    }
  };

  const pollImportJob = async (jobId: string, attempt = 0): Promise<void> => {
    if (!wsId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/import/jobs/${jobId}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.status !== 'success' || !data.data) {
        setImportStatus(data.message || data.error || 'Unable to check import status');
        return;
      }

      const jobStatus = String(data.data.status || '');
      const stats = data.data.payload?.stats;
      if (jobStatus === 'fb_import_done') {
        const summary = stats
          ? `Import completed. Created ${stats.created || 0}, duplicates ${stats.duplicates || 0}, errors ${stats.errors || 0}.`
          : 'Import completed.';
        setImportStatus(summary);
        addToast('success', summary);
        return;
      }

      if (jobStatus === 'fb_import_failed') {
        const message = data.data.error || 'Import failed';
        setImportStatus(message);
        addToast('error', message);
        return;
      }

      const processed = stats?.processed ? ` Processed ${stats.processed} so far.` : '';
      setImportStatus(`Import running.${processed}`);
      if (attempt < 60) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        return pollImportJob(jobId, attempt + 1);
      }

      setImportStatus('Import is still running. You can check the leads page in a moment.');
    } catch (error: any) {
      setImportStatus(error?.message || 'Unable to check import status');
      addToast('error', error?.message || 'Unable to check import status');
      return;
    }
  };

  const handleImport = async () => {
    if (!wsId || !selectedPageId || !selectedFormId) return;
    setImporting(true);
    setImportStatus('');
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/facebook/${wsId}/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          pageId: selectedPageId,
          formId: selectedFormId,
        }),
      });

      const data = await res.json();
      if (data.status === 'success') {
        addToast('success', data.message || 'Import started! Leads will be processed in the background.');
        setImportStatus('Import queued.');
        if (data.data?.jobId) {
          await pollImportJob(data.data.jobId);
        }
      } else {
        const errorMsg = data.message || data.error || 'Failed to start import';
        console.error('Import error:', data);
        addToast('error', errorMsg);
        setImportStatus(errorMsg);
      }
    } catch (error: any) {
      console.error('Error starting import:', error);
      addToast('error', error?.message || 'Error starting import');
      setImportStatus(error?.message || 'Error starting import');
    } finally {
      setImporting(false);
    }
  };

  if (!wsId) {
    if (authLoading || currentWorkspace?.id) {
      return (
        <div className="max-w-4xl mx-auto p-6">
          <h1 className="text-3xl font-bold mb-6">Facebook Lead Ads Integration</h1>
          <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading...</p>
            </div>
          </div>
        </div>
      );
    }

    return <div className="p-6">Workspace ID is required</div>;
  }

  if (isRoleLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Facebook Lead Ads Integration</h1>
        <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Admin access required</h1>
          <p className="text-sm text-gray-500 mb-6">
            Facebook Lead Ads integration can only be managed by workspace admins.
          </p>
          <button
            onClick={() => navigate('/leads', { replace: true })}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Go to Leads
          </button>
        </div>
      </div>
    );
  }

  if (step === null) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Facebook Lead Ads Integration</h1>
        <div className="bg-white rounded-lg shadow p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Facebook Lead Ads Integration</h1>

      {/* Step 1: Connect */}
      {step === 'connect' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Step 1: Connect Facebook Account</h2>
          {connected ? (
            <div className="flex items-center gap-2 text-green-600 mb-4">
              <CheckCircleIcon className="w-5 h-5" />
              <span>Connected to Facebook</span>
            </div>
          ) : (
            <div className="mb-4">
              <p className="text-gray-600 mb-4">
                Connect your Facebook account to import leads from Facebook Lead Ads.
              </p>
              <button
                onClick={handleConnect}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Sign in with Facebook
              </button>
            </div>
          )}
          {connected && (
            <button
              onClick={() => setStep('select-form')}
              className="mt-4 bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2"
            >
              Continue <ArrowRightIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Step 2: Select Form */}
      {step === 'select-form' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Step 2: Select Page & Form</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Facebook Page</label>
              <select
                value={selectedPageId}
                onChange={(e) => {
                  setSelectedPageId(e.target.value);
                  setSelectedFormId('');
                  setForms([]);
                  setFormsError('');
                }}
                className="w-full border rounded-lg px-3 py-2"
                disabled={loading}
              >
                <option value="">Select a page...</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            </div>

            {connected && !loading && pages.length === 0 && (
              <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-4 space-y-2">
                <div className="font-medium">Connected, but no Pages were returned</div>
                <div className="text-sm">
                  This usually means the connected Facebook account didn't grant the required permissions, or the
                  account doesn't have admin access to any Pages.
                </div>
                <div className="bg-white border border-amber-300 rounded p-3 text-sm space-y-1">
                  <div className="font-medium">Required Permissions:</div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>pages_show_list - View your Pages</li>
                    <li>leads_retrieval - Access Lead Ads data</li>
                    <li>pages_read_engagement - Read Page engagement</li>
                    <li>pages_manage_metadata - Manage Page settings</li>
                    <li>pages_manage_ads - Access Page lead ad forms</li>
                    <li>ads_management - Retrieve lead ad attribution</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleConnect}
                    className="bg-amber-700 text-white px-4 py-2 rounded-lg hover:bg-amber-800"
                  >
                    Reconnect Facebook
                  </button>
                </div>
                <div className="text-xs">
                  <strong>Important:</strong> You must accept ALL permissions when prompted. If you decline any permission,
                  the integration won't work. Make sure you're logged into the Facebook account that has admin access to your Pages.
                </div>
              </div>
            )}

            {selectedPageId && (
              <div>
                <label className="block text-sm font-medium mb-2">Lead Ad Form</label>
                <select
                  value={selectedFormId}
                  onChange={(e) => setSelectedFormId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  disabled={loading || forms.length === 0}
                >
                  <option value="">Select a form to configure...</option>
                  {forms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.name}
                    </option>
                  ))}
                </select>
                {!loading && formsError && (
                  <div className="mt-2 text-sm text-red-600">{formsError}</div>
                )}
                {!loading && !formsError && forms.length === 0 && (
                  <div className="mt-2 text-sm text-gray-600">
                    No Lead Ad forms found for this Page. Create an Instant Form in Ads Manager to continue.
                  </div>
                )}
                {configuredForms.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Configured Forms:</p>
                    <div className="space-y-2">
                      {configuredForms.map((form) => (
                        <div key={form.formId} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5 text-green-600" />
                            <span className="text-sm text-gray-700">{form.formName}</span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedFormId(form.formId);
                              setStep('map-fields');
                            }}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Edit
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedFormId && (
              <div className="mt-4">
                <button
                  onClick={() => setStep('map-fields')}
                  className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2"
                >
                  {configuredForms.some(f => f.formId === selectedFormId) ? 'Edit' : 'Configure'} Field Mapping <ArrowRightIcon className="w-4 h-4" />
                </button>
                <p className="mt-2 text-sm text-gray-600">
                  {configuredForms.length > 0 
                    ? 'You can configure multiple forms. Each form can have its own field mapping.'
                    : 'After mapping fields, new leads will automatically sync to your CRM in real-time'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Map Fields */}
      {step === 'map-fields' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">Step 3: Map Fields</h2>
              <p className="text-sm text-gray-500 mt-1">
                Form: {configuredForms.find(f => f.formId === selectedFormId)?.formName || forms.find(f => f.id === selectedFormId)?.name || selectedFormId}
              </p>
            </div>
            <button
              onClick={() => setStep('select-form')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              ← Back to Form Selection
            </button>
          </div>
          <p className="text-gray-600 mb-6">
            Map Facebook form fields to your CRM fields. You can map to core fields or create new
            custom fields.
          </p>

          <div className="space-y-4 mb-6">
            {formFields.map((field) => (
              <div key={field.name} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium">{field.label}</span>
                    <span className="text-sm text-gray-500 ml-2">({field.name})</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Map to Core Field</label>
                    <select
                      value={mapping.coreFields[field.name] || ''}
                      onChange={(e) => handleCoreFieldMapping(field.name, e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="">None</option>
                      {CORE_FIELDS.map((cf) => (
                        <option key={cf.value} value={cf.value}>
                          {cf.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Or Map to Custom Field</label>
                    <div className="flex gap-2">
                      <select
                        value={
                          creatingCustomField === field.name
                            ? '__create_new__'
                            : mapping.customFields.find((cf) => cf.facebookField === field.name)
                                ?.customFieldId || ''
                        }
                        onChange={(e) => {
                          if (e.target.value === '__create_new__') {
                            setCreatingCustomField(field.name);
                          } else {
                            setCreatingCustomField(null);
                            handleCustomFieldMapping(
                              field.name,
                              e.target.value ? Number(e.target.value) : null
                            );
                          }
                        }}
                        className="flex-1 border rounded px-3 py-2"
                      >
                        <option value="">None</option>
                        <option value="__create_new__">+ Create New Custom Field</option>
                        {customFields.map((cf) => (
                          <option key={cf.id} value={cf.id}>
                            {cf.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {creatingCustomField === field.name && (
                      <div className="mt-2 p-3 bg-gray-50 rounded border">
                        <input
                          type="text"
                          placeholder="Field label"
                          value={newCustomField.label}
                          onChange={(e) =>
                            setNewCustomField({ ...newCustomField, label: e.target.value })
                          }
                          className="w-full border rounded px-3 py-2 mb-2"
                        />
                        <select
                          value={newCustomField.field_type}
                          onChange={(e) =>
                            setNewCustomField({ ...newCustomField, field_type: e.target.value })
                          }
                          className="w-full border rounded px-3 py-2 mb-2"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="select">Select</option>
                          <option value="multiselect">Multiselect</option>
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCreateCustomField(field.name)}
                            className="bg-blue-600 text-white px-4 py-1 rounded text-sm"
                            disabled={loading || !newCustomField.label}
                          >
                            Create
                          </button>
                          <button
                            onClick={() => {
                              setCreatingCustomField(null);
                              setNewCustomField({ label: '', field_type: 'text' });
                            }}
                            className="bg-gray-300 text-gray-700 px-4 py-1 rounded text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Webhook Status Indicator */}
          {selectedPageId && (mappingSaved || webhookSubscribed !== null) && (
            <div className={`mb-4 p-4 rounded-lg ${
              webhookSubscribed === true
                ? 'bg-green-50 border border-green-200'
                : 'bg-yellow-50 border border-yellow-200'
            }`}>
              <div className="flex items-center gap-2">
                {webhookSubscribed === true ? (
                  <>
                    <CheckCircleIcon className="w-5 h-5 text-green-600" />
                    <span className="text-green-800 font-medium">
                      Automatic sync active: Webhooks deliver leads immediately, with recovery checks for missed events
                    </span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-yellow-800">
                      {mappingSaved
                        ? 'Field mapping is saved, but real-time sync is not active. Update the mapping to retry the Facebook webhook subscription.'
                        : 'Real-time sync will be activated automatically when you save the mapping'}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {!mappingSaved && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-900">
                    <strong>Next Step:</strong> Save your field mapping to activate real-time sync for new leads.
                    After saving, you can import existing leads if needed.
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <button
                onClick={handleSaveMapping}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Saving...' : mappingSaved ? 'Update Mapping' : 'Save Mapping & Activate Sync'}
              </button>
              <button
                onClick={handleImport}
                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={importing || loading || !mappingSaved}
                title={!mappingSaved ? 'Save mapping first before importing' : ''}
              >
                {importing ? 'Importing...' : 'Import Existing Leads'}
              </button>
              {importStatus && (
                <div className="basis-full text-sm text-gray-700">
                  {importStatus}
                </div>
              )}
              <button
                onClick={() => {
                  setSelectedFormId('');
                  setStep('select-form');
                }}
                className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300"
              >
                Configure Another Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
