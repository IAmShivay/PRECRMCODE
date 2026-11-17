import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getAuthToken } from '../lib/storage';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  Bars2Icon,
  ChevronDownIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Lead, LeadCustomField, LeadCustomFieldValue, LeadStatus } from './types';

// Vite exposes environment variables via import.meta.env; fall back to local backend in dev
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface LeadsTableProps {
  workspaceId?: number;
  showDeleted?: boolean;
}

export interface LeadsTableRef {
  refresh: () => void;
}

// Fallback sample data (used when no API data available)
const sampleStatuses: LeadStatus[] = [];

const PAGE_SIZE = 100;

const mergeLeads = (existing: Lead[], incoming: Lead[]) => {
  if (incoming.length === 0) return existing;
  const byId = new Map<number, Lead>();
  for (const lead of existing) {
    byId.set(lead.id, lead);
  }
  for (const lead of incoming) {
    byId.set(lead.id, lead);
  }
  return Array.from(byId.values());
};

const isValidFlag = (value: unknown): boolean => Number(value) === 1;
type ValidationState = 'valid' | 'invalid' | 'pending';

const PENDING_EMAIL_STATUSES = new Set(['', 'pending', 'not verified', 'not_verified', 'unknown']);
const VALID_EMAIL_STATUSES = new Set(['valid', 'safe', 'deliverable']);
const INVALID_EMAIL_STATUSES = new Set([
  'invalid',
  'disposable',
  'spamtrap',
  'risky',
  'undeliverable',
  'unknown_accept_all',
]);

const getEmailValidationState = (lead: Lead): ValidationState => {
  if (isValidFlag(lead.email_valid)) return 'valid';

  const verificationStatus = String(lead.email_verification_status || '').trim().toLowerCase();
  if (VALID_EMAIL_STATUSES.has(verificationStatus)) return 'valid';
  if (INVALID_EMAIL_STATUSES.has(verificationStatus)) return 'invalid';
  if (PENDING_EMAIL_STATUSES.has(verificationStatus)) return 'pending';

  return 'pending';
};

type ColumnId = string;

type ColumnPreference = {
  id: ColumnId;
  visible: boolean;
  width: number;
};

type ColumnDefinition = {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  locked?: boolean;
  sortField?: keyof Lead;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (lead: Lead) => React.ReactNode;
};

type ColumnViewState = {
  version: number;
  columns: ColumnPreference[];
};

const VIEW_STATE_VERSION = 1;

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Pure helpers – defined at module scope so they are never captured as stale
// closures inside the memoised columnDefinitions.
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getDaysRemaining = (deletedAt: string | null | undefined): number | null => {
  if (!deletedAt) return null;
  const deletedDate = new Date(deletedAt);
  const now = new Date();
  const daysSinceDeletion = Math.floor((now.getTime() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));
  const remaining = 7 - daysSinceDeletion;
  return Math.max(0, remaining);
};

