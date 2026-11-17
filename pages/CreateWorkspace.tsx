import React from 'react';
import { Link } from 'react-router-dom';
import WorkspaceForm from '../components/auth/WorkspaceForm';
import { useAuth } from '../contexts/AuthContext';

const CreateWorkspace: React.FC = () => {
  const { canCreateWorkspace } = useAuth();

  if (!canCreateWorkspace) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-black mb-2">Workspace limit reached</h1>
          <p className="text-gray-500 mb-6">
            This account can create only one workspace.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex px-5 py-2 bg-black text-white rounded-full font-medium hover:bg-gray-800 transition-all"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-12 px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-black mb-2">Create a new workspace</h1>
        <p className="text-gray-500">
          Add another workspace to organize your contacts and deals separately.
        </p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
        <WorkspaceForm isNewWorkspace={true} />
      </div>
    </div>
  );
};

export default CreateWorkspace;
