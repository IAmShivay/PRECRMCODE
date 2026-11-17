import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAuthToken } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import type { Lead, LeadStatus } from './types';
import { MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface LeadsSidebarListProps {
    className?: string;
}

type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

export default function LeadsSidebarList({ className }: LeadsSidebarListProps) {
    const { currentWorkspace } = useAuth();
    const navigate = useNavigate();
    const { leadId } = useParams<{ leadId: string }>();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [statuses, setStatuses] = useState<LeadStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('newest');

    // Fetch statuses for color coding
    useEffect(() => {
        if (!currentWorkspace) return;
        const fetchStatuses = async () => {
            try {
                const token = getAuthToken();
                const response = await fetch(
                    `${API_BASE_URL}/api/lead-statuses?workspace_id=${currentWorkspace.id}`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                );
                const data = await response.json();
                if (data.status === 'success') {
                    setStatuses(data.data);
                }
            } catch (err) {
                console.error('Error fetching statuses', err);
            }
        };
        fetchStatuses();
    }, [currentWorkspace]);

    // Fetch leads
    useEffect(() => {
        if (!currentWorkspace) return;
        const fetchLeads = async () => {
            setLoading(true);
            try {
                const token = getAuthToken();
                // Fetch most recent 100 leads
                const response = await fetch(
                    `${API_BASE_URL}/api/leads?workspace_id=${currentWorkspace.id}&limit=100`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                );
                const data = await response.json();
                if (data.status === 'success' && data.data) {
                    setLeads(data.data);
                }
            } catch (err) {
                console.error('Error fetching leads', err);
            } finally {
                setLoading(false);
            }
        };
        fetchLeads();
    }, [currentWorkspace]);

    // Compute duplicate detection maps for tags
    const duplicateTagsByLeadId = useMemo(() => {
        const phoneCounts = new Map<string, number>();
        const emailCounts = new Map<string, number>();
        const nameCounts = new Map<string, number>();

        for (const lead of leads) {
            const phone = (lead.phone || '').trim().toLowerCase();
            const email = (lead.email || '').trim().toLowerCase();
            const name = (lead.name || '').trim().toLowerCase();
            if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
            if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
            if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }

        const result = new Map<number, string[]>();
        for (const lead of leads) {
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
    }, [leads]);

    const filteredLeads = leads.filter(l =>
        l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const sortedLeads = useMemo(() => {
        return [...filteredLeads].sort((a, b) => {
            if (sortBy === 'newest') {
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            }
            if (sortBy === 'oldest') {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            if (sortBy === 'name-asc') {
                return a.name.localeCompare(b.name);
            }
            if (sortBy === 'name-desc') {
                return b.name.localeCompare(a.name);
            }
            return 0;
        });
    }, [filteredLeads, sortBy]);

    return (
        <div className={`flex flex-col bg-white border-r border-gray-200 h-full ${className || ''}`}>
            <div className="p-4 border-b border-gray-100 space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Leads List</h3>
                    <div className="flex items-center gap-1.5">
                        <label htmlFor="sidebar-sort" className="text-xs text-gray-400 font-medium">Sort:</label>
                        <select
                            id="sidebar-sort"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="text-xs bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-900 cursor-pointer"
                        >
                            <option value="newest">Latest</option>
                            <option value="oldest">Oldest</option>
                            <option value="name-asc">Name A-Z</option>
                            <option value="name-desc">Name Z-A</option>
                        </select>
                    </div>
                </div>
                <div className="relative">
                    <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        id="sidebar-search-leads"
                        type="text"
                        placeholder="Search leads..."
                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-4 text-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto"></div>
                    </div>
                ) : sortedLeads.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-500">No leads found</div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {sortedLeads.map(lead => {
                            const isActive = Number(leadId) === lead.id;
                            const status = statuses.find(s => s.id === lead.status_id);
                            const statusColor = status?.color || '#9CA3AF';
                            const dupTags = duplicateTagsByLeadId.get(lead.id);

                            return (
                                <div
                                    key={lead.id}
                                    onClick={() => navigate(`/leads/${lead.id}`)}
                                    className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors border-l-4 ${isActive ? 'bg-blue-50/50 border-blue-600' : 'border-transparent'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`font-semibold text-sm ${isActive ? 'text-blue-900' : 'text-gray-900'}`}>{lead.name}</span>
                                        <span className="text-xs text-gray-400">
                                            {new Date(lead.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <div className="flex items-center gap-1 flex-1 min-w-0">
                                            <span className="text-xs text-gray-500 truncate">{lead.email}</span>
                                            {lead.email_valid === 1 && <CheckIcon className="w-3 h-3 text-green-600 flex-shrink-0" />}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {/* Status badge */}
                                        <span 
                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                                            style={{
                                                backgroundColor: statusColor + '12',
                                                color: statusColor,
                                                borderColor: statusColor + '30',
                                            }}
                                        >
                                            {status?.name || 'Unknown'}
                                        </span>
                                        
                                        {/* Duplicate tags */}
                                        {dupTags && dupTags.map(tag => (
                                            <span 
                                                key={tag}
                                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200"
                                            >
                                                {tag}
                                            </span>
                                        ))}
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
