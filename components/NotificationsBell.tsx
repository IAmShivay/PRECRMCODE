import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, CheckIcon, InboxIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import type { AppNotification } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const POLL_INTERVAL_MS = 15000;

interface NotificationsResponse {
  status: string;
  data?: AppNotification[];
  message?: string;
  error?: string;
  metadata?: {
    unreadCount?: number;
  };
}

function isUnread(notification: AppNotification): boolean {
  const readAt = String(notification.read_at || '').trim();
  return readAt === '' || readAt === 'null' || readAt === 'undefined';
}

function parsePayload(notification: AppNotification): Record<string, unknown> {
  if (!notification.payload) return {};
  try {
    const parsed = JSON.parse(notification.payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function getLeadLabel(notification: AppNotification): string {
  const payload = parsePayload(notification);
  const leadName = typeof payload.lead_name === 'string' ? payload.lead_name.trim() : '';
  if (leadName) return leadName;
  return notification.lead_id ? `Lead #${notification.lead_id}` : 'Lead';
}

function formatNotificationTime(value: string): string {
  const date = new Date(String(value || '').replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function NotificationsBell() {
  const { currentWorkspace, user } = useAuth();
  const navigate = useNavigate();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchNotifications = React.useCallback(async () => {
    if (!currentWorkspace?.id || !user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      setError(null);
      return;
    }

    const token = getAuthToken();
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/notifications?workspace_id=${currentWorkspace.id}&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = await response.json() as NotificationsResponse;

      if (!response.ok || data.status !== 'success' || !Array.isArray(data.data)) {
        throw new Error(data.message || data.error || 'Failed to load notifications');
      }

      setNotifications(data.data);
      setUnreadCount(
        typeof data.metadata?.unreadCount === 'number'
          ? data.metadata.unreadCount
          : data.data.filter(isUnread).length
      );
      setError(null);
    } catch (fetchError) {
      console.error('[NotificationsBell] Failed to load notifications:', fetchError);
      setError('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace?.id, user?.id]);

  React.useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  React.useEffect(() => {
    if (!currentWorkspace?.id || !user?.id) return;
    const intervalId = window.setInterval(() => {
      void fetchNotifications();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [currentWorkspace?.id, fetchNotifications, user?.id]);

  React.useEffect(() => {
    const handleRefresh = () => {
      void fetchNotifications();
    };
    window.addEventListener('focus', handleRefresh);
    window.addEventListener('notificationsChanged', handleRefresh);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('notificationsChanged', handleRefresh);
    };
  }, [fetchNotifications]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const markNotificationAsRead = React.useCallback(async (notification: AppNotification) => {
    if (!isUnread(notification)) return;

    const token = getAuthToken();
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/${notification.id}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as NotificationsResponse | null;
        throw new Error(data?.message || data?.error || 'Failed to mark notification as read');
      }

      const readAt = new Date().toISOString();
      setNotifications((prev) => prev.map((item) =>
        item.id === notification.id ? { ...item, read_at: readAt } : item
      ));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (markError) {
      console.error('[NotificationsBell] Failed to mark notification as read:', markError);
    }
  }, []);

  const markAllRead = React.useCallback(async () => {
    if (!currentWorkspace?.id || unreadCount === 0) return;

    const token = getAuthToken();
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workspace_id: currentWorkspace.id }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as NotificationsResponse | null;
        throw new Error(data?.message || data?.error || 'Failed to mark notifications as read');
      }

      const readAt = new Date().toISOString();
      setNotifications((prev) => prev.map((notification) => ({ ...notification, read_at: readAt })));
      setUnreadCount(0);
      setError(null);
    } catch (markError) {
      console.error('[NotificationsBell] Failed to mark all notifications as read:', markError);
      setError('Failed to update notifications');
    }
  }, [currentWorkspace?.id, unreadCount]);

  const handleNotificationClick = async (notification: AppNotification) => {
    await markNotificationAsRead(notification);
    setIsOpen(false);
    if (notification.lead_id) {
      navigate(`/leads/${notification.lead_id}`);
    }
  };

  const toggleOpen = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      void fetchNotifications();
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
        aria-label="Notifications"
        title="Notifications"
      >
        <BellIcon className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] h-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white text-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl z-50">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
            <div className="text-sm font-semibold text-gray-900">Notifications</div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-8 text-sm text-gray-500">
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
                Loading notifications
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <InboxIcon className="mb-2 h-6 w-6 text-gray-300" aria-hidden="true" />
                <div className="text-sm font-medium text-gray-700">No notifications</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => {
                  const unread = isUnread(notification);
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => void handleNotificationClick(notification)}
                      className={[
                        'w-full px-3 py-3 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50',
                        unread ? 'bg-gray-50/70' : 'bg-white',
                      ].join(' ')}
                    >
                      <div className="flex gap-3">
                        <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
                          <BellIcon className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                              {notification.title || 'Notification'}
                            </p>
                            {unread && (
                              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-red-600" />
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
                            {notification.message || `${getLeadLabel(notification)} was updated.`}
                          </p>
                          <div className="mt-1 text-[11px] text-gray-400">
                            {formatNotificationTime(notification.created_at)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
