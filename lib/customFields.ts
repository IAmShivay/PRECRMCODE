/**
 * Parse custom field options from storage.
 * NoCodeBackend may store select/multiselect options as a JSON array string (e.g. '["Open","Closed"]');
 * legacy or text format is comma-separated (e.g. 'Open,Closed').
 */
export function getCustomFieldOptions(options: string | null | undefined): string[] {
  if (options == null || typeof options !== 'string') return [];
  const t = options.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const parsed = JSON.parse(t) as unknown;
      return Array.isArray(parsed)
        ? parsed.map((v) => (typeof v === 'string' ? v : String(v)).trim()).filter(Boolean)
        : t.split(',').map((o) => o.trim()).filter(Boolean);
    } catch {
      return t.split(',').map((o) => o.trim()).filter(Boolean);
    }
  }
  return t.split(',').map((o) => o.trim()).filter(Boolean);
}
