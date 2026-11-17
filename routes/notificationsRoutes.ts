import { Router, Response } from 'express';
import { notificationsApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { verifyWorkspaceAccess } from '../utils/workspaceHelpers.js';
import { formatMySqlDateTimeUtc } from '../lib/validation.js';
import {
  ApiResponse,
  AuthenticatedRequest,
  AuthErrorResponse,
  Notification,
} from '../types/index.js';

const router: Router = Router();

interface NotificationsQuery {
  workspace_id?: string;
  unread?: string;
  page?: string;
  limit?: string;
}

interface MarkAllReadBody {
  workspace_id?: number | string;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toBoundedPositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = toPositiveInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function toNullableUserId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value === '' || value === 'null' || value === 'undefined') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNullableDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
  return normalized;
}

function normalizeNotification(notification: Notification): Notification {
  const raw = notification as any;
  return {
    ...notification,
    id: Number(raw.id),
    workspace_id: Number(raw.workspace_id),
    recipient_user_id: Number(raw.recipient_user_id),
    actor_user_id: toNullableUserId(raw.actor_user_id),
    lead_id: toNullableUserId(raw.lead_id),
    read_at: toNullableDateString(raw.read_at),
  };
}

function getSingleNotification(data: Notification | Notification[] | undefined): Notification | null {
  if (!data) return null;
  if (!Array.isArray(data)) return normalizeNotification(data);
  const first = data[0];
  return first ? normalizeNotification(first) : null;
}

function isUnread(notification: Notification): boolean {
  return toNullableDateString(notification.read_at) === null;
}

function sortNewestFirst(notifications: Notification[]): Notification[] {
  return [...notifications].sort((a, b) => {
    const aMs = Date.parse(String(a.created_at || '').replace(' ', 'T'));
    const bMs = Date.parse(String(b.created_at || '').replace(' ', 'T'));
    const safeA = Number.isFinite(aMs) ? aMs : 0;
    const safeB = Number.isFinite(bMs) ? bMs : 0;
    return safeB - safeA;
  });
}

async function verifyAccessOrRespond(
  req: AuthenticatedRequest<any, any, any>,
  res: Response,
  workspaceId: number
): Promise<boolean> {
  const userId = Number(req.user?.id || 0);
  const { hasAccess } = await verifyWorkspaceAccess(userId, workspaceId);

  if (!hasAccess) {
    const errorResponse: AuthErrorResponse = {
      success: false,
      status: 'error',
      error: 'Access denied: You do not have access to this workspace',
    };
    res.status(403).json(errorResponse);
    return false;
  }

  return true;
}

router.get('/', authMiddleware, async (
  req: AuthenticatedRequest<{}, NotificationsQuery>,
  res: Response<ApiResponse<Notification[]>>
): Promise<void> => {
  try {
    const workspaceId = Number(req.query.workspace_id);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ status: 'error', message: 'workspace_id is required' });
      return;
    }

    if (!(await verifyAccessOrRespond(req, res, workspaceId))) return;

    const userId = Number(req.user?.id || 0);
    const requestedLimit = toBoundedPositiveInt(req.query.limit, 10, 1, 50);
    const requestedPage = toBoundedPositiveInt(req.query.page, 1, 1, 100);
    const readScope = String(req.query.unread || '').toLowerCase() === 'true' ? 'unread' : 'all';
    const fetchLimit = toBoundedPositiveInt(requestedPage * requestedLimit, 100, 50, 500);

    const response = await notificationsApi.getNotifications({
      workspace_id: workspaceId,
      recipient_user_id: userId,
      limit: fetchLimit,
      sort: 'created_at',
      order: 'desc',
      cache: 'no-store',
    }) as ApiResponse<Notification[]>;

    if (response.status !== 'success' || !Array.isArray(response.data)) {
      res.status(500).json({
        status: 'error',
        message: response.message || 'Failed to load notifications',
      });
      return;
    }

    const ownedNotifications = sortNewestFirst(
      response.data
        .map(normalizeNotification)
        .filter((notification) => notification.workspace_id === workspaceId)
        .filter((notification) => notification.recipient_user_id === userId)
    );
    const unreadCount = ownedNotifications.filter(isUnread).length;
    const scopedNotifications = readScope === 'unread'
      ? ownedNotifications.filter(isUnread)
      : ownedNotifications;
    const startIndex = (requestedPage - 1) * requestedLimit;
    const pageRows = scopedNotifications.slice(startIndex, startIndex + requestedLimit);

    res.json({
      status: 'success',
      data: pageRows,
      metadata: {
        total: scopedNotifications.length,
        hasMore: scopedNotifications.length > startIndex + requestedLimit,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/notifications:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message || 'Failed to load notifications',
    });
  }
});

