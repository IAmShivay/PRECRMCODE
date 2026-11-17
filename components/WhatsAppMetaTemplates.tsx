import { useCallback, useEffect, useState } from 'react';
import { whatsAppManagementRequest } from '../lib/api-client';
import type { WhatsAppMetaTemplate, WhatsAppMetaTemplateDraft } from '../types/whatsappManagement';

export default function WhatsAppMetaTemplates({ workspaceId, isAdmin }: { workspaceId: number; isAdmin: boolean }) {
  const [templates, setTemplates] = useState<WhatsAppMetaTemplate[]>([]);
  const [after, setAfter] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WhatsAppMetaTemplateDraft>({ name: '', language: 'en_US', category: 'UTILITY', body: '', examples: [] });
  const variables = [...new Set(Array.from(draft.body.matchAll(/\{\{(\d+)\}\}/g), match => Number(match[1])))].sort((a, b) => a - b);

  const load = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const page = await whatsAppManagementRequest<{ templates: WhatsAppMetaTemplate[]; after?: string }>(workspaceId,
        `meta-templates${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, undefined, signal);
      if (!signal?.aborted) {
        setTemplates(previous => cursor ? [...previous, ...page.templates.filter(item => !previous.some(old => old.id === item.id))] : page.templates);
        setAfter(page.after);
      }
    } catch (err) { if (!signal?.aborted) setError((err as Error).message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { const controller = new AbortController(); void load(undefined, controller.signal); return () => controller.abort(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const created = await whatsAppManagementRequest<{ id: string; status: string }>(workspaceId, 'meta-templates', {
        ...draft, examples: variables.map((_, index) => draft.examples[index] || ''),
      });
      setNotice(`Template submitted to Meta. Status: ${created.status}. It can be used after Meta approves it.`);
      setOpen(false); setDraft({ name: '', language: 'en_US', category: 'UTILITY', body: '', examples: [] });
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  const inputClass = 'mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm';
  return <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-gray-900">Templates in Meta</h2><p className="text-sm text-gray-500">Create a template for review and check its current approval status.</p></div>
      <div className="flex gap-3"><button type="button" disabled={loading || saving} onClick={() => void load()} className="text-sm text-green-700 disabled:opacity-50">Refresh</button>
        {isAdmin && <button type="button" onClick={() => setOpen(!open)} disabled={saving} className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white">{open ? 'Close form' : 'Create template'}</button>}</div>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {open && isAdmin && <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Template name<input required pattern="[a-z0-9_]+" maxLength={512} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="appointment_update" className={inputClass} /><span className="text-xs text-gray-500">Lowercase letters, numbers and underscores.</span></label>
        <label className="text-sm">Language code<input required value={draft.language} pattern="[a-z]{2,3}(_[A-Z]{2})?" onChange={event => setDraft({ ...draft, language: event.target.value })} className={inputClass} /><span className="text-xs text-gray-500">For example, en_US or hi.</span></label>
        <label className="text-sm">Category<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as WhatsAppMetaTemplateDraft['category'] })} className={inputClass}><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select></label>
      </div>
      <p className="text-xs text-gray-500">Utility templates provide updates about a customer’s transaction or request. Offers and promotions belong in Marketing.</p>
      <label className="block text-sm">Message body<textarea required maxLength={1024} rows={4} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} className={inputClass} /><span className="text-xs text-gray-500">Optional variables use {'{{1}}, {{2}}'}, and so on. Provide fictional examples below.</span></label>
      {variables.slice(0, 10).map((variable, index) => <label key={variable} className="block text-sm">Sample for {`{{${variable}}}`}<input required maxLength={200} value={draft.examples[index] || ''} onChange={event => { const examples = [...draft.examples]; examples[index] = event.target.value; setDraft({ ...draft, examples }); }} className={inputClass} /></label>)}
      <button type="submit" disabled={saving || variables.length > 10} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Submitting…' : 'Submit to Meta for review'}</button>
    </form>}
    {loading && <p className="text-sm text-gray-500">Loading Meta templates…</p>}
    {!loading && !error && !templates.length && <p className="text-sm text-gray-500">No templates found in this WhatsApp account.</p>}
    {templates.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-gray-500"><tr><th className="py-2">Template</th><th>Language</th><th>Category</th><th>Status</th></tr></thead><tbody>{templates.map(template => <tr key={template.id} className="border-t border-gray-100"><td className="py-3 font-medium">{template.name}</td><td>{template.language}</td><td>{template.category}</td><td>{template.status}</td></tr>)}</tbody></table></div>}
    {after && <button type="button" disabled={loading} onClick={() => void load(after)} className="text-sm text-green-700">Load more templates</button>}
    <p className="text-xs text-gray-500">After approval, use the same template name and language in the automation settings below.</p>
  </section>;
}
