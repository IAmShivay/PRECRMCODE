import { DEFAULT_MEMBER_PERMISSIONS, type WorkspacePermissions } from '../types/permissions';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  getWorkspaceMembers,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  adminResetPassword,
  updateMemberPermissions,
  getPipelines,
  updateWorkspaceMemberRole,
  getPendingInvitations,
  cancelInvitation,
} from '../lib/api-client';
import type { WorkspaceMember, User } from './types';
import { ROLE_ADMIN, ROLE_MANAGER, ROLE_MEMBER, ROLE_VIEWER, ROLE_OWNER, ROLE_LABEL_ADMIN, ROLE_LABEL_MANAGER, ROLE_LABEL_MEMBER, ROLE_LABEL_VIEWER, type MemberRole, DEALS_PERM_NONE, DEALS_PERM_VIEW, DEALS_PERM_EDIT, DEALS_SCOPE_ASSIGNED, DEALS_SCOPE_ALL, PIPELINES_ALL, CONV_PERM_NONE, CONV_PERM_VIEW, CONV_PERM_REPLY } from '../types/constants';
import { XMarkIcon, UserPlusIcon, TrashIcon, KeyIcon } from '@heroicons/react/24/outline';

interface WorkspaceMemberWithUser extends WorkspaceMember {
  user?: User;
}

interface WorkspaceMembersManagerProps {
  workspaceId: number;
}

