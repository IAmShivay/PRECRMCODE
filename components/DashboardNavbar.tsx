import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NotificationsBell from './NotificationsBell';
import {
  ChevronDownIcon,
  ChevronDoubleLeftIcon,
  DocumentTextIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

interface DashboardNavbarProps {
  onToggleSidebar?: () => void;
  onToggleCollapsed?: () => void;
  collapsed?: boolean;
}

const DashboardNavbar: React.FC<DashboardNavbarProps> = ({ onToggleSidebar, onToggleCollapsed, collapsed = false }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userInitial = (user?.name || '').trim().charAt(0).toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50 h-16">
      <div className={`h-full flex justify-between items-center transition-all ${collapsed ? 'pl-3 pr-4 sm:pr-6' : 'px-4 sm:px-6'}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="md:hidden mr-1 inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gray-900"
          >
            <span className="sr-only">Open sidebar</span>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          {collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Expand sidebar"
              className="hidden md:flex items-center focus:outline-none"
            >
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center hover:bg-gray-800 transition-colors">
                <div className="w-4 h-4 border-2 border-white rounded-full"></div>
              </div>
            </button>
          ) : (
            <>
              <Link to="/dashboard" className="flex items-center space-x-2 group">
                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white rounded-full"></div>
                </div>
                <span className="font-bold text-xl tracking-tight text-black">Break the ice</span>
              </Link>
              {onToggleCollapsed && (
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  title="Collapse sidebar"
                  className="hidden md:inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none"
                >
                  <ChevronDoubleLeftIcon className="w-5 h-5" />
                </button>
              )}
            </>
          )}
          {collapsed && (
            <Link to="/dashboard" className="flex items-center space-x-2 group md:hidden">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-white rounded-full"></div>
              </div>
              <span className="font-bold text-xl tracking-tight text-black">Break the ice</span>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <NotificationsBell />
          <div className="hidden sm:block mr-1">
            <span className="text-sm font-medium text-gray-900 max-w-[140px] truncate block">
              {user?.name || 'Account'}
            </span>
          </div>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center space-x-2 focus:outline-none"
            >
              <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center text-white font-medium text-sm">
                {userInitial || 'U'}
              </div>
              <ChevronDownIcon className="w-4 h-4 text-gray-400" />
            </button>
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-100 py-2 z-50">
                <div>
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Options
                  </div>
                  <Link
                    to="/terms"
                    onClick={() => setIsDropdownOpen(false)}
                    className="w-full text-left px-3 py-2 flex items-center text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <DocumentTextIcon className="w-4 h-4 mr-2 text-gray-400" />
                    Terms of Service
                  </Link>
                  <Link
                    to="/privacy"
                    onClick={() => setIsDropdownOpen(false)}
                    className="w-full text-left px-3 py-2 flex items-center text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ShieldCheckIcon className="w-4 h-4 mr-2 text-gray-400" />
                    Privacy Policy
                  </Link>
                  <button
                    onClick={() => {
                      setIsDropdownOpen(false);
                      handleLogout();
                    }}
                    className="w-full text-left px-3 py-2 flex items-center text-sm text-red-600 hover:bg-red-50"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default DashboardNavbar;
