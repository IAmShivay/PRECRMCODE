import React from 'react';
import { SparklesIcon, UserIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import type { AiChatMessage } from '../types';
import { ToolActionCard } from './ToolActionCard';

interface ChatMessageItemProps {
  message: AiChatMessage;
  onActionResolved?: (status: 'confirmed' | 'rejected') => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  onActionResolved,
}) => {
  const isUser = message.role === 'user';

  const renderContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      const isBullet = line.trim().startsWith('- ');
      const isHeader = line.trim().startsWith('### ') || line.trim().startsWith('## ');

      const formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      if (isHeader) {
        return (
          <h4
            key={idx}
            className="my-1.5 font-semibold text-slate-900 dark:text-slate-100"
            dangerouslySetInnerHTML={{ __html: formatted.replace(/^#+\s*/, '') }}
          />
        );
      }
      if (isBullet) {
        return (
          <li
            key={idx}
            className="ml-4 list-disc text-slate-700 dark:text-slate-300"
            dangerouslySetInnerHTML={{ __html: formatted.replace(/^-\s*/, '') }}
          />
        );
      }
      if (!line.trim()) {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p
          key={idx}
          className="my-0.5 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatted }}
        />
      );
    });
  };

  return (
    <div className={`flex w-full gap-2.5 my-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-sm">
          <SparklesIcon className="h-4 w-4" />
        </div>
      )}

      <div
        className={`relative max-w-[85%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
          isUser
            ? 'rounded-tr-none bg-emerald-600 text-white'
            : 'rounded-tl-none border border-slate-200/80 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
        }`}
      >
        {message.tool_name && (
          <div className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <WrenchScrewdriverIcon className="h-3 w-3" />
            <span>Executed: {message.tool_name}</span>
          </div>
        )}

        <div className="space-y-0.5 break-words font-sans">
          {renderContent(message.content)}
        </div>

        {message.actionTicket && (
          <ToolActionCard ticket={message.actionTicket} onResolved={onActionResolved} />
        )}

        {message.timestamp && (
          <div
            className={`mt-1 text-right text-[10px] ${
              isUser ? 'text-emerald-100' : 'text-slate-400'
            }`}
          >
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
};
