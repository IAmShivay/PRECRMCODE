import React, { useState, useEffect } from 'react';
import {
  KeyIcon,
  SparklesIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  TrashIcon,
  CommandLineIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import {
  createMcpToken,
  fetchAiTools,
  fetchMcpTokens,
  revokeMcpToken,
} from '../lib/aiChatClient';
import type { WorkspaceMcpToken } from '../components/types';

export default function McpSettingsPage() {
  const { currentWorkspace } = useAuth();
  const [tokens, setTokens] = useState<WorkspaceMcpToken[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenName, setTokenName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const workspaceId = currentWorkspace?.id;

  const loadData = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [tokensData, toolsData] = await Promise.all([
        fetchMcpTokens(workspaceId).catch(() => []),
        fetchAiTools().catch(() => []),
      ]);
      setTokens(tokensData);
      setTools(toolsData);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load MCP settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [workspaceId]);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !tokenName.trim() || creating) return;
    setCreating(true);
    setErrorMsg(null);
    try {
      const result = await createMcpToken(workspaceId, tokenName.trim());
      setNewlyCreatedToken(result.token);
      setTokens((prev) => [result.record, ...prev]);
      setTokenName('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: number) => {
    if (!workspaceId || !window.confirm('Are you sure you want to revoke this MCP token?')) return;
    try {
      await revokeMcpToken(workspaceId, tokenId);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to revoke token');
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const origin = window.location.origin;
  const configSnippet = `{
  "mcpServers": {
    "scraft-crm": {
      "url": "${origin}/api/mcp/sse?token=${newlyCreatedToken || 'YOUR_MCP_TOKEN'}"
    }
  }
}`;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-md">
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
              Model Context Protocol (MCP) Connector
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
              Connect external AI tools (Claude Desktop, Cursor, Antigravity) to your Scraft CRM workspace securely.
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-4 font-semibold text-slate-900 dark:text-slate-100">
            <KeyIcon className="h-5 w-5 text-emerald-600" />
            <span>Generate Workspace MCP Token</span>
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Create an API token to allow external MCP clients to access leads, deals, and activities for this workspace.
          </p>

          <form onSubmit={handleCreateToken} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Token Name / Client Description
              </label>
              <input
                type="text"
                required
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. Claude Desktop (MacBook), Cursor Agent"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={creating || !tokenName.trim()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {creating ? 'Generating...' : 'Generate MCP Token'}
            </button>
          </form>

          {newlyCreatedToken && (
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs">
              <div className="font-semibold text-amber-900 dark:text-amber-200">
                Token Generated Successfully!
              </div>
              <div className="mt-1 text-slate-600 dark:text-slate-300">
                Copy this token now. For security reasons, it will not be displayed again.
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-white p-2 font-mono text-xs dark:bg-slate-950">
                <span className="truncate text-slate-800 dark:text-slate-200">
                  {newlyCreatedToken}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(newlyCreatedToken, 'token')}
                  className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 font-sans text-xs font-medium text-amber-800 hover:bg-amber-500/30 dark:text-amber-300"
                >
                  {copiedKey === 'token' ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
                  <span>{copiedKey === 'token' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <CommandLineIcon className="h-5 w-5 text-teal-600" />
              <span>Claude Desktop & Cursor Configuration</span>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(configSnippet, 'snippet')}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {copiedKey === 'snippet' ? <CheckIcon className="h-4 w-4 text-emerald-500" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
              <span>{copiedKey === 'snippet' ? 'Copied' : 'Copy JSON'}</span>
            </button>
          </div>

          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Add this configuration block to your <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">claude_desktop_config.json</code>:
          </p>

          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3.5 font-mono text-[11px] text-slate-200 leading-relaxed">
            {configSnippet}
          </pre>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Active Workspace MCP Tokens
        </h3>

        {loading ? (
          <div className="py-6 text-center text-xs text-slate-500">Loading tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No active MCP tokens found for this workspace. Generate one above to connect external AI agents.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Token Prefix</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tokens.map((tok) => (
                  <tr key={tok.id}>
                    <td className="py-3 font-medium text-slate-900 dark:text-slate-100">{tok.name}</td>
                    <td className="py-3 font-mono text-slate-600 dark:text-slate-400">{tok.token_prefix}</td>
                    <td className="py-3 text-slate-500">{new Date(tok.created_at).toLocaleDateString()}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <ShieldCheckIcon className="h-3 w-3" />
                        Active
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevokeToken(tok.id)}
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                        title="Revoke Token"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Available MCP Tools & Actions ({tools.length || 11})
        </h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          The following standard CRM tools are exposed to connected AI assistants. Mutating actions require confirmation.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(tools.length > 0
            ? tools
            : [
                { name: 'search_leads', description: 'Search leads by query, email or status', security_level: 'read_only' },
                { name: 'get_lead_details', description: 'Fetch full profile, custom fields and activity timeline', security_level: 'read_only' },
                { name: 'create_lead', description: 'Create a new lead in workspace', security_level: 'mutating_low' },
                { name: 'update_lead', description: 'Update lead contact information and stage', security_level: 'mutating_low' },
                { name: 'search_deals', description: 'Filter deals by stage, value and priority', security_level: 'read_only' },
                { name: 'get_pipeline_summary', description: 'Aggregated metrics, stage values and win rates', security_level: 'read_only' },
                { name: 'create_deal', description: 'Create a new deal associated with a lead', security_level: 'mutating_low' },
                { name: 'move_deal_stage', description: 'Transition deal stage with requirement checks', security_level: 'mutating_high' },
                { name: 'verify_email', description: 'Validate deliverability via Reoon Verifier', security_level: 'mutating_low' },
                { name: 'send_whatsapp_message', description: 'Queue WhatsApp outbound message via Meta API', security_level: 'mutating_high' },
                { name: 'log_activity', description: 'Record notes, meetings or calls for leads', security_level: 'mutating_low' },
              ]
          ).map((t: any) => (
            <div
              key={t.name}
              className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/50"
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {t.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    t.security_level === 'mutating_high'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                      : t.security_level === 'mutating_low'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                  }`}
                >
                  {t.security_level || 'read_only'}
                </span>
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                {t.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