export default function WorkspaceMembersManager({ workspaceId }: WorkspaceMembersManagerProps) {
  const { user, getUserRole, loadWorkspaceMembers } = useAuth();
  const { addToast } = useToast();
  const [members, setMembers] = useState<WorkspaceMemberWithUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<number, WorkspacePermissions>>({});
  const [savingPermissions, setSavingPermissions] = useState<number | null>(null);
  const [pipelinesList, setPipelinesList] = useState<{ id: number; slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>(ROLE_MEMBER);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [resetModal, setResetModal] = useState<{ userId: number; userName: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const userRole = getUserRole(workspaceId);
  const isAdmin = userRole === ROLE_ADMIN;
  const isSuperAdmin = user?.email?.toLowerCase() === 'scraftstudio@gmail.com';

  useEffect(() => {
    fetchMembers();
  }, [workspaceId]);

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, pipelinesRes, invitesRes] = await Promise.all([
        getWorkspaceMembers(workspaceId),
        getPipelines(workspaceId).catch((err) => { console.error('Pipelines fetch failed:', err); return []; }),
        getPendingInvitations(workspaceId).catch((err) => { console.error('Invitations fetch failed:', err); return []; }),
      ]);
      setPipelinesList(pipelinesRes);
      setPendingInvites(invitesRes);
      if (response.status === 'success' && response.data) {
        const membersWithUsers = response.data.map((member: any) => ({
          ...member,
          user: {
            id: member.user_id,
            name: member.user_name || '',
            email: member.user_email || '',
          } as User,
        }));
        setMembers(membersWithUsers);
        setPermissionDrafts(Object.fromEntries(membersWithUsers.map((member) => [member.id, member.permissions || { ...DEFAULT_MEMBER_PERMISSIONS }])));
        // Update AuthContext
        await loadWorkspaceMembers(workspaceId);
      }
    } catch (err: any) {
      console.error('Error fetching workspace members:', err);
      setError(err.message || 'Failed to load workspace members');
    } finally {
      setLoading(false);
    }
  };

  const savePermissions = async (member: WorkspaceMember) => {
    if (!member.id || !permissionDrafts[member.id]) return;
    setSavingPermissions(member.id); setError(null);
    try {
      const permissions = { ...permissionDrafts[member.id] };
      await updateMemberPermissions(workspaceId, member.id, permissions);
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, permissions } : item));
      addToast('success', 'Member permissions saved for this workspace');
      await loadWorkspaceMembers(workspaceId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to save permissions'); }
    finally { setSavingPermissions(null); }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setError('Email is required');
      return;
    }

    setInviting(true);
    setError(null);
    try {
      const response = await inviteWorkspaceMember(workspaceId, { email: inviteEmail.trim(), role: inviteRole as any });
      setInviteEmail('');
      setShowInviteModal(false);
      const msg = response?.message || 'Member invited.';
      const lower = msg.toLowerCase();
      const toastType =
        lower.includes('email was not sent') ||
        lower.includes('email failed') ||
        lower.includes('skipped')
          ? 'warning'
          : 'success';
      addToast(toastType, msg);
      await fetchMembers();
    } catch (err: any) {
      console.error('Error inviting member:', err);
      setError(err.message || 'Failed to invite member. User may not exist or already be a member.');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: number) => {
    if (!window.confirm('Are you sure you want to remove this member from the workspace?')) {
      return;
    }

    setRemoving(memberId);
    setError(null);
    try {
      await removeWorkspaceMember(memberId, workspaceId);
      await fetchMembers();
    } catch (err: any) {
      console.error('Error removing member:', err);
      setError(err.message || 'Failed to remove member');
    } finally {
      setRemoving(null);
    }
  };

  const handleRoleChange = async (memberId: number, newRole: MemberRole) => {
    try {
      await updateWorkspaceMemberRole(workspaceId, memberId, newRole);
      addToast('success', `Member role updated to ${newRole}`);
      await fetchMembers();
    } catch (err: any) {
      console.error('Error updating role:', err);
      setError(err.message || 'Failed to update member role');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModal || !newPassword.trim()) return;
    if (newPassword.trim().length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const response = await adminResetPassword(resetModal.userId, newPassword.trim());
      addToast('success', response.message || 'Password reset successfully');
      setResetModal(null);
      setNewPassword('');
    } catch (err: any) {
      console.error('Error resetting password:', err);
      setError(err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    if (role === ROLE_OWNER) return ROLE_LABEL_ADMIN;
    if (role === ROLE_ADMIN) return ROLE_LABEL_ADMIN;
    if (role === ROLE_MANAGER) return ROLE_LABEL_MANAGER;
    if (role === ROLE_VIEWER) return ROLE_LABEL_VIEWER;
    return ROLE_LABEL_MEMBER;
  };

  return (
    <div className="bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Workspace Members</h2>
          <p className="text-sm text-gray-500 mt-1">
            Members see only deals assigned to them. Choose deal editing and conversation reply access separately. Admins retain full access.
          </p>
        </div>
        {isAdmin && !loading && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            <UserPlusIcon className="h-4 w-4" />
            Invite Member
          </button>
        )}
      </div>

      {error && (
        <div
          className="mb-4 border border-red-200 rounded bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center">
          <div className="inline-flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-gray-900"></div>
            <p className="text-sm text-gray-500">Loading members...</p>
          </div>
        </div>
      ) : members.length === 0 ? (
        <div className="py-8 text-center text-gray-500 text-sm">
          No members found. {isAdmin && 'Invite team members to get started.'}
        </div>
      ) : !loading && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 px-6 py-3 border-b border-gray-200">
            <div className="col-span-5">Name</div>
            <div className="col-span-4">Email</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
          {members.map((member) => {
            const memberUser = member.user;
            const isOwner = member.role === ROLE_OWNER;
            const canRemove = isAdmin && !isOwner && member.user_id !== user?.id;

            return (
              <div
                key={member.id}
                className="grid grid-cols-12 items-center px-6 py-4 text-sm bg-white border-b border-gray-100 last:border-b-0"
              >
                <div className="col-span-5 font-medium text-gray-900">
                  {memberUser?.name || `User ${member.user_id}`}
                </div>
                <div className="col-span-4 text-gray-600">
                  {memberUser?.email || 'N/A'}
                </div>
                <div className="col-span-2">
                  {isAdmin && !isOwner && member.user_id !== user?.id ? (
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.id!, e.target.value as MemberRole)}
                      className="rounded border-gray-300 text-xs py-1 px-2 border focus:ring-gray-900 focus:border-gray-900"
                    >
                      <option value={ROLE_ADMIN}>{ROLE_LABEL_ADMIN}</option>
                      <option value={ROLE_MANAGER}>{ROLE_LABEL_MANAGER}</option>
                      <option value={ROLE_MEMBER}>{ROLE_LABEL_MEMBER}</option>
                      <option value={ROLE_VIEWER}>{ROLE_LABEL_VIEWER}</option>
                    </select>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isOwner || member.role === ROLE_ADMIN
                          ? 'bg-blue-100 text-blue-800'
                          : member.role === ROLE_MANAGER
                          ? 'bg-purple-100 text-purple-800'
                          : member.role === ROLE_VIEWER
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {getRoleLabel(member.role)}
                    </span>
                  )}
                </div>
                <div className="col-span-1 text-right flex items-center justify-end gap-2">
                  {isSuperAdmin && memberUser?.email && (
                    <button
                      onClick={() =>
                        setResetModal({
                          userId: member.user_id,
                          userName: memberUser?.name || `User ${member.user_id}`,
                          email: memberUser?.email || '',
                        })
                      }
                      className="text-gray-500 hover:text-gray-800"
                      title="Reset password"
                    >
                      <KeyIcon className="h-4 w-4" />
                    </button>
                  )}
                  {canRemove && (
                    <button
                      onClick={() => handleRemove(member.id!)}
                      disabled={removing === member.id}
                      className="text-red-600 hover:text-red-800 disabled:opacity-50"
                      title="Remove member"
                    >
                      {removing === member.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                      ) : (
                        <TrashIcon className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
                {member.role === ROLE_MEMBER && <div className="col-span-12 mt-3 flex flex-wrap items-end gap-4 rounded-lg bg-gray-50 p-3">
                  <label className="text-xs font-medium text-gray-600">Deal permissions
                    <select aria-label={`Deal access for ${memberUser?.name || member.user_id}`} disabled={!isAdmin || savingPermissions !== null} value={permissionDrafts[member.id!]?.deals || DEALS_PERM_VIEW} onChange={(event) => setPermissionDrafts((current) => ({ ...current, [member.id!]: { ...current[member.id!], deals: event.target.value as WorkspacePermissions['deals'] } }))} className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      <option value={DEALS_PERM_NONE}>No access</option><option value={DEALS_PERM_VIEW}>View only</option><option value={DEALS_PERM_EDIT}>View, edit and move</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-gray-600">Deal scope
                    <select aria-label={`Deal scope for ${memberUser?.name || member.user_id}`} disabled={!isAdmin || savingPermissions !== null} value={permissionDrafts[member.id!]?.deals_scope || DEALS_SCOPE_ASSIGNED} onChange={(event) => setPermissionDrafts((current) => ({ ...current, [member.id!]: { ...current[member.id!], deals_scope: event.target.value as WorkspacePermissions['deals_scope'] } }))} className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      <option value={DEALS_SCOPE_ASSIGNED}>Assigned only</option><option value={DEALS_SCOPE_ALL}>All deals</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-gray-600">Pipeline access
                    <select aria-label={`Pipeline access for ${memberUser?.name || member.user_id}`} disabled={!isAdmin || savingPermissions !== null} value={permissionDrafts[member.id!]?.pipelines === PIPELINES_ALL ? PIPELINES_ALL : (permissionDrafts[member.id!]?.pipelines?.[0] || 'default')} onChange={(event) => setPermissionDrafts((current) => ({ ...current, [member.id!]: { ...current[member.id!], pipelines: event.target.value === PIPELINES_ALL ? PIPELINES_ALL : [event.target.value] } }))} className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      <option value={PIPELINES_ALL}>All pipelines</option>
                      {pipelinesList.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-gray-600">Workspace conversations
                    <select aria-label={`Conversation access for ${memberUser?.name || member.user_id}`} disabled={!isAdmin || savingPermissions !== null} value={permissionDrafts[member.id!]?.conversations || CONV_PERM_VIEW} onChange={(event) => setPermissionDrafts((current) => ({ ...current, [member.id!]: { ...current[member.id!], conversations: event.target.value as WorkspacePermissions['conversations'] } }))} className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                      <option value={CONV_PERM_NONE}>No access</option><option value={CONV_PERM_VIEW}>Read only</option><option value={CONV_PERM_REPLY}>Read and reply</option>
                    </select>
                  </label>
                  {isAdmin && <button type="button" onClick={() => void savePermissions(member)} disabled={savingPermissions !== null || JSON.stringify(permissionDrafts[member.id!]) === JSON.stringify(member.permissions || DEFAULT_MEMBER_PERMISSIONS)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{savingPermissions === member.id ? 'Saving…' : 'Save permissions'}</button>}
                  <p className="basis-full text-xs text-gray-500">Read-only conversations allow viewing Instagram messages, WhatsApp logs and communication history. Sending and reply actions are disabled. Only admins can reassign or delete deals and manage messaging connections, templates and campaigns.</p>
                </div>}
              </div>
            );
          })}
          {pendingInvites.map((invite) => (
            <div
              key={invite.token || invite.id}
              className="grid grid-cols-12 items-center px-6 py-4 text-sm bg-white border-b border-gray-100 last:border-b-0"
            >
              <div className="col-span-5 font-medium text-gray-500 italic">
                Pending Invite
              </div>
              <div className="col-span-4 text-gray-500">
                {invite.email}
              </div>
              <div className="col-span-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {getRoleLabel(invite.role || ROLE_MEMBER)}
                </span>
              </div>
              <div className="col-span-1 text-right">
                {isAdmin && (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await inviteWorkspaceMember(workspaceId, { email: invite.email, role: invite.role as any });
                          addToast('success', 'Invitation resent');
                        } catch (e: any) {
                          addToast('error', e.message || 'Failed to resend');
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-900 font-medium"
                    >
                      Resend
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm('Revoke this invitation?')) return;
                        try {
                          await cancelInvitation(workspaceId, invite.email);
                          addToast('success', 'Invitation revoked');
                          fetchMembers();
                        } catch (e: any) {
                          addToast('error', e.message || 'Failed to revoke');
                        }
                      }}
                      className="text-xs text-red-600 hover:text-red-900 font-medium"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Reset Password</h3>
              <button
                onClick={() => {
                  setResetModal(null);
                  setNewPassword('');
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Reset password for <span className="font-semibold">{resetModal.userName}</span>{' '}
                  (<span className="text-gray-500">{resetModal.email}</span>)
                </p>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="Enter new password (min 6 characters)"
                  required
                  minLength={6}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setResetModal(null);
                    setNewPassword('');
                    setError(null);
                  }}
                  disabled={resetting}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {resetting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Resetting...
                    </>
                  ) : (
                    <>
                      <KeyIcon className="h-4 w-4" />
                      Reset Password
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Invite Team Member</h3>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail('');
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="user@example.com"
                  required
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Existing users will be added directly. New users receive an invitation email.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value={ROLE_ADMIN}>{ROLE_LABEL_ADMIN} - Full access to workspace</option>
                  <option value={ROLE_MANAGER}>{ROLE_LABEL_MANAGER} - Edit all deals, no settings access</option>
                  <option value={ROLE_MEMBER}>{ROLE_LABEL_MEMBER} - Configurable access to specific deals</option>
                  <option value={ROLE_VIEWER}>{ROLE_LABEL_VIEWER} - Read-only access to all deals</option>
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  Choose the level of access for this user. You can customize member permissions after inviting them.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteEmail('');
                    setError(null);
                  }}
                  disabled={inviting}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {inviting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Inviting...
                    </>
                  ) : (
                    <>
                      <UserPlusIcon className="h-4 w-4" />
                      Invite
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

