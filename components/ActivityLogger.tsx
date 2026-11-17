import React, { useState, useEffect } from 'react';
import {
  PhoneIcon,
  EnvelopeIcon,
  DocumentTextIcon,
  XMarkIcon,
  CheckIcon,
  TagIcon,
  UserGroupIcon,
  ChatBubbleLeftEllipsisIcon
} from '@heroicons/react/24/outline';
import type { LeadActivity, Lead } from './types';
import { getAuthToken } from '../lib/storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type ActivityApiResponse<T> = {
  status: string;
  data?: T;
  message?: string;
  error?: string;
};

async function getLeadActivities(leadId: number): Promise<ActivityApiResponse<LeadActivity[]>> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/leads/${leadId}/activities`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return response.json();
}

async function createLeadActivity(
  leadId: number,
  payload: Record<string, unknown>
): Promise<ActivityApiResponse<LeadActivity>> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}/api/leads/${leadId}/activities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

interface ActivityLoggerProps {
  lead: Lead;
  workspaceId: number;
  currentUserId?: number;
  onActivityCreated?: (activity: LeadActivity) => void;
}

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call', icon: PhoneIcon, color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-200' },
  { value: 'email', label: 'Email', icon: EnvelopeIcon, color: 'text-purple-600', bg: 'bg-purple-100', border: 'border-purple-200' },
  { value: 'whatsapp', label: 'WhatsApp', icon: WhatsAppIcon, color: 'text-green-600', bg: 'bg-green-100', border: 'border-green-200' },
  { value: 'note', label: 'Note', icon: ChatBubbleLeftEllipsisIcon, color: 'text-orange-600', bg: 'bg-orange-100', border: 'border-orange-200' },
  { value: 'assignment', label: 'Assignment', icon: UserGroupIcon, color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' },
  { value: 'status_change', label: 'Status', icon: TagIcon, color: 'text-indigo-600', bg: 'bg-indigo-100', border: 'border-indigo-200' },
];

interface FormData {
  type: string;
  title: string;
  description: string;
  metadata?: string;
}

export default function ActivityLogger({ lead, workspaceId, currentUserId, onActivityCreated }: ActivityLoggerProps) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    type: 'note',
    title: '',
    description: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) { setError('Title is required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const response = await createLeadActivity(lead.id, {
        lead_id: lead.id,
        workspace_id: workspaceId,
        user_id: currentUserId || 1,
        type: formData.type,
        title: formData.title,
        description: formData.description,
        metadata: formData.metadata,
        created_at: new Date().toISOString(),
      });
      if (response.status === 'success' && response.data) {
        setFormData({ type: 'note', title: '', description: '' });
        setShowForm(false);
        if (onActivityCreated && response.data) onActivityCreated(response.data);
      } else { setError('Failed to log activity'); }
    } catch (err) { setError('Failed to log activity.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm flex items-center justify-center gap-2">
          <DocumentTextIcon className="h-4 w-4" /> Log Activity
        </button>
      ) : (
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Log Activity</h3>
            <button onClick={() => { setShowForm(false); setError(null); }} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {error && (
              <div
                className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                <div className="grid grid-cols-3 gap-2">
                  {ACTIVITY_TYPES.filter(t => t.value !== 'status_change' && t.value !== 'assignment').map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, type: type.value })}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${formData.type === type.value
                          ? 'bg-gray-900 text-white'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                      <type.icon className={`h-4 w-4 ${formData.type === type.value ? 'text-white' : type.color}`} />
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="e.g., Called with customer"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                  placeholder="Add details..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => { setShowForm(false); setError(null); }}
                disabled={submitting}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? 'Saving...' : <><CheckIcon className="h-4 w-4" /> Log Activity</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Activity Timeline Component
interface ActivityTimelineProps {
  leadId: number;
  workspaceId: number;
  activities?: LeadActivity[];
  onRefresh?: () => void;
}

export function ActivityTimeline({ leadId, workspaceId: _workspaceId, activities: propActivities }: ActivityTimelineProps) {
  const [localActivities, setLocalActivities] = useState<LeadActivity[]>(propActivities || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (propActivities) setLocalActivities(propActivities); }, [propActivities]);
  useEffect(() => { if (!propActivities && leadId) fetchActivities(); }, [leadId, propActivities]);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const response = await getLeadActivities(leadId);
      if (response.status === 'success' && response.data) setLocalActivities(response.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const getActivityStyle = (type: string) => {
    return ACTIVITY_TYPES.find(t => t.value === type) ||
      { icon: DocumentTextIcon, color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' };
  };

  const formatTime = (dateString: string) => {
    if (!dateString) return '-';
    let date: Date;
    if (dateString && dateString.length === 19 && dateString[10] === ' ') {
      date = new Date(dateString.replace(' ', 'T') + 'Z');
    } else {
      date = new Date(dateString);
    }

    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between flex-shrink-0 bg-white">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Activity History</h3>
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{localActivities.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto mb-3"></div>
            <p className="text-gray-500 text-sm">Loading...</p>
          </div>
        ) : localActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <DocumentTextIcon className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-500 text-sm font-medium">No activities recorded yet</p>
            <p className="text-gray-400 text-xs mt-1">Notes, calls, and updates will appear here.</p>
          </div>
        ) : (
          <div className="space-y-0 relative">
            {/* Continuous Vertical Line */}
            <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-200 -z-10"></div>

            {localActivities.map((activity) => {
              const style = getActivityStyle(activity.type);
              const Icon = style.icon;

              return (
                <div key={activity.id} className="group flex gap-4 pb-8 last:pb-0 relative">
                  {/* Icon Bubble */}
                  <div className={`
                    flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 z-10 
                    ${style.bg} ${style.color} border ${style.border} shadow-sm ring-4 ring-gray-50 group-hover:ring-white transition-all
                  `}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Content Card */}
                  <div className="flex-1 min-w-0 bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                        {activity.type}
                      </span>
                      <span className="text-[10px] sm:text-xs text-gray-400 font-mono whitespace-nowrap">
                        {formatTime(activity.created_at)}
                      </span>
                    </div>

                    {(activity as any).actor_name && (
                      <div className="text-[11px] text-gray-500 mb-2">
                        {(() => {
                          const actorName = (activity as any).actor_name as string;
                          const actorRole = (activity as any).actor_role as string | undefined;
                          const roleLabel = actorRole === 'owner' || actorRole === 'admin' ? 'Admin' : actorRole === 'member' ? 'Member' : undefined;
                          if (roleLabel === 'Admin') return `Admin: ${actorName}`;
                          return actorName;
                        })()}
                      </div>
                    )}

                    {activity.type !== 'note' && activity.title && (
                      <h4 className="text-sm font-bold text-gray-900 mb-1">{activity.title}</h4>
                    )}

                    {activity.description && (
                      <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                        {activity.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
