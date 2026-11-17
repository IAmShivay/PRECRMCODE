import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BoltIcon,
  PlusIcon,
  XMarkIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  getPipelines,
  readPipelineConfiguration,
  getWorkspaceMembers,
  listBots,
  saveBot,
  deleteBot,
  runBot,
  listBotRuns,
  validateBotScript,
  BOT_HANDLER_TYPES,
  BOT_ACTION_NAMES,
  BOT_CONDITION_OPERATIONS,
  BOT_BLOCK_TYPES,
  BOT_STOP_ACTIONS,
  type Bot,
  type BotRun,
  type BotStep,
  type BotHandler,
  type BotHandlerType,
  type BotActionName,
  type BotBlockType,
  type BotTrigger,
  type WorkspaceMemberWithUser,
} from '../lib/api-client';

const BLUE = 'bg-[#3F7DF4] hover:bg-[#2F6BE0] text-white';
const OWNER = 'owner';
const INPUT = 'w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#3F7DF4] focus:outline-none focus:ring-2 focus:ring-[#3F7DF4]/20';

const TRIGGER_LABEL: Record<BotTrigger, string> = {
  deal_created: 'When a deal is created in this stage',
  deal_moved: 'When a deal is moved to this stage',
  deal_created_or_moved: 'When a deal is created in or moved to this stage',
  deal_owner_changed: 'When the owner changes',
  lead_created: 'When a new lead arrives',
};
const STAGE_TRIGGERS: BotTrigger[] = ['deal_created_or_moved', 'deal_moved', 'deal_created', 'deal_owner_changed'];

const HANDLER_LABEL: Record<BotHandlerType, string> = {
  show: 'Show a message',
  action: 'Run an action',
  condition: 'Condition (branch)',
  goto: 'Go to step',
  wait_answer: 'Wait for a reply',
  stop: 'Stop',
};
const ACTION_LABEL: Record<BotActionName, string> = {
  move_stage: 'Change stage',
  add_tags: 'Add tags',
  remove_tags: 'Remove tags',
  assign_owner: 'Change owner',
  create_task: 'Add task',
  send_email: 'Send email',
  send_whatsapp: 'Send WhatsApp template',
  send_webhook: 'Send webhook',
  notify_user: 'Notify a teammate',
};
const OPERATION_LABEL: Record<(typeof BOT_CONDITION_OPERATIONS)[number], string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  gt: 'greater than',
  lt: 'less than',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};
const BLOCK_LABEL: Record<BotBlockType, string> = {
  question: 'Question',
  answer: 'On reply',
  finish: 'Finish',
};
const RUN_STYLE: Record<BotRun['status'], string> = {
  done: 'bg-[#E6F6EC] text-[#1E8E4E]',
  stopped: 'bg-gray-100 text-gray-600',
  waiting: 'bg-[#FFF4E5] text-[#B7791F]',
  pending: 'bg-[#EAF1FE] text-[#1F5FD6]',
  running: 'bg-[#EAF1FE] text-[#1F5FD6]',
  failed: 'bg-[#FDECEC] text-[#C62828]',
};
const VARIABLES = ['{{lead.name}}', '{{lead.email}}', '{{lead.phone}}', '{{deal.name}}', '{{deal.value}}', '{{deal.stage}}'];

const csv = (value: unknown) => (Array.isArray(value) ? value.join(', ') : '');
const fromCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);
const str = (value: unknown) => String(value ?? '');

interface Stage { slug: string; name: string }
interface Pipeline { slug: string; name: string }

const emptyStep = (): BotStep => ({ question: [], answer: [], finish: [] });

const blankBot = (workspaceId: number, pipeline: string): Bot => ({
  workspace_id: workspaceId,
  name: '',
  pipeline_slug: pipeline,
  stage: '',
  trigger_type: 'deal_created_or_moved',
  conditions: {},
  script: [emptyStep()],
  active: true,
  sort_order: 0,
});

