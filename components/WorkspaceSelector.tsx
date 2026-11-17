import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import {
  MagnifyingGlassIcon,
  CheckIcon,
  PlusIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface WorkspaceSelectorProps {
  collapsed?: boolean;
}

const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ collapsed = false }) => {
  const { workspaces, currentWorkspace, canCreateWorkspace, setCurrentWorkspace, getUserRole } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [workspaceLeadCounts, setWorkspaceLeadCounts] = useState<Record<number, number | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceLeadCountsRef = useRef(workspaceLeadCounts);
  const countsRequestInFlightRef = useRef(false);
  const workspaceInitial = (currentWorkspace?.name || '').trim().charAt(0).toUpperCase();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    workspaceLeadCountsRef.current = workspaceLeadCounts;
  }, [workspaceLeadCounts]);

  useEffect(() => {
    if (!isOpen) return;
    const token = getAuthToken();
    if (!token) return;
    if (countsRequestInFlightRef.current) return;
    const allWorkspaces = workspaces || [];
    const missing = allWorkspaces.filter((w) => workspaceLeadCountsRef.current[w.id] === undefined);
    if (missing.length === 0) return;
    countsRequestInFlightRef.current = true;
    let isActive = true;
    Promise.all(
      missing.map(async (workspace) => {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/leads?workspace_id=${workspace.id}&limit=10000&includeTotal=true`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!response.ok) {
            throw new Error(`Failed to fetch leads for workspace ${workspace.id}`);
          }
          const data = await response.json();
          let count: number | null = null;
          if (data?.status === 'success') {
            if (data?.metadata && typeof data.metadata.total === 'number') {
              count = data.metadata.total;
            } else if (Array.isArray(data?.data)) {
              count = data.data.length;
            } else {
              count = 0;
            }
          }
          if (!isActive) return;
          setWorkspaceLeadCounts((prev) => ({ ...prev, [workspace.id]: count }));
        } catch {
          if (!isActive) return;
          setWorkspaceLeadCounts((prev) => ({ ...prev, [workspace.id]: null }));
        }
      })
    ).finally(() => {
      countsRequestInFlightRef.current = false;
    });
    return () => {
      isActive = false;
    };
  }, [isOpen, workspaces]);

  const filteredWorkspaces = (workspaces || []).filter((w) =>
    w.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleWorkspaceClick = (workspaceId: number) => {
    setCurrentWorkspace(workspaceId);
    setIsOpen(false);
    setSearchTerm('');
    navigate(getUserRole(workspaceId) === 'admin' ? `/workspace/${workspaceId}/sources` : '/leads');
  };

  const handleNewWorkspace = () => {
    setIsOpen(false);
    setSearchTerm('');
    navigate('/workspaces/new');
  };

  if (collapsed) {
    return (
      <div className="relative flex justify-center" ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          title={currentWorkspace?.name || 'Select Workspace'}
          className="w-9 h-9 bg-black rounded-lg flex items-center justify-center text-white font-medium text-sm hover:bg-gray-800 focus:outline-none"
        >
          {workspaceInitial || 'W'}
        </button>
        {isOpen && (
          <div className="absolute left-10 top-0 w-72 bg-white rounded-lg shadow-xl border border-gray-100 py-2 z-50">
            <div className="px-3 pb-2 border-b border-gray-100">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search workspaces"
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Workspaces
              </div>
              {filteredWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  onClick={() => handleWorkspaceClick(workspace.id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50 group"
                >
                  <div className="flex items-center min-w-0">
                    {currentWorkspace?.id === workspace.id && (
                      <CheckIcon className="w-4 h-4 text-gray-900 mr-2 flex-shrink-0" />
                    )}
                    <span
                      className={`text-sm truncate ${
                        currentWorkspace?.id === workspace.id
                          ? 'font-medium text-gray-900 ml-0'
                          : 'text-gray-700 ml-6'
                      }`}
                    >
                      {workspace.name}
                    </span>
                  </div>
                  <span className="bg-green-500 text-white text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ml-2">
                    {workspaceLeadCounts[workspace.id] === undefined
                      ? '…'
                      : workspaceLeadCounts[workspace.id] === null
                        ? '—'
                        : workspaceLeadCounts[workspace.id]}
                  </span>
                </button>
              ))}
            </div>
            {canCreateWorkspace && (
              <div className="border-t border-gray-100 pt-1 mt-1">
                <button
                  onClick={handleNewWorkspace}
                  className="w-full text-left px-3 py-2 flex items-center text-sm text-gray-700 hover:bg-gray-50"
                >
                  <PlusIcon className="w-4 h-4 mr-2 text-gray-400" />
                  New Workspace
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors focus:outline-none"
      >
        <div className="flex items-center min-w-0">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
            {workspaceInitial || 'W'}
          </div>
          <div className="ml-2.5 min-w-0 text-left">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider leading-none">
              Workspace
            </div>
            <div className="text-sm font-medium text-gray-900 truncate max-w-[150px] mt-0.5">
              {currentWorkspace?.name || 'Select Workspace'}
            </div>
          </div>
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-gray-400 flex-shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-100 py-2 z-50">
          <div className="px-3 pb-2 border-b border-gray-100">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search workspaces"
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Workspaces
            </div>
            {filteredWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => handleWorkspaceClick(workspace.id)}
                className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50 group"
              >
                <div className="flex items-center min-w-0">
                  {currentWorkspace?.id === workspace.id && (
                    <CheckIcon className="w-4 h-4 text-gray-900 mr-2 flex-shrink-0" />
                  )}
                  <span
                    className={`text-sm truncate ${
                      currentWorkspace?.id === workspace.id
                        ? 'font-medium text-gray-900 ml-0'
                        : 'text-gray-700 ml-6'
                    }`}
                  >
                    {workspace.name}
                  </span>
                </div>
                <span className="bg-green-500 text-white text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ml-2">
                  {workspaceLeadCounts[workspace.id] === undefined
                    ? '…'
                    : workspaceLeadCounts[workspace.id] === null
                      ? '—'
                      : workspaceLeadCounts[workspace.id]}
                </span>
              </button>
            ))}
          </div>
          {canCreateWorkspace && (
            <div className="border-t border-gray-100 pt-1 mt-1">
              <button
                onClick={handleNewWorkspace}
                className="w-full text-left px-3 py-2 flex items-center text-sm text-gray-700 hover:bg-gray-50"
              >
                <PlusIcon className="w-4 h-4 mr-2 text-gray-400" />
                New Workspace
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSelector;
