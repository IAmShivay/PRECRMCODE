import { useWorkspaceAccess } from '../lib/useWorkspaceAccess';
import type { WorkspaceAccess } from '../types/permissions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatBubbleLeftRightIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { instagramRequest } from '../lib/api-client';
import ConversationAccessState from '../components/ConversationAccessState';
import type { InstagramConnectionView, InstagramConversation, InstagramConversationPage, InstagramMessagePage } from '../types/instagram';

function message(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

export default function InstagramIntegration() {
  const { currentWorkspace } = useAuth();
  const { access, error, errorStatus, retry } = useWorkspaceAccess(currentWorkspace?.id);
  if (!currentWorkspace) return <p className="p-6 text-gray-500">Select a workspace to view Instagram.</p>;
  if (!access) return <ConversationAccessState service="Instagram" error={error} errorStatus={errorStatus} onRetry={retry} />;
  if (access.permissions.conversations === 'none') return <p className="p-6 text-gray-500">Conversation access is disabled. Ask a workspace administrator for access.</p>;
  return <InstagramWorkspace key={`${currentWorkspace.id}:${access.permissions.conversations}`} workspaceId={currentWorkspace.id} access={access} />;
}

function InstagramWorkspace({ workspaceId, access }: { workspaceId: number; access: WorkspaceAccess }) {
  const { getUserRole } = useAuth();
  const canReply = access.permissions.conversations === 'reply';
  const isAdmin = getUserRole(workspaceId) === 'admin';
  const [connection, setConnection] = useState<InstagramConnectionView | null>(null);
  const [conversations, setConversations] = useState<InstagramConversation[]>([]);
  const [after, setAfter] = useState<string>();
  const [selected, setSelected] = useState<InstagramConversation | null>(null);
  const [page, setPage] = useState<InstagramMessagePage | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [callbackParams] = useState(() => new URLSearchParams(window.location.hash.slice(1) || window.location.search));
  const completion = useRef<Promise<InstagramConnectionView> | null>(null);

  const loadConversations = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    const data = await instagramRequest<InstagramConversationPage>(workspaceId, `conversations${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, { signal });
    setConversations(current => cursor ? [...current, ...data.conversations.filter(item => !current.some(previous => previous.id === item.id))] : data.conversations);
    setAfter(data.after);
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    const code = callbackParams.get('code');
    const state = callbackParams.get('state');
    const providerError = callbackParams.get('instagram_error');
    async function load() {
      try {
        let config: InstagramConnectionView;
        if (code && state) {
          window.history.replaceState({}, '', window.location.pathname);
          completion.current ??= instagramRequest<InstagramConnectionView>(workspaceId, 'oauth/complete', { method: 'POST', body: { code, state } });
          config = await completion.current;
        } else config = await instagramRequest<InstagramConnectionView>(workspaceId, 'connection', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setConnection(config);
        if (providerError) { setError(providerError); window.history.replaceState({}, '', window.location.pathname); }
        if (config.connected) await loadConversations(undefined, controller.signal);
      } catch (err) { if (!controller.signal.aborted) setError(message(err)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [workspaceId, loadConversations, callbackParams]);

  useEffect(() => {
    setPage(null); setDraft('');
    if (!selected) return;
    const controller = new AbortController();
    setReading(true);
    instagramRequest<InstagramMessagePage>(workspaceId, `conversations/${encodeURIComponent(selected.id)}/messages`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPage(data); }).catch(err => { if (!controller.signal.aborted) setError(message(err)); })
      .finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [workspaceId, selected]);

  async function connect() {
    setBusy(true); setError('');
    try { const result = await instagramRequest<{ url: string }>(workspaceId, 'oauth/start', { method: 'POST' }); window.location.assign(result.url); }
    catch (err) { setError(message(err)); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError('');
    try {
      await instagramRequest(workspaceId, 'connection', { method: 'DELETE' });
      setConnection(current => ({ configured: Boolean(current?.configured), connected: false }));
      setConversations([]); setSelected(null); setConfirmDisconnect(false);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function refresh(cursor?: string) {
    setBusy(true); setError('');
    try {
      await loadConversations(cursor);
      if (selected && !cursor) setPage(await instagramRequest<InstagramMessagePage>(workspaceId, `conversations/${encodeURIComponent(selected.id)}/messages`));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!canReply || !selected || !draft.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await instagramRequest(workspaceId, `conversations/${encodeURIComponent(selected.id)}/messages`, { method: 'POST', body: { text: draft.trim() } });
      setDraft('');
      setPage(await instagramRequest<InstagramMessagePage>(workspaceId, `conversations/${encodeURIComponent(selected.id)}/messages`));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  const title = (conversation: InstagramConversation) => conversation.participants?.data?.find(person => person.id !== connection?.account_id)?.username || 'Instagram conversation';
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><ChatBubbleLeftRightIcon className="w-7 h-7 text-gray-700" /><div><h1 className="text-2xl font-semibold text-gray-900">Instagram</h1><p className="text-sm text-gray-500">Conversations with your community, in one place.</p></div></div>
        {connection?.connected && <button type="button" disabled={busy} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><ArrowPathIcon className="h-4 w-4" />Refresh inbox</button>}
      </div>
      {!canReply && <p role="status" className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">Read-only access: you can view conversations. Replies are disabled by your workspace administrator.</p>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {loading ? <p className="text-gray-500">Loading Instagram…</p> : <>
        <section className="rounded-xl border border-gray-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="font-semibold text-gray-900">{connection?.connected ? `@${connection.username}` : 'Connect your professional account'}</h2>
            <p className="mt-1 text-sm text-gray-500">{connection?.connected ? (canReply ? 'Connected to this workspace. View recent messages and reply to customers.' : 'Connected to this workspace. View recent customer messages.') : 'Connect an Instagram business or creator account to receive and reply to DMs.'}</p>
            {!connection?.configured && <p className="mt-2 text-sm text-amber-700">Instagram setup is pending. Your administrator needs to enable the connection.</p>}
            {connection?.expires_at && Date.parse(connection.expires_at) < Date.now() && <p className="mt-2 text-sm text-amber-700">Access has expired. Reconnect to open your inbox.</p>}
          </div>
          {isAdmin && <div className="flex gap-2"><button disabled={busy || !connection?.configured} onClick={() => void connect()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{connection?.connected ? 'Reconnect Instagram' : 'Connect Instagram'}</button>
            {connection?.connected && <button disabled={busy} onClick={() => setConfirmDisconnect(true)} className="rounded-lg border px-4 py-2 text-sm">Disconnect</button>}</div>}
          {!isAdmin && !connection?.connected && <p className="text-sm text-gray-500">Ask a workspace administrator to connect Instagram.</p>}
        </section>
        {confirmDisconnect && <div role="alertdialog" aria-label="Disconnect Instagram" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>Remove this workspace’s Instagram connection and saved access token? Messages in Instagram will remain available.</p><div className="flex gap-3 mt-3"><button disabled={busy} onClick={() => void disconnect()} className="rounded-lg bg-gray-900 text-white px-4 py-2">Disconnect</button><button disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancel</button></div></div>}
        {connection?.connected ? <div className="grid md:grid-cols-[280px_1fr] border border-gray-200 bg-white rounded-xl overflow-hidden min-h-[480px]">
          <aside className="border-b md:border-b-0 md:border-r border-gray-200 max-h-[650px] overflow-y-auto"><h2 className="p-4 text-sm font-semibold border-b">Messages</h2>
            {conversations.length === 0 && <p className="p-4 text-sm text-gray-500">No conversations yet. Ask someone to send your account a DM, then refresh.</p>}
            {conversations.map(conversation => <button key={conversation.id} disabled={busy} onClick={() => { setSelected(conversation); setError(''); }} className={`w-full text-left px-4 py-4 border-b border-gray-100 hover:bg-gray-50 ${selected?.id === conversation.id ? 'bg-gray-100' : ''}`}><span className="block text-sm font-medium truncate">{title(conversation)}</span>{conversation.updated_time && <span className="text-xs text-gray-500">{new Date(conversation.updated_time).toLocaleString()}</span>}</button>)}
            {after && <button disabled={busy} onClick={() => void refresh(after)} className="w-full p-4 text-sm underline">Load more</button>}
          </aside>
          <section className="flex flex-col min-w-0">
            {!selected ? <div className="m-auto p-8 text-center text-gray-500 text-sm">{canReply ? 'Select a conversation to read and reply.' : 'Select a conversation to read.'}</div> : <>
              <h2 className="border-b p-4 font-medium">{title(selected)}</h2>
              <div className="flex-1 space-y-4 overflow-y-auto max-h-[440px] p-4">
                {reading ? <p className="text-sm text-gray-500">Loading messages…</p> : [...(page?.messages || [])].reverse().map(item => <div key={item.id} className={`flex ${item.from.id === connection.account_id ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-xl p-3 ${item.from.id === connection.account_id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}><p className="text-sm whitespace-pre-wrap break-words">{item.message || 'Attachment or shared content — view in Instagram.'}</p><p className="text-[11px] mt-2 opacity-60">{new Date(item.created_time).toLocaleString()}</p></div></div>)}
              </div>
              {canReply ? <form onSubmit={send} className="border-t p-4 space-y-3"><label htmlFor="instagram-reply" className="text-xs text-gray-500">{page?.can_reply ? 'Reply within 24 hours of the person’s latest message.' : 'A recent inbound message is needed to reply. Refresh after receiving a new DM.'}</label><textarea id="instagram-reply" aria-label="Reply message" rows={3} maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} disabled={!page?.can_reply || busy || reading} placeholder="Write a reply…" className="w-full rounded-lg border border-gray-300 p-3 text-sm disabled:bg-gray-50" /><div className="flex items-center justify-between"><span className="text-xs text-gray-400">{draft.length}/1000 · Recent 20 messages</span><button disabled={!page?.can_reply || !draft.trim() || busy || reading} className="rounded-lg bg-gray-900 px-5 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Please wait…' : 'Send reply'}</button></div></form> : <p className="border-t p-4 text-sm text-gray-500">You have read-only access to this conversation.</p>}
            </>}
          </section>
        </div> : <section className="rounded-xl bg-gray-50 border border-gray-200 p-6 text-sm text-gray-600"><h2 className="font-semibold text-gray-900 mb-2">How it works</h2><ol className="list-decimal pl-5 space-y-2"><li>A workspace administrator signs in with Instagram and grants profile and messaging access.</li><li>People send messages to your Instagram account as usual.</li><li>Your team reads and replies here. Customers start the conversation; replies are available within 24 hours.</li></ol><p className="mt-4">You can disconnect at any time. Message content is fetched from Instagram and is not saved in our database.</p></section>}
      </>}
    </div>
  );
}