const blankHandler = (type: BotHandlerType): BotHandler => {
  switch (type) {
    case 'action':
      return { handler: 'action', params: { action: 'send_email', config: {} } };
    case 'condition':
      return { handler: 'condition', params: { term1: '', operation: 'equals', term2: '', result: [] } };
    case 'goto':
      return { handler: 'goto', params: { block: 'question', step: 0 } };
    case 'stop':
      return { handler: 'stop', params: { action: 'talk-close' } };
    case 'wait_answer':
      return { handler: 'wait_answer', params: {} };
    default:
      return { handler: 'show', params: { text: '' } };
  }
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm text-gray-700">{label}</span>
    <span className="mt-1 block">{children}</span>
    {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
  </label>
);

interface EditorShared {
  stages: Stage[];
  members: WorkspaceMemberWithUser[];
  stepCount: number;
}

const ActionConfigEditor: React.FC<{ action: BotActionName; config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void } & EditorShared> = ({
  action,
  config,
  onChange,
  stages,
  members,
}) => {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  switch (action) {
    case 'send_email':
      return (
        <>
          <Field label="Subject"><input className={INPUT} value={str(config.subject)} onChange={(e) => set('subject', e.target.value)} /></Field>
          <Field label="Message" hint={`Variables: ${VARIABLES.join(' ')}`}>
            <textarea rows={4} className={INPUT} value={str(config.body)} onChange={(e) => set('body', e.target.value)} />
          </Field>
        </>
      );
    case 'send_whatsapp':
      return (
        <>
          <Field label="Approved template name"><input className={INPUT} value={str(config.template_name)} onChange={(e) => set('template_name', e.target.value)} /></Field>
          <Field label="Language code"><input className={INPUT} value={str(config.language || 'en')} onChange={(e) => set('language', e.target.value)} /></Field>
          <Field label="Template variables" hint="Comma separated"><input className={INPUT} value={csv(config.params)} onChange={(e) => set('params', fromCsv(e.target.value))} /></Field>
        </>
      );
    case 'move_stage':
      return (
        <Field label="Move to stage">
          <select className={INPUT} value={str(config.stage)} onChange={(e) => set('stage', e.target.value)}>
            <option value="">Choose a stage</option>
            {stages.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
        </Field>
      );
    case 'assign_owner':
      return (
        <Field label="New owner">
          <select className={INPUT} value={str(config.user_id)} onChange={(e) => set('user_id', Number(e.target.value) || '')}>
            <option value="">Choose a teammate</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
          </select>
        </Field>
      );
    case 'add_tags':
    case 'remove_tags':
      return <Field label="Tags" hint="Comma separated"><input className={INPUT} value={csv(config.tags)} onChange={(e) => set('tags', fromCsv(e.target.value))} /></Field>;
    case 'create_task':
      return (
        <>
          <Field label="Task"><input className={INPUT} value={str(config.title)} onChange={(e) => set('title', e.target.value)} placeholder="Call {{lead.name}}" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className={INPUT} value={str(config.task_type || 'follow_up')} onChange={(e) => set('task_type', e.target.value)}>
                <option value="follow_up">Follow-up</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Due">
              <select className={INPUT} value={str(config.due_in_minutes || 0)} onChange={(e) => set('due_in_minutes', Number(e.target.value))}>
                <option value={0}>Immediately</option><option value={60}>In 1 hour</option><option value={1440}>In 1 day</option><option value={4320}>In 3 days</option>
              </select>
            </Field>
          </div>
          <Field label="Assign to">
            <select className={INPUT} value={str(config.assign_to || OWNER)} onChange={(e) => set('assign_to', e.target.value === OWNER ? OWNER : Number(e.target.value))}>
              <option value={OWNER}>The deal or lead owner</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
            </select>
          </Field>
        </>
      );
    case 'notify_user':
      return (
        <>
          <Field label="Who">
            <select className={INPUT} value={str(config.user || OWNER)} onChange={(e) => set('user', e.target.value === OWNER ? OWNER : Number(e.target.value))}>
              <option value={OWNER}>The deal or lead owner</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user?.name || `User ${m.user_id}`}</option>)}
            </select>
          </Field>
          <Field label="Message" hint={`Variables: ${VARIABLES.join(' ')}`}><textarea rows={3} className={INPUT} value={str(config.message)} onChange={(e) => set('message', e.target.value)} /></Field>
        </>
      );
    case 'send_webhook':
      return <Field label="URL" hint="Public https:// address"><input className={INPUT} value={str(config.url)} onChange={(e) => set('url', e.target.value)} placeholder="https://" /></Field>;
    default:
      return null;
  }
};

