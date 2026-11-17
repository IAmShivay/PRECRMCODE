import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowPathIcon, MagnifyingGlassIcon, PlusIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import type { Lead, Prospect, ProspectsView } from '../components/types';
import { readProspects, setProspectSelection } from '../lib/api-client';

export default function ProspectsPage() {
  const { currentWorkspace } = useAuth();
  const workspaceId = currentWorkspace?.id;
  const [view, setView] = React.useState<ProspectsView>({ prospects: [], candidates: [] });
  const [loading, setLoading] = React.useState(false);
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [candidateQuery, setCandidateQuery] = React.useState('');
  const [showPicker, setShowPicker] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!workspaceId) {
      setView({ prospects: [], candidates: [] });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setView({ prospects: [], candidates: [] });
    setShowPicker(false);
    void readProspects(workspaceId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setView(response.data || { prospects: [], candidates: [] });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load prospects');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId, refreshKey]);

  const matches = (lead: Lead, needle: string) => [lead.name, lead.email, lead.phone]
    .some((value) => String(value || '').toLowerCase().includes(needle));
  const visibleProspects = view.prospects.filter((prospect) => matches(prospect.lead, query.trim().toLowerCase()));
  const prospectIds = new Set(view.prospects.map((prospect) => Number(prospect.lead.id)));
  const visibleCandidates = view.candidates
    .filter((lead) => !prospectIds.has(Number(lead.id)))
    .filter((lead) => matches(lead, candidateQuery.trim().toLowerCase()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const select = async (leadId: number, selected: boolean) => {
    if (!workspaceId) return;
    setSavingId(leadId);
    setError('');
    try {
      await setProspectSelection(workspaceId, leadId, selected);
      const response = await readProspects(workspaceId);
      setView(response.data || { prospects: [], candidates: [] });
      if (selected) setShowPicker(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save prospect');
    } finally {
      setSavingId(null);
    }
  };

  if (!currentWorkspace) return <div className="text-sm text-gray-600">Select a workspace to view prospects.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Prospects</h1>
          <p className="mt-1 text-sm text-gray-500">Qualified leads and leads selected for future opportunities. When a linked deal reaches a conversion stage, the lead appears in Customers.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button type="button" onClick={() => setShowPicker(true)} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">
            <PlusIcon className="h-4 w-4" /> Add from Leads
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 flex items-center gap-3">
        <div className="rounded-xl bg-gray-100 p-2 text-gray-700"><UserGroupIcon className="h-5 w-5" /></div>
        <div><div className="text-xs text-gray-500">Active prospects</div><div className="text-xl font-semibold text-gray-900">{view.prospects.length}</div></div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="text-sm font-semibold text-gray-900">Prospect list</div>
          <div className="relative w-full sm:w-72">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prospects" aria-label="Search prospects" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-gray-400" />
          </div>
        </div>
        {error && <div role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="px-5 py-12 text-center text-sm text-gray-500">Loading prospects…</div>
          : error && view.prospects.length === 0 ? null
          : visibleProspects.length === 0 ? <div className="px-5 py-12 text-center text-sm text-gray-500">{query ? 'No matching prospects.' : 'No prospects yet. Qualify a lead or add one from Leads.'}</div>
          : <div className="divide-y divide-gray-100">{visibleProspects.map((prospect: Prospect) => (
            <div key={prospect.lead.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <Link to={`/leads/${prospect.lead.id}`} className="text-sm font-semibold text-gray-900 hover:underline">{prospect.lead.name || `Lead #${prospect.lead.id}`}</Link>
                <div className="mt-1 text-xs text-gray-500">{[prospect.lead.email, prospect.lead.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{prospect.status_name}</span>
                <span className="text-xs text-gray-500">{prospect.qualified ? 'Qualified status' : 'Selected manually'}</span>
                {prospect.manually_selected && <button type="button" onClick={() => void select(Number(prospect.lead.id), false)} disabled={savingId !== null} title={prospect.qualified ? 'Remove manual selection; qualified status will keep this lead in Prospects' : undefined} className="text-xs font-medium text-gray-600 hover:text-red-600 disabled:opacity-50">{prospect.qualified ? 'Clear selection' : 'Remove'}</button>}
              </div>
            </div>
          ))}</div>}
      </div>

      {showPicker && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add a prospect">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div><h2 className="text-base font-semibold text-gray-900">Add from Leads</h2><p className="mt-1 text-xs text-gray-500">Select a lead to add as a prospect.</p></div>
            <button type="button" aria-label="Close" onClick={() => setShowPicker(false)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
          </div>
          <div className="p-5"><input type="search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Search leads by name, email, or phone" aria-label="Search leads to add" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />{error && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}</div>
          <div className="max-h-80 overflow-y-auto border-t border-gray-100">
            {visibleCandidates.length === 0 ? <div className="px-5 py-8 text-center text-sm text-gray-500">No available leads.</div>
              : visibleCandidates.map((lead) => <div key={lead.id} className="flex items-center justify-between gap-3 border-b border-gray-50 px-5 py-3">
                <div className="min-w-0"><div className="truncate text-sm font-medium text-gray-900">{lead.name || `Lead #${lead.id}`}</div><div className="truncate text-xs text-gray-500">{lead.email || lead.phone || 'No contact details'}</div></div>
                <button type="button" onClick={() => void select(Number(lead.id), true)} disabled={savingId !== null} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Add</button>
              </div>)}
          </div>
        </div>
      </div>}
    </div>
  );
}
