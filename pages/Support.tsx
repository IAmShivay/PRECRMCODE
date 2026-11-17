import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import DashboardNavbar from '../components/DashboardNavbar';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const Support: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('technical');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !message) {
      addToast('error', 'Please fill out all required fields.');
      return;
    }

    setSubmitting(true);
    const subject = `Support request - ${category}`;
    const body = [
      'Please review this Scraft CRM support request.',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Category: ${category}`,
      '',
      'Message:',
      message,
    ].join('\n');

    window.location.href = `mailto:hello@scraft.studio?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitting(false);

    addToast('success', 'Your email client has been opened with the support request details.');
  };

  const faqs = [
    {
      q: 'How do I link my Facebook Page to Scraft CRM?',
      a: 'Navigate to Workspace Settings, select "Integrations" and click "Connect Facebook". You will be redirected to grant permissions for Lead Ads retrieval. Once authenticated, select the Pages you wish to fetch leads from.'
    },
    {
      q: 'What is required to trigger WhatsApp welcome messages?',
      a: 'You need an active Meta WhatsApp Business Account (WABA), a verified phone number ID, and a WhatsApp message template approved by Meta. Once set up, enable the "New Lead Welcome" trigger in your WhatsApp Settings.'
    },
    {
      q: 'Where can I find my workspace Webhook endpoint URL?',
      a: 'Go to Workspace Settings > Webhook Sources. Click "Generate Endpoint" to copy your unique URL. You can forward payloads from Typeform, Webflow, or Zapier directly to this address.'
    }
  ];

  return (
    <div className="min-h-screen selection:bg-black selection:text-white bg-white">
      {isAuthenticated ? <DashboardNavbar /> : <Navbar scrolled={true} />}
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100 uppercase tracking-wider mb-6 inline-block">
              Contact Us &amp; Support
            </span>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 leading-tight">
              Get in touch with our team
            </h1>
            <p className="mt-4 text-gray-500 text-lg font-medium leading-relaxed">
              Have questions about Scraft CRM features, WhatsApp API connectivity, or business compliance? Drop us a line below.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start">
            {/* Contact Form Panel */}
            <div className="lg:col-span-2 border border-gray-200 rounded-3xl p-6 bg-white shadow-sm space-y-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Send us a Message</h2>
                <p className="text-xs text-gray-400 mt-1 font-semibold">Typical response time: Under 12 hours</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-black font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. admin@company.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-black font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                    Inquiry Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-black font-medium bg-white"
                  >
                    <option value="technical">Meta Integration / Technical Help</option>
                    <option value="whatsapp">WhatsApp Template &amp; API Configuration</option>
                    <option value="billing">Workspace Billing &amp; Subscriptions</option>
                    <option value="compliance">Privacy &amp; Data Deletion Enquiries</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                    Detailed Message
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Provide details about your workspace name, integration status, and logs."
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-black font-medium"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full py-3 bg-black hover:bg-gray-900 text-white font-bold rounded-xl text-sm transition-all shadow-md active:scale-[0.98] ${
                    submitting ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {submitting ? 'Creating ticket...' : 'Send Message'}
                </button>
              </form>
            </div>

            {/* Quick Contact & Info Card */}
            <div className="space-y-6">
              <div className="bg-slate-50 border border-gray-200 rounded-3xl p-6 space-y-5">
                <div>
                  <h3 className="font-bold text-sm text-gray-900 uppercase tracking-wide">Direct Contact</h3>
                  <a href="mailto:hello@scraft.studio" className="text-indigo-600 hover:underline text-sm font-bold mt-1.5 block">
                    hello@scraft.studio
                  </a>
                </div>

                <div>
                  <h3 className="font-bold text-sm text-gray-900 uppercase tracking-wide">Business Operator</h3>
                  <p className="text-xs text-gray-600 font-medium leading-relaxed mt-1.5">
                    Next Up Design<br />
                    India
                  </p>
                </div>

                <div>
                  <h3 className="font-bold text-sm text-gray-900 uppercase tracking-wide">Response Policy</h3>
                  <p className="text-xs text-gray-600 font-medium leading-relaxed mt-1.5">
                    We respond by email. Please include your workspace name and a description of the issue so our team can help.
                  </p>
                </div>
              </div>

              {/* FAQs Summary */}
              <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
                <h3 className="font-bold text-sm text-gray-900 uppercase tracking-wide mb-4">Quick Troubleshooting</h3>
                <div className="space-y-4">
                  {faqs.map((faq, index) => (
                    <div key={index} className="space-y-1">
                      <h4 className="text-xs font-bold text-black">{faq.q}</h4>
                      <p className="text-[11px] text-gray-500 leading-normal font-medium">{faq.a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Support;
