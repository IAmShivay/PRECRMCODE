
import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-gray-100 pt-20 pb-10 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-12 mb-20">
          <div className="col-span-2">
            <div className="flex items-center space-x-2 mb-6">
              <div className="w-6 h-6 bg-black rounded flex items-center justify-center">
                <div className="w-3 h-3 border border-white rounded-full"></div>
              </div>
              <span className="font-bold text-lg tracking-tight">Scraft CRM</span>
            </div>
            <p className="text-gray-500 text-sm max-w-xs font-medium leading-relaxed">
              The next generation of customer relationship management.
              Powerful pipelines, instant WhatsApp automation, and lightning-fast speeds.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-xs uppercase tracking-widest text-black mb-6">Product</h4>
            <ul className="space-y-4 text-sm text-gray-500 font-light">
              <li><a href="#" className="hover:text-black transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Integrations</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Enterprise</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Solutions</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-xs uppercase tracking-widest text-black mb-6">Resources</h4>
            <ul className="space-y-4 text-sm text-gray-500 font-light">
              <li><a href="#" className="hover:text-black transition-colors">Documentation</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Help Center</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Community</a></li>
              <li><a href="#" className="hover:text-black transition-colors">API Reference</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-xs uppercase tracking-widest text-black mb-6">Company</h4>
            <ul className="space-y-4 text-sm text-gray-500 font-medium">
              <li><a href="#" className="hover:text-black transition-colors">About Us</a></li>
              <li><a href="#" className="hover:text-black transition-colors">Careers</a></li>
              <li><Link to="/privacy" className="hover:text-black transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-black transition-colors">Terms of Service</Link></li>
              <li><Link to="/data-deletion" className="hover:text-black transition-colors">Data Deletion</Link></li>
              <li><Link to="/contact" className="hover:text-black transition-colors">Contact & Support</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-10 border-t border-gray-50 flex flex-col md:flex-row justify-between items-center text-sm text-gray-400 font-light">
          <p>© 2026 Next Up Design. All rights reserved. Break the ice CRM | Scraft Studio</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-black transition-colors">Twitter</a>
            <a href="#" className="hover:text-black transition-colors">LinkedIn</a>
            <a href="#" className="hover:text-black transition-colors">Instagram</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
