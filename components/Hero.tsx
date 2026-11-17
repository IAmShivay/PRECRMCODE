import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const Hero: React.FC = () => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Small timeout to ensure the browser has painted the initial state
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="pt-32 pb-20 lg:pt-48 lg:pb-36 px-6 bg-grid relative overflow-hidden bg-white">
      {/* Premium Ambient Light Glows */}
      <div className="absolute top-12 left-1/4 w-[400px] h-[400px] bg-indigo-200/40 rounded-full blur-3xl pointer-events-none -z-10"></div>
      <div className="absolute top-24 right-1/4 w-[350px] h-[350px] bg-emerald-100/40 rounded-full blur-3xl pointer-events-none -z-10"></div>

      <div
        className={`max-w-5xl mx-auto text-center relative z-10 transition-all duration-[1000ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      >
        {/* Badge */}
        <div className="inline-flex items-center px-4 py-1.5 rounded-full border border-gray-200 bg-white/95 mb-8 sm:mb-10 shadow-sm hover:border-gray-300 transition-colors cursor-pointer">
          <span className="h-2 w-2 rounded-full bg-green-500 mr-2.5 animate-pulse"></span>
          <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500">Live WhatsApp API Integration</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-[5.5rem] font-extrabold tracking-tight text-black mb-6 sm:mb-8 leading-[1.05] sm:leading-[1.05]">
          Capture leads.<br />
          <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-emerald-500 bg-clip-text text-transparent">Automate WhatsApp.</span>
        </h1>

        {/* Subtext */}
        <p className="text-base sm:text-lg lg:text-xl text-gray-600 max-w-xl sm:max-w-3xl mx-auto mb-10 sm:mb-12 font-medium leading-relaxed">
          The high-performance lead management platform for modern sales teams. <br className="hidden md:block" />
          Stream inbound leads instantly from Facebook Ads and Webhooks, enrich profiles automatically, and trigger customized WhatsApp follow-ups.
        </p>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-5">
          <Link
            to="/signup"
            className="w-full sm:w-auto px-10 py-4 bg-black text-white rounded-full text-sm font-bold transition-all flex items-center justify-center group hover:bg-gray-900 active:scale-95 shadow-lg shadow-black/10"
          >
            Start Free Trial
            <span className="ml-2 transition-transform group-hover:translate-x-1">-&gt;</span>
          </Link>

          <Link
            to="/contact"
            className="w-full sm:w-auto px-10 py-4 bg-white border border-gray-200 text-black rounded-full text-sm font-bold transition-all flex items-center justify-center shadow-sm hover:bg-gray-50 hover:border-gray-300 active:scale-95"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
};

export default Hero;
