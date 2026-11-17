import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeftIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { buildWebhookUrl } from '../lib/webhookUrl';

export default function WebhookSources() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { currentWorkspace, workspaces } = useAuth();

  const [copied, setCopied] = useState(false);

  // Get the workspace name from the route param or current workspace
  const workspace = workspaceId
    ? workspaces.find(w => w.id === Number(workspaceId))
    : currentWorkspace;

  const workspaceName = workspace?.name || 'this workspace';

  // Generate webhook URL for this workspace
  const generateWebhookUrl = () => {
    return buildWebhookUrl(workspace?.id || 'workspace-id');
  };

  const generatedUrl = generateWebhookUrl();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Webhook Sources</h1>
              <p className="text-sm text-gray-500">Manage webhook connections for {workspaceName}</p>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Webhook URL Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Your Webhook URL</h2>
              <p className="text-sm text-gray-500">
                Use this URL in your website forms to send leads directly to this workspace
              </p>
            </div>
            <DocumentDuplicateIcon className="h-6 w-6 text-gray-400" />
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <code className="text-sm text-gray-800 break-all block">
              {generatedUrl}
            </code>
          </div>

          <button
            onClick={copyToClipboard}
            className="w-full px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <DocumentDuplicateIcon className="h-5 w-5" />
                Copy Webhook URL
              </>
            )}
          </button>
        </div>

        {/* Integration Guide */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">How to Integrate</h2>

          <div className="space-y-4">
            <div className="border-l-4 border-black pl-4">
              <h3 className="font-medium text-gray-900 mb-1">HTML Form Integration</h3>
              <p className="text-sm text-gray-600 mb-2">Add this to your website's HTML form:</p>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`<form action="${generatedUrl}" method="POST">
  <input type="text" name="name" placeholder="Name" required />
  <input type="email" name="email" placeholder="Email" required />
  <input type="tel" name="phone" placeholder="Phone" />
  <input type="hidden" name="source" value="landing_page" />
  <button type="submit">Submit</button>
</form>`}
              </pre>
            </div>

            <div className="border-l-4 border-blue-500 pl-4">
              <h3 className="font-medium text-gray-900 mb-1">JavaScript/AJAX Integration</h3>
              <p className="text-sm text-gray-600 mb-2">Use JavaScript for better user experience:</p>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`fetch('${generatedUrl}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    source: 'landing_page'
  })
}).then(response => response.json())
.then(data => console.log('Success:', data));`}
              </pre>
            </div>

            <div className="border-l-4 border-green-500 pl-4">
              <h3 className="font-medium text-gray-900 mb-1">Required Fields</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li><code className="bg-gray-100 px-1 rounded">name</code> - Lead's full name (required)</li>
                <li><code className="bg-gray-100 px-1 rounded">email</code> - Lead's email address (required)</li>
                <li><code className="bg-gray-100 px-1 rounded">phone</code> - Lead's phone number (optional)</li>
                <li><code className="bg-gray-100 px-1 rounded">source</code> - Source identifier like 'landing_page', 'webhook', etc.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Webhook Logs */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Webhook Activity</h2>
          <p className="text-sm text-gray-500">
            View incoming webhook logs and activity for this workspace.
          </p>
          <button
            onClick={() => navigate(`/workspace/${workspace?.id}/webhook-logs`)}
            className="mt-4 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            View Webhook Logs
          </button>
        </div>
      </main>
    </div>
  );
}
