import React, { useState } from 'react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import type { AiActionTicket } from '../types';
import { confirmAiAction } from '../../lib/aiChatClient';

interface ToolActionCardProps {
  ticket: AiActionTicket;
  onResolved?: (status: 'confirmed' | 'rejected') => void;
}

export const ToolActionCard: React.FC<ToolActionCardProps> = ({ ticket, onResolved }) => {
  const [loading, setLoading] = useState(false);
  const [resolvedStatus, setResolvedStatus] = useState<'confirmed' | 'rejected' | null>(
    ticket.status === 'confirmed' || ticket.status === 'rejected' ? ticket.status : null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async (confirmed: boolean) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await confirmAiAction(ticket.ticket_id, confirmed);
      const status = confirmed ? 'confirmed' : 'rejected';
      setResolvedStatus(status);
      onResolved?.(status);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process action');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs shadow-sm backdrop-blur-sm">
      <div className="flex items-start gap-2.5">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="flex-1">
          <div className="font-semibold text-amber-900 dark:text-amber-200">
            Action Approval Required
          </div>
          <div className="mt-1 text-slate-700 dark:text-slate-300">
            {ticket.summary}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-800 dark:text-amber-300">
              Tool: {ticket.tool_name}
            </span>
            {Object.entries(ticket.params).map(([key, val]) => (
              <span
                key={key}
                className="rounded-md bg-slate-200/80 px-2 py-0.5 text-[11px] text-slate-800 dark:bg-slate-700 dark:text-slate-200"
              >
                <span className="font-semibold">{key}:</span> {String(val)}
              </span>
            ))}
          </div>

          {errorMsg && (
            <div className="mt-2 text-rose-500">
              {errorMsg}
            </div>
          )}

          <div className="mt-3.5 flex items-center gap-2">
            {resolvedStatus === 'confirmed' ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircleIcon className="h-4 w-4" />
                Action Approved & Executed
              </span>
            ) : resolvedStatus === 'rejected' ? (
              <span className="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">
                <XCircleIcon className="h-4 w-4" />
                Action Rejected
              </span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleAction(true)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loading ? 'Executing...' : 'Confirm & Execute'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleAction(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
