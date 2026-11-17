import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthToken } from '../lib/storage';
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from './SocialIcons';
import WorkspaceSelector from './WorkspaceSelector';
import {
  HomeIcon,
  InboxStackIcon,
  UserGroupIcon,
  IdentificationIcon,
  UserPlusIcon,
  RectangleStackIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  TrashIcon,
  QuestionMarkCircleIcon,
  BoltIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface SidebarProps {
  collapsed?: boolean;
}

type NavIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface NavItem {
  name: string;
  href: string;
  icon: NavIcon;
  count?: number | null;
  iconClass?: string;
}

const ACCENT_TEXT = 'text-[#1F5FD6]';
const ACCENT_BG = 'bg-[#EAF1FE]';
const BADGE = 'bg-[#E5383B] text-white';

interface NavSection {
  label?: string;
  items: NavItem[];
}

const initialsOf = (name?: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

const Sidebar: React.FC<SidebarProps> = ({ collapsed = false }) => {
  const { user, currentWorkspace, getUserRole } = useAuth();
  const location = useLocation();
  const [sourcesCount, setSourcesCount] = useState<number | null>(null);
  const [leadsCount, setLeadsCount] = useState<number | null>(null);
  const isWorkspaceAdmin = currentWorkspace ? getUserRole(currentWorkspace.id) === 'admin' : false;

  const fetchSourcesCount = React.useCallback(async () => {
    if (!currentWorkspace || !isWorkspaceAdmin) {
      setSourcesCount(null);
      return;
    }

    const token = getAuthToken();
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/sources/${currentWorkspace.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.status === 'success' && data.data) {
        setSourcesCount(Array.isArray(data.data) ? data.data.length : 0);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to fetch sources count:', error);
    }
  }, [currentWorkspace, isWorkspaceAdmin]);

  const fetchLeadsCount = React.useCallback(async () => {
    if (!currentWorkspace) return;

    const token = getAuthToken();
    if (!token) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/leads/count?workspace_id=${currentWorkspace.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) return;

      const data = await response.json();

      if (data.status === 'success' && data.data && typeof data.data.count === 'number') {
        setLeadsCount(data.data.count);
      }
    } catch (error) {
      console.error('[Sidebar] Failed to fetch leads count:', error);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!currentWorkspace) return;
    setSourcesCount(null);
    setLeadsCount(null);
    if (isWorkspaceAdmin) fetchSourcesCount();
    fetchLeadsCount();
  }, [currentWorkspace, isWorkspaceAdmin, fetchSourcesCount, fetchLeadsCount]);

  useEffect(() => {
    if (!currentWorkspace) return;
    const token = getAuthToken();
    if (!token) return;

    const interval = setInterval(() => {
      if (getAuthToken()) {
        if (isWorkspaceAdmin) fetchSourcesCount();
        fetchLeadsCount();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [currentWorkspace, isWorkspaceAdmin, fetchSourcesCount, fetchLeadsCount]);

  useEffect(() => {
    if (!currentWorkspace) return;
    const handleFocus = () => {
      if (isWorkspaceAdmin) fetchSourcesCount();
      fetchLeadsCount();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentWorkspace, isWorkspaceAdmin, fetchSourcesCount, fetchLeadsCount]);

  useEffect(() => {
    if (!currentWorkspace) return;
    const handleLeadsChanged = () => {
      fetchLeadsCount();
    };
    window.addEventListener('leadsChanged', handleLeadsChanged);
    return () => window.removeEventListener('leadsChanged', handleLeadsChanged);
  }, [currentWorkspace, fetchLeadsCount]);

  const sections: NavSection[] = currentWorkspace
    ? [
        {
          items: [
            { name: 'Home', href: '/dashboard', icon: HomeIcon },
            { name: 'Leads', href: '/leads', icon: UserGroupIcon, count: leadsCount },
            { name: 'Prospects', href: '/prospects', icon: UserPlusIcon },
            { name: 'Deals', href: '/deals', icon: RectangleStackIcon },
            { name: 'Customers', href: '/customers', icon: IdentificationIcon },
            { name: 'Tasks', href: '/tasks', icon: ClipboardDocumentCheckIcon },
            { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
            ...(isWorkspaceAdmin ? [{ name: 'Automations', href: '/automations', icon: BoltIcon }] : []),
          ],
        },
        ...(isWorkspaceAdmin
          ? [{
              label: 'Lead capture',
              items: [
                { name: 'Lead sources', href: `/workspace/${currentWorkspace.id}/sources`, icon: InboxStackIcon, count: sourcesCount },
                { name: 'Facebook Lead Ads', href: `/workspace/${currentWorkspace.id}/integrations/facebook`, icon: FacebookIcon, iconClass: 'text-[#1877F2]' },
              ],
            }]
          : []),
        {
          label: 'Channels',
          items: [
            { name: 'WhatsApp', href: '/whatsapp', icon: WhatsAppIcon, iconClass: 'text-[#25D366]' },
            { name: 'Instagram', href: '/instagram', icon: InstagramIcon, iconClass: 'text-[#E1306C]' },
          ],
        },
        {
          label: 'Tools',
          items: [
            { name: 'MCP connector', href: '/settings/mcp', icon: CpuChipIcon },
            { name: 'Trash', href: '/trash', icon: TrashIcon },
          ],
        },
      ]
    : [];

  const footerItems: NavItem[] = [
    { name: 'Workspace settings', href: '/settings', icon: Cog6ToothIcon },
    { name: 'Help', href: '/support', icon: QuestionMarkCircleIcon },
  ];

  const isActivePath = (href: string) =>
    href === '/settings' ? location.pathname === href : location.pathname === href || location.pathname.startsWith(`${href}/`);

  const renderItem = (item: NavItem) => {
    const active = isActivePath(item.href);
    return (
      <NavLink
        key={item.href}
        to={item.href}
        title={collapsed ? item.name : ''}
        className={`group relative flex items-center ${collapsed ? 'px-2 justify-center' : 'px-3'} py-2 text-[15px] rounded-md transition-colors ${
          active ? `${ACCENT_BG} ${ACCENT_TEXT} font-semibold` : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <item.icon
          className={`flex-shrink-0 h-5 w-5 ${active ? ACCENT_TEXT : item.iconClass || 'text-gray-500 group-hover:text-gray-700'} ${!collapsed ? 'mr-3' : ''}`}
          aria-hidden="true"
        />
        {!collapsed && <span className="truncate">{item.name}</span>}
        {!collapsed && item.count != null && item.count > 0 && (
          <span className={`ml-auto min-w-[1.6rem] text-center ${BADGE} py-0.5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums`}>
            {item.count.toLocaleString()}
          </span>
        )}
        {collapsed && item.count != null && item.count > 0 && (
          <span aria-hidden="true" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#E5383B]" />
        )}
      </NavLink>
    );
  };

  return (
    <div className={`h-full bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${collapsed ? 'items-center' : ''}`}>
      <div className={`flex-1 flex flex-col pt-5 pb-4 overflow-y-auto w-full ${collapsed ? 'px-1.5' : 'px-3 sm:px-4'}`}>
        <div className={`w-full ${collapsed ? 'flex justify-center mb-2' : 'mb-4'}`}>
          <WorkspaceSelector collapsed={collapsed} />
        </div>
        {currentWorkspace && (
          <nav className="flex-1 space-y-5" aria-label="Main">
            {sections.map((section, i) => (
              <div key={section.label ?? i} className="space-y-0.5">
                {section.label && !collapsed && (
                  <p className="px-3 pb-1 text-[13px] text-gray-400">{section.label}</p>
                )}
                {section.label && collapsed && <div className="mx-2 my-2 border-t border-gray-100" />}
                {section.items.map(renderItem)}
              </div>
            ))}
          </nav>
        )}
      </div>

      {currentWorkspace && (
        <div className={`flex-shrink-0 border-t border-gray-200 ${collapsed ? 'p-1.5' : 'px-3 sm:px-4 py-3'} w-full space-y-0.5`}>
          {footerItems.map(renderItem)}
          <NavLink
            to="/account"
            title={collapsed ? 'Account' : ''}
            className={`mt-2 flex items-center gap-3 rounded-md border-t border-gray-100 pt-3 ${collapsed ? 'justify-center p-1.5' : 'px-2 pb-1'} transition-colors ${
              isActivePath('/account') ? ACCENT_BG : 'hover:bg-gray-50'
            }`}
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[11px] font-semibold text-white">
              {initialsOf(user?.name)}
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-gray-900">{user?.name || 'Account'}</span>
                <span className="block truncate text-xs text-gray-500">{currentWorkspace.name}</span>
              </span>
            )}
          </NavLink>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