const getDaysRemainingText = (deletedAt: string | null | undefined): string => {
  const daysRemaining = getDaysRemaining(deletedAt);
  if (daysRemaining === null) return '';
  if (daysRemaining <= 0) return 'Will be deleted soon';
  return `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

export default forwardRef<LeadsTableRef, LeadsTableProps>(function LeadsTable({ workspaceId, showDeleted = false }, ref) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatus[]>(sampleStatuses);
  const [sourceNameById, setSourceNameById] = useState<Record<string, string>>({});
  const [assigneeNameById, setAssigneeNameById] = useState<Record<number, string>>({});
  const assigneeNameCacheRef = useRef<Record<number, string>>({});
  const requestIdRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const lastAutomaticRefreshRef = useRef(0);
  const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [leadToRestore, setLeadToRestore] = useState<{ id: number; name: string } | null>(null);
  const { addToast } = useToast();

  const [openStatusDropdownId, setOpenStatusDropdownId] = useState<number | null>(null);
  const [statusDropdownPos, setStatusDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const statusDropdownRef = useRef<HTMLDivElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<keyof Lead>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isEditViewOpen, setIsEditViewOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [customFields, setCustomFields] = useState<LeadCustomField[]>([]);
  const [customFieldValuesByLeadId, setCustomFieldValuesByLeadId] = useState<Record<number, Record<number, string>>>({});
  const loadingCustomFieldValuesRef = useRef<Set<number>>(new Set());

  const [columnPrefs, setColumnPrefs] = useState<ColumnPreference[]>([]);
  const [draggingColumnId, setDraggingColumnId] = useState<ColumnId | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<ColumnId | null>(null);
  const resizingRef = useRef<{ id: ColumnId; startX: number; startWidth: number } | null>(null);
  const [resizingColumnId, setResizingColumnId] = useState<ColumnId | null>(null);

  useEffect(() => {
    if (searchTerm.length === 0) {
      setDebouncedSearchTerm('');
      return;
    }

    const handle = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(handle);
  }, [searchTerm]);

  // Close status dropdown on click outside
  useEffect(() => {
    if (openStatusDropdownId === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setOpenStatusDropdownId(null);
        setStatusDropdownPos(null);
      }
    };
    const handleScroll = () => {
      setOpenStatusDropdownId(null);
      setStatusDropdownPos(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [openStatusDropdownId]);

  const normalizeUserId = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (value === '' || value === 'null' || value === 'undefined') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  // Load workspace-scoped lead statuses from backend
  useEffect(() => {
    const fetchStatuses = async () => {
      try {
        const token = getAuthToken();
        const params: any = {};
        if (workspaceId) {
          params.workspace_id = workspaceId;
        }
        const query = new URLSearchParams(params).toString();
        const response = await fetch(
          `${API_BASE_URL}/api/lead-statuses${query ? `?${query}` : ''}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }
        );
        const data = await response.json();

        if (response.ok && data.status === 'success' && data.data) {
          const workspaceStatuses = (data.data as LeadStatus[])
            .filter(s => (workspaceId ? s.workspace_id === workspaceId : true))
            .filter(s => s.is_active === 1)
            .sort((a, b) => a.order_index - b.order_index);
          setStatuses(workspaceStatuses);
        }
      } catch (err) {
        console.error('Error fetching lead statuses:', err);
      }
    };

    fetchStatuses();
  }, [workspaceId]);

  // Load registered sources for display names
  useEffect(() => {
    let isActive = true;

    const fetchSources = async () => {
      if (!workspaceId) {
        setSourceNameById({});
        return;
      }

      try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/api/sources/${workspaceId}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = await response.json();

        if (!isActive) return;

        if (response.ok && data.status === 'success' && Array.isArray(data.data)) {
          const map: Record<string, string> = {};
          data.data.forEach((log: any) => {
            if (log?.event_id) {
              map[log.event_id] = log.source || log.event_id;
            }
          });
          setSourceNameById(map);
        } else {
          setSourceNameById({});
        }
      } catch (err) {
        console.error('Error fetching sources:', err);
        if (isActive) {
          setSourceNameById({});
        }
      }
    };

    fetchSources();

    return () => {
      isActive = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    let isActive = true;

    const fetchCustomFields = async () => {
      if (!workspaceId) {
        setCustomFields([]);
        return;
      }

      try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/custom-fields`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const data = await response.json();
        if (!isActive) return;
        if (response.ok && data.status === 'success' && Array.isArray(data.data)) {
          setCustomFields((data.data as LeadCustomField[]).filter((f) => f.is_active === 1));
        } else {
          setCustomFields([]);
        }
      } catch {
        if (isActive) setCustomFields([]);
      }
    };

    void fetchCustomFields();
    return () => {
      isActive = false;
    };
  }, [workspaceId]);

  const fetchLeadsPage = useCallback(async (
    pageToLoad: number,
    options: { append: boolean; merge?: boolean; silent?: boolean }
  ) => {
    if (options.append && loadingMoreRef.current) return;

    const requestId = ++requestIdRef.current;
    const isLatestRequest = () => requestId === requestIdRef.current;

    if (options.append) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else if (!options.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const params: any = { limit: PAGE_SIZE, page: pageToLoad };
      if (workspaceId) {
        params.workspace_id = workspaceId;
      }
      if (statusFilter !== 'all') {
        params.status_id = statusFilter;
      }
      if (debouncedSearchTerm) {
        params.search = debouncedSearchTerm;
      }
      if (showDeleted) {
        params.deleted = 'true';
      }
      // Always request server-side sort so the first page contains the most
      // relevant leads (e.g. newest first) instead of relying solely on
      // client-side sorting of a partial page.
      params.sort = sortField;
      params.order = sortDirection;

      const token = getAuthToken();
      const query = new URLSearchParams(params).toString();
      const url = `${API_BASE_URL}/api/leads${query ? `?${query}` : ''}`;
      if (import.meta.env.DEV) {
        console.log(`[LeadsTable] Fetching leads from: ${url}`, { showDeleted, workspaceId, page: pageToLoad });
      }

      const response = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await response.json();

      if (import.meta.env.DEV && (!response.ok || data.status !== 'success')) {
        console.error('Failed to fetch leads from backend API', {
          ok: response.ok,
          status: response.status,
          payloadStatus: data.status,
          message: data.message,
        });
      }

      if (response.ok && data.status === 'success' && Array.isArray(data.data)) {
        const incomingLeads = data.data as Lead[];
        if (isLatestRequest()) {
          setLeads(prev => (
            options.append || options.merge ? mergeLeads(prev, incomingLeads) : incomingLeads
          ));
          if (!options.merge) {
            setPage(pageToLoad);
            const nextHasMore = typeof data?.metadata?.hasMore === 'boolean'
              ? data.metadata.hasMore
              : incomingLeads.length === PAGE_SIZE;
            setHasMore(nextHasMore);
          }
        }
      } else {
        console.error('[LeadsTable] Failed to fetch leads:', {
          ok: response.ok,
          status: response.status,
          dataStatus: data.status,
          message: data.message,
          error: data.error,
          fullResponse: data
        });
        if (!options.append && !options.silent && isLatestRequest()) {
          setError('Failed to fetch leads');
        }
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
      if (!options.append && !options.silent && isLatestRequest()) {
        setError('Failed to load leads. Please try again.');
        // Use sample data on error for demo
        setLeads([]);
      }
    } finally {
      if (options.append) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      } else if (!options.silent) {
        if (isLatestRequest()) {
          setLoading(false);
        }
      }
    }
  }, [debouncedSearchTerm, showDeleted, sortDirection, sortField, statusFilter, workspaceId]);

  const fetchLeads = useCallback(async () => {
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setPage(1);
    setHasMore(true);
    await fetchLeadsPage(1, { append: false });
  }, [fetchLeadsPage]);

  const loadMoreLeads = useCallback(async () => {
    if (loading || loadingMoreRef.current || !hasMore) return;
    const nextPage = page + 1;
    await fetchLeadsPage(nextPage, { append: true });
  }, [fetchLeadsPage, hasMore, loading, page]);

  // Expose refresh method to parent
  useImperativeHandle(ref, () => ({
    refresh: fetchLeads,
  }), [fetchLeads]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Facebook/webhook leads are created outside this page. Refresh the first
  // page quietly so an open CRM table shows them without a manual reload.
  useEffect(() => {
    if (!workspaceId || showDeleted) return;

    const refreshAutomatically = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAutomaticRefreshRef.current < 5_000) return;
      lastAutomaticRefreshRef.current = now;
      void fetchLeadsPage(1, { append: false, merge: true, silent: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAutomatically();
    };

    const interval = window.setInterval(refreshAutomatically, 30_000);
    window.addEventListener('focus', refreshAutomatically);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshAutomatically);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchLeadsPage, showDeleted, workspaceId]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMoreLeads();
      }
    }, {
      root: null,
      rootMargin: '200px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMoreLeads]);

  useEffect(() => {
    let cancelled = false;

    const loadAssignees = async () => {
      const token = getAuthToken();
      if (!token || !workspaceId) return;

      try {
        const res = await fetch(`${API_BASE_URL}/api/workspaces/${workspaceId}/members`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (payload.status !== 'success' || !Array.isArray(payload.data)) return;
        if (cancelled) return;

        const nameMap: Record<number, string> = {};
        for (const member of payload.data) {
          const userId = Number(member.user_id);
          if (!Number.isFinite(userId) || userId <= 0) continue;
          const label = member.user_name || member.user_email || '';
          if (label) nameMap[userId] = label;
        }
        assigneeNameCacheRef.current = nameMap;
        setAssigneeNameById(nameMap);
      } catch {
        // ignore — fallback labels still work
      }
    };

    setAssigneeNameById({});
    assigneeNameCacheRef.current = {};
    void loadAssignees();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Update countdown every minute for deleted leads
  useEffect(() => {
    if (!showDeleted) return;

    const interval = setInterval(() => {
      setTick(tick => tick + 1);
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [showDeleted]);

  // Leads are filtered server-side; memoize for sorting.
  const filteredLeads = useMemo(() => leads, [leads]);

  // Sort leads
  const sortedLeads = useMemo(() => {
    const sorted = [...filteredLeads].sort((a, b) => {
      const aValue = a[sortField] ?? '';
      const bValue = b[sortField] ?? '';

      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return sorted;
  }, [filteredLeads, sortField, sortDirection]);

  // Compute duplicate detection maps
  const duplicateTagsByLeadId = useMemo(() => {
    const phoneCounts = new Map<string, number>();
    const emailCounts = new Map<string, number>();
    const nameCounts = new Map<string, number>();

    for (const lead of sortedLeads) {
      const phone = (lead.phone || '').trim().toLowerCase();
      const email = (lead.email || '').trim().toLowerCase();
      const name = (lead.name || '').trim().toLowerCase();
      if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
      if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }

    const result = new Map<number, string[]>();
    for (const lead of sortedLeads) {
      const tags: string[] = [];
      const phone = (lead.phone || '').trim().toLowerCase();
      const email = (lead.email || '').trim().toLowerCase();
      const name = (lead.name || '').trim().toLowerCase();
      if (phone && (phoneCounts.get(phone) || 0) > 1) tags.push('Dup. Phone');
      if (email && (emailCounts.get(email) || 0) > 1) tags.push('Dup. Email');
      if (name && (nameCounts.get(name) || 0) > 1) tags.push('Dup. Name');
      if (tags.length > 0) result.set(lead.id, tags);
    }
    return result;
  }, [sortedLeads]);

  // Get status info
  const getStatusInfo = (statusId: number) => {
    const status = statuses.find(s => s.id === statusId);
    return status || { id: 0, workspace_id: workspaceId || 0, name: 'Unknown', slug: 'unknown', color: '#9CA3AF', order_index: 0, type: 'open', is_default: 0, is_active: 1, is_qualified: 0, created_at: '', updated_at: '' };
  };

  const getAssigneeLabel = (lead: Lead): string => {
    const assigneeId = normalizeUserId(lead.user_id);
    if (!assigneeId) return 'Unassigned';
    return assigneeNameById[assigneeId] || `User ${assigneeId}`;
  };

  // Handle sort
  const handleSort = (field: keyof Lead) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle row click - navigate to lead detail
  // Works for both mouse clicks and touch events on mobile
  const handleRowClick = useCallback((event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
    // Check if the click/touch originated from an interactive element
    const target = event.target as HTMLElement;
    
    // Ignore clicks on interactive elements
    if (
      target.tagName === 'SELECT' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'A' ||
      target.closest('select') ||
      target.closest('button') ||
      target.closest('a') ||
      target.closest('[role="button"]')
    ) {
      return;
    }

    const leadId = Number(event.currentTarget.dataset.leadId);
    if (!Number.isFinite(leadId)) return;
    navigate(`/leads/${leadId}`);
  }, [navigate]);

  const handleStatusChange = async (leadId: number, newStatusId: number, currentStatusId: number) => {
    if (newStatusId === currentStatusId) return;

    setLeads(prev => prev.map(lead => (
      lead.id === leadId ? { ...lead, status_id: newStatusId } : lead
    )));

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          status_id: newStatusId,
          updated_by_user_id: user?.id || 1,
        }),
      });
      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || data.error || 'Failed to update status');
      }

      addToast('success', 'Status updated');
    } catch (err) {
      console.error('Error updating lead status:', err);
      setLeads(prev => prev.map(lead => (
        lead.id === leadId ? { ...lead, status_id: currentStatusId } : lead
      )));
      addToast('error', 'Failed to update status');
    }
  };

  // Restore lead from trash
  const handleRestoreLead = (leadId: number, leadName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setLeadToRestore({ id: leadId, name: leadName });
    setShowRestoreModal(true);
  };

  const confirmRestoreLead = async () => {
    if (!leadToRestore) return;

    const leadId = leadToRestore.id;
    setRestoringIds(prev => new Set(prev).add(leadId));

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          deleted_at: null,
        }),
      });

      if (response.ok) {
        addToast('success', 'Lead restored successfully');
        // Refresh leads list
        await fetchLeads();
        // Notify sidebar to refresh count
        window.dispatchEvent(new CustomEvent('leadsChanged'));
      } else {
        const errorData = await response.json();
        addToast('error', errorData.message || errorData.error || 'Failed to restore lead');
      }
    } catch (err) {
      console.error('Error restoring lead:', err);
      addToast('error', 'Failed to restore lead. Please try again.');
    } finally {
      setRestoringIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(leadId);
        return newSet;
      });
      setShowRestoreModal(false);
      setLeadToRestore(null);
    }
  };

  const getSourceLabel = (lead: Lead) => {
    const rawSource = (lead.source_old || '').trim();

    if (rawSource && sourceNameById[rawSource]) {
      return sourceNameById[rawSource];
    }

    if (lead.source_ref && sourceNameById[lead.source_ref]) {
      return sourceNameById[lead.source_ref];
    }

    if (!rawSource) {
      return 'Unknown';
    }

    if (rawSource.startsWith('src_')) {
      return 'Unregistered Source';
    }

    return toTitleCase(rawSource);
  };

  const renderStatusControl = (lead: Lead, isMobile = false) => {
    const statusInfo = getStatusInfo(lead.status_id);
    const resolvedStatus = statusInfo.id === lead.status_id
      ? statusInfo
      : { ...statusInfo, id: lead.status_id, is_default: 0, is_qualified: 0 };
    const hasStatuses = statuses.length > 0;
    const statusColor = resolvedStatus.color || '#3B82F6';
    const isOpen = openStatusDropdownId === lead.id;
    const dupTags = duplicateTagsByLeadId.get(lead.id);

    const dupIndicator = !isMobile && dupTags && dupTags.length > 0 ? (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold leading-none bg-amber-500 text-white flex-shrink-0 cursor-default"
        title={dupTags.join(', ')}
      >
        {dupTags.length}
      </span>
    ) : null;

    if (showDeleted || !hasStatuses) {
      return (
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border"
            style={{
              backgroundColor: statusColor + '14',
              color: statusColor,
              borderColor: statusColor + '33',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
            {resolvedStatus.name}
          </span>
          {dupIndicator}
        </div>
      );
    }

    const statusOptions = statuses.some(status => status.id === lead.status_id)
      ? statuses
      : [resolvedStatus, ...statuses];

    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isOpen) {
              setOpenStatusDropdownId(null);
              setStatusDropdownPos(null);
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setStatusDropdownPos({ top: rect.bottom + 4, left: rect.left });
              setOpenStatusDropdownId(lead.id);
            }
          }}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-md text-xs font-semibold border transition-all hover:shadow-sm"
          style={{
            backgroundColor: statusColor + '14',
            color: statusColor,
            borderColor: statusColor + '33',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
          {resolvedStatus.name}
          <ChevronDownIcon className="w-3 h-3 opacity-60" style={{ color: statusColor }} />
        </button>
        {isOpen && statusDropdownPos && createPortal(
          <div
            ref={statusDropdownRef}
            className="w-44 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
            style={{
              position: 'fixed',
              top: statusDropdownPos.top,
              left: statusDropdownPos.left,
              zIndex: 9999,
            }}
          >
            {statusOptions.map((s) => {
              const c = s.color || '#3B82F6';
              const isSelected = s.id === lead.status_id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStatusChange(lead.id, s.id, lead.status_id);
                    setOpenStatusDropdownId(null);
                    setStatusDropdownPos(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${isSelected ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                  <span style={{ color: isSelected ? c : '#374151' }}>{s.name}</span>
                  {isSelected && <CheckIcon className="w-3.5 h-3.5 ml-auto" style={{ color: c }} />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
        {dupIndicator}
      </div>
    );
  };

  const viewStorageKey = useMemo(() => {
    const userId = user?.id ?? 0;
    const workspaceKey = workspaceId ?? 0;
    const mode = showDeleted ? 'trash' : 'active';
    return `scraft_leads_table_view_${VIEW_STATE_VERSION}_${userId}_${workspaceKey}_${mode}`;
  }, [showDeleted, user?.id, workspaceId]);

  const columnDefinitions = useMemo<ColumnDefinition[]>(() => {
    const defs: ColumnDefinition[] = [
      {
        id: 'name',
        label: 'Name',
        defaultVisible: true,
        defaultWidth: 240,
        minWidth: 160,
        maxWidth: 520,
        locked: true,
        sortField: 'name',
        renderCell: (lead) => (
          <>
            <div className="font-medium text-gray-900 truncate">{lead.name}</div>
            <div className="text-xs text-gray-500">#{lead.id}</div>
          </>
        ),
      },
      {
        id: 'contact',
        label: 'Contact',
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 200,
        maxWidth: 560,
        renderCell: (lead) => (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-900 truncate">{lead.email}</span>
            </div>
            <div className="text-xs text-gray-500 truncate">{lead.phone}</div>
          </>
        ),
      },
      {
        id: 'status',
        label: 'Status',
        defaultVisible: true,
        defaultWidth: 170,
        minWidth: 140,
        maxWidth: 300,
        sortField: 'status_id',
        renderCell: (lead) => renderStatusControl(lead),
      },
      {
        id: 'assigned',
        label: 'Assigned',
        defaultVisible: true,
        defaultWidth: 180,
        minWidth: 140,
        maxWidth: 340,
        renderCell: (lead) => (
          <span className="text-sm text-gray-600 truncate" title={getAssigneeLabel(lead)}>
            {getAssigneeLabel(lead)}
          </span>
        ),
      },
      {
        id: 'source',
        label: 'Source',
        defaultVisible: true,
        defaultWidth: 190,
        minWidth: 140,
        maxWidth: 380,
        sortField: 'source_old',
        renderCell: (lead) => (
          <span className="text-sm text-gray-600 truncate" title={lead.source_old}>
            {getSourceLabel(lead)}
          </span>
        ),
      },
      {
        id: 'created_at',
        label: 'Created',
        defaultVisible: true,
        defaultWidth: 160,
        minWidth: 140,
        maxWidth: 260,
        sortField: 'created_at',
        renderCell: (lead) => {
          const daysRemainingText = getDaysRemainingText(lead.deleted_at);
          return (
            <>
              <div className="text-sm text-gray-600">{formatDate(lead.created_at)}</div>
              {showDeleted && daysRemainingText && (
                <div className="text-xs text-orange-600 font-medium mt-0.5">{daysRemainingText}</div>
              )}
            </>
          );
        },
      },
      {
        id: 'validation',
        label: showDeleted ? 'Actions' : 'Validation',
        defaultVisible: true,
        defaultWidth: showDeleted ? 120 : 180,
        minWidth: showDeleted ? 100 : 160,
        maxWidth: showDeleted ? 160 : 260,
        locked: true,
        renderCell: (lead) => {
          const isRestoring = restoringIds.has(lead.id);
          return showDeleted ? (
            <button
              onClick={(e) => handleRestoreLead(lead.id, lead.name, e)}
              disabled={isRestoring}
              className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Restore Lead"
            >
              {isRestoring ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
              ) : (
                <ArrowPathIcon className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="flex gap-2">
              <ValidationBadge state={getEmailValidationState(lead)} label="Email" />
              <ValidationBadge valid={isValidFlag(lead.phone_valid)} label="Phone" />
            </div>
          );
        },
      },
      {
        id: 'id',
        label: 'ID',
        defaultVisible: false,
        defaultWidth: 110,
        minWidth: 90,
        maxWidth: 160,
        sortField: 'id',
        renderCell: (lead) => <span className="text-sm text-gray-600">#{lead.id}</span>,
      },
      {
        id: 'email',
        label: 'Email',
        defaultVisible: false,
        defaultWidth: 260,
        minWidth: 200,
        maxWidth: 560,
        sortField: 'email',
        renderCell: (lead) => (
          <span className="text-sm text-gray-900 truncate" title={lead.email}>
            {lead.email}
          </span>
        ),
      },
      {
        id: 'phone',
        label: 'Phone',
        defaultVisible: false,
        defaultWidth: 180,
        minWidth: 140,
        maxWidth: 320,
        sortField: 'phone',
        renderCell: (lead) => (
          <span className="text-sm text-gray-600 truncate" title={lead.phone}>
            {lead.phone}
          </span>
        ),
      },
      {
        id: 'updated_at',
        label: 'Updated',
        defaultVisible: false,
        defaultWidth: 160,
        minWidth: 140,
        maxWidth: 260,
        sortField: 'updated_at',
        renderCell: (lead) => <span className="text-sm text-gray-600">{formatDate(lead.updated_at)}</span>,
      },
      {
        id: 'deleted_at',
        label: 'Deleted',
        defaultVisible: false,
        defaultWidth: 160,
        minWidth: 140,
        maxWidth: 260,
        sortField: 'deleted_at',
        renderCell: (lead) => (
          <span className="text-sm text-gray-600">
            {lead.deleted_at ? formatDate(lead.deleted_at) : '-'}
          </span>
        ),
      },
      {
        id: 'source_ref',
        label: 'Source Ref',
        defaultVisible: false,
        defaultWidth: 220,
        minWidth: 160,
        maxWidth: 520,
        renderCell: (lead) => (
          <span className="text-sm text-gray-600 truncate" title={lead.source_ref || ''}>
            {lead.source_ref || '-'}
          </span>
        ),
      },
      {
        id: 'source_id',
        label: 'Source ID',
        defaultVisible: false,
        defaultWidth: 240,
        minWidth: 160,
        maxWidth: 520,
        renderCell: (lead) => (
          <span className="text-sm text-gray-600 truncate" title={lead.source_id || ''}>
            {lead.source_id || '-'}
          </span>
        ),
      },
    ];

    for (const field of customFields) {
      const colId = `cf:${field.id}`;
      defs.push({
        id: colId,
        label: field.label,
        defaultVisible: false,
        defaultWidth: 220,
        minWidth: 140,
        maxWidth: 520,
        renderCell: (lead) => {
          const leadValues = customFieldValuesByLeadId[lead.id];
          const value = leadValues ? leadValues[field.id] : undefined;
          return (
            <span className="text-sm text-gray-600 truncate" title={value || ''}>
              {value ?? '-'}
            </span>
          );
        },
      });
    }

    if (!showDeleted) {
      return defs.filter((d) => d.id !== 'deleted_at');
    }

    return defs;
  // NOTE: statusFilter / sortDirection / sortField were previously listed but
  // are NOT referenced inside any renderCell closure.  Including leads.length
  // as a safety dependency guarantees the memoised renderCell closures are
  // refreshed whenever the underlying lead data changes (fixes stale-date
  // rendering after login).
  }, [customFieldValuesByLeadId, customFields, restoringIds, showDeleted, statuses, sourceNameById, assigneeNameById, openStatusDropdownId, duplicateTagsByLeadId, leads.length]);

  const columnDefById = useMemo(() => {
    const map = new Map<ColumnId, ColumnDefinition>();
    for (const def of columnDefinitions) map.set(def.id, def);
    return map;
  }, [columnDefinitions]);

  const columnDefIdsKey = useMemo(() => columnDefinitions.map((d) => d.id).join('|'), [columnDefinitions]);
  const hasLoadedPrefsRef = useRef(false);
  const lastStorageKeyRef = useRef<string>('');
  const lastColumnDefIdsKeyRef = useRef<string>('');

  // Reset loaded flag when storage key changes (workspace/trash mode change)
  useEffect(() => {
    if (lastStorageKeyRef.current !== viewStorageKey) {
      hasLoadedPrefsRef.current = false;
      lastStorageKeyRef.current = viewStorageKey;
    }
  }, [viewStorageKey]);

  useEffect(() => {
    // Skip if column definitions haven't actually changed and we've already loaded
    if (lastColumnDefIdsKeyRef.current === columnDefIdsKey && hasLoadedPrefsRef.current && columnPrefs.length > 0) {
      return;
    }

    const loadFromStorage = (): ColumnViewState | null => {
      const raw = localStorage.getItem(viewStorageKey);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as ColumnViewState;
        if (!parsed || parsed.version !== VIEW_STATE_VERSION || !Array.isArray(parsed.columns)) return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const mergePrefs = (existing: ColumnPreference[] | undefined, preserveExisting: boolean): ColumnPreference[] => {
      const byId = new Map<ColumnId, ColumnPreference>();
      for (const col of existing || []) byId.set(col.id, col);

      const ordered: ColumnPreference[] = [];
      const known = new Set<ColumnId>();
      
      // First, add existing preferences in their saved order (if preserving)
      // Always preserve custom field preferences (cf:*) even if preserveExisting is false
      // This handles the case where custom fields load asynchronously after preferences
      if (existing) {
        for (const col of existing) {
          const isCustomField = col.id.startsWith('cf:');
          // Always preserve custom fields, or preserve others if preserveExisting is true and they exist in columnDefById
          if (!isCustomField && (!preserveExisting || !columnDefById.has(col.id))) continue;
          if (known.has(col.id)) continue;
          known.add(col.id);
          ordered.push(col);
        }
      }

      // Then add any new columns that weren't in the saved preferences
      for (const def of columnDefinitions) {
        if (known.has(def.id)) {
          // Update existing column with current definition constraints
          const existingCol = byId.get(def.id);
          if (existingCol) {
            const width = clampNumber(existingCol.width, def.minWidth, def.maxWidth);
            const visible = def.locked ? true : existingCol.visible;
            const index = ordered.findIndex(c => c.id === def.id);
            if (index >= 0) {
              ordered[index] = { id: def.id, visible, width };
            }
          }
          continue;
        }
        // New column - add with defaults
        ordered.push({ id: def.id, visible: def.defaultVisible || Boolean(def.locked), width: def.defaultWidth });
      }

      return ordered
        .map((col) => {
          const def = columnDefById.get(col.id);
          // For custom fields that aren't loaded yet, preserve the saved preference
          const isCustomField = col.id.startsWith('cf:');
          if (!def && !isCustomField) return null;
          
          // If custom field definition exists now, use it; otherwise preserve saved preference
          if (def) {
            const existingCol = byId.get(col.id);
            const width = clampNumber(existingCol?.width ?? col.width ?? def.defaultWidth, def.minWidth, def.maxWidth);
            const visible = def.locked ? true : Boolean(existingCol?.visible ?? col.visible ?? def.defaultVisible);
            return { id: def.id, visible, width };
          } else {
            // Preserve custom field preference until definition loads
            return col;
          }
        })
        .filter((c): c is ColumnPreference => !!c);
    };

    // Only load from storage on initial mount or when storage key changes
    if (!hasLoadedPrefsRef.current) {
      const saved = loadFromStorage();
      const merged = mergePrefs(saved?.columns, false);
      setColumnPrefs(merged);
      hasLoadedPrefsRef.current = true;
      lastColumnDefIdsKeyRef.current = columnDefIdsKey;
    } else if (lastColumnDefIdsKeyRef.current !== columnDefIdsKey) {
      // When column definitions change (e.g., custom fields added), merge new columns without resetting existing
      setColumnPrefs((prev) => {
        if (prev.length === 0) {
          const saved = loadFromStorage();
          return mergePrefs(saved?.columns, false);
        }
        return mergePrefs(prev, true);
      });
      lastColumnDefIdsKeyRef.current = columnDefIdsKey;
    }
  }, [columnDefById, columnDefIdsKey, columnDefinitions, viewStorageKey]);

  useEffect(() => {
    if (columnPrefs.length === 0) return;
    const state: ColumnViewState = { version: VIEW_STATE_VERSION, columns: columnPrefs };
    localStorage.setItem(viewStorageKey, JSON.stringify(state));
  }, [columnPrefs, viewStorageKey]);

  const visibleColumns = useMemo(() => {
    if (columnPrefs.length === 0) {
      return columnDefinitions
        .filter((d) => d.defaultVisible || Boolean(d.locked))
        .map((d) => ({ ...d, width: clampNumber(d.defaultWidth, d.minWidth, d.maxWidth) }));
    }

    const cols: Array<ColumnDefinition & { width: number }> = [];
    for (const pref of columnPrefs) {
      if (!pref.visible) continue;
      const def = columnDefById.get(pref.id);
      if (!def) continue;
      cols.push({ ...def, width: clampNumber(pref.width, def.minWidth, def.maxWidth) });
    }
    return cols;
  }, [columnDefById, columnDefinitions, columnPrefs]);

  const visibleColumnCount = visibleColumns.length > 0 ? visibleColumns.length : 1;

  const visibleCustomFieldIds = useMemo(() => {
    return columnPrefs
      .filter((c) => c.visible && c.id.startsWith('cf:'))
      .map((c) => Number(c.id.slice(3)))
      .filter((id) => Number.isFinite(id) && id > 0);
  }, [columnPrefs]);

  const fetchLeadCustomFieldValues = useCallback(async (leadId: number) => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/api/leads/${leadId}/custom-field-values`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success' || !Array.isArray(data.data)) {
      return [];
    }
    return data.data as LeadCustomFieldValue[];
  }, []);

  useEffect(() => {
    if (visibleCustomFieldIds.length === 0) return;
    const missingLeadIds = sortedLeads
      .map((l) => l.id)
      .filter((id) => customFieldValuesByLeadId[id] === undefined && !loadingCustomFieldValuesRef.current.has(id));
    if (missingLeadIds.length === 0) return;

    let cancelled = false;
    const concurrency = 6;
    let index = 0;

    const runNext = async (): Promise<void> => {
      if (cancelled) return;
      const leadId = missingLeadIds[index++];
      if (!leadId) return;
      loadingCustomFieldValuesRef.current.add(leadId);
      try {
        const values = await fetchLeadCustomFieldValues(leadId);
        if (cancelled) return;
        const byFieldId: Record<number, string> = {};
        for (const v of values) {
          const fid = Number(v.field_id);
          if (!Number.isFinite(fid)) continue;
          byFieldId[fid] = String(v.value ?? '');
        }
        setCustomFieldValuesByLeadId((prev) => ({ ...prev, [leadId]: byFieldId }));
      } finally {
        loadingCustomFieldValuesRef.current.delete(leadId);
        if (index < missingLeadIds.length) {
          void runNext();
        }
      }
    };

    for (let i = 0; i < Math.min(concurrency, missingLeadIds.length); i++) {
      void runNext();
    }

    return () => {
      cancelled = true;
    };
  }, [customFieldValuesByLeadId, fetchLeadCustomFieldValues, sortedLeads, visibleCustomFieldIds]);

  const updateColumnWidth = useCallback((columnId: ColumnId, nextWidth: number) => {
    setColumnPrefs((prev) => prev.map((c) => (c.id === columnId ? { ...c, width: nextWidth } : c)));
  }, []);

  const reorderColumns = useCallback((activeId: ColumnId, overId: ColumnId) => {
    setColumnPrefs((prev) => {
      const activeIndex = prev.findIndex((c) => c.id === activeId);
      const overIndex = prev.findIndex((c) => c.id === overId);
      if (activeIndex < 0 || overIndex < 0) return prev;
      const activeDef = columnDefById.get(activeId);
      const overDef = columnDefById.get(overId);
      if (activeDef?.locked || overDef?.locked) return prev;
      return moveItem(prev, activeIndex, overIndex);
    });
  }, [columnDefById]);

  const setColumnVisible = useCallback((columnId: ColumnId, visible: boolean) => {
    setColumnPrefs((prev) => {
      const def = columnDefById.get(columnId);
      if (def?.locked) return prev;
      return prev.map((c) => (c.id === columnId ? { ...c, visible } : c));
    });
  }, [columnDefById]);

  const handleResizePointerDown = useCallback((columnId: ColumnId, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const def = columnDefById.get(columnId);
    if (!def) return;
    const pref = columnPrefs.find((c) => c.id === columnId);
    const startWidth = clampNumber(pref?.width ?? def.defaultWidth, def.minWidth, def.maxWidth);
    resizingRef.current = { id: columnId, startX: event.clientX, startWidth };
    setResizingColumnId(columnId);
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
  }, [columnDefById, columnPrefs]);

  const handleResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = resizingRef.current;
    if (!current) return;
    const def = columnDefById.get(current.id);
    if (!def) return;
    const delta = event.clientX - current.startX;
    const nextWidth = clampNumber(current.startWidth + delta, def.minWidth, def.maxWidth);
    updateColumnWidth(current.id, nextWidth);
  }, [columnDefById, updateColumnWidth]);

  const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    resizingRef.current = null;
    setResizingColumnId(null);
    document.body.style.cursor = '';
  }, []);

  const beginColumnDrag = useCallback((columnId: ColumnId, label: string, event: React.DragEvent<HTMLElement>) => {
    event.stopPropagation();
    setDraggingColumnId(columnId);
    setDragOverColumnId(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', columnId);

    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.left = '-1000px';
    ghost.style.padding = '6px 10px';
    ghost.style.background = '#111827';
    ghost.style.color = '#ffffff';
    ghost.style.fontSize = '12px';
    ghost.style.fontWeight = '600';
    ghost.style.borderRadius = '8px';
    ghost.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)';
    ghost.textContent = label;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => {
      document.body.removeChild(ghost);
    }, 0);
  }, []);

  const endColumnDrag = useCallback(() => {
    setDraggingColumnId(null);
    setDragOverColumnId(null);
  }, []);

  const tableWidthPx = useMemo(() => {
    const totalWidth = visibleColumns.reduce((sum, col) => sum + col.width, 0);
    // Ensure minimum width to prevent overlaps
    return Math.max(totalWidth, 800);
  }, [visibleColumns]);

  return (
    <div className="w-full">
      {/* Filters */}
      <div className="mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-1 flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search leads..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 min-w-[220px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
            disabled={loading}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="w-full sm:w-52 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400 bg-white"
            disabled={loading}
          >
            <option value="all">All Statuses</option>
            {statuses.map(status => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setIsEditViewOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            <AdjustmentsHorizontalIcon className="w-4 h-4 text-gray-500" />
            Edit View
          </button>
        </div>

        <div className="text-sm text-gray-500">
          {loading ? 'Loading...' : `Showing ${sortedLeads.length} of ${leads.length} leads`}
        </div>
      </div>

      {error && (
        <div
          className="mb-4 text-sm text-gray-800 bg-gray-100 px-3 py-2 rounded-lg border border-gray-300"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </div>
      )}

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-3"></div>
            Loading leads...
          </div>
        ) : sortedLeads.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
            <p>No leads found</p>
            {searchTerm || statusFilter !== 'all' ? (
              <p className="text-sm mt-2">Try adjusting your filters</p>
            ) : (
              <p className="text-sm mt-2">{showDeleted ? 'Trash is empty' : 'Create your first lead to get started'}</p>
            )}
          </div>
        ) : (
          sortedLeads.map(lead => {
            const isRestoring = restoringIds.has(lead.id);
            const daysRemainingText = getDaysRemainingText(lead.deleted_at);
            return (
              <div
                key={lead.id}
                className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm active:scale-[0.99] transition-transform"
              >
                <div className="flex justify-between items-start mb-2">
                  <div
                    className={!showDeleted ? 'cursor-pointer flex-1' : 'flex-1'}
                    data-lead-id={lead.id}
                    onClick={showDeleted ? undefined : handleRowClick}
                  >
                    <h3 className="font-semibold text-gray-900">{lead.name}</h3>
                    <span className="text-xs text-gray-400">#{lead.id}</span>
                  </div>
                  {renderStatusControl(lead, true)}
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center text-sm text-gray-600">
                    <span className="truncate">{lead.email}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <span>{lead.phone}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <span className="truncate">Assigned: {getAssigneeLabel(lead)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <div className="flex gap-2">
                    <ValidationBadge state={getEmailValidationState(lead)} label="Email" />
                    <ValidationBadge valid={isValidFlag(lead.phone_valid)} label="Phone" />
                  </div>
                  <div className="flex items-center gap-2">
                    {showDeleted && daysRemainingText && (
                      <span className="text-xs text-orange-600 font-medium">
                        {daysRemainingText}
                      </span>
                    )}
                    {showDeleted && (
                      <button
                        onClick={(e) => handleRestoreLead(lead.id, lead.name, e)}
                        disabled={isRestoring}
                        className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Restore Lead"
                      >
                        {isRestoring ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                        ) : (
                          <ArrowPathIcon className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block border border-gray-200 rounded-lg overflow-hidden">
        <div 
          className="overflow-x-auto"
          style={{ 
            touchAction: 'pan-x',
            WebkitOverflowScrolling: 'touch',
            minWidth: '100%'
          }}
        >
          <table 
            className="table-fixed" 
            style={{ 
              width: '100%',
              minWidth: tableWidthPx,
              tableLayout: 'fixed'
            }}
          >
            <colgroup>
              {visibleColumns.map((col) => (
                <col 
                  key={col.id} 
                  style={{ 
                    width: `${col.width}px`,
                    minWidth: `${col.width}px`
                  }} 
                />
              ))}
            </colgroup>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {visibleColumns.map((col) => {
                  const isSortable = Boolean(col.sortField);
                  const isDragging = draggingColumnId === col.id;
                  const isDragOver = dragOverColumnId === col.id && draggingColumnId && draggingColumnId !== col.id;
                  const isResizing = resizingColumnId === col.id;
                  return (
                    <th
                      key={col.id}
                      onClick={isSortable ? () => handleSort(col.sortField as keyof Lead) : undefined}
                      onDragOver={(e) => {
                        if (!draggingColumnId) return;
                        e.preventDefault();
                        setDragOverColumnId(col.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const activeId = (e.dataTransfer.getData('text/plain') || draggingColumnId) as ColumnId;
                        if (!activeId) return;
                        reorderColumns(activeId, col.id);
                        endColumnDrag();
                      }}
                      onDragLeave={() => {
                        if (dragOverColumnId === col.id) setDragOverColumnId(null);
                      }}
                      className={[
                        'group relative px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider select-none overflow-hidden',
                        isSortable ? 'cursor-pointer hover:bg-gray-100 transition-colors' : '',
                        isDragging ? 'opacity-50' : '',
                        isDragOver ? 'bg-gray-100' : '',
                      ].join(' ')}
                      style={{
                        width: `${col.width}px`,
                        minWidth: `${col.width}px`
                      }}
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {!col.locked && (
                          <button
                            type="button"
                            draggable
                            onClick={(e) => e.stopPropagation()}
                            onDragStart={(e) => beginColumnDrag(col.id, col.label, e)}
                            onDragEnd={endColumnDrag}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 flex-shrink-0"
                            title="Drag to reorder"
                          >
                            <Bars2Icon className="w-4 h-4" />
                          </button>
                        )}
                        <span className="truncate">{col.label}</span>
                        {isSortable && sortField === col.sortField && (
                          <span className="text-gray-400 flex-shrink-0">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                      <div
                        role="separator"
                        aria-label="Resize column"
                        onPointerDown={(e) => handleResizePointerDown(col.id, e)}
                        onPointerMove={handleResizePointerMove}
                        onPointerUp={handleResizePointerUp}
                        onPointerCancel={handleResizePointerUp}
                        onClick={(e) => e.stopPropagation()}
                        className={[
                          'absolute right-0 top-0 h-full w-2',
                          'cursor-col-resize',
                          isResizing ? 'bg-gray-200' : 'hover:bg-gray-100',
                        ].join(' ')}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-4 py-10 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-3"></div>
                      Loading leads...
                    </div>
                  </td>
                </tr>
              ) : sortedLeads.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-4 py-10 text-center text-gray-500">
                    <p>No leads found</p>
                    {searchTerm || statusFilter !== 'all' ? (
                      <p className="text-sm mt-2">Try adjusting your filters</p>
                    ) : (
                      <p className="text-sm mt-2">{showDeleted ? 'Trash is empty' : 'Create your first lead to get started'}</p>
                    )}
                  </td>
                </tr>
              ) : (
                sortedLeads.map(lead => {
                  return (
                    <tr
                      key={lead.id}
                      data-lead-id={lead.id}
                      onClick={showDeleted ? undefined : handleRowClick}
                      onTouchStart={showDeleted ? undefined : (e) => {
                        // Store touch start to handle tap vs scroll
                        const touch = e.touches[0];
                        if (touch) {
                          (e.currentTarget as any)._touchStartX = touch.clientX;
                          (e.currentTarget as any)._touchStartY = touch.clientY;
                        }
                      }}
                      onTouchEnd={showDeleted ? undefined : (e) => {
                        const target = e.currentTarget as any;
                        const touch = e.changedTouches[0];
                        if (!touch || !target._touchStartX || !target._touchStartY) return;
                        
                        // Check if it was a tap (not a scroll)
                        const deltaX = Math.abs(touch.clientX - target._touchStartX);
                        const deltaY = Math.abs(touch.clientY - target._touchStartY);
                        const isTap = deltaX < 10 && deltaY < 10;
                        
                        // Check if touch was on an interactive element
                        const touchTarget = document.elementFromPoint(touch.clientX, touch.clientY);
                        const isInteractive = touchTarget && (
                          touchTarget.tagName === 'SELECT' ||
                          touchTarget.tagName === 'BUTTON' ||
                          touchTarget.tagName === 'INPUT' ||
                          touchTarget.tagName === 'A' ||
                          touchTarget.closest('select') ||
                          touchTarget.closest('button') ||
                          touchTarget.closest('a')
                        );
                        
                        if (isTap && !isInteractive) {
                          handleRowClick(e as any);
                        }
                        
                        // Clean up
                        delete target._touchStartX;
                        delete target._touchStartY;
                      }}
                      className={`${!showDeleted ? 'hover:bg-gray-50 cursor-pointer transition-colors' : ''}`}
                      style={!showDeleted ? { 
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'manipulation'
                      } : undefined}
                    >
                      {visibleColumns.map((col) => (
                        <td
                          key={`${lead.id}:${col.id}`}
                          className={['px-3 py-2.5 align-middle overflow-hidden', col.cellClassName || ''].join(' ')}
                          style={{ 
                            width: `${col.width}px`,
                            minWidth: `${col.width}px`,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            pointerEvents: 'auto'
                          }}
                          onClick={(e) => {
                            // Allow clicks on cells to bubble to row, unless it's an interactive element
                            const target = e.target as HTMLElement;
                            if (
                              target.tagName === 'SELECT' ||
                              target.tagName === 'BUTTON' ||
                              target.tagName === 'INPUT' ||
                              target.tagName === 'A' ||
                              target.closest('select') ||
                              target.closest('button') ||
                              target.closest('a')
                            ) {
                              e.stopPropagation();
                            }
                          }}
                        >
                          {col.renderCell(lead)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isEditViewOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onMouseDown={() => setIsEditViewOpen(false)}
          />
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l border-gray-200 flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-900">Edit View</div>
              <button
                type="button"
                onClick={() => setIsEditViewOpen(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-100">
              <input
                type="text"
                value={propertySearch}
                onChange={(e) => setPropertySearch(e.target.value)}
                placeholder="Search property"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">In View</div>
                <div className="space-y-1">
                  {columnPrefs
                    .filter((c) => c.visible)
                    .filter((c) => {
                      const def = columnDefById.get(c.id);
                      const label = def?.label || c.id;
                      if (!propertySearch.trim()) return true;
                      return label.toLowerCase().includes(propertySearch.trim().toLowerCase());
                    })
                    .map((c) => {
                      const def = columnDefById.get(c.id);
                      if (!def) return null;
                      const isDragging = draggingColumnId === c.id;
                      const isDragOver = dragOverColumnId === c.id && draggingColumnId && draggingColumnId !== c.id;
                      return (
                        <div
                          key={`inview:${c.id}`}
                          onDragOver={(e) => {
                            if (!draggingColumnId) return;
                            e.preventDefault();
                            setDragOverColumnId(c.id);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const activeId = (e.dataTransfer.getData('text/plain') || draggingColumnId) as ColumnId;
                            if (!activeId) return;
                            reorderColumns(activeId, c.id);
                            endColumnDrag();
                          }}
                          onDragLeave={() => {
                            if (dragOverColumnId === c.id) setDragOverColumnId(null);
                          }}
                          className={[
                            'flex items-center gap-2 px-2 py-2 rounded-lg border',
                            isDragOver ? 'border-gray-400 bg-gray-50' : 'border-transparent hover:bg-gray-50',
                            isDragging ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          {!def.locked ? (
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => beginColumnDrag(c.id, def.label, e)}
                              onDragEnd={endColumnDrag}
                              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                              title="Drag to reorder"
                            >
                              <Bars2Icon className="w-4 h-4" />
                            </button>
                          ) : (
                            <div className="w-4 h-4 flex-shrink-0" />
                          )}
                          <div className="flex-1 text-sm text-gray-900 truncate">{def.label}</div>
                          <input
                            type="checkbox"
                            checked={c.visible}
                            disabled={Boolean(def.locked)}
                            onChange={(e) => setColumnVisible(c.id, e.target.checked)}
                            className="h-4 w-4"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Hidden</div>
                <div className="space-y-1">
                  {columnPrefs
                    .filter((c) => !c.visible)
                    .filter((c) => {
                      const def = columnDefById.get(c.id);
                      const label = def?.label || c.id;
                      if (!propertySearch.trim()) return true;
                      return label.toLowerCase().includes(propertySearch.trim().toLowerCase());
                    })
                    .map((c) => {
                      const def = columnDefById.get(c.id);
                      if (!def) return null;
                      return (
                        <div
                          key={`hidden:${c.id}`}
                          className="flex items-center gap-2 px-2 py-2 rounded-lg border border-transparent hover:bg-gray-50"
                        >
                          <div className="w-4 h-4 flex-shrink-0" />
                          <div className="flex-1 text-sm text-gray-700 truncate">{def.label}</div>
                          <input
                            type="checkbox"
                            checked={c.visible}
                            disabled={Boolean(def.locked)}
                            onChange={(e) => setColumnVisible(c.id, e.target.checked)}
                            className="h-4 w-4"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setColumnPrefs(columnDefinitions.map((d) => ({ id: d.id, visible: d.defaultVisible || Boolean(d.locked), width: d.defaultWidth })));
                }}
                className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-700 bg-white hover:bg-gray-50"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={loadMoreRef} className="h-1" />
      {!loading && loadingMore && (
        <div className="py-4 text-center text-sm text-gray-500">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400 mr-2"></div>
            Loading more leads...
          </div>
        </div>
      )}

      {/* Restore Lead Confirmation Modal */}
      {showRestoreModal && leadToRestore && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-gray-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Restore Lead</h3>
                  <p className="text-sm text-gray-500">
                    Are you sure you want to restore <span className="font-medium">{leadToRestore.name}</span>?
                  </p>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-green-700">
                  This lead will be restored and moved back to your active leads list.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowRestoreModal(false);
                    setLeadToRestore(null);
                  }}
                  disabled={restoringIds.has(leadToRestore.id)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRestoreLead}
                  disabled={restoringIds.has(leadToRestore.id)}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {restoringIds.has(leadToRestore.id) ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4}></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Restoring...
                    </>
                  ) : (
                    'Restore Lead'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// Validation badge component
interface ValidationBadgeProps {
  label: string;
  valid?: boolean;
  state?: ValidationState;
}

function ValidationBadge({ valid = false, state, label }: ValidationBadgeProps) {
  const resolvedState: ValidationState = state ?? (valid ? 'valid' : 'pending');
  const badgeClasses =
    resolvedState === 'valid'
      ? 'bg-green-600 text-white'
      : resolvedState === 'invalid'
        ? 'bg-red-50 text-red-700 border border-red-200'
        : 'bg-white text-gray-700 border border-gray-400';
  const dotClasses =
    resolvedState === 'valid'
      ? 'bg-white'
      : resolvedState === 'invalid'
        ? 'bg-red-600'
        : 'bg-gray-700';

  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded ${badgeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotClasses}`} />
      {label}
    </span>
  );
}
