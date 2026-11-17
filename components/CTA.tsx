import React from 'react';
import { Link } from 'react-router-dom';

const CTA: React.FC = () => {
  return (
    <section id="pricing" className="py-24 px-6 bg-white scroll-mt-24">
      <div className="max-w-5xl mx-auto relative group">
        {/* Glow behind the CTA card */}
        <div className="absolute -inset-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 rounded-[3rem] blur-xl opacity-20 group-hover:opacity-30 transition duration-1000"></div>

        {/* Main CTA Card */}
        <div className="bg-black rounded-[3rem] p-12 lg:p-24 text-center text-white relative overflow-hidden flex flex-col items-center shadow-2xl">
          {/* Subtle gradient pattern overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-transparent to-emerald-950/20 pointer-events-none opacity-40"></div>

          {/* Subtle architectural lines */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-5">
            <div className="absolute top-0 left-1/4 w-px h-full bg-white"></div>
            <div className="absolute top-0 left-2/4 w-px h-full bg-white"></div>
            <div className="absolute top-0 left-3/4 w-px h-full bg-white"></div>
          </div>

          <div className="relative z-10 max-w-2xl">
            <span className="px-3 py-1.5 rounded-full bg-white/10 text-white text-[10px] font-bold tracking-widest uppercase border border-white/5 mb-8 inline-block">
              Immediate Setup
            </span>
            <h2 className="text-4xl lg:text-6xl font-extrabold mb-6 tracking-tight leading-tight">
              Ready to automate <br />your sales pipeline?
            </h2>
            <p className="text-gray-400 text-base lg:text-lg mb-10 font-medium leading-relaxed">
              Don't let high-intent leads slip away. Deploy Scraft CRM's WhatsApp integration and webhook endpoints in less than 5 minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-5">
              <Link to="/signup" className="w-full sm:w-auto bg-white text-black px-10 py-4 rounded-full font-bold hover:bg-gray-100 transition-all active:scale-95 shadow-xl shadow-white/5 text-sm text-center">
                Start Free Trial
              </Link>
              <button className="w-full sm:w-auto text-white border border-white/20 bg-white/5 backdrop-blur-sm px-10 py-4 rounded-full font-bold hover:bg-white/10 transition-all text-sm">
                Schedule Demo Call
              </button>
            </div>
            <p className="mt-8 text-gray-500 text-xs font-bold tracking-wider uppercase">
              Free setup guidance &nbsp; • &nbsp; No credit card required
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;
