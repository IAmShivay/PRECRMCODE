import React from 'react';
import Navbar from '../components/Navbar';
import DashboardNavbar from '../components/DashboardNavbar';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LAST_UPDATED = '2026-09-26';

const PrivacyPolicy: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen selection:bg-black selection:text-white bg-white">
      {isAuthenticated ? <DashboardNavbar /> : <Navbar scrolled={true} />}
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-semibold">Last updated: {LAST_UPDATED}</p>

          <div className="mt-10 space-y-10 text-gray-700 leading-relaxed font-medium">
            <section>
              <h2 className="text-lg font-bold text-gray-900">Overview</h2>
              <p className="mt-3 text-gray-600">
                This Privacy Policy explains how <strong>Break the ice CRM, operated by Next Up Design, India</strong> (the “Service”, “we”, “our”, or “us”) collects, uses, and
                shares information when you use our website, applications, and integrations,
                including our Facebook Lead Ads, WhatsApp Business, and Instagram messaging integrations.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Information We Collect</h2>
              <div className="mt-3 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Information you provide</h3>
                  <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                    <li>Account details such as name, email address, phone number, and password.</li>
                    <li>Workspace configuration details, member invites, and billing parameters.</li>
                    <li>Lead and client information you input, upload, or sync within your CRM.</li>
                    <li>Support queries, correspondence, and troubleshooting notes.</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Information collected automatically</h3>
                  <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                    <li>Device metadata, browser configurations, IP address, and location pointers.</li>
                    <li>User activities: page views, feature interactions, and timing logs.</li>
                    <li>API event payloads and server-side webhooks logs for service monitoring.</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Information from Meta integrations</h3>
                  <p className="mt-1 text-gray-600">
                    When you authorize our Meta Developer application, we access specific platform data in accordance with permissions granted by you:
                  </p>
                  <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                    <li><strong>Authentication Tokens</strong>: Access tokens and credentials (e.g., Page Access Tokens, User Access Tokens, and WhatsApp Business Account tokens) required to perform actions on your behalf.</li>
                    <li><strong>Lead Retrieval Data</strong>: Lead identifiers, contact fields (names, email addresses, phone numbers), and custom form inputs submitted to your Facebook Lead Ads.</li>
                    <li><strong>WhatsApp Messaging Details</strong>: WhatsApp Business Account IDs, phone number IDs, message content, templates configurations, and message status logs (Sent, Delivered, Read).</li>
                    <li><strong>Instagram</strong>: Your professional account ID, username, encrypted access token, token expiry, and connection activity. When your team opens the inbox, we retrieve conversation participants, recent message content, and timestamps from Instagram. Replies are sent to Meta at your team’s request. Instagram message content is not stored in our database.</li>
                    <li><strong>Webhook Subscription Payloads</strong>: Automated notification events triggered by Facebook Page updates or WhatsApp Business Account updates.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">How We Use Information</h2>
              <p className="mt-3 text-gray-600">We utilize the collected information to:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                <li>Provide, operate, and maintain the Scraft CRM platform features.</li>
                <li>Authenticate users and ensure secure workspace environments.</li>
                <li>Enable integration synchronizations, import inbound leads, and handle automated WhatsApp campaigns.</li>
                <li>Let authorized workspace members read and reply to inbound Instagram conversations. We do not use Instagram messages to create advertising audiences or send unsolicited DMs.</li>
                <li>Deliver real-time alerts (email/webhooks) when high-intent actions occur.</li>
                <li>Offer technical support and solve integration configuration issues.</li>
                <li>Enforce compliance with our Terms of Service and prevent fraudulent practices.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">How We Share Information</h2>
              <p className="mt-3 text-gray-600">
                We respect your privacy. <strong>We do not sell your personal data</strong>. We may share information only in the following contexts:
              </p>
              <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                <li><strong>Service Providers</strong>: With reliable third-party infrastructure hosts, email delivery systems, and database providers that assist us in running the Service.</li>
                <li><strong>Integrations</strong>: When you explicitly configure integrations (e.g., forwarding leads to other destinations).</li>
                <li><strong>Legal Requirements</strong>: When required by law, regulation, subpoena, or government authority request.</li>
                <li><strong>Business Transfers</strong>: During corporate mergers, acquisitions, or restructuring, provided your data remains protected under this policy.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Data Retention & Security</h2>
              <p className="mt-3 text-gray-600">
                We retain CRM records while your workspace uses the Service, subject to deletion requests and applicable retention obligations. Instagram and WhatsApp access tokens are encrypted before storage in our NoCodeBackend database. Access to workspace integrations requires authentication and workspace membership. Production connections use HTTPS. Disconnecting Instagram removes its stored connection, token, and connection activity; it does not delete messages held by Meta.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Meta/Facebook Data Control & Deletion</h2>
              <div className="mt-3 space-y-3 text-gray-600">
                <p>
                  You can revoke access through Meta’s app and business integration settings. Workspace administrators can disconnect Instagram from the Instagram page. WhatsApp automation can be disabled in its connection settings. To remove previously imported CRM records, follow the deletion instructions below.
                </p>
                <p>
                  If you wish to request the complete deletion of all user data obtained via Facebook/Meta integration, you can follow the self-service steps or submit a formal request on our dedicated page: <Link to="/data-deletion" className="text-indigo-600 hover:text-indigo-800 underline">Meta Data Deletion Instructions</Link>.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Your Rights and Choices (GDPR & CCPA)</h2>
              <p className="mt-3 text-gray-600">
                Depending on your location, you may have specific rights regarding your personal data under the General Data Protection Regulation (GDPR) or California Consumer Privacy Act (CCPA):
              </p>
              <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                <li>Request access to your stored data files.</li>
                <li>Request correcting or amending inaccurate records.</li>
                <li>Request deletion or restricted processing of your records.</li>
                <li>Portability rights to receive your data in a machine-readable format.</li>
              </ul>
              <p className="mt-3 text-gray-600">
                To exercise any of these options, please contact our support team at <a className="underline hover:text-black font-semibold" href="mailto:hello@scraft.studio">hello@scraft.studio</a>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Children’s Privacy</h2>
              <p className="mt-3 text-gray-600">
                The Service is restricted to individuals aged 16 or older. We do not intentionally collect or request data from children under the age of 13.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Changes to This Privacy Policy</h2>
              <p className="mt-3 text-gray-600">
                We may periodically update this policy. We will notify you of any material changes by posting the revised version on this page and updating the last updated date.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Contact Us</h2>
              <p className="mt-3 text-gray-600">
                For questions regarding this policy or data management practices, please contact us at:{' '}
                <a className="underline text-indigo-600 hover:text-indigo-800 font-bold" href="mailto:hello@scraft.studio">
                  hello@scraft.studio
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
