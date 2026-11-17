import { useState, useEffect } from 'react';

type Scenario = 'facebook_lead' | 'whatsapp_reply' | 'status_change';

export default function DashboardPreview() {
  const [activeScenario, setActiveScenario] = useState<Scenario>('facebook_lead');
  const [pulseEnrich, setPulseEnrich] = useState(false);

  // Trigger pulse effect when scenario changes to show database enrichment
  useEffect(() => {
    if (activeScenario !== 'facebook_lead') return;

    setPulseEnrich(true);
    const timer = setTimeout(() => setPulseEnrich(false), 2000);
    return () => clearTimeout(timer);
  }, [activeScenario]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Scenario Selector Controls - Styled exactly like the workspace card selector in the dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <button
          onClick={() => setActiveScenario('facebook_lead')}
          className={`flex-1 text-left p-5 rounded-xl border transition-all duration-300 relative ${
            activeScenario === 'facebook_lead'
              ? 'bg-white border-black ring-2 ring-black/5 shadow-md scale-[1.02]'
              : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center space-x-3 mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${activeScenario === 'facebook_lead' ? 'bg-indigo-500 animate-pulse' : 'bg-gray-300'}`}></span>
            <span className="font-bold text-xs tracking-wider uppercase text-black">1. Inbound Capture</span>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-gray-500">
            Leads enter CRM instantly from Facebook Ads or custom Webhooks.
          </p>
        </button>

        <button
          onClick={() => setActiveScenario('whatsapp_reply')}
          className={`flex-1 text-left p-5 rounded-xl border transition-all duration-300 relative ${
            activeScenario === 'whatsapp_reply'
              ? 'bg-white border-black ring-2 ring-black/5 shadow-md scale-[1.02]'
              : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center space-x-3 mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${activeScenario === 'whatsapp_reply' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
            <span className="font-bold text-xs tracking-wider uppercase text-black">2. Auto-Welcome</span>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-gray-500">
            WhatsApp API immediately triggers a personalized welcome template.
          </p>
        </button>

        <button
          onClick={() => setActiveScenario('status_change')}
          className={`flex-1 text-left p-5 rounded-xl border transition-all duration-300 relative ${
            activeScenario === 'status_change'
              ? 'bg-white border-black ring-2 ring-black/5 shadow-md scale-[1.02]'
              : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center space-x-3 mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${activeScenario === 'status_change' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`}></span>
            <span className="font-bold text-xs tracking-wider uppercase text-black">3. Smart Workflow</span>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-gray-500">
            Updating CRM stage (e.g., "No Answer") automates follow-ups.
          </p>
        </button>
      </div>

      {/* Main Display Container */}
      <div className="bg-white rounded-[2.5rem] border border-gray-200 p-3 shadow-2xl shadow-gray-200/50">
        <div className="bg-[#FAF9F6] rounded-[2rem] border border-gray-100 overflow-hidden flex flex-col lg:flex-row min-h-[600px] lg:h-[680px]">

          {/* CRM Panel */}
          <div className="flex-1 flex flex-col border-b lg:border-b-0 lg:border-r border-gray-200/70 bg-white">
            {/* CRM Header */}
            <div className="h-16 border-b border-gray-100 px-6 flex items-center justify-between bg-gray-50/40">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-green-400"></span>
                <div className="h-4 w-px bg-gray-200 mx-1"></div>
                <span className="font-bold text-[10px] uppercase tracking-wider text-gray-400">Scraft Lead Manager</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold border border-blue-100">
                  FB Ads Connect
                </span>
                <span className="px-2 py-0.5 rounded bg-green-50 text-green-600 text-[10px] font-bold border border-green-200 animate-pulse">
                  WhatsApp Active
                </span>
              </div>
            </div>

            {/* CRM Body */}
            <div className="p-6 flex-1 flex flex-col bg-[#FDFDFD]">
              {/* Stat metrics - Styled exactly like the dashboard stats inside */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="text-xs font-semibold text-gray-400 uppercase">Total Leads</div>
                  <div className="text-xl md:text-2xl font-extrabold text-black mt-1">428</div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="text-xs font-semibold text-gray-400 uppercase">WhatsApp Open</div>
                  <div className="text-xl md:text-2xl font-extrabold text-green-600 mt-1">94.2%</div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="text-xs font-semibold text-gray-400 uppercase">Automations</div>
                  <div className="text-xl md:text-2xl font-extrabold text-black mt-1">1,824</div>
                </div>
              </div>

              {/* Kanban Pipelines */}
              <div className="grid grid-cols-3 gap-4 flex-1">
                {/* Pipeline 1: Inbound Capture */}
                <div className="bg-gray-50/50 rounded-xl p-3 flex flex-col min-h-[300px] border border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Incoming</span>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded">1</span>
                  </div>

                  <div className="space-y-3 flex-1">
                    {/* Animated Lead Card */}
                    <div
                      className={`p-3.5 rounded-xl border bg-white transition-all duration-700 shadow-sm ${
                        activeScenario === 'facebook_lead'
                          ? 'border-black ring-2 ring-black/5 scale-[1.03] shadow-md'
                          : 'border-gray-200 opacity-90'
                      } ${pulseEnrich ? 'animate-pulse' : ''}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[9px] font-bold border border-indigo-100 flex items-center">
                          Facebook Ad
                        </span>
                        <span className="text-[9px] text-gray-400 font-semibold">1m ago</span>
                      </div>
                      <h4 className="font-bold text-xs text-black">Sarah Jenkins</h4>
                      <p className="text-[10px] text-gray-500 mt-1 font-medium">Apex Development Co.</p>

                      {/* Enrichment Section */}
                      <div className="mt-3 pt-2.5 border-t border-gray-100 space-y-1">
                        <div className="flex justify-between text-[9px] font-medium">
                          <span className="text-gray-400">Email</span>
                          <span className="text-black font-semibold">sarah@apex.com</span>
                        </div>
                        <div className="flex justify-between text-[9px] font-medium">
                          <span className="text-gray-400">Size</span>
                          <span className="text-black font-semibold">50 - 150 seats</span>
                        </div>
                        <div className="flex justify-between text-[9px] font-medium">
                          <span className="text-gray-400">Auto-Enrich</span>
                          <span className="text-indigo-600 font-bold flex items-center">
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full mr-1 animate-ping"></span>
                            Verified ✓
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pipeline 2: Contacted / Automating */}
                <div className="bg-gray-50/50 rounded-xl p-3 flex flex-col min-h-[300px] border border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Contacted</span>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {activeScenario === 'whatsapp_reply' ? '1' : '0'}
                    </span>
                  </div>

                  <div className="space-y-3 flex-1 relative">
                    {activeScenario !== 'facebook_lead' ? (
                      <div
                        className={`p-3.5 rounded-xl border bg-white transition-all duration-700 shadow-sm ${
                          activeScenario === 'whatsapp_reply'
                            ? 'border-black ring-2 ring-black/5 scale-[1.03] shadow-md'
                            : 'border-gray-200 opacity-70 translate-y-1'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-[9px] font-bold border border-green-200 flex items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse"></span>
                            WhatsApp Sent
                          </span>
                          <span className="text-[9px] text-gray-400 font-semibold">Just now</span>
                        </div>
                        <h4 className="font-bold text-xs text-black">Sarah Jenkins</h4>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium">Apex Development Co.</p>

                        <div className="mt-2.5 pt-2 border-t border-gray-100">
                          <span className="text-[9px] text-gray-400 block">Active Campaign</span>
                          <span className="text-[10px] font-bold text-gray-800">"New Lead Welcome"</span>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center text-[10px] text-gray-300 font-bold bg-white/50 select-none">
                        Waiting for reply
                      </div>
                    )}
                  </div>
                </div>

                {/* Pipeline 3: Follow-up / Status Trigger */}
                <div className="bg-gray-50/50 rounded-xl p-3 flex flex-col min-h-[300px] border border-gray-100">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Follow Up</span>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {activeScenario === 'status_change' ? '1' : '0'}
                    </span>
                  </div>

                  <div className="space-y-3 flex-1">
                    {activeScenario === 'status_change' ? (
                      <div className="p-3.5 rounded-xl border border-black ring-2 ring-black/5 bg-white transition-all duration-700 shadow-md scale-[1.03]">
                        <div className="flex justify-between items-start mb-2">
                          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[9px] font-bold border border-amber-100 flex items-center">
                            No Answer
                          </span>
                          <span className="text-[9px] text-gray-400 font-semibold">Just now</span>
                        </div>
                        <h4 className="font-bold text-xs text-black">Sarah Jenkins</h4>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium">Apex Development Co.</p>

                        <div className="mt-3 pt-2.5 border-t border-gray-100 space-y-1">
                          <div className="flex justify-between text-[9px]">
                            <span className="text-gray-400">Trigger Auto-SMS</span>
                            <span className="text-green-600 font-bold">Enabled</span>
                          </div>
                          <div className="flex justify-between text-[9px]">
                            <span className="text-gray-400">Trigger template</span>
                            <span className="text-gray-800 font-bold">call_no_answer</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center text-[10px] text-gray-300 font-bold bg-white/50 select-none">
                        Drop here to trigger
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Smartphone WhatsApp Simulator */}
          <div className="w-full lg:w-[320px] bg-slate-100 flex flex-col p-4 justify-center items-center">
            {/* Phone Wrapper */}
            <div className="w-full max-w-[270px] aspect-[9/18.5] bg-black rounded-[2.5rem] p-2.5 shadow-2xl relative border-4 border-gray-800">
              {/* Dynamic Camera Notch */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-16 h-4 bg-black rounded-full z-30"></div>

              {/* WhatsApp Interface inside Phone Screen */}
              <div className="w-full h-full bg-[#E5DDD5] rounded-[2rem] overflow-hidden flex flex-col relative">

                {/* WA Header */}
                <div className="bg-[#075E54] text-white p-3 pt-5 flex items-center space-x-2 z-10 shrink-0">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center font-bold text-[10px]">SC</div>
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-[10.5px] truncate">Scraft CRM Workspace</h5>
                    <div className="flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                      <span className="text-[8px] text-green-200 font-medium">Auto-pilot active</span>
                    </div>
                  </div>
                </div>

                {/* WA Chat Content */}
                <div className="flex-1 p-3 space-y-3.5 overflow-y-auto flex flex-col justify-end">

                  {/* Static Info Badge */}
                  <div className="bg-[#FCF5E5] text-[7.5px] text-gray-500 p-2 rounded-lg text-center shadow-sm mx-1 leading-snug border border-yellow-100">
                    Illustrative conversation using sample data.
                  </div>

                  {/* Scenario 1: User fills form on Facebook (Inbound Capture) */}
                  <div className={`transition-all duration-700 ease-out transform ${
                    activeScenario === 'facebook_lead' || activeScenario === 'whatsapp_reply' || activeScenario === 'status_change'
                      ? 'opacity-100 translate-y-0 scale-100'
                      : 'opacity-0 translate-y-4 scale-95'
                  }`}>
                    {/* User Inbound message mockup */}
                    <div className="bg-white text-black text-[9.5px] p-2.5 rounded-lg max-w-[85%] self-start shadow-sm relative leading-snug">
                      <div className="font-bold text-[#075E54] text-[8px] mb-0.5">Sarah Jenkins (Inbound)</div>
                      Hello! I just saw your ad and submitted a lead. Interested in WhatsApp Automation.
                      <span className="text-[7px] text-gray-400 block text-right mt-1">11:13 AM</span>
                    </div>
                  </div>

                  {/* Scenario 2: Instant Welcome Reply */}
                  <div className={`transition-all duration-700 ease-out transform delay-300 ${
                    activeScenario === 'whatsapp_reply' || activeScenario === 'status_change'
                      ? 'opacity-100 translate-y-0 scale-100'
                      : 'opacity-0 translate-y-4 scale-95'
                  }`}>
                    {/* Automated CRM message mockup */}
                    <div className="bg-[#DCF8C6] text-black text-[9.5px] p-2.5 rounded-lg max-w-[85%] ml-auto shadow-sm relative leading-snug border border-[#BFF0A6]">
                      <div className="font-bold text-green-700 text-[8px] mb-0.5">⚡ Scraft Auto-Reply</div>
                      Hi Sarah! Welcome to Scraft CRM. 🚀
                      <br /><br />
                      We've captured your details and assigned a tech specialist. Here is our pricing guide:
                      <div className="mt-2 p-1.5 bg-white/70 border border-green-200/50 rounded flex items-center justify-between text-[8px] font-semibold text-green-900">
                        📄 scraft-crm-pricing.pdf
                        <span className="text-[7px] text-green-600 bg-green-100 px-1 rounded">2.4MB</span>
                      </div>
                      <span className="text-[7px] text-gray-400 block text-right mt-1">11:13 AM</span>
                    </div>
                  </div>

                  {/* Scenario 3: Call no answer follow up triggered */}
                  <div className={`transition-all duration-700 ease-out transform ${
                    activeScenario === 'status_change'
                      ? 'opacity-100 translate-y-0 scale-100'
                      : 'opacity-0 translate-y-4 scale-95'
                  }`}>
                    {/* Status change CRM trigger message mockup */}
                    <div className="bg-[#DCF8C6] text-black text-[9.5px] p-2.5 rounded-lg max-w-[85%] ml-auto shadow-sm relative leading-snug border border-[#BFF0A6]">
                      <div className="font-bold text-orange-700 text-[8px] mb-0.5">⚡ Status Triggered: Call Not Answered</div>
                      Hi Sarah, we tried calling your number earlier to discuss the setup but couldn't reach you.
                      <br /><br />
                      Let us know when you're free! Tap below to book a time slot on our calendar:
                      <div className="mt-2 text-center py-1 bg-white text-[#075E54] border border-[#075E54] rounded-md font-bold text-[8px] hover:bg-slate-50 cursor-pointer">
                        🗓️ Book a Call
                      </div>
                      <span className="text-[7px] text-gray-400 block text-right mt-1">11:14 AM</span>
                    </div>
                  </div>

                </div>

                {/* WA Message input simulation */}
                <div className="p-2 bg-white flex items-center space-x-2 shrink-0">
                  <div className="flex-1 bg-gray-100 rounded-full px-3 py-1 flex items-center justify-between">
                    <span className="text-[9px] text-gray-400 font-medium">Type a message...</span>
                    <span className="text-gray-400">📎</span>
                  </div>
                  <div className="w-7 h-7 bg-[#075E54] rounded-full flex items-center justify-center text-white text-[10px]">
                    🎤
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
