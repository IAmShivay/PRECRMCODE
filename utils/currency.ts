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

interface WorkspaceCurrencyOption {
  code: WorkspaceCurrencyCode;
  locale: string;
}

export const DEFAULT_WORKSPACE_CURRENCY: WorkspaceCurrencyCode = 'INR';

export const WORKSPACE_CURRENCY_CODES: WorkspaceCurrencyCode[] = [
  'INR',
  'USD',
  'AED',
  'EUR',
  'GBP',
  'SGD',
  'AUD',
  'CAD',
  'SAR',
  'QAR',
];

const WORKSPACE_CURRENCY_OPTIONS: WorkspaceCurrencyOption[] = [
  { code: 'INR', locale: 'en-IN' },
  { code: 'USD', locale: 'en-US' },
  { code: 'AED', locale: 'en-AE' },
  { code: 'EUR', locale: 'en-IE' },
  { code: 'GBP', locale: 'en-GB' },
  { code: 'SGD', locale: 'en-SG' },
  { code: 'AUD', locale: 'en-AU' },
  { code: 'CAD', locale: 'en-CA' },
  { code: 'SAR', locale: 'en-SA' },
  { code: 'QAR', locale: 'en-QA' },
];

const currencyByCode = new Map(WORKSPACE_CURRENCY_OPTIONS.map((currency) => [currency.code, currency]));

export const normalizeWorkspaceCurrency = (currency: unknown): WorkspaceCurrencyCode => {
  const code = String(currency || '').trim().toUpperCase();
  return currencyByCode.has(code as WorkspaceCurrencyCode)
    ? (code as WorkspaceCurrencyCode)
    : DEFAULT_WORKSPACE_CURRENCY;
};

export const formatWorkspaceCurrency = (value: number, currency: unknown): string => {
  const option = (currencyByCode.get(normalizeWorkspaceCurrency(currency)) || WORKSPACE_CURRENCY_OPTIONS[0]) as WorkspaceCurrencyOption;
  const numericValue = Number.isFinite(value) ? value : 0;

  try {
    return new Intl.NumberFormat(option.locale, {
      style: 'currency',
      currency: option.code,
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `${option.code} ${Math.round(numericValue).toLocaleString('en-US')}`;
  }
};