const HandlerEditor: React.FC<{ handler: BotHandler; onChange: (handler: BotHandler) => void; onRemove: () => void; allowNested: boolean } & EditorShared> = ({
  handler,
  onChange,
  onRemove,
  allowNested,
  stages,
  members,
  stepCount,
}) => {
  const setParam = (key: string, value: unknown) => onChange({ ...handler, params: { ...handler.params, [key]: value } });
  const params = handler.params;
  const nested = Array.isArray(params.result) ? (params.result as BotHandler[]) : [];
  const setNested = (list: BotHandler[]) => setParam('result', list);

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{HANDLER_LABEL[handler.handler]}</span>
        <button type="button" onClick={onRemove} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-[#C62828]" aria-label="Remove step action">
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 space-y-3">
        {handler.handler === 'show' && (
          <Field label="Message" hint={`Variables: ${VARIABLES.join(' ')}`}><textarea rows={3} className={INPUT} value={str(params.text)} onChange={(e) => setParam('text', e.target.value)} /></Field>
        )}

        {handler.handler === 'action' && (
          <>
            <Field label="Action">
              <select
                className={INPUT}
                value={str(params.action || 'send_email')}
                onChange={(e) => onChange({ ...handler, params: { action: e.target.value as BotActionName, config: {} } })}
              >
                {BOT_ACTION_NAMES.map((name) => <option key={name} value={name}>{ACTION_LABEL[name]}</option>)}
              </select>
            </Field>
            <ActionConfigEditor
              action={(str(params.action || 'send_email')) as BotActionName}
              config={(params.config as Record<string, unknown>) || {}}
              onChange={(config) => setParam('config', config)}
              stages={stages}
              members={members}
              stepCount={stepCount}
            />
          </>
        )}

        {handler.handler === 'condition' && (
          <>
            <Field label="If this value" hint="Supports variables, e.g. {{deal.stage}}"><input className={INPUT} value={str(params.term1)} onChange={(e) => setParam('term1', e.target.value)} /></Field>
            <Field label="Comparison">
              <select className={INPUT} value={str(params.operation || 'equals')} onChange={(e) => setParam('operation', e.target.value)}>
                {BOT_CONDITION_OPERATIONS.map((op) => <option key={op} value={op}>{OPERATION_LABEL[op]}</option>)}
              </select>
            </Field>
            <Field label="This value"><input className={INPUT} value={str(params.term2)} onChange={(e) => setParam('term2', e.target.value)} /></Field>
            {allowNested && (
              <div className="rounded-md border border-dashed border-gray-300 p-2.5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Then run (when the condition is met)</p>
                <HandlerList handlers={nested} onChange={setNested} allowNested={false} stages={stages} members={members} stepCount={stepCount} />
              </div>
            )}
          </>
        )}

        {handler.handler === 'goto' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Block">
              <select className={INPUT} value={str(params.block || 'question')} onChange={(e) => setParam('block', e.target.value)}>
                {BOT_BLOCK_TYPES.map((block) => <option key={block} value={block}>{BLOCK_LABEL[block]}</option>)}
              </select>
            </Field>
            <Field label="Step number" hint={`1–${stepCount}`}>
              <input
                type="number"
                min={1}
                max={stepCount}
                className={INPUT}
                value={Number(params.step ?? 0) + 1}
                onChange={(e) => setParam('step', Math.max(0, (Number(e.target.value) || 1) - 1))}
              />
            </Field>
          </div>
        )}

        {handler.handler === 'wait_answer' && (
          <p className="text-xs text-gray-500">Pauses the bot until the contact replies. The run status becomes &quot;waiting&quot; until a reply arrives (Phase C).</p>
        )}

        {handler.handler === 'stop' && (
          <>
            <Field label="On stop">
              <select className={INPUT} value={str(params.action || 'talk-close')} onChange={(e) => setParam('action', e.target.value)}>
                {BOT_STOP_ACTIONS.map((a) => <option key={a} value={a}>{a === 'talk-close' ? 'End the bot' : 'Launch another bot'}</option>)}
              </select>
            </Field>
            {str(params.action) === 'salesbot-start' && (
              <Field label="Bot to launch" hint="The numeric ID of the bot to start next"><input className={INPUT} value={str(params.bot_id)} onChange={(e) => setParam('bot_id', e.target.value)} placeholder="e.g. 42" /></Field>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const HandlerList: React.FC<{ handlers: BotHandler[]; onChange: (list: BotHandler[]) => void; allowNested: boolean } & EditorShared> = ({
  handlers,
  onChange,
  allowNested,
  stages,
  members,
  stepCount,
}) => {
  const update = (index: number, next: BotHandler) => onChange(handlers.map((h, i) => (i === index ? next : h)));
  const remove = (index: number) => onChange(handlers.filter((_, i) => i !== index));
  const pickable = allowNested ? BOT_HANDLER_TYPES : BOT_HANDLER_TYPES.filter((t) => t !== 'condition');
  return (
    <div className="space-y-2">
      {handlers.map((handler, index) => (
        <HandlerEditor
          key={index}
          handler={handler}
          onChange={(next) => update(index, next)}
          onRemove={() => remove(index)}
          allowNested={allowNested}
          stages={stages}
          members={members}
          stepCount={stepCount}
        />
      ))}
      <select
        className={`${INPUT} text-gray-600`}
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          onChange([...handlers, blankHandler(e.target.value as BotHandlerType)]);
        }}
      >
        <option value="">+ Add a step action…</option>
        {pickable.map((type) => <option key={type} value={type}>{HANDLER_LABEL[type]}</option>)}
      </select>
    </div>
  );
};

const BotBuilderPage: React.FC = () => {
  const { currentWorkspace, getUserRole } = useAuth();
  const { addToast } = useToast();
  const workspaceId = currentWorkspace?.id ?? 0;
  const isAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;

  const [tab, setTab] = useState<'bots' | 'log'>('bots');
  const [pipelines, setPipelines] = useState<Pipeline[]>([{ slug: 'default', name: 'Default' }]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberWithUser[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [launchDealId, setLaunchDealId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadBots = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setBots(await listBots(workspaceId));
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not load bots');
    }
  }, [workspaceId, addToast]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      getPipelines(workspaceId).then((list) => {
        const mapped = (list || []).map((p: { slug?: unknown; name?: unknown }) => ({ slug: String(p.slug), name: String(p.name || p.slug) }));
        if (mapped.length) setPipelines(mapped);
      }).catch(() => undefined),
      getWorkspaceMembers(workspaceId).then((res) => setMembers(res.data || [])).catch(() => undefined),
      loadBots(),
    ]).finally(() => setLoading(false));
  }, [workspaceId, loadBots]);

  const pipelineSlug = editing?.pipeline_slug || pipelines[0]?.slug || 'default';
  useEffect(() => {
    if (!workspaceId) return;
    readPipelineConfiguration(workspaceId, pipelineSlug)
      .then((config) => setStages((config?.stages || []).map((s) => ({ slug: s.slug, name: s.name }))))
      .catch(() => setStages([]));
  }, [workspaceId, pipelineSlug]);

  useEffect(() => {
    if (tab !== 'log' || !workspaceId) return;
    listBotRuns(workspaceId).then(setRuns).catch((error) => addToast('error', (error as Error).message));
  }, [tab, workspaceId, addToast]);

  const botName = useCallback((id: number) => bots.find((b) => b.id === id)?.name || `Bot #${id}`, [bots]);

  const scriptErrors = useMemo(() => (editing ? validateBotScript(editing.script) : []), [editing]);
  const sourceJson = useMemo(() => (editing ? JSON.stringify(editing.script, null, 2) : ''), [editing]);

  if (!isAdmin) {
    return (
      <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7] p-8">
        <p className="rounded-md border border-gray-200 bg-white p-6 text-gray-700">Only workspace admins can manage bots.</p>
      </div>
    );
  }

  const set = <K extends keyof Bot>(key: K, value: Bot[K]) => setEditing((current) => (current ? { ...current, [key]: value } : current));
  const setBlock = (stepIndex: number, block: BotBlockType, handlers: BotHandler[]) =>
    setEditing((current) => (current ? { ...current, script: current.script.map((step, i) => (i === stepIndex ? { ...step, [block]: handlers } : step)) } : current));
  const addStep = () => setEditing((current) => (current ? { ...current, script: [...current.script, emptyStep()] } : current));
  const removeStep = (index: number) => setEditing((current) => (current ? { ...current, script: current.script.filter((_, i) => i !== index) } : current));
  const moveStep = (index: number, delta: number) =>
    setEditing((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.script.length) return current;
      const next = [...current.script];
      const [removed] = next.splice(index, 1);
      next.splice(target, 0, removed as BotStep);
      return { ...current, script: next };
    });

  const submit = async () => {
    if (!editing) return;
    if (scriptErrors.length) {
      addToast('error', scriptErrors[0] || 'Fix the script before saving');
      return;
    }
    setSaving(true);
    try {
      await saveBot({ ...editing, name: editing.name.trim() || 'Untitled bot' });
      addToast('success', 'Bot saved');
      setEditing(null);
      await loadBots();
    } catch (error) {
      addToast('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    try {
      await deleteBot(workspaceId, editing.id);
      addToast('success', 'Bot deleted');
      setEditing(null);
      await loadBots();
    } catch (error) {
      addToast('error', (error as Error).message);
    }
  };

  const launch = async () => {
    if (!editing?.id) return;
    const dealId = Number(launchDealId);
    if (!dealId) {
      addToast('error', 'Enter a deal ID to launch on');
      return;
    }
    try {
      const run = await runBot(workspaceId, editing.id, dealId);
      addToast('success', `Launched bot run #${run.id} on deal #${dealId}`);
    } catch (error) {
      addToast('error', (error as Error).message);
    }
  };

  return (
    <div className="-m-4 sm:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-[#F2F4F7]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center gap-6">
          <h1 className="flex items-center gap-2 text-[15px] font-bold uppercase tracking-wide text-gray-800"><BoltIcon className="h-5 w-5 text-[#3F7DF4]" /> Bots</h1>
          <div role="tablist" className="flex gap-5">
            {(['bots', 'log'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-3 border-b-2 pb-2.5 text-[15px] ${tab === key ? 'border-[#3F7DF4] text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
              >
                {key === 'bots' ? 'Bots' : 'Run log'}
              </button>
            ))}
          </div>
        </div>
        {tab === 'bots' && (
          <button type="button" onClick={() => { setEditing(blankBot(workspaceId, pipelines[0]?.slug || 'default')); setShowSource(false); setLaunchDealId(''); }} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold ${BLUE}`}>
            <PlusIcon className="h-4 w-4" /> New bot
          </button>
        )}
      </div>

      {tab === 'bots' ? (
        <div className="px-4 sm:px-6 lg:px-8 py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {loading && <div className="h-24 rounded-md bg-gray-100 animate-pulse" />}
            {!loading && bots.length === 0 && (
              <p className="col-span-full rounded-md border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No bots yet. Create one to script a multi-step flow.</p>
            )}
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => { setEditing(bot); setShowSource(false); setLaunchDealId(''); }}
                className={`rounded-md border p-4 text-left ${bot.active ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-white opacity-70'}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><BoltIcon className="h-4 w-4 text-[#3F7DF4]" /> {bot.name || 'Untitled bot'}</span>
                <span className="mt-1 block text-xs text-gray-500">{TRIGGER_LABEL[bot.trigger_type]}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{bot.script.length} step{bot.script.length === 1 ? '' : 's'} · {bot.active ? 'On' : 'Off'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-5">
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Bot</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Cursor</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No runs yet. Launch a bot to see its cursor progress here.</td></tr>
                )}
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{run.run_at}</td>
                    <td className="px-4 py-2.5 text-gray-900">{botName(run.bot_id)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{run.entity_type} #{run.entity_id}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{run.cursor}</td>
                    <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${RUN_STYLE[run.status] || RUN_STYLE.stopped}`}>{run.status}</span></td>
                    <td className="px-4 py-2.5 text-gray-600">{run.error || run.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/30" onClick={() => setEditing(null)}>
          <aside role="dialog" aria-modal="true" aria-label="Edit bot" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><BoltIcon className="h-5 w-5 text-[#3F7DF4]" /> {editing.id ? 'Edit bot' : 'New bot'}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowSource((v) => !v)} className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-sm ${showSource ? 'border-[#3F7DF4] text-[#1F5FD6]' : 'border-gray-300 text-gray-700'}`}>
                  <CodeBracketIcon className="h-4 w-4" /> View source
                </button>
                <button onClick={() => setEditing(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close"><XMarkIcon className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <Field label="Name"><input className={INPUT} value={editing.name} onChange={(e) => set('name', e.target.value)} placeholder="Untitled bot" /></Field>

              <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold text-gray-900">Trigger</legend>
                <Field label="Launch when">
                  <select className={INPUT} value={editing.trigger_type} onChange={(e) => set('trigger_type', e.target.value as BotTrigger)}>
                    {STAGE_TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
                  </select>
                </Field>
                <Field label="Pipeline">
                  <select className={INPUT} value={editing.pipeline_slug} onChange={(e) => set('pipeline_slug', e.target.value)}>
                    {pipelines.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Stage" hint="Leave as Any to match every stage">
                  <select className={INPUT} value={editing.stage} onChange={(e) => set('stage', e.target.value)}>
                    <option value="">Any stage</option>
                    {stages.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 self-end text-sm text-gray-700">
                  <input type="checkbox" className="accent-[#3F7DF4]" checked={editing.active} onChange={(e) => set('active', e.target.checked)} /> Bot is on
                </label>
              </fieldset>

              {showSource ? (
                <div className="space-y-2">
                  {scriptErrors.length > 0 && (
                    <div className="rounded-md border border-[#F5C2C2] bg-[#FDECEC] px-3 py-2 text-sm text-[#9B1C1C]">
                      {scriptErrors.map((err, i) => <p key={i}>{err}</p>)}
                    </div>
                  )}
                  <pre className="max-h-[60vh] overflow-auto rounded-md border border-gray-200 bg-[#0F172A] p-4 text-xs text-[#E2E8F0]">{sourceJson}</pre>
                </div>
              ) : (
                <div className="space-y-4">
                  {editing.script.map((step, index) => (
                    <section key={index} className="rounded-md border border-gray-200 bg-[#F8FAFC] p-4">
                      <header className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900">Step {index + 1}</span>
                        <span className="flex items-center gap-1">
                          <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30" aria-label="Move step up"><ChevronUpIcon className="h-4 w-4" /></button>
                          <button type="button" onClick={() => moveStep(index, 1)} disabled={index === editing.script.length - 1} className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30" aria-label="Move step down"><ChevronDownIcon className="h-4 w-4" /></button>
                          <button type="button" onClick={() => removeStep(index)} disabled={editing.script.length === 1} className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-[#C62828] disabled:opacity-30" aria-label="Remove step"><TrashIcon className="h-4 w-4" /></button>
                        </span>
                      </header>
                      <div className="space-y-4">
                        {BOT_BLOCK_TYPES.map((block) => (
                          <div key={block}>
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{BLOCK_LABEL[block]}</p>
                            <HandlerList
                              handlers={step[block]}
                              onChange={(list) => setBlock(index, block, list)}
                              allowNested
                              stages={stages}
                              members={members}
                              stepCount={editing.script.length}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                  <button type="button" onClick={addStep} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-2.5 text-sm text-gray-600 hover:border-[#3F7DF4] hover:text-[#1F5FD6]">
                    <PlusIcon className="h-4 w-4" /> Add step
                  </button>
                </div>
              )}

              {editing.id && (
                <fieldset className="flex items-end gap-2 rounded-md border border-gray-200 p-4">
                  <legend className="px-1 text-sm font-semibold text-gray-900">Test launch</legend>
                  <Field label="Deal ID"><input className={INPUT} value={launchDealId} onChange={(e) => setLaunchDealId(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 123" /></Field>
                  <button type="button" onClick={launch} className="mb-0.5 flex items-center gap-1.5 rounded border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"><PlayIcon className="h-4 w-4" /> Launch</button>
                </fieldset>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3.5">
              {editing.id ? <button onClick={remove} className="rounded px-3 py-1.5 text-sm font-semibold text-[#C62828] hover:bg-[#FDECEC]">Delete</button> : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50">Cancel</button>
                <button onClick={submit} disabled={saving || scriptErrors.length > 0} className={`rounded px-4 py-1.5 text-sm font-semibold disabled:opacity-60 ${BLUE}`}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default BotBuilderPage;
