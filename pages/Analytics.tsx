import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { formatWorkspaceCurrency } from '../lib/currency';
import type { Lead, LeadStatus, Deal, DealStageConfig } from '../components/types';
import {
  ArrowPathIcon,
  UsersIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon,
  BanknotesIcon,
  ClockIcon,
  ShieldCheckIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface SourceLog {
  id: number;
  event_id: string;
  source: string;
  created_at: string;
}

const formatNumber = (value: number) => value.toLocaleString('en-US');

const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getShortDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'last_90_days';

interface DateRangeOption {
  value: DateRangePreset;
  label: string;
}

const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_90_days', label: 'Last 90 days' },
];

const DATE_RANGE_LABEL: Record<DateRangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  last_90_days: 'Last 90 days',
};

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const daysBetween = (start: Date, end: Date) => {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)) + 1);
};

const computeDateRange = (preset: DateRangePreset): { start: Date; end: Date } => {
  const today = startOfDay(new Date());

  switch (preset) {
    case 'today':
      return { start: new Date(today), end: endOfDay(today) };
    case 'yesterday': {
      const start = new Date(today);
      start.setDate(start.getDate() - 1);
      return { start, end: endOfDay(start) };
    }
    case 'last_7_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { start, end: endOfDay(today) };
    }
    case 'last_30_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start, end: endOfDay(today) };
    }
    case 'last_90_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      return { start, end: endOfDay(today) };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: endOfDay(today) };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start, end: endOfDay(end) };
    }
  }
};

