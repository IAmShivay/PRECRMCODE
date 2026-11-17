import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import SignupForm from '../components/auth/SignupForm';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';

const SignupWithInvite: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [invitationData, setInvitationData] = useState<{
    workspaceName: string;
    inviterName: string;
    email: string;
    workspaceId: number;
    userExists?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshWorkspaces } = useAuth();

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link. No token provided.');
      setLoading(false);
      return;
    }

    // Validate invitation token
    const validateInvitation = async () => {
      try {
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
        const response = await fetch(`${apiBaseUrl}/api/invitations/${token}/validate`, {
          method: 'GET',
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
          setInvitationData(data.data);
          // If already authenticated, accept immediately without requiring signup
          const authed = getAuthToken();
          if (!authed && data.data?.userExists) {
            navigate('/login', { state: { from: location }, replace: true });
            return;
          }
          if (authed) {
            try {
              const acceptRes = await fetch(`${apiBaseUrl}/api/invitations/${token}/accept`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${authed}`,
                },
              });
              const acceptData = await acceptRes.json();
              if (acceptRes.ok && acceptData.status === 'success') {
                const workspaceId = data.data?.workspaceId;
                if (workspaceId) {
                  await refreshWorkspaces(workspaceId);
                  navigate('/leads');
                  return;
                }
              }
            } catch {
              // Fall through to normal flow
            }
          }
          setLoading(false);
        } else {
          setError(data.error || 'Invalid or expired invitation. Please contact the person who invited you.');
          setLoading(false);
        }
      } catch (err) {
        console.error('Error validating invitation:', err);
        setError('Failed to validate invitation. Please try again later.');
        setLoading(false);
      }
    };

    validateInvitation();
  }, [token, navigate, location, refreshWorkspaces]);

  const handleSignupSuccess = async () => {
    if (!token) return;

    try {
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const authToken = getAuthToken();

      if (!authToken) {
        navigate('/dashboard');
        return;
      }

      const response = await fetch(`${apiBaseUrl}/api/invitations/${token}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        const workspaceId = invitationData?.workspaceId;
        if (workspaceId) {
          await refreshWorkspaces(workspaceId);
          navigate('/leads');
          return;
        }
      }
      navigate('/dashboard');
    } catch (err) {
      console.error('Error accepting invitation:', err);
      navigate('/dashboard');
    }
  };

  const goToLogin = () => {
    navigate('/login', { state: { from: location } });
  };

  if (loading) {
    return (
      <AuthLayout title="Create your account" subtitle="Verifying invitation...">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
        </div>
      </AuthLayout>
    );
  }

  if (error) {
    return (
      <AuthLayout title="Invalid Invitation" subtitle="We couldn't verify your invitation">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
        <button
          onClick={goToLogin}
          className="w-full bg-black text-white py-3 rounded-full font-medium hover:bg-gray-800 active:scale-[0.98] transition-all duration-200"
        >
          Sign in to accept
        </button>
      </AuthLayout>
    );
  }

  if (!invitationData) {
    return null;
  }

  return (
    <AuthLayout
      title="You're invited!"
      subtitle={`Join ${invitationData.workspaceName} workspace`}
    >
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-gray-700 mb-2">
          <strong>{invitationData.inviterName}</strong> has invited you to join their workspace.
        </p>
        <p className="text-sm text-gray-600">
          Create your account and you'll automatically be added to <strong>{invitationData.workspaceName}</strong>.
        </p>
      </div>

      <SignupForm
        prefillEmail={invitationData.email}
        onSignupSuccess={handleSignupSuccess}
      />

      <div className="mt-6 text-center">
        <button
          onClick={goToLogin}
          className="text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          Already have an account? Sign in
        </button>
      </div>
    </AuthLayout>
  );
};

export default SignupWithInvite;
