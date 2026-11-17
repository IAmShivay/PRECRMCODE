export type WorkspaceCurrencyCode =
  | 'INR'
  | 'USD'
  | 'AED'
  | 'EUR'
  | 'GBP'
  | 'SGD'
  | 'AUD'
  | 'CAD'
  | 'SAR'
  | 'QAR';

export interface WorkspaceCurrencyOption {
  code: WorkspaceCurrencyCode;
  label: string;
  locale: string;
  sampleAmount: number;
}

export const DEFAULT_WORKSPACE_CURRENCY: WorkspaceCurrencyCode = 'INR';

export const WORKSPACE_CURRENCY_OPTIONS: WorkspaceCurrencyOption[] = [
  { code: 'INR', label: 'Indian rupee', locale: 'en-IN', sampleAmount: 20000 },
  { code: 'USD', label: 'US dollar', locale: 'en-US', sampleAmount: 20000 },
  { code: 'AED', label: 'UAE dirham', locale: 'en-AE', sampleAmount: 20000 },
  { code: 'EUR', label: 'Euro', locale: 'en-IE', sampleAmount: 20000 },
  { code: 'GBP', label: 'British pound', locale: 'en-GB', sampleAmount: 20000 },
  { code: 'SGD', label: 'Singapore dollar', locale: 'en-SG', sampleAmount: 20000 },
  { code: 'AUD', label: 'Australian dollar', locale: 'en-AU', sampleAmount: 20000 },
  { code: 'CAD', label: 'Canadian dollar', locale: 'en-CA', sampleAmount: 20000 },
  { code: 'SAR', label: 'Saudi riyal', locale: 'en-SA', sampleAmount: 20000 },
  { code: 'QAR', label: 'Qatari riyal', locale: 'en-QA', sampleAmount: 20000 },
];

const currencyByCode = new Map(WORKSPACE_CURRENCY_OPTIONS.map((currency) => [currency.code, currency]));

export const normalizeWorkspaceCurrency = (currency: unknown): WorkspaceCurrencyCode => {
  const code = String(currency || '').trim().toUpperCase();
  return currencyByCode.has(code as WorkspaceCurrencyCode)
    ? (code as WorkspaceCurrencyCode)
    : DEFAULT_WORKSPACE_CURRENCY;
};

export const getWorkspaceCurrencyOption = (currency: unknown): WorkspaceCurrencyOption =>
  currencyByCode.get(normalizeWorkspaceCurrency(currency)) || WORKSPACE_CURRENCY_OPTIONS[0];

export const formatWorkspaceCurrency = (value: number, currency: unknown, compact = false): string => {
  const option = getWorkspaceCurrencyOption(currency);
  const numericValue = Number.isFinite(value) ? value : 0;

  try {
    return new Intl.NumberFormat(option.locale, {
      style: 'currency',
      currency: option.code,
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
      compactDisplay: 'short',
    }).format(numericValue);
  } catch {
    return `${option.code} ${Math.round(numericValue).toLocaleString('en-US')}`;
  }
};

export const getCurrencyInputPlaceholder = (currency: unknown): string =>
  formatWorkspaceCurrency(getWorkspaceCurrencyOption(currency).sampleAmount, currency);
