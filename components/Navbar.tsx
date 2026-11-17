
import React from 'react';
import { Link } from 'react-router-dom';

interface NavbarProps {
  scrolled: boolean;
}

const Navbar: React.FC<NavbarProps> = ({ scrolled }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const navLinks = [
    { name: 'Features', href: '#product' },
    { name: 'WhatsApp Automation', href: '#whatsapp-automation' },
    { name: 'Integrations', href: '#solutions' },
    { name: 'Pricing', href: '#pricing' }
  ];

  return (
    <nav className={`fixed top-0 w-full z-50 transition-all duration-500 ${scrolled ? 'bg-white/80 backdrop-blur-md border-b border-gray-200/50 py-4 shadow-sm' : 'bg-transparent py-6'}`}>
      <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
        <Link to="/" className="flex items-center space-x-2.5 group cursor-pointer z-50 relative">
          <div className="w-9 h-9 bg-black rounded-xl flex items-center justify-center transition-transform duration-500 group-hover:scale-105 group-hover:rotate-3 shadow-md shadow-black/10">
            <div className="w-4 h-4 border-2 border-white rounded-full flex items-center justify-center">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg tracking-tight text-black leading-tight">Scraft CRM</span>
            <span className="text-[9px] text-gray-500 font-semibold tracking-wider uppercase leading-none mt-0.5">WhatsApp Automation</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex space-x-8 items-center text-sm font-medium">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="relative text-gray-500 hover:text-black transition-colors duration-300 group py-1"
            >
              {link.name}
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-black transition-all duration-300 ease-out group-hover:w-full"></span>
            </a>
          ))}
        </div>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center space-x-6">
          <Link to="/login" className="relative text-sm font-medium text-gray-500 hover:text-black transition-colors duration-300 group py-1">
            Sign in
            <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-black transition-all duration-300 ease-out group-hover:w-full"></span>
          </Link>
          <Link to="/signup" className="bg-black text-white px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:bg-gray-800 hover:shadow-lg hover:shadow-black/10 active:scale-95">
            Get Started
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 text-gray-900 z-50 relative focus:outline-none"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <div className="w-6 h-5 flex flex-col justify-between">
            <span className={`w-full h-0.5 bg-black rounded-full transition-all duration-300 origin-left ${mobileMenuOpen ? 'rotate-45 translate-x-px' : ''}`}></span>
            <span className={`w-full h-0.5 bg-black rounded-full transition-all duration-300 ${mobileMenuOpen ? 'opacity-0' : 'opacity-100'}`}></span>
            <span className={`w-full h-0.5 bg-black rounded-full transition-all duration-300 origin-left ${mobileMenuOpen ? '-rotate-45 translate-x-px' : ''}`}></span>
          </div>
        </button>

        {/* Mobile Menu Overlay */}
        <div className={`fixed inset-0 bg-white z-40 flex flex-col pt-24 px-6 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${mobileMenuOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
          <div className="flex flex-col space-y-6">
            {navLinks.map((link, idx) => (
              <a
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-2xl font-bold text-gray-900"
                style={{ transitionDelay: `${idx * 50}ms` }}
              >
                {link.name}
              </a>
            ))}
            <div className="w-full h-[1px] bg-gray-100 my-6"></div>
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="text-xl font-medium text-gray-600"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              onClick={() => setMobileMenuOpen(false)}
              className="bg-black text-white px-8 py-4 rounded-full text-center text-lg font-bold transition-all active:scale-95"
            >
              Get Started
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
