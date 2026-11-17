import { useState } from 'react';

type TabKey = 'whatsapp' | 'pipeline' | 'integrations';

export default function Features() {
  const [activeTab, setActiveTab] = useState<TabKey>('whatsapp');

  const tabsInfo = {
    whatsapp: {
      title: 'WhatsApp Automation Hub',
      subtitle: 'Nurture leads automatically without lifting a finger.',
      description: 'Connect your WhatsApp Business API and configure instant automated messages that keep leads engaged 24/7.',
      points: [
        {
          title: 'New Lead Auto-Welcome',
          desc: 'Immediately greet new sign-ups or inbound inquiries with customized template messages.'
        },
        {
          title: 'One-Click "No Answer" Follow-ups',
          desc: 'Fired up from the CRM details page if a call goes unanswered, dropping a scheduler link automatically.'
        },
        {
          title: 'Bulk Broadcast Campaigns',
          desc: 'Blast notifications, newsletters, or offers to segment groups of contacts with full delivery tracking.'
        }
      ],
      mockup: (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4 w-full">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="font-bold text-sm text-black">WhatsApp Triggers</span>
            <span className="px-2 py-0.5 rounded bg-green-50 text-green-600 text-[10px] font-bold border border-green-200">Active</span>
          </div>
          <div className="space-y-2">
            <div className="p-3 bg-white rounded-xl border border-gray-100 hover:border-black transition-all flex justify-between items-center shadow-sm">
              <div>
                <span className="font-bold text-xs text-black block">new_lead (Welcome Message)</span>
                <span className="text-[10px] text-gray-400">Sent on initial lead creation</span>
              </div>
              <span className="text-[10px] bg-black text-white font-bold px-2 py-1 rounded-lg">Auto</span>
            </div>
            <div className="p-3 bg-white rounded-xl border border-gray-100 hover:border-black transition-all flex justify-between items-center shadow-sm">
              <div>
                <span className="font-bold text-xs text-black block">call_no_answer (Follow-up)</span>
                <span className="text-[10px] text-gray-400">Manual button click or auto-trigger</span>
              </div>
              <span className="text-[10px] bg-black text-white font-bold px-2 py-1 rounded-lg">1-Click</span>
            </div>
            <div className="p-3 bg-white rounded-xl border border-gray-100 hover:border-black transition-all flex justify-between items-center shadow-sm">
              <div>
                <span className="font-bold text-xs text-black block">lead_done (Conversion SMS)</span>
                <span className="text-[10px] text-gray-400">Sent when lead is marked "Done"</span>
              </div>
              <span className="text-[10px] bg-black text-white font-bold px-2 py-1 rounded-lg">Auto</span>
            </div>
          </div>
        </div>
      )
    },
    pipeline: {
      title: 'Advanced CRM Pipelines',
      subtitle: 'Track your deals from contact to closing.',
      description: 'Manage sales pipelines with clear visual boards, details loggers, custom fields, and seamless workflows tailored to your business model.',
      points: [
        {
          title: 'Visual Kanban Boards',
          desc: 'Drag-and-drop lead cards between customizable sales stages and track deal values in real-time.'
        },
        {
          title: 'Detailed Activity Logger',
          desc: 'Log calls, emails, status changes, and WhatsApp interactions in a single chronological feed.'
        },
        {
          title: 'Custom Field Manager',
          desc: 'Add text, numbers, dropdowns, and date fields to leads without writing any backend code.'
        }
      ],
      mockup: (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4 w-full">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="font-bold text-sm text-black">Deal Pipeline</span>
            <span className="text-xs font-bold text-gray-400">$34,800 Active Value</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border border-gray-100 rounded-xl bg-gray-50/50">
              <span className="text-[10px] uppercase font-bold text-gray-400">Proposal Sent</span>
              <div className="mt-2 space-y-1.5">
                <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm hover:border-black transition-all">
                  <span className="font-bold text-xs text-black block">Acme Corp</span>
                  <span className="text-[10px] text-green-600 font-semibold">$12,000</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm hover:border-black transition-all">
                  <span className="font-bold text-xs text-black block">Initech Inc</span>
                  <span className="text-[10px] text-green-600 font-semibold">$4,500</span>
                </div>
              </div>
            </div>
            <div className="p-3 border border-gray-100 rounded-xl bg-gray-50/50">
              <span className="text-[10px] uppercase font-bold text-gray-400">Negotiation</span>
              <div className="mt-2 space-y-1.5">
                <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm hover:border-black transition-all">
                  <span className="font-bold text-xs text-black block">Stark Indus</span>
                  <span className="text-[10px] text-green-600 font-semibold">$18,300</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    integrations: {
      title: 'Inbound Integration Engine',
      subtitle: 'Stream leads from anywhere instantly.',
      description: 'Scraft CRM integrates natively with leading ad systems and supports generic developer webhooks to import leads automatically.',
      points: [
        {
          title: 'Facebook Lead Ads Integration',
          desc: 'Direct integration with Meta Graph API. Leads from your social ads appear inside your CRM in under a second.'
        },
        {
          title: 'Universal Custom Webhooks',
          desc: 'Each workspace gets a unique webhook endpoint. Connect it to Webflow, Typeform, or custom scripts.'
        },
        {
          title: 'Forward Destinations',
          desc: 'Automatically forward captured leads to other platforms or sync updates back to Google Sheets.'
        }
      ],
      mockup: (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4 w-full">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="font-bold text-sm text-black">Active Inbound Sources</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-2.5 border border-gray-100 rounded-xl bg-white hover:border-black transition-all shadow-sm">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">f</div>
                <div>
                  <span className="font-bold text-xs text-black block">Meta Lead Ads</span>
                  <span className="text-[9px] text-gray-400">Campaign: Q2 Growth</span>
                </div>
              </div>
              <span className="text-[10px] bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded border border-green-100">Connected</span>
            </div>
            <div className="flex items-center justify-between p-2.5 border border-gray-100 rounded-xl bg-white hover:border-black transition-all shadow-sm">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white font-bold text-xs">🔗</div>
                <div>
                  <span className="font-bold text-xs text-black block">Workspace Webhook</span>
                  <span className="text-[9px] text-gray-400">https://api.scraft...</span>
                </div>
              </div>
              <span className="text-[10px] bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded border border-green-100">Listening</span>
            </div>
          </div>
        </div>
      )
    }
  };

  const activeTabInfo = tabsInfo[activeTab];

  return (
    <section id="product" className="py-24 lg:py-36 px-6 bg-white scroll-mt-24 relative overflow-hidden">
      {/* Decorative gradients */}
      <div className="absolute bottom-0 right-0 w-[450px] h-[450px] bg-indigo-50/50 rounded-full blur-3xl pointer-events-none -z-10"></div>

      <div className="max-w-7xl mx-auto">
        <div className="max-w-3xl mb-16">
          <div className="h-1.5 w-16 bg-black rounded mb-8"></div>
          <h2 className="text-4xl lg:text-6xl font-extrabold tracking-tight mb-6 text-black leading-tight">
            The ultimate engine for <br />
            <span className="bg-gradient-to-r from-indigo-600 to-emerald-500 bg-clip-text text-transparent">precision sales growth.</span>
          </h2>
          <p className="text-gray-500 text-lg lg:text-xl font-medium leading-relaxed max-w-2xl">
            Stop losing leads in spreadsheets. Scraft CRM merges high-performance lead pipeline management with powerful, instant WhatsApp automation.
          </p>
        </div>

        {/* Dynamic Feature Tabs - styled like actual internal tab lists */}
        <div className="flex flex-wrap gap-3 mb-12">
          {(Object.keys(tabsInfo) as TabKey[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2.5 rounded-full font-bold text-sm border transition-all duration-300 ${
                activeTab === tab
                  ? 'bg-black text-white border-black shadow-sm'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {tabsInfo[tab].title}
            </button>
          ))}
        </div>

        {/* Tab Detail Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8 transition-all duration-500">
            <div>
              <h3 className="text-3xl font-extrabold text-black mb-2">
                {activeTabInfo.title}
              </h3>
              <p className="text-indigo-600 text-sm font-bold tracking-wide uppercase mb-4">
                {activeTabInfo.subtitle}
              </p>
              <p className="text-gray-600 font-medium leading-relaxed">
                {activeTabInfo.description}
              </p>
            </div>

            <div className="space-y-6 pt-4">
              {activeTabInfo.points.map((point, index) => (
                <div key={index} className="flex items-start space-x-3.5 group">
                  <div className="w-5 h-5 rounded-full bg-green-500/10 border border-green-200/50 flex items-center justify-center text-green-600 mt-1 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-black group-hover:text-indigo-600 transition-colors">
                      {point.title}
                    </h4>
                    <p className="text-gray-500 text-sm leading-relaxed mt-1 font-medium">
                      {point.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Graphical Mockup area */}
          <div className="relative w-full">
            {/* Ambient Card Background Glow */}
            <div className="absolute -inset-4 bg-gradient-to-tr from-indigo-50 to-emerald-50 rounded-[2.5rem] -z-10 rotate-1 scale-105"></div>
            <div className="bg-[#FAF9F6] border border-gray-200 rounded-[2rem] p-6 shadow-sm overflow-hidden min-h-[320px] flex items-center justify-center w-full">
              <div className="w-full transition-all duration-500 transform hover:scale-[1.02] flex justify-center">
                {activeTabInfo.mockup}
              </div>
            </div>
          </div>
        </div>

        {/* WhatsApp Automation specific deep dive spotlight */}
        <div id="whatsapp-automation" className="mt-32 pt-20 border-t border-gray-200 scroll-mt-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="absolute -inset-3 bg-gradient-to-tr from-green-50 to-indigo-50 rounded-[2.5rem] -z-10 -rotate-1 scale-105"></div>
              <div className="bg-white border border-gray-200 rounded-[2rem] p-6 shadow-sm">
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                    <span className="font-bold text-xs text-gray-400 uppercase">Interactive Log Tracker</span>
                    <span className="text-[10px] text-green-500 font-bold animate-pulse flex items-center">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1"></span>
                      Real-time API Logs
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="p-3 bg-green-50/50 rounded-xl border border-green-100/50 text-[11px] font-mono leading-relaxed">
                      <span className="text-green-700 font-bold">[11:13:02]</span> Inbound Webhook Lead <span className="text-black font-semibold">Sarah Jenkins</span> captured. Email: <span className="text-gray-600 font-semibold">sa***@apex.com</span>.
                    </div>
                    <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50 text-[11px] font-mono leading-relaxed">
                      <span className="text-indigo-700 font-bold">[11:13:03]</span> WhatsApp trigger: <span className="text-black font-semibold">"new_lead"</span> welcome dispatched to phone <span className="text-gray-600">308293...</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-gray-200 text-[11px] font-mono leading-relaxed">
                      <span className="text-slate-500 font-bold">[11:13:04]</span> API log: <span className="text-green-700 font-bold">status="delivered"</span>. correlationId: <span className="text-gray-500">tr-810a9c</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2 space-y-8">
              <span className="px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-[10px] font-bold tracking-wider uppercase border border-green-200">
                Spotlight: WhatsApp Automation
              </span>
              <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight text-black">
                Send messages that actually get read.
              </h2>
              <p className="text-gray-600 text-lg font-medium leading-relaxed">
                Connect your WhatsApp Business account, submit message templates for Meta review, and automate follow-ups for customers who have opted in.
              </p>
              <div className="space-y-4">
                <div className="flex items-center space-x-3 text-black font-bold">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span>Built with the official WhatsApp Cloud API</span>
                </div>
                <div className="flex items-center space-x-3 text-black font-bold">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span>No markup fees — pay Meta directly per message</span>
                </div>
                <div className="flex items-center space-x-3 text-black font-bold">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span>Delivery and read status updates from Meta</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
