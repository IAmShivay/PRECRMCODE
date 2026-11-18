import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  PlusIcon,
  TrashIcon,
  ClipboardIcon,
  InboxArrowDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  listChannels,
  saveChannel,
  deleteChannel,
  listChannelConversations,
  listConversationMessages,
  listBots,
  CHANNEL_TYPES,
  type Channel,
  type ChannelType,
  type Conversation,
  type ConversationMessage,
  type Bot,
} from '../lib/api-client';
import { buildWidgetEmbedSnippet, buildWidgetScriptUrl, buildChannelDeepLink } from '../lib/webhookUrl';

const BLUE = 'bg-[#3F7DF4] hover:bg-[#2F6BE0] text-white';
const INPUT = 'w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#3F7DF4] focus:outline-none focus:ring-2 focus:ring-[#3F7DF4]/20';
const SAMPLE_VISITOR = 'VISITOR_UID';

const TYPE_LABEL: Record<ChannelType, string> = {
  live_chat: 'Live chat widget',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

const blankChannel = (workspaceId: number): Channel => ({
  workspace_id: workspaceId,
  type: 'live_chat',
  name: '',
  config: {},
  secret: '',
  bot_id: 0,
  active: true,
});

const ChannelsPage: React.FC = () => {
  const { currentWorkspace, getUserRole } = useAuth();
  const { addToast } = useToast();
  const workspaceId = currentWorkspace?.id ?? 0;
  const isAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [draft, setDraft] = useState<Channel | null>(null);
  const [inboxChannel, setInboxChannel] = useState<Channel | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const botName = useMemo(() => {
    const map = new Map<number, string>();
    bots.forEach((bot) => bot.id && map.set(bot.id, bot.name));
    return map;
  }, [bots]);

  const load = useCallback(async () => {
    if (!workspaceId || !isAdmin) return;
    setLoading(true);
    try {
      const [channelList, botList] = await Promise.all([listChannels(workspaceId), listBots(workspaceId)]);
      setChannels(channelList);
      setBots(botList);
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not load channels');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isAdmin, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = useCallback(
    (value: string) => {
      navigator.clipboard?.writeText(value).then(
        () => addToast('success', 'Copied to clipboard'),
        () => addToast('error', 'Could not copy')
      );
    },
    [addToast]
  );

  const onSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      addToast('error', 'Give the channel a name');
      return;
    }
    try {
      await saveChannel(draft);
      setDraft(null);
      await load();
      addToast('success', 'Channel saved');
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not save channel');
    }
  };

  const onDelete = async (channel: Channel) => {
    if (!channel.id || !window.confirm(`Delete channel "${channel.name}"?`)) return;
    try {
      await deleteChannel(workspaceId, channel.id);
      await load();
      addToast('success', 'Channel deleted');
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not delete channel');
    }
  };

  const openInbox = async (channel: Channel) => {
    setInboxChannel(channel);
    setActiveConversation(null);
    setMessages([]);
    try {
      setConversations(await listChannelConversations(workspaceId, channel.id!));
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not load conversations');
    }
  };

  const openConversation = async (conversation: Conversation) => {
    setActiveConversation(conversation);
    try {
      setMessages(await listConversationMessages(workspaceId, conversation.id));
    } catch (error) {
      addToast('error', (error as Error).message || 'Could not load messages');
    }
  };

  const shareFor = (channel: Channel): { label: string; value: string } => {
    if (channel.type === 'live_chat') {
      return { label: 'Embed snippet', value: buildWidgetEmbedSnippet(channel.id!) };
    }
    const handle = String(channel.config.handle || channel.config.phone || '');
    return {
      label: channel.type === 'whatsapp' ? 'wa.me link' : 't.me link',
      value: handle ? buildChannelDeepLink(channel.type, handle, SAMPLE_VISITOR) : 'Add a handle/phone in config to build a link',
    };
  };

  if (!currentWorkspace) return <div className="p-6 text-gray-600">Select a workspace to manage channels.</div>;
  if (!isAdmin) return <div className="p-6 text-gray-600">Channel management is available to workspace admins.</div>;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-6 w-6 text-[#3F7DF4]" />
          <h1 className="text-xl font-semibold text-gray-900">Channels</h1>
        </div>
        <button className={`inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm ${BLUE}`} onClick={() => setDraft(blankChannel(workspaceId))}>
          <PlusIcon className="h-4 w-4" /> New channel
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500 mb-3">Loading…</p>}

      <div className="grid gap-3">
        {channels.map((channel) => {
          const share = shareFor(channel);
          return (
            <div key={channel.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{channel.name || '(untitled)'}</p>
                  <p className="text-xs text-gray-500">
                    {TYPE_LABEL[channel.type]} · {channel.bot_id ? `Bot: ${botName.get(channel.bot_id) || channel.bot_id}` : 'No bot (inbox only)'} ·{' '}
                    {channel.active ? 'Active' : 'Off'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => openInbox(channel)}>
                    <InboxArrowDownIcon className="h-4 w-4" /> Inbox
                  </button>
                  <button className="inline-flex items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setDraft(channel)}>
                    Edit
                  </button>
                  <button className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => onDelete(channel)}>
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 rounded border border-gray-100 bg-gray-50 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">{share.label}</span>
                  <button className="inline-flex items-center gap-1 text-xs text-[#3F7DF4]" onClick={() => copy(share.value)}>
                    <ClipboardIcon className="h-3.5 w-3.5" /> Copy
                  </button>
                </div>
                <code className="mt-1 block break-all text-[11px] text-gray-700">{share.value}</code>
                {channel.type === 'live_chat' && (
                  <p className="mt-1 text-[11px] text-gray-400">Script URL: {buildWidgetScriptUrl(channel.id!)}</p>
                )}
              </div>
            </div>
          );
        })}
        {channels.length === 0 && !loading && <p className="text-sm text-gray-500">No channels yet. Create a live-chat widget to get started.</p>}
      </div>

      {draft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{draft.id ? 'Edit channel' : 'New channel'}</h2>
              <button onClick={() => setDraft(null)}><XMarkIcon className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
                <select className={INPUT} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ChannelType })}>
                  {CHANNEL_TYPES.map((type) => (
                    <option key={type} value={type}>{TYPE_LABEL[type]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Attached bot</label>
                <select className={INPUT} value={draft.bot_id} onChange={(e) => setDraft({ ...draft, bot_id: Number(e.target.value) })}>
                  <option value={0}>No bot (inbox only)</option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>{bot.name || `Bot ${bot.id}`}</option>
                  ))}
                </select>
              </div>
              {draft.type !== 'live_chat' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Handle / phone (for share link)</label>
                  <input
                    className={INPUT}
                    value={String(draft.config.handle || '')}
                    onChange={(e) => setDraft({ ...draft, config: { ...draft.config, handle: e.target.value } })}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700" onClick={() => setDraft(null)}>Cancel</button>
              <button className={`rounded px-3 py-2 text-sm ${BLUE}`} onClick={onSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {inboxChannel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setInboxChannel(null)}>
          <div className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-64 shrink-0 border-r border-gray-200 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-gray-200 p-3">
                <span className="text-sm font-semibold text-gray-900">{inboxChannel.name}</span>
                <button onClick={() => setInboxChannel(null)}><XMarkIcon className="h-5 w-5 text-gray-400" /></button>
              </div>
              {conversations.length === 0 && <p className="p-3 text-sm text-gray-500">No conversations yet.</p>}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`block w-full border-b border-gray-100 p-3 text-left text-sm hover:bg-gray-50 ${activeConversation?.id === conversation.id ? 'bg-[#EAF1FE]' : ''}`}
                  onClick={() => openConversation(conversation)}
                >
                  <span className="block font-medium text-gray-800">Visitor {conversation.visitor_uid.slice(0, 10)}</span>
                  <span className="block text-xs text-gray-500">{conversation.status} · lead {conversation.lead_id || '—'}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-col">
              <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4">
                {!activeConversation && <p className="text-sm text-gray-500">Select a conversation.</p>}
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${message.direction === 'out' ? 'bg-[#3F7DF4] text-white' : 'border border-gray-200 bg-white text-gray-800'}`}>
                      <span className="block whitespace-pre-wrap break-words">{message.text}</span>
                      {Array.isArray((message.payload as { buttons?: unknown[] })?.buttons) && (
                        <span className="mt-1 block text-[11px] opacity-80">
                          {((message.payload as { buttons: { title?: string }[] }).buttons).map((b) => b.title).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelsPage;
