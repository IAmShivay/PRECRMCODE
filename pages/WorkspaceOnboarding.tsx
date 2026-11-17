import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthLayout from '../components/auth/AuthLayout';
import WorkspaceForm from '../components/auth/WorkspaceForm';

const WorkspaceOnboarding: React.FC = () => {
  const { workspaces, isLoading } = useAuth();

  // Redirect to new workspace creation page if user already has workspaces
  if (!isLoading && workspaces.length > 0) {
    return <Navigate to="/workspaces/new" replace />;
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Set up your workspace to get started with Break the ice"
    >
      <WorkspaceForm />
    </AuthLayout>
  );
};

export default WorkspaceOnboarding;
