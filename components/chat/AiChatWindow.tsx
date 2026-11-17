import React, { useState, useRef, useEffect } from 'react';
import {
  SparklesIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import type { AiChatMessage, AiStreamEvent } from '../types';
import { streamAiChat } from '../../lib/aiChatClient';
import { ChatMessageItem } from './ChatMessageItem';

interface AiChatWindowProps {
  workspaceId: number;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  'Show pipeline summary',
  'List recent deals',
  'Search leads',
  'What deals are in Proposal stage?',
];

export const AiChatWindow: React.FC<AiChatWindowProps> = ({ workspaceId, onClose }) => {
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello! I am your **Scraft CRM AI Assistant**.\nI can query your pipeline, search leads, check deal stage requirements, verify emails, or trigger WhatsApp follow-ups.\nHow can I help you today?',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeTool, isStreaming]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isStreaming) return;

    setInputText('');
    setStreamError(null);

    const userMessage: AiChatMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    const assistantPlaceholderId = `asst_${Date.now()}`;
    const initialAssistantMessage: AiChatMessage = {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
    setIsStreaming(true);

    try {
      await streamAiChat(
        workspaceId,
        text,
        messages,
        (event: AiStreamEvent) => {
          if (event.type === 'delta' && event.text) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantPlaceholderId
                  ? { ...msg, content: msg.content + event.text }
                  : msg
              )
            );
          } else if (event.type === 'tool_start') {
            setActiveTool(event.tool || 'CRM tool');
          } else if (event.type === 'tool_end') {
            setActiveTool(null);
            if (event.tool) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantPlaceholderId
                    ? { ...msg, tool_name: event.tool }
                    : msg
                )
              );
            }
          } else if (event.type === 'action_required' && event.ticket) {
            setActiveTool(null);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantPlaceholderId
                  ? { ...msg, actionTicket: event.ticket }
                  : msg
              )
            );
          } else if (event.type === 'error' && event.message) {
            setStreamError(event.message);
          } else if (event.type === 'done') {
            setActiveTool(null);
          }
        }
      );
    } catch (err: any) {
      setStreamError(err?.message || 'Failed to communicate with AI Assistant');
    } finally {
      setIsStreaming(false);
      setActiveTool(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'welcome_reset',
        role: 'assistant',
        content: 'Session cleared. How can I help you today?',
        timestamp: new Date().toISOString(),
      },
    ]);
    setStreamError(null);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200/80 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-sm">
            <SparklesIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900 text-sm dark:text-slate-100">
                Scraft AI Assistant
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                MCP
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Grok + CRM Tools
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearHistory}
            title="Clear Chat History"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close Assistant"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.map((message) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            onActionResolved={() => {
              handleSendMessage('I have confirmed the action. What is the updated status?');
            }}
          />
        ))}

        {activeTool && (
          <div className="flex items-center gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3.5 py-2 text-xs text-teal-800 dark:text-teal-300">
            <WrenchScrewdriverIcon className="h-4 w-4 animate-spin text-teal-600" />
            <span>Executing MCP tool: <strong>{activeTool}</strong>...</span>
          </div>
        )}

        {streamError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
            {streamError}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSendMessage(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-emerald-500 dark:hover:bg-slate-700"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="relative flex items-end rounded-2xl border border-slate-300 bg-slate-50 p-1.5 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950">
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            disabled={isStreaming}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about deals, leads, metrics, or take actions..."
            className="max-h-28 flex-1 resize-none bg-transparent px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
          />
          <button
            type="button"
            disabled={!inputText.trim() || isStreaming}
            onClick={() => handleSendMessage()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            <PaperAirplaneIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
