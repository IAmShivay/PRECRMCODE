import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { listTasks, updateTaskStatus, type CrmTask } from '../lib/api-client';

const TYPE_LABEL: Record<string, string> = { follow_up: 'Follow-up', call: 'Call', meeting: 'Meeting', email: 'Email', other: 'Other' };

const parseSql = (value: string) => {
  const ms = Date.parse(value?.includes('T') ? value : `${String(value || '').replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : 0;
};
const formatDue = (value: string) => {
  const ms = parseSql(value);
  return ms ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ms) : '—';
};

const TasksPage: React.FC = () => {
  const { currentWorkspace, getUserRole } = useAuth();
  const { addToast } = useToast();
  const workspaceId = currentWorkspace?.id ?? 0;
  const isAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks(workspaceId, scope, status));
    } catch (err) {
      setError((err as Error).message || 'Could not load tasks');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, scope, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (task: CrmTask) => {
    const next = task.status === 'open' ? 'done' : 'open';
    try {
      await updateTaskStatus(workspaceId, task.id, next);
      setTasks((list) => list.filter((t) => t.id !== task.id));
      addToast('success', next === 'done' ? 'Task completed' : 'Task reopened');
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  };

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 px-1 pb-2 text-[15px] ${active ? 'border-[#3F7DF4] text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`;

  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7]">
      <div className="border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8 py-4">
        <h1 className="text-[15px] font-bold uppercase tracking-wide text-gray-800">Tasks</h1>
      </div>
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6">
        <section className="rounded-md border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-100">
            <div role="tablist" className="flex gap-6">
              <button role="tab" aria-selected={status === 'open'} className={tabClass(status === 'open')} onClick={() => setStatus('open')}>To do</button>
              <button role="tab" aria-selected={status === 'done'} className={tabClass(status === 'done')} onClick={() => setStatus('done')}>Completed</button>
            </div>
            {isAdmin && (
              <select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} className="mb-2 rounded border border-gray-300 px-2 py-1 text-sm" aria-label="Whose tasks">
                <option value="mine">My tasks</option>
                <option value="all">Everyone's tasks</option>
              </select>
            )}
          </div>

          {error && <p className="mt-4 rounded border border-[#F5C2C2] bg-[#FDECEC] px-3 py-2 text-sm text-[#9B1C1C]">{error}</p>}

          <ul className="divide-y divide-gray-100">
            {loading && <li className="py-6"><div className="h-10 rounded bg-gray-100 animate-pulse" /></li>}
            {!loading && tasks.length === 0 && !error && (
              <li className="py-10 text-center text-sm text-gray-500">{status === 'open' ? 'Nothing to do. Tasks created by you or by automations show up here.' : 'No completed tasks yet.'}</li>
            )}
            {!loading && tasks.map((task) => {
              const overdue = task.status === 'open' && parseSql(task.due_at) < Date.now();
              return (
                <li key={task.id} className="flex items-start gap-3 py-3.5">
                  <button
                    onClick={() => toggle(task)}
                    aria-label={task.status === 'open' ? 'Mark done' : 'Reopen'}
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${task.status === 'done' ? 'border-[#1E8E4E] bg-[#1E8E4E] text-white' : 'border-gray-300 hover:border-[#3F7DF4]'}`}
                  >
                    {task.status === 'done' && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
                    {task.description && <p className="mt-0.5 text-sm text-gray-500">{task.description}</p>}
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">{TYPE_LABEL[task.task_type] || task.task_type}</span>
                      <span className={overdue ? 'font-semibold text-[#C62828]' : ''}>Due {formatDue(task.due_at)}</span>
                      {task.lead_id > 0 && <Link to={`/leads/${task.lead_id}`} className="text-[#1F5FD6] hover:underline">Open lead</Link>}
                      {task.automation_id > 0 && <span>Created by an automation</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
};

export default TasksPage;
