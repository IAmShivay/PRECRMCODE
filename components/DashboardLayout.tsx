import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import DashboardNavbar from './DashboardNavbar';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import { AiChatWidget } from './chat/AiChatWidget';

const DashboardLayout: React.FC = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const location = useLocation();
  const routeResetKey = `${location.pathname}${location.search}${location.hash}`;

  React.useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-white">
      <DashboardNavbar
        onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        collapsed={collapsed}
      />
      <div className="flex pt-16">
        <div
          className={`hidden md:flex ${collapsed ? 'md:w-14' : 'md:w-64'} bg-white border-r border-gray-200 flex-col fixed left-0 top-16 bottom-0 z-40 transition-all duration-300 ease-in-out`}
        >
          <ErrorBoundary resetKeys={[routeResetKey, collapsed]} retryLabel="Reload sidebar" variant="section">
            <Sidebar collapsed={collapsed} />
          </ErrorBoundary>
        </div>

        {mobileSidebarOpen && (
          <div className="fixed inset-x-0 top-16 bottom-0 z-40 flex md:hidden">
            <div
              className="fixed inset-x-0 top-16 bottom-0 bg-black bg-opacity-30"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="relative flex w-64 bg-white border-r border-gray-200 h-full flex-col">
              <ErrorBoundary resetKeys={[routeResetKey, mobileSidebarOpen]} retryLabel="Reload sidebar" variant="section">
                <Sidebar collapsed={false} />
              </ErrorBoundary>
            </div>
          </div>
        )}

        <main
          className={`flex-1 min-w-0 p-4 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)] transition-all duration-300 ease-in-out ${collapsed ? 'md:ml-14' : 'md:ml-64'}`}
        >
          <ErrorBoundary resetKeys={[routeResetKey]} retryLabel="Reload page section" variant="section">
            <Outlet context={{ collapsed }} />
          </ErrorBoundary>
        </main>
        <AiChatWidget />
      </div>
    </div>
  );
};

export default DashboardLayout;
