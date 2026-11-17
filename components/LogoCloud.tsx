
import React from 'react';

const LogoCloud: React.FC = () => {
  return (
    <div id="customers" className="py-24 bg-white scroll-mt-24">
      <div className="max-w-7xl mx-auto px-6">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-gray-400 mb-16">
          Built for every step of your customer journey
        </p>
        <div className="flex flex-wrap justify-center items-center gap-x-16 gap-y-12 opacity-[0.35] grayscale transition-all duration-700 hover:opacity-100 cursor-default">
          <div className="text-2xl font-black tracking-tighter">CAPTURE</div>
          <div className="text-2xl font-black tracking-tighter">QUALIFY</div>
          <div className="text-2xl font-black tracking-tighter">FOLLOW UP</div>
          <div className="text-2xl font-black tracking-tighter">CONVERT</div>
          <div className="text-2xl font-black tracking-tighter">SUPPORT</div>
          <div className="text-2xl font-black tracking-tighter">RETAIN</div>
        </div>
      </div>
    </div>
  );
};

export default LogoCloud;
