const DEFAULT_BACKEND_PORT = 3006;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function isProbablyLocalHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true;
  // IPv4 (covers LAN IPs like 192.168.x.x)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  return false;
}

function slugifyPathSegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug;
}

/**
 * Returns the base origin that external systems should call for webhooks.
 *
 * Priority:
 * 1) `VITE_WEBHOOK_BASE_URL` (explicit override for webhook URLs)
 * 2) `VITE_API_BASE_URL` (if you already set a backend base URL)
 * 3) Dev fallback:
 *    - local hosts → `${protocol}//${hostname}:3006`
 *    - non-local hosts (ngrok, etc) → `window.location.origin`
 * 4) Prod fallback: `window.location.origin`
 */
export function getWebhookBaseUrl(): string {
  const explicit = (
    import.meta.env.VITE_WEBHOOK_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    ''
  ).trim();

  if (explicit) return stripTrailingSlashes(explicit);

  if (typeof window === 'undefined') return '';

  if (import.meta.env.DEV) {
    const { protocol, hostname, origin } = window.location;

    if (isProbablyLocalHostname(hostname)) {
      return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
    }

    // e.g. ngrok: let the dev server proxy /api → backend
    return origin;
  }

  return window.location.origin;
}

export function buildWebhookUrl(
  workspaceId: string | number,
  sourceId?: string,
  sourceName?: string
): string {
  const base = getWebhookBaseUrl();
  const slug = sourceName ? slugifyPathSegment(sourceName) : '';
  const path = `/api/webhook/${workspaceId}${sourceId
    ? slug
      ? `/${encodeURIComponent(slug)}/${encodeURIComponent(sourceId)}`
      : `/${encodeURIComponent(sourceId)}`
    : ''}`;
  return base ? `${base}${path}` : path;
}

// Kommo-style attribution placeholders carried by a channel deep link.
export const VISITOR_UID_REF_PREFIX = 'VisitorUid_';
export const SESSION_ID_REF_PREFIX = 'ID:%20';

/** Absolute URL of a channel's embeddable live-chat widget script. */
export function buildWidgetScriptUrl(channelId: string | number): string {
  const base = getWebhookBaseUrl();
  const path = `/api/channels/${channelId}/widget.js`;
  return base ? `${base}${path}` : path;
}

/** The `<script>` embed snippet a site owner pastes to install the live-chat widget. */
export function buildWidgetEmbedSnippet(channelId: string | number): string {
  return `<script src="${buildWidgetScriptUrl(channelId)}" async></script>`;
}

/**
 * Builds a messenger deep link that carries the visitor/session attribution the
 * way Kommo does (`ref=VisitorUid_{{visitor_uid}}` / `ID:%20{{session_id}}`).
 */
export function buildChannelDeepLink(
  type: 'whatsapp' | 'telegram',
  handle: string,
  visitorUid: string,
  sessionId?: string
): string {
  const ref = `${VISITOR_UID_REF_PREFIX}${visitorUid}`;
  const text = sessionId ? `${ref} ${SESSION_ID_REF_PREFIX}${encodeURIComponent(sessionId)}` : ref;
  const cleanHandle = handle.replace(/^[@+]/, '');
  if (type === 'telegram') {
    return `https://t.me/${cleanHandle}?start=${encodeURIComponent(ref)}`;
  }
  return `https://wa.me/${cleanHandle}?text=${encodeURIComponent(text)}`;
}
