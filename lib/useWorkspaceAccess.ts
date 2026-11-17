import { useEffect, useState } from 'react';
import { readWorkspaceAccess } from './api-client';
import { ApiError } from '../components/types';
import type { WorkspaceAccess } from '../types/permissions';

export function useWorkspaceAccess(workspaceId?: number) {
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    setAccess(null); setError(''); setErrorStatus(null);
    if (!workspaceId) return undefined;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await readWorkspaceAccess(workspaceId, controller.signal);
        if (!controller.signal.aborted) { setAccess(next); setError(''); setErrorStatus(null); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setAccess(null);
          setError(cause instanceof Error ? cause.message : 'Unable to load permissions');
          setErrorStatus(cause instanceof ApiError ? cause.status : null);
        }
      } finally { loading = false; }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [workspaceId, retryKey]);
  return {
    access: access?.workspace_id === workspaceId ? access : null,
    error,
    errorStatus,
    retry: () => setRetryKey(current => current + 1),
  };
}
