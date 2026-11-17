import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { formatWorkspaceCurrency } from '../lib/currency';
import { TrashIcon, CheckIcon, ChevronUpIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface DashboardStats {
  totalLeads: number;
  conversionRate: number;
  topSource: string;
  totalRevenue: number;
  openDeals: number;
  wonDeals: number;
  sourcesCount: number;
  membersCount: number;
  loading: boolean;
}

interface SetupStep {
  title: string;
  text: string;
  cta: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SETUP_HIDDEN_KEY = 'scraft_setup_hidden_';
const WON_STAGE = 'won';
const LOST_STAGE = 'lost';

const ProgressRing: React.FC<{ value: number }> = ({ value }) => (
  <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90" aria-hidden="true">
    <circle cx="20" cy="20" r={RING_RADIUS} fill="none" stroke="#E5E7EB" strokeWidth="3.5" />
    <circle
      cx="20" cy="20" r={RING_RADIUS} fill="none" stroke="#3F7DF4" strokeWidth="3.5" strokeLinecap="round"
      strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - value)}
      className="transition-[stroke-dashoffset] duration-700 ease-out"
    />
  </svg>
);

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    workspaces,
    currentWorkspace,
    canCreateWorkspace,
    setCurrentWorkspace,
    getUserRole,
    refreshWorkspaces,
  } = useAuth();

  const [workspaceToDelete, setWorkspaceToDelete] = useState<{ id: number; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalLeads: 0,
    conversionRate: 0,
    topSource: '-',
    totalRevenue: 0,
    openDeals: 0,
    wonDeals: 0,
    sourcesCount: 0,
    membersCount: 0,
    loading: true,
  });
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupTab, setSetupTab] = useState<'progress' | 'done'>('progress');

  const fetchStats = useCallback(async (silent = false) => {
    if (!currentWorkspace) return;
    const token = getAuthToken();
    if (!token) return;

    if (!silent) {
      setStats(prev => ({ ...prev, loading: true }));
    }

    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [leadsRes, stagesRes, sourcesRes, dealsRes, membersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/leads?workspace_id=${currentWorkspace.id}&limit=10000`, { headers }),
        fetch(`${API_BASE_URL}/api/deals/stages?workspace_id=${currentWorkspace.id}`, { headers }),
        fetch(`${API_BASE_URL}/api/sources/${currentWorkspace.id}`, { headers }),
        fetch(`${API_BASE_URL}/api/deals?workspace_id=${currentWorkspace.id}&limit=10000`, { headers }),
        fetch(`${API_BASE_URL}/api/workspaces/${currentWorkspace.id}/members`, { headers }),
      ]);

      const [leadsData, stagesData, sourcesData, dealsData, membersData] = await Promise.all([
        leadsRes.ok ? leadsRes.json() : null,
        stagesRes.ok ? stagesRes.json() : null,
        sourcesRes.ok ? sourcesRes.json() : null,
        dealsRes.ok ? dealsRes.json() : null,
        membersRes.ok ? membersRes.json() : null,
      ]);

      // Total leads
      const leads: any[] = leadsData?.data && Array.isArray(leadsData.data) ? leadsData.data : [];
      const totalLeads = leads.length;

      const stages: any[] = Array.isArray(stagesData?.data) ? stagesData.data : [];
      const conversionStages = new Set(stages.length > 0
        ? stages.filter((stage: any) => stage.counts_as_conversion).map((stage: any) => String(stage.slug))
        : ['won']);

      // Top performing source
      const sources: any[] = sourcesData?.data && Array.isArray(sourcesData.data) ? sourcesData.data : [];
      let topSource = '-';
      if (sources.length > 0) {
        // Count leads per source_id
        const sourceCountMap = new Map<string, number>();
        for (const lead of leads) {
          if (lead.source_id) {
            sourceCountMap.set(lead.source_id, (sourceCountMap.get(lead.source_id) || 0) + 1);
          }
        }
        let maxCount = 0;
        let topSourceId = '';
        for (const [sourceId, count] of sourceCountMap) {
          if (count > maxCount) {
            maxCount = count;
            topSourceId = sourceId;
          }
        }
        if (topSourceId) {
          const matched = sources.find((s: any) => s.event_id === topSourceId);
          topSource = matched?.source || topSourceId;
        }
      }

      // Total revenue — won deals
      const deals: any[] = dealsData?.data && Array.isArray(dealsData.data) ? dealsData.data : [];
      const convertedLeadIds = new Set(deals
        .filter((deal: any) => conversionStages.has(String(deal.stage)) && Number(deal.lead_id) > 0)
        .map((deal: any) => Number(deal.lead_id)));
      const conversionRate = totalLeads > 0
        ? (leads.filter((lead: any) => convertedLeadIds.has(Number(lead.id))).length / totalLeads) * 100
        : 0;
      const totalRevenue = deals
        .filter((d: any) => d.stage === WON_STAGE)
        .reduce((sum: number, d: any) => sum + (Number(d.value) || 0), 0);
      const wonDeals = deals.filter((d: any) => d.stage === WON_STAGE).length;
      const openDeals = deals.filter((d: any) => d.stage !== WON_STAGE && d.stage !== LOST_STAGE).length;
      const membersCount = Array.isArray(membersData?.data) ? membersData.data.length : 0;

      setStats({
        totalLeads,
        conversionRate,
        topSource,
        totalRevenue,
        openDeals,
        wonDeals,
        sourcesCount: sources.length,
        membersCount,
        loading: false,
      });
    } catch (error) {
      console.error('[Dashboard] Failed to fetch stats:', error);
      setStats(prev => ({ ...prev, loading: false }));
    }
  }, [currentWorkspace]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const currentWorkspaceIsAdmin = currentWorkspace
    ? getUserRole(currentWorkspace.id) === 'admin'
    : false;

  useEffect(() => {
    if (!currentWorkspace) return;
    try {
      setSetupOpen(localStorage.getItem(`${SETUP_HIDDEN_KEY}${currentWorkspace.id}`) !== '1');
    } catch {
      setSetupOpen(true);
    }
  }, [currentWorkspace]);

  const toggleSetup = () => {
    if (!currentWorkspace) return;
    const next = !setupOpen;
    setSetupOpen(next);
    try {
      localStorage.setItem(`${SETUP_HIDDEN_KEY}${currentWorkspace.id}`, next ? '0' : '1');
    } catch {
      /* storage unavailable */
    }
  };

  const setupSteps: SetupStep[] = currentWorkspace
    ? [
        { title: 'Connect a lead source', text: 'Send leads in from your website, forms or Facebook Lead Ads.', cta: 'Add a source', href: `/workspace/${currentWorkspace.id}/sources`, done: stats.sourcesCount > 0 },
        { title: 'Capture your first lead', text: 'Add one by hand or let a source bring it in automatically.', cta: 'Open leads', href: '/leads', done: stats.totalLeads > 0 },
        { title: 'Open your first deal', text: 'Move a qualified lead into your pipeline and track it to won.', cta: 'Open deals', href: '/deals', done: stats.openDeals + stats.wonDeals > 0 },
        { title: 'Invite your team', text: 'Share the workspace so leads get answered faster.', cta: 'Invite members', href: '/settings', done: stats.membersCount > 1 },
        { title: 'Connect WhatsApp', text: 'Reply to leads from the CRM on the channel they already use.', cta: 'Connect WhatsApp', href: '/whatsapp', done: false, optional: true },
      ]
    : [];
  const requiredSteps = setupSteps.filter((step) => !step.optional);
  const doneSteps = requiredSteps.filter((step) => step.done).length;
  const setupProgress = requiredSteps.length ? doneSteps / requiredSteps.length : 0;
  const showSetup = currentWorkspaceIsAdmin && !stats.loading;

  const overview = [
    { label: 'Leads', value: stats.totalLeads.toLocaleString() },
    { label: 'Open deals', value: stats.openDeals.toLocaleString() },
    { label: 'Won deals', value: stats.wonDeals.toLocaleString() },
    { label: 'Lead sources', value: stats.sourcesCount.toLocaleString() },
    { label: 'Team members', value: stats.membersCount.toLocaleString() },
    { label: 'Top source', value: stats.topSource },
  ];

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => fetchStats(true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchStats]);

  // Refresh on lead changes
  useEffect(() => {
    const handleLeadsChanged = () => fetchStats(true);
    window.addEventListener('leadsChanged', handleLeadsChanged);
    return () => window.removeEventListener('leadsChanged', handleLeadsChanged);
  }, [fetchStats]);

  // Keep dashboard totals current when leads arrive from Facebook/webhooks.
  useEffect(() => {
    if (!currentWorkspace) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchStats(true);
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [currentWorkspace, fetchStats]);

  const handleDeleteWorkspace = async () => {
    if (!workspaceToDelete || !user) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceToDelete.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (response.ok) {
        if (currentWorkspace?.id === workspaceToDelete.id) {
          setCurrentWorkspace(null);
        }
        await refreshWorkspaces();
        setWorkspaceToDelete(null);
      } else {
        const data = await response.json();
        setDeleteError(data.error || data.message || 'Failed to delete workspace');
      }
    } catch (e) {
      console.error('Failed to delete workspace', e);
      setDeleteError('Failed to delete workspace');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7]">
      <div className="border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8 py-4">
        <h1 className="text-[15px] font-bold uppercase tracking-wide text-gray-800">Home</h1>
      </div>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentWorkspace ? (
          <section className="mb-5 rounded-md border border-gray-200 bg-white p-5 sm:p-6" aria-label="Workspace">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg text-gray-900">{currentWorkspace.name}</h2>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${currentWorkspaceIsAdmin ? 'bg-[#E6F6EC] text-[#1E8E4E]' : 'bg-gray-100 text-gray-600'}`}>
                    {currentWorkspaceIsAdmin ? 'Admin' : 'Member'}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] text-gray-800">
                  {currentWorkspaceIsAdmin
                    ? 'You manage where leads come from, who works them and how they move through your pipeline.'
                    : 'Pick up new leads, keep them moving and close deals with your team.'}
                </p>
                <p className="mt-4 text-[15px] text-gray-800">Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Here is where your workspace stands today.</p>

                <dl className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    { label: 'Conversion rate', value: `${stats.conversionRate.toFixed(1)}%` },
                    { label: 'Revenue (won)', value: formatWorkspaceCurrency(stats.totalRevenue, currentWorkspace?.currency, true) },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-md border border-gray-200 px-4 py-3">
                      <dt className="text-sm text-gray-500">{kpi.label}</dt>
                      {stats.loading ? (
                        <dd className="mt-1.5 h-6 w-16 rounded bg-gray-100 animate-pulse" />
                      ) : (
                        <dd className="mt-0.5 text-xl font-semibold text-gray-900 tabular-nums">{kpi.value}</dd>
                      )}
                    </div>
                  ))}
                </dl>

                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  <button
                    onClick={() => navigate(currentWorkspaceIsAdmin ? `/workspace/${currentWorkspace.id}/sources` : '/leads')}
                    className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
                  >
                    {currentWorkspaceIsAdmin ? 'Manage sources' : 'View leads'}
                  </button>
                  <button
                    onClick={() => navigate('/analytics')}
                    className="rounded bg-[#3F7DF4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#2F6BE0] transition-colors"
                  >
                    View analytics
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 p-4 sm:p-5">
                <h2 className="text-lg text-gray-900">Workspace overview</h2>
                {currentWorkspaceIsAdmin && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[15px]">
                      <span className="text-gray-900">Setup progress</span>
                      <span className="text-xs font-semibold text-[#E5383B] tabular-nums">{doneSteps} / {requiredSteps.length}</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-gray-100">
                      <div className="h-1 rounded-full bg-[#E5383B] transition-[width] duration-700" style={{ width: `${Math.round(setupProgress * 100)}%` }} />
                    </div>
                  </div>
                )}
                <dl className="mt-4 space-y-2.5">
                  {overview.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 text-[15px]">
                      <dt className="text-gray-500">{row.label}</dt>
                      {stats.loading ? (
                        <dd className="h-4 w-12 rounded bg-gray-100 animate-pulse" />
                      ) : (
                        <dd className="truncate text-gray-900 tabular-nums" title={row.value}>{row.value}</dd>
                      )}
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </section>
        ) : (
          <div className="mb-5 rounded-md border border-gray-200 bg-white p-6">
            <p className="text-gray-600">No workspace selected. Create one to get started.</p>
            {canCreateWorkspace && (
              <button
                onClick={() => navigate('/onboarding/workspace')}
                className="mt-4 rounded bg-[#3F7DF4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2F6BE0] transition-colors"
              >
                Create workspace
              </button>
            )}
          </div>
        )}

        {showSetup && (
          <section className="mb-5 rounded-md border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="setup-heading">
            <div className="flex items-center justify-between">
              <h2 id="setup-heading" className="text-lg text-gray-900">Get set up</h2>
              <button type="button" onClick={toggleSetup} aria-expanded={setupOpen} aria-label={setupOpen ? 'Collapse setup' : 'Expand setup'} className="rounded p-1 text-gray-500 hover:bg-gray-50">
                <ChevronUpIcon className={`h-5 w-5 transition-transform ${setupOpen ? '' : 'rotate-180'}`} aria-hidden="true" />
              </button>
            </div>

            {setupOpen && (
              <>
                <div role="tablist" className="mt-4 flex gap-6 border-b border-gray-100">
                  {([['progress', 'In progress'], ['done', 'Completed']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={setupTab === key}
                      onClick={() => setSetupTab(key)}
                      className={`-mb-px border-b-2 px-1 pb-2 text-[15px] transition-colors ${setupTab === key ? 'border-[#3F7DF4] text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-5 rounded-md border border-gray-200">
                  <div className="flex items-center gap-4 px-4 py-3">
                    <span className="relative flex-shrink-0">
                      <ProgressRing value={setupProgress} />
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-gray-900">
                        {Math.round(setupProgress * 100)}%
                      </span>
                    </span>
                    <span className="text-[15px] text-gray-900">Set up your workspace to capture and convert leads</span>
                  </div>

                  {(() => {
                    const visible = setupSteps.filter((step) => (setupTab === 'done' ? step.done : !step.done));
                    if (visible.length === 0) {
                      return <p className="border-t border-gray-100 px-4 py-6 text-sm text-gray-500">{setupTab === 'done' ? 'Nothing completed yet.' : 'All done. Your workspace is ready.'}</p>;
                    }
                    return (
                      <ol className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2 xl:grid-cols-3">
                        {visible.map((step) => (
                          <li key={step.title} className="flex flex-col rounded-md border border-gray-200 bg-white p-4">
                            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${step.done ? 'bg-[#1E8E4E] text-white' : 'border-2 border-dashed border-gray-300'}`}>
                              {step.done && <CheckIcon className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
                            </span>
                            <p className="mt-4 flex flex-wrap items-center gap-2 text-[15px] text-gray-900">
                              {step.title}
                              {step.optional && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">Optional</span>}
                            </p>
                            <p className="mt-1 flex-1 text-sm text-gray-500">{step.text}</p>
                            {!step.done && (
                              <button
                                onClick={() => navigate(step.href)}
                                className="mt-4 inline-flex items-center gap-1.5 self-start rounded bg-[#3F7DF4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#2F6BE0] transition-colors"
                              >
                                {step.cta} <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    );
                  })()}
                </div>
              </>
            )}
          </section>
        )}

        {/* All Workspaces */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg text-gray-900">
              Your Workspaces ({workspaces.length})
            </h3>
            {canCreateWorkspace && (
              <button
                onClick={() => navigate('/workspaces/new')}
                className="rounded bg-[#3F7DF4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#2F6BE0] transition-colors"
              >
                + New workspace
              </button>
            )}
          </div>

          {workspaces.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workspaces.map((workspace) => {
                const isAdmin = getUserRole(workspace.id) === 'admin';
                return (
                  <div
                    key={workspace.id}
                    className={`bg-white rounded-md p-5 border transition-colors hover:border-[#3F7DF4] relative ${
                      currentWorkspace?.id === workspace.id
                        ? 'border-[#3F7DF4] ring-2 ring-[#3F7DF4]/10'
                        : 'border-gray-200'
                    }`}
                  >
                    <div
                      onClick={() => {
                        setCurrentWorkspace(workspace.id);
                        navigate(isAdmin ? `/workspace/${workspace.id}/sources` : '/leads');
                      }}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          currentWorkspace?.id === workspace.id ? 'bg-[#3F7DF4]' : 'bg-gray-100'
                        }`}>
                          <span className={`font-medium ${
                            currentWorkspace?.id === workspace.id ? 'text-white' : 'text-gray-600'
                          }`}>
                            {workspace.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-black">{workspace.name}</h4>
                          <p className="text-sm text-gray-400">
                            {workspace.id === currentWorkspace?.id ? 'Active' : isAdmin ? 'Click to manage' : 'Member access'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {isAdmin ? 'Manage Sources' : 'View Leads'}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setWorkspaceToDelete({ id: workspace.id, name: workspace.name });
                        }}
                        className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete workspace"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-md p-8 text-center border border-gray-200">
              <p className="text-gray-500 mb-4">You don't have any workspaces yet.</p>
              {canCreateWorkspace && (
                <button
                  onClick={() => navigate('/onboarding/workspace')}
                  className="rounded bg-[#3F7DF4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2F6BE0] transition-colors"
                >
                  Create your first workspace
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Delete Workspace Confirmation Modal */}
      {workspaceToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Workspace</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <span className="font-medium">{workspaceToDelete.name}</span>?
              This action cannot be undone and will permanently delete all workspace data.
            </p>
            {deleteError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setWorkspaceToDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteWorkspace}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
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
      )}
    </div>
  );
};

export default Dashboard;
