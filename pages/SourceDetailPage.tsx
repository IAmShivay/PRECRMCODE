import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { buildWebhookUrl } from '../lib/webhookUrl';
import { getCustomFieldOptions } from '../lib/customFields';
import {
  ArrowLeftIcon,
  DocumentDuplicateIcon,
  CodeBracketIcon,
  InformationCircleIcon,
  PowerIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { LeadCustomField } from '../components/types';
import WebFormDealMappingForm from '../components/WebFormDealMappingForm';

// Backend API base URL (same as other frontend API calls)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface Source {
  id: string;
  name: string;
  webhookUrl: string;
  createdAt: string;
  logId?: number;
  isActive?: boolean;
  webhookSecret?: string | null;
}

export default function SourceDetailPage() {
  const { workspaceId, sourceId } = useParams<{ workspaceId: string; sourceId: string }>();
  const navigate = useNavigate();
  const {
    user,
    workspaces,
    currentWorkspace,
    getUserRole,
    loadWorkspaceMembers,
    workspaceMembersLoading,
  } = useAuth();

  const [source, setSource] = useState<Source | null>(null);
  const [customFields, setCustomFields] = useState<LeadCustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [roleCheckWorkspaceId, setRoleCheckWorkspaceId] = useState<number | null>(null);

  const workspace = workspaceId
    ? workspaces.find(w => w.id === Number(workspaceId))
    : currentWorkspace;
  const workspaceRole = workspace ? getUserRole(workspace.id) : null;
  const isWorkspaceAdmin = workspaceRole === 'admin';
  const isRoleLoading = Boolean(
    workspace
      && user
      && workspaceRole === null
      && (workspaceMembersLoading || roleCheckWorkspaceId !== workspace.id)
  );

  const generateWebhookUrl = (sourceName?: string) => {
    if (!workspace || !sourceId) return '';
    return buildWebhookUrl(workspace.id, sourceId, sourceName);
  };

  useEffect(() => {
    if (!workspace?.id || !user) return;
    let isActive = true;
    const targetWorkspaceId = workspace.id;
    setRoleCheckWorkspaceId(null);
    loadWorkspaceMembers(targetWorkspaceId).finally(() => {
      if (isActive) {
        setRoleCheckWorkspaceId(targetWorkspaceId);
      }
    });
    return () => {
      isActive = false;
    };
  }, [workspace?.id, user, loadWorkspaceMembers]);

  // Fetch source details from database
  useEffect(() => {
    if (!workspace || !sourceId || !isWorkspaceAdmin) return;

    const fetchSource = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}/${sourceId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const response = await res.json();
        if (response.status === 'success' && response.data) {
          const log = response.data;
          let isActive = true;
          let webhookSecret: string | null = null;
          try {
            const parsedPayload = log.payload ? JSON.parse(log.payload) : {};
            isActive = parsedPayload.config?.isActive !== false;
            webhookSecret = String(parsedPayload.webhookSecret || '').trim() || null;
          } catch (parseError) {
            console.error('Error parsing source payload:', parseError);
          }

          setSource({
            id: log.event_id,
            name: log.source,
            webhookUrl: generateWebhookUrl(log.source),
            createdAt: log.created_at,
            logId: log.id,
            isActive,
            webhookSecret,
          });
        } else {
          console.error('Source not found:', sourceId);
        }
      } catch (error) {
        console.error('Failed to fetch source:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSource();
  }, [workspace, sourceId, isWorkspaceAdmin]);

  // Fetch custom fields for this workspace
  useEffect(() => {
    if (!workspace || !isWorkspaceAdmin) return;

    const fetchCustomFields = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspace.id}/custom-fields`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const response = await res.json();
        if (response.status === 'success' && response.data) {
          const activeFields = response.data.filter((f: LeadCustomField) => f.is_active === 1);
          setCustomFields(activeFields);
        }
      } catch (err) {
        console.error('Error fetching custom fields:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomFields();
  }, [workspace, isWorkspaceAdmin]);

  const generateSamplePayload = () => {
    const payload: Record<string, any> = {
      name: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+1234567890',
      source: 'landing_page',
    };

    // Add custom fields to sample payload
    customFields.forEach(field => {
      if (field.is_active === 1) {
        switch (field.field_type) {
          case 'text':
            payload[field.slug] = `Sample ${field.label}`;
            break;
          case 'number':
            payload[field.slug] = 123;
            break;
          case 'date':
            payload[field.slug] = new Date().toISOString().split('T')[0];
            break;
          case 'select': {
            const opts = getCustomFieldOptions(field.options);
            payload[field.slug] = (opts[0] || 'Option 1').trim();
            break;
          }
          case 'multiselect': {
            const multiOpts = getCustomFieldOptions(field.options);
            payload[field.slug] = (multiOpts.length ? multiOpts : ['Option 1', 'Option 2']).slice(0, 2).map(o => o.trim());
            break;
          }
          case 'checkbox':
            payload[field.slug] = true;
            break;
          case 'textarea':
            payload[field.slug] = `Sample multi-line text for ${field.label}`;
            break;
        }
      }
    });

    return payload;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSecretChange = async (nextSecret: string | null) => {
    if (!source || !workspace || !isWorkspaceAdmin) return;

    setSyncing(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}/${source.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          payload: JSON.stringify({ webhookSecret: nextSecret || '' }),
        }),
      });
      const response = await res.json();

      if (response.status === 'success' || response.message?.toLowerCase().includes('success')) {
        setSource({ ...source, webhookSecret: nextSecret });
        showMessage('success', nextSecret ? 'Secret token enabled' : 'Secret token removed');
      } else {
        showMessage('error', response.message || 'Failed to update the secret token');
      }
    } catch (error: any) {
      console.error('Failed to update the secret token:', error);
      showMessage('error', `Error: ${error.message || 'Failed to update the secret token'}`);
    } finally {
      setSyncing(false);
    }
  };

  const generateSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  const handleToggleActive = async () => {
    if (!source || !workspace || !isWorkspaceAdmin) return;

    const newActiveState = source.isActive !== false;
    
    setSyncing(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}/${source.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          isActive: !newActiveState,
        }),
      });
      const response = await res.json();

      if (response.status === 'success' || response.message?.toLowerCase().includes('success')) {
        setSource({
          ...source,
          isActive: !newActiveState,
        });
        showMessage('success', !newActiveState ? 'Source enabled successfully' : 'Source disabled successfully');
      } else {
        showMessage('error', response.message || 'Failed to update source status');
      }
    } catch (error: any) {
      console.error('Failed to toggle source active status:', error);
      showMessage('error', `Error: ${error.message || 'Failed to update source status. Please try again.'}`);
    } finally {
      setSyncing(false);
    }
  };

  const getFieldTypeExample = (field: LeadCustomField) => {
    switch (field.field_type) {
      case 'text':
        return 'string';
      case 'number':
        return 123;
      case 'date':
        return 'YYYY-MM-DD';
      case 'select':
        return getCustomFieldOptions(field.options)[0] || 'option1';
      case 'multiselect':
        return ['option1', 'option2'];
      case 'checkbox':
        return true;
      case 'textarea':
        return 'Long text content...';
      default:
        return 'value';
    }
  };

  if (!workspace || isRoleLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading source...</p>
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Admin access required</h1>
          <p className="text-sm text-gray-500 mb-6">
            Webhook details and source settings can only be viewed by workspace admins.
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

  if (!source) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Source not found</p>
      </div>
    );
  }

  const baseWebhookUrl = generateWebhookUrl(source?.name);
  const webhookUrl = source?.webhookSecret
    ? `${baseWebhookUrl}?token=${encodeURIComponent(source.webhookSecret)}`
    : baseWebhookUrl;
  const samplePayload = generateSamplePayload();
  const availableFieldKeys = Object.keys(samplePayload).filter((key) => key !== 'source');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/workspace/${workspace.id}/sources`)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900">{source.name}</h1>
                {source.isActive === false && (
                  <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">Webhook configuration and integration details</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleActive}
                disabled={syncing}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium ${
                  source.isActive !== false
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {syncing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Loading...
                  </>
                ) : (
                  <>
                    <PowerIcon className="h-4 w-4" />
                    {source.isActive !== false ? 'Disable' : 'Enable'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Webhook URL Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <CodeBracketIcon className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Webhook URL</h2>
                <p className="text-sm text-gray-500">
                  Send POST requests to this endpoint to create leads
                </p>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(webhookUrl)}
              className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <DocumentDuplicateIcon className="h-5 w-5" />
                  Copy URL
                </>
              )}
            </button>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <code className="text-sm text-green-400">{webhookUrl}</code>
          </div>
        </div>

        {/* Access Token */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Access Token</h2>
                <p className="text-sm text-gray-500">
                  Require a secret token on every request to stop strangers from creating leads
                </p>
              </div>
            </div>
            {source.webhookSecret ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleSecretChange(null)}
                  disabled={syncing}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-60"
                >
                  Remove token
                </button>
                <button
                  onClick={() => void handleSecretChange(generateSecret())}
                  disabled={syncing}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-60"
                >
                  Regenerate
                </button>
              </div>
            ) : (
              <button
                onClick={() => void handleSecretChange(generateSecret())}
                disabled={syncing}
                className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-60"
              >
                Enable token
              </button>
            )}
          </div>
          {source.webhookSecret ? (
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <code className="text-sm text-green-400 break-all">{source.webhookSecret}</code>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              This endpoint is currently open. Anyone who knows the URL can submit leads and create deals.
            </p>
          )}
        </div>

        {/* Required Fields */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-100 rounded-lg">
              <InformationCircleIcon className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Required Fields</h2>
              <p className="text-sm text-gray-500">
                These fields must be included in your webhook payload
              </p>
            </div>
          </div>
          <div className="bg-gray-55 rounded-lg p-4">
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200">
                <div>
                  <code className="text-sm font-mono text-gray-900">name</code>
                  <p className="text-xs text-gray-500 mt-1">Lead's full name</p>
                </div>
                <span className="w-fit px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">Required</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200">
                <div>
                  <code className="text-sm font-mono text-gray-900">email</code>
                  <p className="text-xs text-gray-500 mt-1">Lead's email address</p>
                </div>
                <span className="w-fit px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">Required</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200">
                <div>
                  <code className="text-sm font-mono text-gray-900">phone</code>
                  <p className="text-xs text-gray-500 mt-1">Lead's phone number</p>
                </div>
                <span className="w-fit px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded">Optional</span>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Fields */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-3"></div>
            <p className="text-gray-500">Loading custom fields...</p>
          </div>
        ) : customFields.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-100 rounded-lg">
                <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Custom Fields</h2>
                <p className="text-sm text-gray-500">
                  Additional fields configured for this workspace
                </p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="space-y-2">
                {customFields.map(field => (
                  <div
                    key={field.id}
                    className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-gray-900">{field.slug}</code>
                        <span className="text-xs text-gray-400">({field.label})</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Type: <span className="font-medium">{field.field_type}</span>
                        {(() => {
                          const o = getCustomFieldOptions(field.options);
                          return o.length > 0 ? <> | Options: {o.join(', ')}</> : null;
                        })()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">Example:</span>
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded max-w-[200px] truncate">
                        {JSON.stringify(getFieldTypeExample(field))}
                      </code>
                      {field.is_required === 1 && (
                        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">Required</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <p className="text-gray-500">No custom fields configured</p>
          </div>
        )}

        {/* Deal Automation */}
        <WebFormDealMappingForm
          workspaceId={workspace.id}
          sourceId={source.id}
          availableFieldKeys={availableFieldKeys}
        />

        {/* Sample Payload */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DocumentDuplicateIcon className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Sample Payload</h2>
                <p className="text-sm text-gray-500">
                  Complete example of webhook request body
                </p>
              </div>
            </div>
            <button
              onClick={() => copyToClipboard(JSON.stringify(samplePayload, null, 2))}
              className="w-full sm:w-auto px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <DocumentDuplicateIcon className="h-4 w-4" />
              Copy JSON
            </button>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-green-400">{JSON.stringify(samplePayload, null, 2)}</pre>
          </div>
        </div>

        {/* Integration Examples */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <CodeBracketIcon className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Integration Examples</h2>
              <p className="text-sm text-gray-500">
                Copy and paste these examples into your website
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* HTML Form Example */}
            <div>
              <h3 className="text-md font-medium text-gray-900 mb-2">HTML Form</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`<form action="${webhookUrl}" method="POST">
  <input type="text" name="name" placeholder="Full Name" required />
  <input type="email" name="email" placeholder="Email" required />
  <input type="tel" name="phone" placeholder="Phone" />
${customFields.map(f => `  <input type="${f.field_type === 'textarea' ? 'text' : f.field_type === 'number' ? 'number' : 'text'}" name="${f.slug}" placeholder="${f.label}"${f.is_required ? ' required' : ''} />`).join('\n')}
  <button type="submit">Submit</button>
</form>`}
              </pre>
            </div>

            {/* JavaScript Example */}
            <div>
              <h3 className="text-md font-medium text-gray-900 mb-2">JavaScript (Fetch)</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`fetch('${webhookUrl}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(samplePayload, null, 6)})
})
  .then(response => response.json())
  .then(data => console.log('Success:', data))
  .catch(error => console.error('Error:', error));`}
              </pre>
            </div>

            {/* cURL Example */}
            <div>
              <h3 className="text-md font-medium text-gray-900 mb-2">cURL</h3>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(samplePayload).replace(/'/g, "'\\''")}'`}
              </pre>
            </div>
          </div>
        </div>
      </main>

      {/* Message Toast */}
      {message && (
        <div
          className={`fixed bottom-4 right-4 p-4 rounded-lg flex items-center gap-3 shadow-lg z-50 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
          role={message.type === 'error' ? 'alert' : 'status'}
          aria-live={message.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {message.type === 'success' ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <XMarkIcon className="h-5 w-5" />
          )}
          <span className="font-medium">{message.text}</span>
        </div>
      )}
    </div>
  );
}