const computePreviousRange = (start: Date, end: Date): { start: Date; end: Date } => {
  const days = daysBetween(start, end);
  const prevEnd = endOfDay(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = startOfDay(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { start: prevStart, end: prevEnd };
};

const buildDateBucketsForRange = (start: Date, end: Date) => {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  const buckets: { key: string; label: string; count: number }[] = [];

  const cursor = new Date(startDate);
  let guard = 0;
  while (cursor.getTime() <= endDate.getTime() && guard < 1000) {
    buckets.push({
      key: formatDateKey(cursor),
      label: getShortDate(cursor),
      count: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  if (buckets.length === 0) {
    buckets.push({ key: formatDateKey(startDate), label: getShortDate(startDate), count: 0 });
  }
  return buckets;
};

const getLabelInterval = (days: number) => {
  if (days <= 14) return 1;
  if (days <= 30) return 5;
  if (days <= 60) return 10;
  if (days <= 90) return 15;
  if (days <= 180) return 30;
  return 60;
};

export default function Analytics() {
  const { currentWorkspace } = useAuth();
  const formatCurrency = React.useCallback(
    (value: number) => formatWorkspaceCurrency(value, currentWorkspace?.currency),
    [currentWorkspace?.currency]
  );
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [statuses, setStatuses] = React.useState<LeadStatus[]>([]);
  const [sources, setSources] = React.useState<SourceLog[]>([]);
  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [dealStages, setDealStages] = React.useState<DealStageConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const [leadsTotal, setLeadsTotal] = React.useState<number | null>(null);
  const [selectedRange, setSelectedRange] = React.useState<DateRangePreset>('last_30_days');

  const sourceNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    sources.forEach((log) => {
      if (log?.event_id) {
        map[log.event_id] = log.source || log.event_id;
      }
    });
    return map;
  }, [sources]);

  const getSourceLabel = React.useCallback((lead: Lead) => {
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
  }, [sourceNameById]);

  const loadAnalytics = React.useCallback(async () => {
    if (!currentWorkspace) return;

    setLoading(true);
    setError(null);
    setLeads([]);
    setStatuses([]);
    setSources([]);
    setDeals([]);
    setDealStages([]);
    setLeadsTotal(null);

    try {
      const token = getAuthToken();
      const headers = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const leadParams = new URLSearchParams({
        workspace_id: String(currentWorkspace.id),
        limit: '10000',
        includeTotal: 'true',
        sort: 'created_at',
        order: 'desc',
      });

      const dealsParams = new URLSearchParams({
        workspace_id: String(currentWorkspace.id),
        limit: '10000',
      });

      const [leadsResponse, statusesResponse, sourcesResponse, dealsResponse, dealStagesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/leads?${leadParams.toString()}`, { headers }),
        fetch(`${API_BASE_URL}/api/lead-statuses?workspace_id=${currentWorkspace.id}`, { headers }),
        fetch(`${API_BASE_URL}/api/sources/${currentWorkspace.id}`, { headers }),
        fetch(`${API_BASE_URL}/api/deals?${dealsParams.toString()}`, { headers }),
        fetch(`${API_BASE_URL}/api/deals/stages?workspace_id=${currentWorkspace.id}`, { headers }),
      ]);

      const leadsPayload = await leadsResponse.json();
      const statusesPayload = await statusesResponse.json();
      const sourcesPayload = await sourcesResponse.json();
      const dealsPayload = await dealsResponse.json();
      const dealStagesPayload = dealStagesResponse.ok ? await dealStagesResponse.json() : null;
      if (dealStagesPayload?.status === 'success' && Array.isArray(dealStagesPayload.data)) {
        setDealStages(dealStagesPayload.data);
      }

      if (leadsResponse.ok && leadsPayload.status === 'success' && Array.isArray(leadsPayload.data)) {
        setLeads(leadsPayload.data);
        if (leadsPayload.metadata && typeof leadsPayload.metadata.total === 'number') {
          setLeadsTotal(leadsPayload.metadata.total);
        } else {
          setLeadsTotal(null);
        }
      } else {
        throw new Error(leadsPayload.message || 'Failed to load leads');
      }

      if (statusesResponse.ok && statusesPayload.status === 'success' && Array.isArray(statusesPayload.data)) {
        const activeStatuses = (statusesPayload.data as LeadStatus[])
          .filter((status) => status.is_active === 1)
          .sort((a, b) => a.order_index - b.order_index);
        setStatuses(activeStatuses);
      } else {
        setStatuses([]);
      }

      if (sourcesResponse.ok && sourcesPayload.status === 'success' && Array.isArray(sourcesPayload.data)) {
        setSources(sourcesPayload.data as SourceLog[]);
      } else {
        setSources([]);
      }

      if (dealsResponse.ok && dealsPayload.status === 'success' && Array.isArray(dealsPayload.data)) {
        setDeals(dealsPayload.data as Deal[]);
      } else {
        setDeals([]);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load analytics:', err);
      setError('Unable to load analytics right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  React.useEffect(() => {
    if (!currentWorkspace) return;
    loadAnalytics();
  }, [currentWorkspace, loadAnalytics]);

  const statusById = React.useMemo(() => {
    const map = new Map<number, LeadStatus>();
    statuses.forEach((status) => map.set(status.id, status));
    return map;
  }, [statuses]);

  const totalLeads = leadsTotal ?? leads.length;

  const statusCounts = React.useMemo(() => {
    const counts = new Map<number, number>();
    leads.forEach((lead) => {
      counts.set(lead.status_id, (counts.get(lead.status_id) || 0) + 1);
    });
    return counts;
  }, [leads]);

  const statusBreakdown = React.useMemo(() => {
    const breakdown = statuses.map((status) => ({
      id: status.id,
      name: status.name,
      count: statusCounts.get(status.id) || 0,
      color: status.color || '#111827',
      type: status.type,
    }));

    const unknownCount = leads.filter((lead) => !statusById.has(lead.status_id)).length;
    if (unknownCount > 0) {
      breakdown.push({
        id: -1,
        name: 'Uncategorized',
        count: unknownCount,
        color: '#9CA3AF',
        type: 'open',
      });
    }

    return breakdown;
  }, [leads, statuses, statusCounts, statusById]);

  const statusTypeCounts = React.useMemo(() => {
    return statusBreakdown.reduce(
      (acc, status) => {
        if (status.type === 'closed_won') acc.won += status.count;
        else if (status.type === 'closed_lost') acc.lost += status.count;
        else acc.open += status.count;
        return acc;
      },
      { open: 0, won: 0, lost: 0 }
    );
  }, [statusBreakdown]);

  const qualifiedStatusIds = React.useMemo(() => {
    return new Set(statuses.filter((status) => status.is_qualified === 1).map((status) => status.id));
  }, [statuses]);

  const qualifiedCount = React.useMemo(() => {
    if (qualifiedStatusIds.size === 0) return 0;
    return leads.filter((lead) => qualifiedStatusIds.has(lead.status_id)).length;
  }, [leads, qualifiedStatusIds]);

  const dateRange = React.useMemo(() => computeDateRange(selectedRange), [selectedRange]);
  const prevDateRange = React.useMemo(
    () => computePreviousRange(dateRange.start, dateRange.end),
    [dateRange]
  );
  const rangeDayCount = React.useMemo(
    () => daysBetween(dateRange.start, dateRange.end),
    [dateRange]
  );
  const rangeLabel = DATE_RANGE_LABEL[selectedRange];

  // Leads by day for chart, scoped to the selected date range
  const leadsByDayForChart = React.useMemo(() => {
    const buckets = buildDateBucketsForRange(dateRange.start, dateRange.end);
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));

    leads.forEach((lead) => {
      const leadDate = new Date(lead.created_at);
      if (Number.isNaN(leadDate.getTime())) return;
      const index = bucketIndex.get(formatDateKey(leadDate));
      if (index === undefined) return;
      buckets[index].count += 1;
    });

    return buckets;
  }, [leads, dateRange]);

  const newLeadsForPeriod = React.useMemo(
    () => leadsByDayForChart.reduce((sum, day) => sum + day.count, 0),
    [leadsByDayForChart]
  );

  // Previous period comparison for new-leads trend
  const prevLeadsForPeriod = React.useMemo(() => {
    const buckets = buildDateBucketsForRange(prevDateRange.start, prevDateRange.end);
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));

    leads.forEach((lead) => {
      const leadDate = new Date(lead.created_at);
      if (Number.isNaN(leadDate.getTime())) return;
      const index = bucketIndex.get(formatDateKey(leadDate));
      if (index === undefined) return;
      buckets[index].count += 1;
    });

    return buckets.reduce((sum, day) => sum + day.count, 0);
  }, [leads, prevDateRange]);

  const maxLeadsPerDay = React.useMemo(
    () => Math.max(1, ...leadsByDayForChart.map((day) => day.count)),
    [leadsByDayForChart]
  );

  const sourceBreakdown = React.useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    leads.forEach((lead) => {
      const key = (lead.source_old || 'unknown').trim() || 'unknown';
      const label = getSourceLabel(lead);
      const existing = counts.get(key) || { label, count: 0 };
      existing.count += 1;
      existing.label = label;
      counts.set(key, existing);
    });

    return Array.from(counts.entries())
      .map(([source, data]) => ({
        source,
        label: data.label,
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [leads, getSourceLabel]);

  const emailValidCount = leads.filter((lead) => lead.email_valid === 1).length;
  const phoneValidCount = leads.filter((lead) => lead.phone_valid === 1).length;
  const emailValidRate = totalLeads ? emailValidCount / totalLeads : 0;
  const phoneValidRate = totalLeads ? phoneValidCount / totalLeads : 0;
  const qualifiedRate = totalLeads ? qualifiedCount / totalLeads : 0;
  const conversionStageIds = React.useMemo(() => new Set(
    dealStages.length > 0
      ? dealStages.filter((stage) => stage.counts_as_conversion).map((stage) => stage.slug)
      : ['won']
  ), [dealStages]);
  const activeStageIds = React.useMemo(() => new Set(
    dealStages.length > 0
      ? dealStages.filter((stage) => !stage.counts_as_conversion && stage.slug !== 'won' && stage.slug !== 'lost').map((stage) => stage.slug)
      : ['new_lead', 'qualified', 'in_discussion', 'proposal', 'negotiation']
  ), [dealStages]);

  // Calculate revenue from closed deals (stage === 'won')
  const closedDeals = React.useMemo(() => {
    return deals.filter((deal) => String(deal.stage || '').trim() === 'won');
  }, [deals]);

  const totalRevenue = React.useMemo(() => {
    return closedDeals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  }, [closedDeals]);

  const avgDealValue = closedDeals.length > 0 ? totalRevenue / closedDeals.length : 0;

  const openPipelineValue = React.useMemo(() => {
    return deals
      .filter((deal) => activeStageIds.has(String(deal.stage || '').trim()))
      .reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  }, [deals, activeStageIds]);

  const avgDealVelocity = React.useMemo(() => {
    const closed = deals.filter(
      (deal) => {
        const stage = String(deal.stage || '').trim();
        return (conversionStageIds.has(stage) || stage === 'won' || stage === 'lost') && deal.created_at && deal.updated_at;
      }
    );
    if (closed.length === 0) return 0;
    const totalDays = closed.reduce((sum, deal) => {
      const start = new Date(deal.created_at!);
      const end = new Date(deal.updated_at!);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return sum + (diffDays || 1); // min 1 day
    }, 0);
    return Math.round(totalDays / closed.length);
  }, [deals, conversionStageIds]);

  const leadsWithDealsCount = React.useMemo(() => {
    const ids = new Set(deals.filter((deal) => deal.lead_id).map((deal) => deal.lead_id));
    return leads.filter((lead) => ids.has(lead.id)).length;
  }, [leads, deals]);

  const convertedLeadsCount = React.useMemo(() => {
    const ids = new Set(deals.filter((deal) => deal.lead_id && conversionStageIds.has(deal.stage)).map((deal) => deal.lead_id));
    return leads.filter((lead) => ids.has(lead.id)).length;
  }, [leads, deals, conversionStageIds]);

  const leadToDealConversionRate = totalLeads > 0 ? convertedLeadsCount / totalLeads : 0;

  const sourcePerformance = React.useMemo(() => {
    const map = new Map<string, { label: string; leadCount: number; convertedCount: number; revenue: number }>();

    // Map of lead ID to its source
    const leadSourceMap = new Map<number, string>();
    leads.forEach((lead) => {
      const key = (lead.source_old || 'unknown').trim() || 'unknown';
      leadSourceMap.set(lead.id, key);

      const label = getSourceLabel(lead);
      const existing = map.get(key) || { label, leadCount: 0, convertedCount: 0, revenue: 0 };
      existing.leadCount += 1;
      map.set(key, existing);
    });

    deals.forEach((deal) => {
      if (deal.lead_id) {
        const sourceKey = leadSourceMap.get(deal.lead_id);
        if (sourceKey) {
          const existing = map.get(sourceKey);
          if (existing) {
            if (conversionStageIds.has(String(deal.stage || '').trim())) existing.convertedCount += 1;
            if (deal.stage === 'won') existing.revenue += Number(deal.value || 0);
          }
        }
      }
    });

    return Array.from(map.entries())
      .map(([source, data]) => ({
        source,
        label: data.label,
        leadCount: data.leadCount,
        convertedCount: data.convertedCount,
        revenue: data.revenue,
        conversionRate: data.leadCount > 0 ? data.convertedCount / data.leadCount : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.leadCount - a.leadCount);
  }, [leads, deals, getSourceLabel, conversionStageIds]);

  // Revenue by day for chart (scoped to selected date range)
  const revenueByDayForChart = React.useMemo(() => {
    const buckets = buildDateBucketsForRange(dateRange.start, dateRange.end);
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));

    closedDeals.forEach((deal) => {
      // Use updated_at (when deal was closed) if available, otherwise use created_at
      const dateStr = deal.updated_at || deal.created_at;
      if (!dateStr) return;
      const dealDate = new Date(dateStr);
      if (Number.isNaN(dealDate.getTime())) return;
      const key = formatDateKey(dealDate);
      const index = bucketIndex.get(key);
      if (index === undefined) return;
      buckets[index].count += Number(deal.value || 0);
    });

    return buckets;
  }, [closedDeals, dateRange]);

  // Calculate revenue for selected period + previous period comparison
  const revenueForPeriod = React.useMemo(() => {
    return closedDeals.filter((deal) => {
      const dateStr = deal.updated_at || deal.created_at;
      if (!dateStr) return false;
      const dealDate = new Date(dateStr);
      return dealDate >= dateRange.start && dealDate <= dateRange.end;
    }).reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  }, [closedDeals, dateRange]);

  const prevRevenueForPeriod = React.useMemo(() => {
    return closedDeals.filter((deal) => {
      const dateStr = deal.updated_at || deal.created_at;
      if (!dateStr) return false;
      const dealDate = new Date(dateStr);
      return dealDate >= prevDateRange.start && dealDate <= prevDateRange.end;
    }).reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  }, [closedDeals, prevDateRange]);

  const maxRevenuePerDay = React.useMemo(() => {
    return Math.max(1, ...revenueByDayForChart.map((day) => day.count));
  }, [revenueByDayForChart]);

  const DEAL_STAGE_META = React.useMemo(() => Object.fromEntries(dealStages.map((stage, order) => [
    stage.slug, { label: stage.name, color: stage.color, order },
  ])) as Record<string, { label: string; color: string; order: number }>, [dealStages]);

  const dealPipeline = React.useMemo(() => {
    const stageCounts = new Map<string, { count: number; value: number }>();
    deals.forEach((deal) => {
      const stage = String(deal.stage || 'new_lead').trim();
      const existing = stageCounts.get(stage) || { count: 0, value: 0 };
      existing.count += 1;
      existing.value += Number(deal.value || 0);
      stageCounts.set(stage, existing);
    });

    return Array.from(stageCounts.entries())
      .map(([stage, data]) => ({
        stage,
        label: DEAL_STAGE_META[stage]?.label || toTitleCase(stage),
        color: DEAL_STAGE_META[stage]?.color || '#6B7280',
        order: DEAL_STAGE_META[stage]?.order ?? 99,
        count: data.count,
        value: data.value,
      }))
      .sort((a, b) => a.order - b.order);
  }, [deals, DEAL_STAGE_META]);

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Please select a workspace to view analytics.</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <main className="mx-auto w-full max-w-[1600px]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Analytics</h1>
            <p className="text-xs sm:text-sm text-gray-500">
              Activity for {currentWorkspace.name}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {lastUpdated && (
              <span className="hidden md:inline text-[10px] sm:text-xs text-gray-400">
                Updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <label htmlFor="analytics-range" className="sr-only">Filter by date range</label>
            <select
              id="analytics-range"
              value={selectedRange}
              onChange={(e) => setSelectedRange(e.target.value as DateRangePreset)}
              className="text-xs sm:text-sm px-3 py-1.5 sm:py-2 border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 cursor-pointer"
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              onClick={loadAnalytics}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh analytics"
              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {error && (
          <div
            className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                  <div className="h-3 w-16 bg-gray-200 rounded mb-3" />
                  <div className="h-7 w-24 bg-gray-200 rounded mb-2" />
                  <div className="h-3 w-20 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
                <div className="h-3 w-24 bg-gray-100 rounded mb-6" />
                <div className="flex items-end gap-1 h-40">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="flex-1 bg-gray-100 rounded-full" style={{ height: `${20 + Math.random() * 60}%` }} />
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
                <div className="h-3 w-28 bg-gray-100 rounded mb-6" />
                <div className="space-y-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i}>
                      <div className="h-3 w-full bg-gray-100 rounded mb-2" />
                      <div className="h-2 bg-gray-100 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard
                label="Total leads"
                value={formatNumber(totalLeads)}
                subtitle="All-time leads captured"
                icon={UsersIcon}
                gradientClassName="from-indigo-50/20 to-white"
              />
              <StatCardWithTrend
                label="New leads"
                value={formatNumber(newLeadsForPeriod)}
                rangeLabel={rangeLabel}
                currentValue={newLeadsForPeriod}
                previousValue={prevLeadsForPeriod}
                icon={ArrowTrendingUpIcon}
                gradientClassName="from-blue-50/20 to-white"
              />
              <StatCard
                label="Lead Conversion"
                value={formatPercent(leadToDealConversionRate)}
                subtitle="Leads with converted deals"
                icon={ChartBarIcon}
                gradientClassName="from-purple-50/20 to-white"
              />
              <StatCard
                label="Qualified leads"
                value={formatNumber(qualifiedCount)}
                subtitle={`${formatPercent(qualifiedRate)} of total leads`}
                icon={ShieldCheckIcon}
                gradientClassName="from-teal-50/20 to-white"
              />
              <StatCard
                label="Total revenue"
                value={formatCurrency(totalRevenue)}
                subtitle={`${closedDeals.length} closed won deals`}
                icon={BanknotesIcon}
                gradientClassName="from-green-50/20 to-white font-semibold"
              />
              <StatCardWithTrend
                label="Revenue"
                value={formatCurrency(revenueForPeriod)}
                rangeLabel={rangeLabel}
                currentValue={revenueForPeriod}
                previousValue={prevRevenueForPeriod}
                icon={BanknotesIcon}
                gradientClassName="from-emerald-50/20 to-white font-semibold"
              />
              <StatCard
                label="Avg deal value"
                value={formatCurrency(avgDealValue)}
                subtitle={closedDeals.length > 0 ? `Across ${closedDeals.length} won deals` : 'No won deals yet'}
                icon={CheckCircleIcon}
                gradientClassName="from-pink-50/20 to-white"
              />
              <StatCard
                label="Sales Cycle"
                value={avgDealVelocity > 0 ? `${avgDealVelocity} days` : '—'}
                subtitle="Average days to close deals"
                icon={ClockIcon}
                gradientClassName="from-amber-50/20 to-white"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">Leads over time</h2>
                    <p className="text-xs sm:text-sm text-gray-500">{rangeLabel}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-500">
                    <span>Open {formatNumber(statusTypeCounts.open)}</span>
                    <span>Won {formatNumber(statusTypeCounts.won)}</span>
                    <span>Lost {formatNumber(statusTypeCounts.lost)}</span>
                  </div>
                </div>

                {totalLeads === 0 ? (
                  <div className="py-12 text-center text-gray-500">No leads yet.</div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
                    <div className="flex items-end gap-0.5 sm:gap-1 h-40 min-w-max">
                      {(() => {
                        const interval = getLabelInterval(rangeDayCount);
                        return leadsByDayForChart.map((bucket, i) => {
                          const height = Math.round((bucket.count / maxLeadsPerDay) * 100);
                          const showLabel = i % interval === 0 || i === leadsByDayForChart.length - 1;
                          return (
                            <div key={bucket.key} className="flex flex-col items-center gap-1 sm:gap-2 min-w-[24px] sm:min-w-[28px] group/bar cursor-pointer">
                              <div className="w-full bg-gray-50 rounded-full h-28 flex items-end shadow-inner border border-gray-100">
                                <div
                                  className="w-full bg-gradient-to-t from-gray-900 to-indigo-950 group-hover/bar:from-indigo-600 group-hover/bar:to-indigo-400 rounded-full transition-all duration-300 shadow-sm"
                                  style={{ height: `${height}%` }}
                                  title={`${bucket.label}: ${bucket.count}`}
                                />
                              </div>
                              <span className="text-[9px] sm:text-[10px] text-gray-400 group-hover/bar:text-indigo-600 font-medium whitespace-nowrap transition-colors">
                                {showLabel ? bucket.label : ''}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Data quality</h2>
                <p className="text-xs sm:text-sm text-gray-500">Validation coverage</p>

                {totalLeads === 0 ? (
                  <div className="py-10 text-center text-gray-500">No validation data yet.</div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <ProgressRow
                      label="Email valid"
                      value={`${formatPercent(emailValidRate)} (${formatNumber(emailValidCount)})`}
                      percent={emailValidRate}
                      color="#111827"
                    />
                    <ProgressRow
                      label="Phone valid"
                      value={`${formatPercent(phoneValidRate)} (${formatNumber(phoneValidCount)})`}
                      percent={phoneValidRate}
                      color="#4B5563"
                    />
                    <ProgressRow
                      label="Qualified leads"
                      value={`${formatPercent(qualifiedRate)} (${formatNumber(qualifiedCount)})`}
                      percent={qualifiedRate}
                      color="#111827"
                    />
                    <div className="pt-3 border-t border-gray-100 text-xs text-gray-500">
                      Based on {formatNumber(totalLeads)} leads
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Lead Acquisition & Source Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 overflow-hidden">
                <div className="mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Source Performance</h2>
                  <p className="text-xs sm:text-sm text-gray-500">Revenue, volume, and conversion rates by acquisition channel</p>
                </div>

                {sourcePerformance.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">No source performance data available.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead>
                        <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          <th className="py-3 px-4">Source</th>
                          <th className="py-3 px-4 text-right">Leads</th>
                          <th className="py-3 px-4 text-right">Converted Deals</th>
                          <th className="py-3 px-4 text-right">Conversion</th>
                          <th className="py-3 px-4 text-right">Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-gray-700">
                        {sourcePerformance.map((row) => (
                          <tr key={row.source} className="hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-4 font-medium text-gray-900">{row.label}</td>
                            <td className="py-3 px-4 text-right">{formatNumber(row.leadCount)}</td>
                            <td className="py-3 px-4 text-right">{formatNumber(row.convertedCount)}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                row.conversionRate > 0.2 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {formatPercent(row.conversionRate)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-gray-900">{formatCurrency(row.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Active Pipeline</h2>
                  <p className="text-xs sm:text-sm text-gray-500">Deals currently active in pipeline stages</p>
                </div>
                <div className="my-6 flex flex-col justify-center items-center text-center p-6 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border border-blue-100 rounded-xl">
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-blue-600 mb-1">Total Active Pipeline</span>
                  <span className="text-3xl font-extrabold text-gray-950 tracking-tight">{formatCurrency(openPipelineValue)}</span>
                  <span className="text-xs text-gray-500 mt-2 font-medium">
                    Across {deals.filter(d => activeStageIds.has(d.stage || '')).length} active deals
                  </span>
                </div>
                <div className="pt-3 border-t border-gray-100 text-xs text-gray-400">
                  Excludes conversion, Won, and Lost stages
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 lg:grid-flow-dense">
              {totalLeads > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Conversion funnel</h2>
                  <p className="text-xs sm:text-sm text-gray-500">Leads with deals and leads in a configured conversion stage</p>
                  <div className="mt-4 sm:mt-5">
                    {(() => {
                      const stages = [
                        { label: 'Total Leads', count: totalLeads, color: '#6B7280' },
                        { label: 'Leads with deals', count: leadsWithDealsCount, color: '#3B82F6' },
                        { label: 'Converted leads', count: convertedLeadsCount, color: '#10B981' },
                      ];
                      const maxWidth = 100;
                      return (
                        <div className="space-y-2">
                          {stages.map((stage, i) => {
                            const widthPct = totalLeads > 0 ? Math.max(8, (stage.count / totalLeads) * maxWidth) : 0;
                            const conversionFromPrev = i > 0 && stages[i - 1].count > 0
                              ? (stage.count / stages[i - 1].count) * 100
                              : null;
                            return (
                              <div key={stage.label}>
                                {conversionFromPrev !== null && (
                                  <div className="flex items-center gap-2 py-1 pl-4">
                                    <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="none">
                                      <path d="M6 2v8M3 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <span className="text-[10px] sm:text-xs text-gray-400">
                                      {Math.round(conversionFromPrev)}% conversion
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-3">
                                  <div
                                    className="h-10 sm:h-12 rounded-lg flex items-center px-3 sm:px-4 transition-all"
                                    style={{ width: `${widthPct}%`, backgroundColor: stage.color }}
                                  >
                                    <span className="text-white text-xs sm:text-sm font-medium truncate">{stage.label}</span>
                                  </div>
                                  <span className="text-sm sm:text-base font-semibold text-gray-900 shrink-0">{formatNumber(stage.count)}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Status breakdown</h2>
                <p className="text-xs sm:text-sm text-gray-500">Pipeline distribution</p>

                {statusBreakdown.length === 0 ? (
                  <div className="py-10 text-center text-gray-500">No statuses configured.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {statusBreakdown.map((status) => {
                      const percent = totalLeads ? status.count / totalLeads : 0;
                      return (
                        <div key={status.id}>
                          <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-1.5">
                            <span className="truncate pr-2">{status.name}</span>
                            <span className="shrink-0">{formatNumber(status.count)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round(percent * 100)}%`,
                                backgroundColor: status.color || '#111827',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Top sources</h2>
                <p className="text-xs sm:text-sm text-gray-500">Lead acquisition</p>

                {sourceBreakdown.length === 0 ? (
                  <div className="py-10 text-center text-gray-500">No source data yet.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {sourceBreakdown.slice(0, 6).map((source) => {
                      const percent = totalLeads ? source.count / totalLeads : 0;
                      return (
                        <div key={source.source}>
                          <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-1.5">
                            <span className="truncate pr-2">{source.label}</span>
                            <span className="shrink-0">{formatNumber(source.count)}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gray-900 rounded-full"
                              style={{ width: `${Math.round(percent * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-2 text-[10px] sm:text-xs text-gray-500">
                      {sources.length > 0
                        ? `${formatNumber(sources.length)} registered sources`
                        : 'No registered sources yet'}
                    </div>
                  </div>
                )}
              </div>

              {deals.length > 0 && (
                <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 ${dealPipeline.length > 4 ? 'lg:col-span-2' : ''}`}>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Deal pipeline</h2>
                  <p className="text-xs sm:text-sm text-gray-500">{formatNumber(deals.length)} deals across {dealPipeline.length} stages</p>

                  <div className="mt-4 space-y-3">
                    {dealPipeline.map((stage) => {
                      const percent = deals.length ? stage.count / deals.length : 0;
                      return (
                        <div key={stage.stage}>
                          <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-1.5">
                            <span className="truncate pr-2">{stage.label}</span>
                            <span className="shrink-0 flex items-center gap-2">
                              <span className="text-gray-400">{formatCurrency(stage.value)}</span>
                              <span>{formatNumber(stage.count)}</span>
                            </span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.round(percent * 100)}%`, backgroundColor: stage.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {closedDeals.length > 0 && (
              <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 overflow-hidden">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Revenue over time</h2>
                <p className="text-xs sm:text-sm text-gray-500">{rangeLabel} · closed deals</p>

                {revenueForPeriod === 0 ? (
                  <div className="py-10 text-center text-gray-500">No revenue data yet.</div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5 mt-4">
                    <div className="flex items-end gap-0.5 sm:gap-1 h-40 min-w-max">
                      {(() => {
                        const interval = getLabelInterval(rangeDayCount);
                        return revenueByDayForChart.map((bucket, i) => {
                          const height = Math.round((bucket.count / maxRevenuePerDay) * 100);
                          const showLabel = i % interval === 0 || i === revenueByDayForChart.length - 1;
                          return (
                            <div key={bucket.key} className="flex flex-col items-center gap-1 sm:gap-2 min-w-[24px] sm:min-w-[28px] group/bar cursor-pointer">
                              <div className="w-full bg-gray-50 rounded-full h-28 flex items-end shadow-inner border border-gray-100">
                                <div
                                  className="w-full bg-gradient-to-t from-emerald-600 to-teal-400 group-hover/bar:from-emerald-500 group-hover/bar:to-teal-300 rounded-full transition-all duration-300 shadow-sm"
                                  style={{ height: `${height}%` }}
                                  title={`${bucket.label}: ${formatCurrency(bucket.count)}`}
                                />
                              </div>
                              <span className="text-[9px] sm:text-[10px] text-gray-400 group-hover/bar:text-emerald-600 font-medium whitespace-nowrap transition-colors">
                                {showLabel ? bucket.label : ''}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  subtitle: string;
  icon?: React.ComponentType<{ className?: string }>;
  gradientClassName?: string;
}

function StatCard({ label, value, subtitle, icon: Icon, gradientClassName = 'from-white to-white hover:border-gray-900/10' }: StatCardProps) {
  return (
    <div className={`bg-gradient-to-br ${gradientClassName} rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 group`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] sm:text-xs uppercase tracking-wide font-semibold text-gray-500">{label}</p>
          <div className="mt-1 sm:mt-2 text-xl sm:text-2xl font-bold text-gray-900 group-hover:text-black transition-colors">{value}</div>
        </div>
        {Icon && (
          <div className="p-2 bg-gray-50 rounded-lg text-gray-400 group-hover:text-gray-900 group-hover:bg-gray-100 transition-colors shrink-0">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      <p className="text-xs sm:text-sm text-gray-400 mt-2 font-medium">{subtitle}</p>
    </div>
  );
}

interface StatCardWithTrendProps {
  label: string;
  value: string;
  rangeLabel: string;
  currentValue?: number;
  previousValue?: number;
  icon?: React.ComponentType<{ className?: string }>;
  gradientClassName?: string;
}

function StatCardWithTrend({
  label,
  value,
  rangeLabel,
  currentValue,
  previousValue,
  icon: Icon,
  gradientClassName = 'from-white to-white hover:border-gray-900/10',
}: StatCardWithTrendProps) {
  const trend = React.useMemo(() => {
    if (previousValue === undefined || currentValue === undefined || previousValue === 0) return null;
    const change = ((currentValue - previousValue) / previousValue) * 100;
    return { change: Math.round(change), direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat' as const };
  }, [previousValue, currentValue]);

  return (
    <div className={`bg-gradient-to-br ${gradientClassName} rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 group`}>
      <div className="flex items-start justify-between mb-1 sm:mb-2 gap-2">
        <p className="text-[10px] sm:text-xs uppercase tracking-wide font-semibold text-gray-500 truncate">{label}</p>
      </div>
      <div className="mt-1 sm:mt-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold text-gray-900 group-hover:text-black transition-colors">{value}</span>
          {trend && trend.direction !== 'flat' && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded-md ${
              trend.direction === 'up' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
            }`}>
              <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none">
                {trend.direction === 'up' ? (
                  <path d="M6 2.5v7M6 2.5L3 5.5M6 2.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M6 9.5v-7M6 9.5L3 6.5M6 9.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
              {Math.abs(trend.change)}%
            </span>
          )}
        </div>
        {Icon && (
          <div className="p-2 bg-gray-50 rounded-lg text-gray-400 group-hover:text-gray-900 group-hover:bg-gray-100 transition-colors shrink-0">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      <p className="text-xs sm:text-sm text-gray-400 mt-2 font-medium">
        {rangeLabel}{trend && previousValue !== undefined && previousValue > 0 ? ' vs prior period' : ''}
      </p>
    </div>
  );
}

interface ProgressRowProps {
  label: string;
  value: string;
  percent: number;
  color: string;
}

function ProgressRow({ label, value, percent, color }: ProgressRowProps) {
  return (
    <div className="group">
      <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-1.5">
        <span className="truncate pr-2 font-medium text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
        <span className="shrink-0 font-semibold text-gray-900">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-1.5 shadow-inner">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.round(percent * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
