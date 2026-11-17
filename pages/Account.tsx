import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { verifyEmail } from '../lib/api-client';
import {
  ArrowRightOnRectangleIcon,
  CheckIcon,
  PencilSquareIcon,
  XMarkIcon,
  BuildingOffice2Icon,
  ClipboardIcon,
  ExclamationTriangleIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getInitials(name?: string) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'U';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || '';
  const second = parts[1]?.[0] || parts[0]?.[1] || '';
  return `${first}${second}`.toUpperCase() || 'U';
}

export default function Account() {
  const { user, workspaces, currentWorkspace, setCurrentWorkspace, getUserRole, logout, updateUserProfile } = useAuth();
  const [copied, setCopied] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState('');
  const [draftEmail, setDraftEmail] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [emailVerification, setEmailVerification] = React.useState<{
    status: 'idle' | 'checking' | 'valid' | 'invalid' | 'error';
    message?: string;
  }>({ status: 'idle' });

  const handleCopy = React.useCallback(async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(String(user.id));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!user) return;
    if (!isEditing) return;
    setDraftName(user.name || '');
    setDraftEmail(user.email || '');
  }, [user, isEditing]);

  React.useEffect(() => {
    if (!isEditing) return;

    const email = draftEmail.trim().toLowerCase();
    if (!email || email === (user?.email || '').toLowerCase()) {
      setEmailVerification({ status: 'idle' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailVerification({ status: 'invalid', message: 'Invalid email format' });
      return;
    }

    let active = true;
    setEmailVerification({ status: 'checking' });
    const timeoutId = window.setTimeout(() => {
      void verifyEmail(email, 'auto')
        .then((result) => {
          if (!active) return;
          let message = result.email_valid ? 'Deliverable' : 'Not Deliverable';
          if (!result.email_valid) {
            if (result.email_verdict === 'unknown_accept_all') {
              message = 'Cannot confirm mailbox (accept-all domain)';
            } else if (result.status === 'disposable') {
              message = 'Disposable email not allowed';
            } else if (result.status === 'spamtrap') {
              message = 'Spam trap detected';
            }
          } else if (result.email_verification_mode === 'quick') {
            message = 'Deliverable';
          } else if (result.status === 'safe') {
            message = 'Deliverable';
          }
          setEmailVerification({
            status: result.email_valid ? 'valid' : 'invalid',
            message,
          });
        })
        .catch((err: any) => {
          if (!active) return;
          setEmailVerification({
            status: 'error',
            message: err?.message ? String(err.message) : 'Email verification failed',
          });
        });
    }, 650);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [draftEmail, isEditing, user?.email]);

  const beginEdit = () => {
    setSaveError(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
    setEmailVerification({ status: 'idle' });
    setDraftName(user?.name || '');
    setDraftEmail(user?.email || '');
  };

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextName = draftName.trim();
      const nextEmail = draftEmail.trim().toLowerCase();
      const updates: { name?: string; email?: string } = {};
      if (nextName && nextName !== (user.name || '')) updates.name = nextName;
      if (nextEmail && nextEmail !== (user.email || '').toLowerCase()) updates.email = nextEmail;

      await updateUserProfile(updates);
      setIsEditing(false);
      setEmailVerification({ status: 'idle' });
    } catch (err: any) {
      setSaveError(err?.message ? String(err.message) : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Loading account...</p>
      </div>
    );
  }

  const initials = getInitials(user.name);

  return (
    <div className="w-full min-h-screen bg-white">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Account</h1>
            <p className="text-gray-500 mt-1 text-sm sm:text-base">
              Profile details and workspace access.
            </p>
          </div>
          <button
            onClick={logout}
            className="w-full sm:w-auto px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base flex items-center justify-center gap-2"
          >
            <ArrowRightOnRectangleIcon className="w-4 h-4" />
            Sign out
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                  <UserCircleIcon className="w-4 h-4 text-gray-500" />
                  Profile
                </h2>
              </div>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center font-bold text-gray-900">
                    {initials}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex-1">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                                Name
                              </label>
                              <input
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-colors"
                                placeholder="Your name"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                                Email
                              </label>
                              <input
                                value={draftEmail}
                                onChange={(e) => setDraftEmail(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-colors"
                                placeholder="you@company.com"
                                inputMode="email"
                                autoComplete="email"
                              />
                              <div className="mt-2 flex items-center gap-2 text-xs">
                                {emailVerification.status === 'checking' && (
                                  <span className="text-gray-500 flex items-center gap-2">
                                    <span className="inline-block w-3 h-3 rounded-full border-2 border-gray-300 border-t-gray-900 animate-spin" />
                                    Verifying email…
                                  </span>
                                )}
                                {emailVerification.status === 'valid' && (
                                  <span className="text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                    <CheckIcon className="w-3 h-3" />
                                    {emailVerification.message || 'Valid'}
                                  </span>
                                )}
                                {emailVerification.status === 'invalid' && (
                                  <span className="text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                    <ExclamationTriangleIcon className="w-3 h-3" />
                                    {emailVerification.message || 'Invalid'}
                                  </span>
                                )}
                                {emailVerification.status === 'error' && (
                                  <span className="text-gray-700 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                    <ExclamationTriangleIcon className="w-3 h-3" />
                                    {emailVerification.message || 'Verification failed'}
                                  </span>
                                )}
                              </div>
                            </div>
                            {saveError && (
                              <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                                {saveError}
                              </div>
                            )}
                            <div className="flex flex-col sm:flex-row gap-2">
                              <button
                                onClick={() => void saveProfile()}
                                disabled={saving}
                                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {saving ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <XMarkIcon className="w-4 h-4" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-lg font-semibold text-gray-900">{user.name || 'Unnamed user'}</div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!isEditing && (
                          <button
                            onClick={beginEdit}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                          >
                            <PencilSquareIcon className="w-4 h-4 text-gray-500" />
                            Edit
                          </button>
                        )}
                        <button
                          onClick={handleCopy}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                        >
                          <ClipboardIcon className="w-4 h-4 text-gray-500" />
                          {copied ? 'Copied' : 'Copy user ID'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">User ID</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{user.id}</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{formatDate(user.created_at)}</div>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Workspaces</div>
                        <div className="mt-1 text-sm font-medium text-gray-900">{workspaces.length}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                  <BuildingOffice2Icon className="w-4 h-4 text-gray-500" />
                  Workspace Access
                </h2>
              </div>
              <div className="p-6">
                {workspaces.length === 0 ? (
                  <div className="text-gray-500">No workspaces yet.</div>
                ) : (
                  <div className="space-y-3">
                    {workspaces.map((workspace) => {
                      const isActive = currentWorkspace?.id === workspace.id;
                      const role = getUserRole(workspace.id);
                      return (
                        <button
                          key={workspace.id}
                          onClick={() => setCurrentWorkspace(workspace.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-colors ${isActive ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{workspace.name}</div>
                              <div className="text-xs text-gray-500 mt-1">
                                {role === 'admin' ? 'Admin access' : role === 'member' ? 'Member access' : 'Unknown role'}
                                {' · '}
                                Created {formatDate(workspace.created_at)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isActive && (
                                <span className="text-[10px] bg-gray-900 text-white py-0.5 px-2 rounded-full font-bold uppercase tracking-wide">
                                  Current
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Quick Actions</h2>
              </div>
              <div className="p-6 space-y-3">
                <a
                  href="mailto:hello@scraft.studio"
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center justify-center font-semibold"
                >
                  Contact support
                </a>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current workspace</div>
                  <div className="mt-1 text-sm font-medium text-gray-900">
                    {currentWorkspace ? currentWorkspace.name : 'None selected'}
                  </div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Signed in as</div>
                  <div className="mt-1 text-sm font-medium text-gray-900">{user.email}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Security</h2>
              </div>
              <div className="p-6">
                <div className="text-sm text-gray-600">
                  Password updates and MFA will appear here once enabled for your tenant.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
