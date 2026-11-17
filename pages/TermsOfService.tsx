import React from 'react';
import Navbar from '../components/Navbar';
import DashboardNavbar from '../components/DashboardNavbar';
import Footer from '../components/Footer';
import { useAuth } from '../contexts/AuthContext';

const LAST_UPDATED = '2026-09-26';

const TermsOfService: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen selection:bg-black selection:text-white bg-white">
      {isAuthenticated ? <DashboardNavbar /> : <Navbar scrolled={true} />}
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-gray-500 font-semibold">Last updated: {LAST_UPDATED}</p>

          <div className="mt-10 space-y-10 text-gray-700 leading-relaxed font-medium">
            <section>
              <h2 className="text-lg font-bold text-gray-900">Agreement</h2>
              <p className="mt-3 text-gray-600">
                These Terms of Service (“Terms”) govern your access to and use of <strong>Break the ice CRM, operated by Next Up Design, India</strong> (the
                “Service”, “we”, “our”, or “us”). By creating an account, accessing, or using the Service, you represent that you have read, understood, and agree to be bound by these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Eligibility</h2>
              <p className="mt-3 text-gray-600">
                You must be at least 16 years of age and legally capable of entering into a binding contract to use the Service. If you are accepting these terms on behalf of a company, corporate entity, or workspace organization, you warrant that you possess the official authority to bind such entity.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">User Accounts and Workspace Security</h2>
              <ul className="mt-3 list-disc pl-5 space-y-1.5 text-gray-600">
                <li>You are solely responsible for maintaining the confidentiality of your workspace login credentials.</li>
                <li>You are liable for all actions, communications, and configurations performed under your registered user profile and account.</li>
                <li>You must immediately notify our team at <a href="mailto:hello@scraft.studio" className="underline font-semibold">hello@scraft.studio</a> of any suspected unauthorized security breach or compromise.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Acceptable Use Policy</h2>
              <p className="mt-3 text-gray-600">You agree not to misuse the Scraft CRM platform. Specifically, you shall not:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1.5 text-gray-600">
                <li>Violate any local, national, or international regulations.</li>
                <li>Infringe upon the copyright, patent, privacy rights, or trademarks of others.</li>
                <li>Circumvent workspace authorization layers, inject malware, or execute DDOS attacks.</li>
                <li>Perform automated scraping, harvesting, or indexing of our data repositories.</li>
                <li>Transmit illegal, fraudulent, or harassing messaging campaigns.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Third-Party Platform Integrations (Facebook & Meta Developer Apps)</h2>
              <div className="mt-3 space-y-3 text-gray-600">
                <p>
                  Scraft CRM offers integrations with Meta Platforms, Inc. (including Facebook Lead Ads and WhatsApp Business API). By connecting these integrations, you agree that:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>You must strictly comply with all relevant <strong>Meta Developer Policies</strong>, <strong>Facebook Terms of Service</strong>, and <strong>WhatsApp Business Terms of Service</strong>.</li>
                  <li>You authorize us to request, process, store, and display information obtained through Facebook APIs, such as Facebook Page tokens, Lead Forms metadata, and WhatsApp Business credentials.</li>
                  <li>We are not responsible for any modifications, deprecations, rate limits, or account suspensions imposed by Meta.</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">WhatsApp Messaging and Campaign Rules</h2>
              <div className="mt-3 space-y-3 text-gray-600">
                <p>
                  When utilizing Scraft CRM's WhatsApp Automation and Bulk Campaigns features:
                </p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>You warrant that you have obtained explicit, verifiable prior opt-in consent from all lead recipients before dispatching WhatsApp templates or message notifications.</li>
                  <li>You agree not to engage in spamming or mass-distribution of unsolicited messages.</li>
                  <li>You agree that Meta directly charges for conversation rates based on their pricing model. You are solely responsible for ensuring your WhatsApp Business Account (WABA) has a valid payment method.</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Client and Workspace Data</h2>
              <div className="mt-3 space-y-3 text-gray-600">
                <p>
                  You retain ownership rights over all lead data, client files, and custom configurations submitted to the Service (“Customer Data”). You grant us a non-exclusive, global license to access and process Customer Data solely to provide, support, and troubleshoot the Service.
                </p>
                <p>
                  You represent that you have the legal right (including compliance with GDPR and CCPA) to import, store, and synchronize Customer Data within the CRM.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Intellectual Property Rights</h2>
              <p className="mt-3 text-gray-600">
                The Scraft CRM interface, visual designs, backend architectures, logo, and source codes are the exclusive property of Scraft CRM or our licensors and are protected under international trademark and patent protocols.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Disclaimer of Warranties</h2>
              <p className="mt-3 text-gray-600 font-semibold">
                THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE EXPRESSLY DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Limitation of Liability</h2>
              <p className="mt-3 text-gray-600 font-semibold">
                TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT SHALL SCRAFT CRM, ITS DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF REVENUES, DEAL VALUES, OR CLIENT DATA ARISING OUT OF YOUR USE OF THE SERVICE.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Indemnification</h2>
              <p className="mt-3 text-gray-600">
                You agree to defend, indemnify, and hold us harmless against any claims, losses, liabilities, penalties, and legal expenses (including reasonable attorney fees) arising from your Customer Data, WhatsApp marketing practices, or violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Termination and Account Suspensions</h2>
              <p className="mt-3 text-gray-600">
                We reserve the right to temporarily suspend or permanently terminate your workspace access immediately, without prior notice, if you violate these Terms, fail to pay subscription balances, or engage in practices that threaten our platform's IP reputation.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Governing Law</h2>
              <p className="mt-3 text-gray-600">
                These Terms and any related disputes are governed exclusively by the laws of the jurisdiction in which our operating entity is registered, without reference to conflict of laws doctrines.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Updates to Terms</h2>
              <p className="mt-3 text-gray-600">
                We may periodically amend these Terms. We will update the last updated date and publish the changes on this page. Your continued use of the Service following revisions constitutes acceptance of the new Terms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900">Contact Details</h2>
              <p className="mt-3 text-gray-600">
                For questions regarding these Terms of Service, please reach out to us at:{' '}
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

export default TermsOfService;
