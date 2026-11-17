import React from 'react';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children, title, subtitle }) => {
  return (
    <div className="min-h-screen bg-white flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-black text-white flex-col justify-between p-12 relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(to right, #333 1px, transparent 1px), linear-gradient(to bottom, #333 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}></div>
        </div>

        {/* Top logo */}
        <div className="relative z-10">
          <h1 className="text-2xl font-bold tracking-tight">Break the ice</h1>
          <p className="text-gray-400 text-sm mt-1">CRM Platform</p>
        </div>

        {/* Center content */}
        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-bold leading-tight mb-4">
            A simpler way to manage customer relationships
          </h2>
          <p className="text-gray-300 text-lg">
            Built for clarity, performance, and enterprise-grade simplicity.
          </p>
        </div>

        {/* Bottom info */}
        <div className="relative z-10">
          <p className="text-gray-400 text-sm">
            Trusted by teams worldwide
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-black">Break the ice</h1>
            <p className="text-gray-400 text-sm mt-1">CRM Platform</p>
          </div>

          {/* Form content */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-black mb-2">{title}</h2>
            {subtitle && (
              <p className="text-gray-500">{subtitle}</p>
            )}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
