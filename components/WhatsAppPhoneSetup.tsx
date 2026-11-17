import { useCallback, useEffect, useState } from 'react';
import { whatsAppManagementRequest } from '../lib/api-client';
import type { WhatsAppPhoneStatus } from '../types/whatsappManagement';

export default function WhatsAppPhoneSetup({ workspaceId }: { workspaceId: number }) {
  const [status, setStatus] = useState<WhatsAppPhoneStatus>();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError('');
    try {
      const data = await whatsAppManagementRequest<WhatsAppPhoneStatus>(workspaceId, 'phone-status', undefined, signal);
      if (!signal?.aborted) setStatus(data);
    } catch (err) { if (!signal?.aborted) setError((err as Error).message); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [workspaceId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function register(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await whatsAppManagementRequest(workspaceId, 'register-phone', { pin }); setPin(''); await load(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Phone registration</h2><button type="button" onClick={() => void load()} disabled={busy} className="text-sm text-green-700 disabled:opacity-50">{busy ? 'Checking…' : 'Refresh status'}</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {status && <p className="text-sm text-gray-600">{status.display_phone_number} · {status.status}</p>}
    {status?.status === 'CONNECTED' && <p className="text-sm text-green-700">This number is registered with WhatsApp Cloud API.</p>}
    {status && status.status !== 'CONNECTED' && !status.can_register && <p className="text-sm text-gray-600">Complete phone verification in Meta, then refresh this status. Production messaging may also require a payment method in WhatsApp Manager.</p>}
    {status?.can_register && <form onSubmit={register} className="space-y-3">
      <p className="text-sm text-gray-600">Your number is verified and needs registration. Choose a six-digit two-step verification PIN and keep it securely. If the number already has a PIN, enter that PIN. It is sent to Meta and is not saved by the CRM.</p>
      <label className="block text-sm">Two-step verification PIN<input type="password" inputMode="numeric" autoComplete="off" required pattern="[0-9]{6}" maxLength={6} value={pin} onChange={event => setPin(event.target.value)} className="block mt-1 border border-gray-300 rounded-lg px-3 py-2" /></label>
      <button type="submit" disabled={busy} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50">Register number</button>
    </form>}
  </section>;
}
