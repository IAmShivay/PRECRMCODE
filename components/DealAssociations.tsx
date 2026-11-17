import { useEffect, useState } from 'react';
import { getDealAssociations, createDealAssociation, deleteDealAssociation } from '../lib/api-client';
import { getAuthToken } from '../lib/storage';
import { DEAL_ASSOCIATION_TYPES } from '../types/constants';
import type { DealAssociationType } from '../types/constants';

interface Props {
  workspaceId: number;
  dealId: number;
}

export default function DealAssociations({ workspaceId, dealId }: Props) {
  const [associations, setAssociations] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [targetId, setTargetId] = useState<string>('');
  const [type, setType] = useState<DealAssociationType>(DEAL_ASSOCIATION_TYPES[0]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDeals(): Promise<void> {
    try {
      const token = getAuthToken();
      if (!token) return;
      const base = (import.meta.env.VITE_API_BASE_URL as string) || '';
      const url = `${base}/api/deals?workspace_id=${workspaceId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await res.json();
      if (payload.status === 'success' && Array.isArray(payload.data)) setDeals(payload.data);
    } catch {}
  }

  async function load(): Promise<void> {
    try {
      setLoading(true);
      setError(null);
      const data = await getDealAssociations(workspaceId, dealId);
      setAssociations(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (workspaceId && dealId) {
      load();
      loadDeals();
    }
  }, [workspaceId, dealId]);

  async function handleCreate(): Promise<void> {
    const tid = Number(targetId);
    if (!Number.isFinite(tid) || tid <= 0) {
      setError('Select a deal');
      return;
    }
    if (tid === dealId) {
      setError('Cannot link deal to itself');
      return;
    }
    try {
      setError(null);
      await createDealAssociation(workspaceId, dealId, tid, type);
      setTargetId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    try {
      await deleteDealAssociation(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const dealMap = new Map<number, string>(deals.map((d: any) => [Number(d.id), String(d.name || `#${d.id}`)]));
  const associatedIds = new Set<number>(associations.flatMap((a: any) => [Number(a.source_deal_id), Number(a.target_deal_id)]));
  const availableDeals = deals.filter((d: any) => Number(d.id) !== dealId && !associatedIds.has(Number(d.id)));

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium">Link deal</label>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full border rounded px-3 py-2">
            <option value="">Select a deal</option>
            {availableDeals.map((d: any) => (
              <option key={d.id} value={String(d.id)}>
                {d.name} (#{d.id} — {d.stage})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as DealAssociationType)} className="border rounded px-3 py-2">
            {DEAL_ASSOCIATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button onClick={handleCreate} className="bg-black text-white px-4 py-2 rounded">
          Link
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="text-sm">Loading...</div>
      ) : associations.length === 0 ? (
        <div className="text-sm text-gray-500">No associations</div>
      ) : (
        <ul className="space-y-2">
          {associations.map((a) => {
            const isSource = Number(a.source_deal_id) === dealId;
            const otherId = isSource ? Number(a.target_deal_id) : Number(a.source_deal_id);
            const otherName = dealMap.get(otherId) || `#${otherId}`;
            let relationLabel = `${otherName} (${a.type})`;
            if (a.type === 'parent_child') relationLabel = isSource ? `Child: ${otherName}` : `Parent: ${otherName}`;
            else if (a.type === 'blocked_by') relationLabel = isSource ? `Blocked by: ${otherName}` : `Blocking: ${otherName}`;
            else if (a.type === 'related') relationLabel = `Related: ${otherName}`;
            return (
              <li key={a.id} className="flex justify-between items-center border rounded px-3 py-2 gap-2">
                <span className="text-sm min-w-0 flex-1">
                  {relationLabel} <span className="text-xs text-gray-400">({a.type})</span>
                </span>
                <button onClick={() => handleDelete(a.id)} className="text-sm text-red-600 shrink-0">
                  Unlink
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
