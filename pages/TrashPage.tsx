import { useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LeadsTable from '../components/LeadsTable';

export default function TrashPage() {
  const { currentWorkspace } = useAuth();
  const tableRef = useRef<{ refresh: () => void }>(null);

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Please select a workspace to view trash.</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-white">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-2 sm:py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-semibold text-gray-900 leading-tight">Trash</h1>
          <span className="hidden sm:inline text-xs text-gray-400 font-normal">{currentWorkspace.name}</span>
        </div>

        <div className="bg-white">
          <LeadsTable
            ref={tableRef}
            workspaceId={currentWorkspace.id}
            showDeleted={true}
          />
        </div>
      </div>
    </div>
  );
}
