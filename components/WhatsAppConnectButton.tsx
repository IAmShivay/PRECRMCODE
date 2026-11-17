import { useEffect, useRef, useState } from 'react';
import { whatsAppSignupRequest } from '../lib/api-client';

interface SignupSettings { configured: boolean; app_id: string; config_id: string; version: string; state?: string; }
interface SignupAssets { waba_id: string; phone_number_id: string; }
interface FacebookSdk {
  init(options: { appId: string; version: string; autoLogAppEvents: boolean; xfbml: boolean }): void;
  login(callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>): void;
}
declare global { interface Window { FB?: FacebookSdk; } }

function loadSdk(): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-scraft-facebook-sdk]');
    const ready = () => window.FB ? resolve(window.FB) : reject(new Error('Facebook login is unavailable.'));
    const failed = () => reject(new Error('Facebook login could not load. Please refresh and try again.'));
    if (!script) {
      script = document.createElement('script'); script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true; script.defer = true; script.dataset.scraftFacebookSdk = 'true';
      script.addEventListener('load', ready, { once: true }); script.addEventListener('error', failed, { once: true });
      document.head.appendChild(script);
    } else { script.addEventListener('load', ready, { once: true }); script.addEventListener('error', failed, { once: true }); }
  });
}

export default function WhatsAppConnectButton({ workspaceId, onConnected }: { workspaceId: number; onConnected: () => Promise<void> }) {
  const [settings, setSettings] = useState<SignupSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ code?: string; assets?: SignupAssets; submitting?: boolean; state?: string } | null>(null);
  const connectedCallback = useRef(onConnected);
  connectedCallback.current = onConnected;
  const submit = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const config = await whatsAppSignupRequest<SignupSettings>(workspaceId);
        if (!active) return;
        setSettings(config);
        if (config.configured) {
          const sdk = await loadSdk();
          if (!active) return;
          sdk.init({ appId: config.app_id, version: config.version, autoLogAppEvents: false, xfbml: false });
          setReady(true);
        }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Unable to load WhatsApp signup.'); }
    }
    const receive = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin) || !attempt.current) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.event === 'FINISH' && /^\d+$/.test(data.data?.waba_id) && /^\d+$/.test(data.data?.phone_number_id)) {
          attempt.current.assets = { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id };
          submit.current();
        } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
          attempt.current = null; setBusy(false); setError('WhatsApp setup was not completed. You can try again.');
        }
      } catch { /* Ignore unrelated SDK messages. */ }
    };
    submit.current = () => {
      const current = attempt.current;
      if (!current?.code || !current.assets || current.submitting) return;
      current.submitting = true;
      whatsAppSignupRequest(workspaceId, { code: current.code, state: current.state, ...current.assets })
        .then(async () => { if (active) await connectedCallback.current(); })
        .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Connection failed.'); })
        .finally(() => { if (active) { attempt.current = null; setBusy(false); void prepare(); } });
    };
    void prepare();
    const refreshSettings = window.setInterval(() => { if (!attempt.current) void prepare(); }, 5 * 60000);
    window.addEventListener('message', receive);
    return () => { active = false; attempt.current = null; window.clearInterval(refreshSettings); window.removeEventListener('message', receive); };
  }, [workspaceId]);

  function connect() {
    if (!ready || !window.FB || !settings?.state) return;
    setError(''); setBusy(true); attempt.current = { state: settings.state };
    window.FB.login(response => {
      if (!attempt.current) return;
      if (!response.authResponse?.code) { attempt.current = null; setBusy(false); setError('Connection was cancelled.'); return; }
      attempt.current.code = response.authResponse.code; submit.current();
    }, { config_id: settings.config_id, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3' } });
  }
  return <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
    <h2 className="font-semibold text-gray-900">Connect with Meta</h2>
    <p className="text-sm text-gray-500">Sign in to select your WhatsApp Business account and number. Meta guides you through account setup and permissions.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {settings?.configured === false && <p className="text-sm text-amber-700">Guided connection is awaiting the app’s Meta onboarding configuration. Existing connections continue to work.</p>}
    <button type="button" disabled={!ready || busy} onClick={connect} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Complete setup in Meta…' : 'Connect WhatsApp'}</button>
    {busy && <button type="button" onClick={() => { attempt.current = null; setBusy(false); }} className="ml-3 text-sm text-gray-600 underline">Cancel</button>}
  </section>;
}