router.patch('/:id/read', authMiddleware, async (
  req: AuthenticatedRequest<{ id: string }>,
  res: Response<ApiResponse<Notification>>
): Promise<void> => {
  try {
    const notificationId = Number(req.params.id);
    const userId = Number(req.user?.id || 0);

    if (!Number.isFinite(notificationId) || notificationId <= 0) {
      res.status(400).json({ status: 'error', message: 'notification id is required' });
      return;
    }

    const notificationResponse = await notificationsApi.getNotificationById(notificationId) as ApiResponse<Notification>;
    const notification = getSingleNotification(notificationResponse.data);

    if (
      notificationResponse.status !== 'success' ||
      !notification ||
      notification.recipient_user_id !== userId
    ) {
      res.status(404).json({ status: 'error', message: 'Notification not found' });
      return;
    }

    if (!(await verifyAccessOrRespond(req, res, notification.workspace_id))) return;

    if (!isUnread(notification)) {
      res.json({ status: 'success', data: notification });
      return;
    }

    const readAt = formatMySqlDateTimeUtc(new Date());
    const updateResponse = await notificationsApi.updateNotification(notificationId, {
      read_at: readAt,
      updated_at: readAt,
    }) as ApiResponse<Notification>;

    if (updateResponse.status !== 'success') {
      res.status(500).json({
        status: 'error',
        message: updateResponse.message || 'Failed to mark notification as read',
      });
      return;
    }

    res.json({
      status: 'success',
      data: {
        ...notification,
        read_at: readAt,
        updated_at: readAt,
      },
    });
  } catch (error) {
    console.error('Error in PATCH /api/notifications/:id/read:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message || 'Failed to mark notification as read',
    });
  }
});

router.patch('/read-all', authMiddleware, async (
  req: AuthenticatedRequest<{}, {}, MarkAllReadBody>,
  res: Response<ApiResponse<{ updated: number }>>
): Promise<void> => {
  try {
    const workspaceId = Number(req.body?.workspace_id);
    if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ status: 'error', message: 'workspace_id is required' });
      return;
    }

    if (!(await verifyAccessOrRespond(req, res, workspaceId))) return;

    const userId = Number(req.user?.id || 0);
    const response = await notificationsApi.getNotifications({
      workspace_id: workspaceId,
      recipient_user_id: userId,
      limit: 200,
      sort: 'created_at',
      order: 'desc',
      cache: 'no-store',
    }) as ApiResponse<Notification[]>;

    if (response.status !== 'success' || !Array.isArray(response.data)) {
      res.status(500).json({
        status: 'error',
        message: response.message || 'Failed to load notifications',
      });
      return;
    }

    const unreadNotifications = response.data
      .map(normalizeNotification)
      .filter((notification) => notification.workspace_id === workspaceId)
      .filter((notification) => notification.recipient_user_id === userId)
      .filter(isUnread);

    const readAt = formatMySqlDateTimeUtc(new Date());
    await Promise.all(unreadNotifications.map((notification) =>
      notificationsApi.updateNotification(notification.id, {
        read_at: readAt,
        updated_at: readAt,
      })
    ));

    res.json({
      status: 'success',
      data: { updated: unreadNotifications.length },
      metadata: { unreadCount: 0 },
    });
  } catch (error) {
    console.error('Error in PATCH /api/notifications/read-all:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message || 'Failed to mark notifications as read',
    });
  }
});

export default router;
