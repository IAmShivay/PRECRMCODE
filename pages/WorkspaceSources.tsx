import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { buildWebhookUrl } from '../lib/webhookUrl';
import { PlusIcon, XMarkIcon, LinkIcon, TrashIcon, CheckCircleIcon, PowerIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

// Backend API base URL (same as other frontend API calls)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface Source {
  id: string;
  name: string;
  webhookUrl: string;
  createdAt: string;
  logId?: number;
  isActive?: boolean;
  leadCount?: number;
}

export default function WorkspaceSources() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const {
    user,
    workspaces,
    currentWorkspace,
    setCurrentWorkspace,
    getUserRole,
    loadWorkspaceMembers,
    workspaceMembersLoading,
    isLoading: authLoading,
  } = useAuth();

  const [sources, setSources] = useState<Source[]>([]);
  const [workspaceFallback, setWorkspaceFallback] = useState<{ id: number; name: string; owner_id?: number; created_at?: string } | null>(null);
  const [workspaceLookupComplete, setWorkspaceLookupComplete] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [sourceToDelete, setSourceToDelete] = useState<Source | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [checkingFacebookConnection, setCheckingFacebookConnection] = useState(true);
  const [roleCheckWorkspaceId, setRoleCheckWorkspaceId] = useState<number | null>(null);

  // Get the workspace info
  const workspace = workspaceId
    ? workspaces.find(w => w.id === Number(workspaceId)) || workspaceFallback
    : currentWorkspace || workspaceFallback;
  const workspaceRole = workspace ? getUserRole(workspace.id) : null;
  const isWorkspaceAdmin = workspaceRole === 'admin';
  const isRoleLoading = Boolean(
    workspace
      && user
      && workspaceRole === null
      && (workspaceMembersLoading || roleCheckWorkspaceId !== workspace.id)
  );

  // If accessing from current workspace, set the workspaceId
  useEffect(() => {
    if (!workspaceId && currentWorkspace) {
      navigate(getUserRole(currentWorkspace.id) === 'admin' ? `/workspace/${currentWorkspace.id}/sources` : '/leads', { replace: true });
    }
  }, [workspaceId, currentWorkspace, getUserRole, navigate]);

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

  useEffect(() => {
    const fetchWorkspace = async () => {
      if (!workspaceId || workspace) {
        setWorkspaceLookupComplete(true);
        return;
      }

      setWorkspaceLookupComplete(false);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = await res.json();
        const ws = Array.isArray(data?.data) ? data.data[0] : data?.data;
        if (data?.status === 'success' && ws?.id) {
          setWorkspaceFallback({ id: ws.id, name: ws.name, owner_id: ws.owner_id, created_at: ws.created_at });
        }
      } catch {
      } finally {
        setWorkspaceLookupComplete(true);
      }
    };
    fetchWorkspace();
  }, [workspaceId, workspace]);

  useEffect(() => {
    if (authLoading || !workspaceLookupComplete || workspace || workspaces.length === 0) return;
    const firstWorkspace = workspaces[0];
    if (!firstWorkspace) return;
    navigate(getUserRole(firstWorkspace.id) === 'admin' ? `/workspace/${firstWorkspace.id}/sources` : '/leads', { replace: true });
  }, [authLoading, workspaceLookupComplete, workspace, workspaces, getUserRole, navigate]);

  // Load sources from database (only when workspace ID changes)
  useEffect(() => {
    if (!workspace || !isWorkspaceAdmin) return;

    const loadSources = async () => {
      setLoading(true);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const response = await res.json();
        console.log('Sources API response:', response);
        
        if (response.status === 'success' && response.data) {
          console.log('Loaded sources from database:', response.data);
          // Convert database format to Source format, parsing payload for isActive
          const sourcesWithUrl = response.data.map((log: any) => {
            let isActive = true;
            try {
              const parsedPayload = log.payload ? JSON.parse(log.payload) : {};
              isActive = parsedPayload.config?.isActive !== false;
            } catch (parseError) {
              console.error('Error parsing source payload:', parseError);
            }
            
            return {
              id: log.event_id,
              name: log.source,
              webhookUrl: generateWebhookUrl(log.event_id, log.source),
              createdAt: log.created_at,
              logId: log.id,
              isActive,
              leadCount: log.leadCount || 0,
            };
          });
          console.log('Processed sources with URLs:', sourcesWithUrl);
          setSources(sourcesWithUrl);
        } else {
          console.error('API response error or no data:', response);
          setSources([]); // Ensure empty array if no sources
        }
      } catch (error) {
        console.error('Failed to load sources:', error);
        showMessage('error', 'Failed to load sources');
        setSources([]); // Ensure empty array on error
      } finally {
        setLoading(false);
      }
    };

    loadSources();
  }, [workspace?.id, isWorkspaceAdmin]); // Only reload when workspace ID changes

  // Check Facebook connection status
  useEffect(() => {
    const checkFacebookConnection = async () => {
      if (!workspace?.id || !isWorkspaceAdmin) return;
      setCheckingFacebookConnection(true);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/facebook/${workspace.id}/pages`, {
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
  }, [workspace?.id, isWorkspaceAdmin]);

  // Set as current workspace
  useEffect(() => {
    if (workspace && currentWorkspace?.id !== workspace.id) {
      setCurrentWorkspace(workspace.id);
    }
  }, [workspace, currentWorkspace, setCurrentWorkspace]);

  const generateWebhookUrl = (sourceId: string, sourceName?: string) => {
    if (!workspace?.id) return '';
    // Always generate an absolute URL suitable for external callers.
    return buildWebhookUrl(workspace.id, sourceId, sourceName);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddSource = async () => {
    if (!newSourceName.trim() || !workspace || !isWorkspaceAdmin) return;

    setSyncing(true);
    try {
      console.log('Creating source for workspace:', workspace.id, 'with name:', newSourceName.trim());
      
      // Generate a unique source ID
      const sourceId = `src_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/sources`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          workspace_id: workspace.id,
          source: newSourceName.trim(),
          event_id: sourceId,
          payload: JSON.stringify({ type: 'source_registry' }),
          status: 'source_registry',
        }),
      });
      
      const response = await res.json();
      console.log('Source creation response:', response);

      if (response.status === 'success' || response.message?.toLowerCase().includes('success')) {
        // Reload sources from database
        const loadRes = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const loadResponse = await loadRes.json();
        if (loadResponse.status === 'success' && loadResponse.data) {
          const sourcesWithUrl = loadResponse.data.map((log: any) => {
            let isActive = true;
            try {
              const parsedPayload = log.payload ? JSON.parse(log.payload) : {};
              isActive = parsedPayload.config?.isActive !== false;
            } catch (parseError) {
              console.error('Error parsing source payload:', parseError);
            }
            
            return {
              id: log.event_id,
              name: log.source,
              webhookUrl: generateWebhookUrl(log.event_id, log.source),
              createdAt: log.created_at,
              logId: log.id,
              isActive,
              leadCount: log.leadCount || 0,
            };
          });
          setSources(sourcesWithUrl);
        }

        setNewSourceName('');
        setShowAddModal(false);
        showMessage('success', 'Source created successfully!');
      } else {
        console.error('Source creation failed:', response);
        const errorMessage = response.message || response.error || 'Failed to create source';
        showMessage('error', errorMessage);
      }
    } catch (error: any) {
      console.error('Failed to create source:', error);
      showMessage('error', `Error: ${error.message || 'Failed to create source. Please try again.'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteSource = async () => {
    if (!sourceToDelete || !workspace || !isWorkspaceAdmin) return;

    setSyncing(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}/${sourceToDelete.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const response = await res.json();

      if (response.status === 'success' || response.message?.toLowerCase().includes('success')) {
        // Directly remove the source from state
        setSources(prevSources => prevSources.filter(s => s.id !== sourceToDelete.id));

        setSourceToDelete(null);
        showMessage('success', 'Source deleted successfully');
      } else {
        showMessage('error', response.message || 'Failed to delete source');
      }
    } catch (error) {
      console.error('Failed to delete source:', error);
      showMessage('error', 'Failed to delete source. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleSourceActive = async (sourceId: string, currentIsActive: boolean) => {
    if (!workspace || !isWorkspaceAdmin) return;

    setSyncing(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/sources/${workspace.id}/${sourceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          isActive: !currentIsActive,
        }),
      });
      const response = await res.json();

      if (response.status === 'success' || response.message?.toLowerCase().includes('success')) {
        // Update local state
        setSources(prevSources =>
          prevSources.map(s =>
            s.id === sourceId ? { ...s, isActive: !currentIsActive } : s
          )
        );
        showMessage('success', !currentIsActive ? 'Source enabled successfully' : 'Source disabled successfully');
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

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    showMessage('success', 'Webhook URL copied!');
  };

  if (authLoading || !workspaceLookupComplete || (!workspace && workspaces.length > 0) || isRoleLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading workspace...</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Workspace not found</p>
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Admin access required</h1>
          <p className="text-sm text-gray-500 mb-6">
            Lead sources and webhook settings can only be managed by workspace admins.
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sources List */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Lead Sources</h1>
            <p className="text-sm text-gray-500">
              Manage your lead sources for {workspace.name}
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full sm:w-auto px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            <PlusIcon className="h-5 w-5" />
            New Source
          </button>
        </div>

        {/* Message Toast */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
            role={message.type === 'error' ? 'alert' : 'status'}
            aria-live={message.type === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {message.type === 'success' ? (
              <CheckCircleIcon className="h-5 w-5" />
            ) : (
              <XMarkIcon className="h-5 w-5" />
            )}
            <span className="font-medium">{message.text}</span>
          </div>
        )}

        {/* Facebook Integration Card */}
        <div className="mb-6 bg-gradient-to-r from-blue-50 to-blue-100/50 rounded-xl border border-blue-200 overflow-hidden">
          <div className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Facebook Lead Ads</h3>
                  <p className="text-xs text-gray-500">
                    Capture leads from your Facebook Lead Ads campaigns. Connect your account to sync leads in real-time.
                  </p>
                </div>
              </div>
              {checkingFacebookConnection ? (
                <button
                  disabled
                  className="w-full sm:w-auto px-4 py-2 bg-gray-400 text-white rounded-lg font-medium flex items-center justify-center gap-2 text-sm shadow-sm cursor-not-allowed"
                >
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent"></div>
                  <span>Checking...</span>
                </button>
              ) : facebookConnected ? (
                <button
                  onClick={() => navigate(`/workspace/${workspace.id}/integrations/facebook`)}
                  className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 text-sm shadow-sm"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Manage Integration</span>
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/workspace/${workspace.id}/integrations/facebook`)}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm shadow-sm"
                >
                  <span>Set Up Integration</span>
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-3"></div>
            <p className="text-gray-500">Loading sources...</p>
          </div>
        ) : sources.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <LinkIcon className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No sources yet</h3>
            <p className="text-gray-500 mb-6">Create your first source to start collecting leads from your website</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors inline-flex items-center gap-2"
            >
              <PlusIcon className="h-5 w-5" />
              Add Your First Source
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sources.map((source) => {
              const webhookUrl = generateWebhookUrl(source.id, source.name);
              return (
                <div
                  key={source.id}
                  className={`bg-white rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${
                    source.isActive === false ? 'border-gray-300 opacity-75' : 'border-gray-200'
                  }`}
                  onClick={() => navigate(`/workspace/${workspace.id}/sources/${source.id}`)}
                >
                  {/* Source Header */}
                  <div className="p-6 border-b border-gray-100">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-gray-900">{source.name}</h3>
                          {source.isActive === false && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-3">
                          Created {new Date(source.createdAt).toLocaleDateString()}
                        </p>
                        {/* Lead Count */}
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Total Leads</p>
                          <p className="text-2xl font-semibold text-gray-900">{source.leadCount || 0}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSourceActive(source.id, source.isActive !== false);
                          }}
                          className="p-1 hover:bg-gray-100 rounded-lg transition-colors group"
                          title={source.isActive !== false ? "Disable source" : "Enable source"}
                        >
                          <PowerIcon className={`h-5 w-5 ${source.isActive !== false ? 'text-gray-400 group-hover:text-gray-600' : 'text-yellow-500'}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSourceToDelete(source);
                          }}
                          className="p-1 hover:bg-red-50 rounded-lg transition-colors group"
                          title="Delete source"
                        >
                          <TrashIcon className="h-5 w-5 text-gray-400 group-hover:text-red-600" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Webhook URL */}
                  <div className="p-6 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Webhook URL</p>
                    <div className="bg-white rounded-lg p-3 mb-3 border border-gray-200">
                      <code className="text-sm text-gray-800 break-all block">{webhookUrl}</code>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(webhookUrl);
                      }}
                      className="w-full px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all text-sm font-medium flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy URL
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Add New Source</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <XMarkIcon className="h-6 w-6 text-gray-400" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Source Name
              </label>
              <input
                type="text"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="e.g., Landing Page, Facebook Ads, Google Ads"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent mb-4"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !syncing) handleAddSource();
                }}
              />
              <p className="text-sm text-gray-500 mb-6">
                Give your source a descriptive name to help you identify where leads are coming from.
                <span className="block mt-1 text-xs text-red-500">
                  Note: The source name can’t be modified later once created.
                </span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={syncing}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSource}
                  disabled={!newSourceName.trim() || syncing}
                  className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
                >
                  {syncing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Saving...
                    </>
                  ) : (
                    'Create Source'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {sourceToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Source</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{sourceToDelete.name}"? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setSourceToDelete(null)}
                  disabled={syncing}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSource}
                  disabled={syncing}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {syncing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Deleting...
                    </>
                  ) : (
                    'Delete'
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
