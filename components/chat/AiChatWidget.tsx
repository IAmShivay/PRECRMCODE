import React, { useState } from 'react';
import { SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../contexts/AuthContext';
import { AiChatWindow } from './AiChatWindow';

export const AiChatWidget: React.FC = () => {
  const { currentWorkspace } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!currentWorkspace?.id) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen ? (
        <div className="flex h-[600px] w-96 flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl backdrop-blur-xl transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 sm:w-[420px]">
          <AiChatWindow
            workspaceId={currentWorkspace.id}
            onClose={() => setIsOpen(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-emerald-500/25 active:scale-95"
          title="Open Scraft AI Assistant"
        >
          <SparklesIcon className="h-6 w-6 transition-transform duration-300 group-hover:rotate-12" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
          </span>
        </button>
      )}
    </div>
  );
};
