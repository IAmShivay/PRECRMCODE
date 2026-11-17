import React, { useState } from 'react';
import Navbar from '../components/Navbar';
import DashboardNavbar from '../components/DashboardNavbar';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const DataDeletion: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();

  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [confirmCheckbox, setConfirmCheckbox] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !workspaceName || !confirmCheckbox) {
      addToast('error', 'Please fill out all fields and accept the confirmation checkbox.');
      return;
    }

    setSubmitting(true);
    const subject = `Meta data deletion request - ${workspaceName}`;
    const body = [
      'Please process a Facebook/Meta data deletion request for the workspace below.',
      '',
      `Account email: ${email}`,
      `Workspace name: ${workspaceName}`,
      '',
      'I request deletion of Meta integration data for this workspace. Please verify my authority and confirm which records will be removed before processing.',
    ].join('\n');

    window.location.href = `mailto:hello@scraft.studio?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitting(false);

    addToast('success', 'Your email client has been opened with the deletion request details.');
  };

  return (
    <div className="min-h-screen selection:bg-black selection:text-white bg-white">
      {isAuthenticated ? <DashboardNavbar /> : <Navbar scrolled={true} />}
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <span className="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-bold border border-red-100 rounded-full tracking-wider uppercase mb-6 inline-block">
            Meta Compliance Page
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900">
            Meta Data Deletion Instructions
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-medium">
            Learn how to remove Break the ice CRM integrations and request personal data deletion.
          </p>

          {/* Core Content */}
          <div className="mt-10 space-y-12 text-gray-700 leading-relaxed font-medium">
            <section className="bg-slate-50 border border-gray-200 rounded-2xl p-6">
              <h2 className="text-lg font-bold text-gray-900 flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 mr-2.5"></span>
                Overview
              </h2>
              <p className="mt-3 text-sm text-gray-600">
                Break the ice CRM, operated by Next Up Design, India, connects to Facebook Lead Ads, WhatsApp Business, and Instagram. Workspace administrators can remove integrations and request deletion of data associated with their workspace.
              </p>
            </section>

            {/* Self-Service Instructions */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900">
                1. Disconnect a Meta integration
              </h2>
              <p className="text-sm text-gray-600">
                To immediately revoke our application’s access to your Facebook account and pages:
              </p>
              <ol className="list-decimal pl-5 space-y-3.5 text-sm text-gray-600">
                <li>
                  Log in to your Facebook profile and navigate to <a href="https://www.facebook.com/settings?tab=applications" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-bold">Settings & Privacy &gt; Settings &gt; Apps and Websites</a>.
                </li>
                <li>
                  Find <strong>break the ice crm</strong> (app ID 1121383243335859) in the active applications or business integrations list.
                </li>
                <li>
                  Click the <strong>Remove</strong> button. Confirm the removal popup to immediately invalidate our active Page Access Tokens and disable future synchronization.
                </li>
              </ol>
              <p className="text-sm text-gray-600">For Instagram, sign in to the CRM as a workspace administrator, open Instagram, select Disconnect, and confirm. This removes the saved access token, account connection, and connection activity from our database. We do not store Instagram message content. You can also revoke the app from Instagram’s Apps and Websites settings. Messages remain in Instagram unless you delete them there.</p>
              <p className="text-sm text-gray-600">For WhatsApp, disable the integration in the CRM’s WhatsApp connection settings to stop automated sends, then revoke the app in Meta’s business integration settings. Contact support to remove stored configuration and message logs.</p>
            </section>

            {/* Request Data Deletion Form */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900">
                2. Request Permanent Lead Data Deletion
              </h2>
              <p className="text-sm text-gray-600">
                To request deletion of imported leads, contact records, WhatsApp message logs, or other Meta data, email <a href="mailto:hello@scraft.studio" className="text-indigo-600 hover:underline font-bold">hello@scraft.studio</a> with your account email, workspace name, and the integration or records concerned. We verify your authority over the workspace before processing the request. The form below prepares an email; you must send it from your email application.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 border border-gray-200 rounded-2xl p-6 bg-white shadow-sm space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Account Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. administrator@company.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-indigo-500 font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Workspace Name
                    </label>
                    <input
                      type="text"
                      required
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      placeholder="e.g. Global Marketing Dept"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-indigo-500 font-medium"
                    />
                  </div>
                </div>

                <div className="flex items-start space-x-3.5">
                  <input
                    type="checkbox"
                    id="confirmDelete"
                    required
                    checked={confirmCheckbox}
                    onChange={(e) => setConfirmCheckbox(e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <label htmlFor="confirmDelete" className="text-xs text-gray-500 leading-normal select-none font-medium">
                    I am authorized to request deletion for this workspace. I understand that support will verify this request and that completed deletion cannot be undone.
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full py-3 bg-black hover:bg-gray-900 text-white font-bold rounded-xl text-sm transition-all shadow-md active:scale-[0.98] ${
                    submitting ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {submitting ? 'Preparing email...' : 'Prepare Deletion Request Email'}
                </button>
              </form>
            </section>

            {/* Extra Info */}
            <section className="border-t border-gray-200 pt-8 space-y-3">
              <h2 className="text-lg font-bold text-gray-900">
                Request Processing Timeline
              </h2>
              <p className="text-sm text-gray-600">
                Self-service disconnections are immediate. Manual database deletion requests are validated after receipt by our support team, and qualifying rows associated with your Facebook integrations are purged within the stated support window. Confirmation is sent to your account email address.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default DataDeletion;
