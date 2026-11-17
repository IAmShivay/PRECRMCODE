import { ValidationResult } from '../components/types.js';

// Email validation
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim() === '') {
    return { valid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  return { valid: true };
}

// Password validation
export function validatePassword(password: string): ValidationResult {
  if (!password || password.trim() === '') {
    return { valid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }

  return { valid: true };
}

// Name validation
export function validateName(name: string): ValidationResult {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Name is required' };
  }

  if (name.trim().length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }

  return { valid: true };
}

// Workspace name validation
export function validateWorkspaceName(name: string): ValidationResult {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Workspace name is required' };
  }

  if (name.trim().length < 2) {
    return { valid: false, error: 'Workspace name must be at least 2 characters' };
  }

  if (name.trim().length > 50) {
    return { valid: false, error: 'Workspace name must be less than 50 characters' };
  }

  return { valid: true };
}

// Phone validation and normalization
export interface PhoneValidationResult extends ValidationResult {
  normalized?: string;
  dialCode?: string;
  countryCode?: string;
  isValidFormat?: boolean;
}

/**
 * Validates and normalizes a phone number
 * @param phone - Phone number string to validate
 * @param required - Whether phone is required (default: false)
 * @returns Validation result with normalized phone if valid
 */
export function validatePhone(phone: string, required: boolean = false): PhoneValidationResult {
  // If not required and empty, it's valid
  if (!required && (!phone || phone.trim() === '')) {
    return { valid: true, normalized: '' };
  }

  // If required and empty, it's invalid
  if (required && (!phone || phone.trim() === '')) {
    return { valid: false, error: 'Phone number is required' };
  }

  const trimmed = phone.trim();

  // Remove all non-digit characters except +
  const cleaned = trimmed.replace(/[^\d+]/g, '');

  // Check if it contains at least some digits
  if (cleaned.length === 0 || cleaned === '+') {
    return { valid: false, error: 'Phone number must contain digits' };
  }

  // Validate minimum length (at least 7 digits for a valid phone number)
  const digitsOnly = cleaned.replace(/\+/g, '');
  if (digitsOnly.length < 7) {
    return { valid: false, error: 'Phone number is too short (minimum 7 digits)' };
  }

  // Validate maximum length (typically 15 digits max including country code)
  if (digitsOnly.length > 15) {
    return { valid: false, error: 'Phone number is too long (maximum 15 digits)' };
  }

  // Normalize the phone number so we can validate country-specific rules.
  const normalized = normalizePhone(trimmed);

  // Indian numbers are the primary default in this CRM. If a number resolves
  // to India, require an actual 10-digit Indian mobile number.
  if (normalized.countryCode === 'IN' && !INDIAN_MOBILE_RE.test(normalized.value)) {
    return {
      valid: false,
      error: 'Indian mobile numbers must be 10 digits and start with 6-9',
    };
  }

  // For non-Indian numbers, keep a generic sanity check on the local part.
  if (normalized.countryCode !== 'IN' && (normalized.value.length < MIN_LOCAL_LENGTH || normalized.value.length > 12)) {
    return {
      valid: false,
      error: 'Phone number has an invalid local number length',
    };
  }

  return {
    valid: true,
    normalized: normalized.normalized,
    dialCode: normalized.dialCode,
    countryCode: normalized.countryCode,
    isValidFormat: true,
  };
}

/**
 * Known dial codes sorted by length (longest first) so that more specific
 * codes are matched before shorter prefixes (e.g. "234" before "2").
 */
const DIAL_CODE_TABLE: Array<{ code: string; country: string }> = [
  { code: '234', country: 'NG' },
  { code: '254', country: 'KE' },
  { code: '256', country: 'UG' },
  { code: '251', country: 'ET' },
  { code: '971', country: 'AE' },
  { code: '966', country: 'SA' },
  { code: '974', country: 'QA' },
  { code: '973', country: 'BH' },
  { code: '968', country: 'OM' },
  { code: '965', country: 'KW' },
  { code: '962', country: 'JO' },
  { code: '961', country: 'LB' },
  { code: '91', country: 'IN' },
  { code: '86', country: 'CN' },
  { code: '81', country: 'JP' },
  { code: '61', country: 'AU' },
  { code: '55', country: 'BR' },
  { code: '52', country: 'MX' },
  { code: '49', country: 'DE' },
  { code: '44', country: 'GB' },
  { code: '39', country: 'IT' },
  { code: '34', country: 'ES' },
  { code: '33', country: 'FR' },
  { code: '27', country: 'ZA' },
  { code: '20', country: 'EG' },
  { code: '7', country: 'RU' },
  { code: '1', country: 'US' },
];

/**
 * Minimum local-number length expected after stripping a dial code.
 * Helps avoid false positives (e.g. a 7-digit local Indian number whose
 * first two digits happen to be "91").
 */
const MIN_LOCAL_LENGTH = 7;

/**
 * Regex for a bare 10-digit Indian mobile number (starts with 6-9).
 * Used to short-circuit dial-code detection so that numbers like
 * 7622803823 or +9687954095 are not misidentified as Russian / Omani / etc.
 */
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Normalizes a phone number to a standard format
 * @param phone - Phone number string to normalize
 * @returns Normalized phone number with dial code and country code
 */
export function normalizePhone(phone: string): {
  normalized: string;
  dialCode: string;
  countryCode: string;
  value: string;
} {
  // Remove all non-digit characters except +, then keep only a single
  // leading + (prevents inputs like "+91+91..." from slipping through).
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.substring(1).replace(/\+/g, '');
  }

  // Default to India if no country code detected
  let dialCode = '+91';
  let countryCode = 'IN';
  let value = cleaned;

  // ---------- Helper: match a dial code from a digits-only string ----------
  const detectDialCode = (digits: string): { code: string; country: string; local: string } | null => {
    for (const entry of DIAL_CODE_TABLE) {
      if (digits.startsWith(entry.code) && digits.length - entry.code.length >= MIN_LOCAL_LENGTH) {
        return { code: entry.code, country: entry.country, local: digits.substring(entry.code.length) };
      }
    }
    return null;
  };

  if (cleaned.startsWith('+')) {
    const digits = cleaned.substring(1); // everything after the +

    // ---- Indian mobile short-circuit ----
    // If the digits after '+' are exactly a 10-digit Indian mobile number
    // the '+' was added without the country code (e.g. landing-page forms
    // that prepend '+' to bare user input).  Treat as Indian immediately
    // so that collisions with other dial codes are impossible:
    //   +7622803823  → +917622803823  (was misidentified as RU +7)
    //   +9687954095  → +919687954095  (was misidentified as OM +968)
    if (INDIAN_MOBILE_RE.test(digits)) {
      return {
        normalized: `+91${digits}`,
        dialCode: '+91',
        countryCode: 'IN',
        value: digits,
      };
    }

    // Guard against doubled country codes (e.g. +9191XXXXXXXXXX)
    const detected = detectDialCode(digits);
    if (detected) {
      dialCode = `+${detected.code}`;
      countryCode = detected.country;
      value = detected.local;

      // Check if local part ALSO starts with the same dial code (double prefix)
      // e.g. +9191XXXXXXXXXX → the local part "919876543210" starts with "91"
      // Only strip the duplicate if the remaining digits form a valid 10-digit
      // Indian mobile — avoids false positives where the local number just
      // happens to start with the dial code (e.g. +91-9152274759 is valid,
      // NOT a doubled prefix).
      if (value.startsWith(detected.code) && value.length - detected.code.length >= MIN_LOCAL_LENGTH) {
        const afterStrip = value.substring(detected.code.length);
        if (detected.country === 'IN' ? INDIAN_MOBILE_RE.test(afterStrip) : true) {
          value = afterStrip;
        }
      }
    } else {
      // Generic extraction — take first 1-3 digits after +
      const match = digits.match(/^(\d{1,3})(.+)$/);
      if (match && match[1] && match[2]) {
        dialCode = `+${match[1]}`;
        value = match[2];
        countryCode = 'INTL';
      }
    }

    return {
      normalized: `+${detected ? detected.code : dialCode.substring(1)}${value}`,
      dialCode,
      countryCode,
      value,
    };
  } else {
    // No + prefix — try to detect an existing country code in the digits
    let val = cleaned;
    if (val.startsWith('0')) val = val.substring(1);

    // Indian mobile numbers are exactly 10 digits and start with 6-9.
    // Without an explicit '+' prefix we must NOT let any dial code
    // (7 → RU, 1 → US, 968 → OM, etc.) hijack these numbers.
    if (INDIAN_MOBILE_RE.test(val)) {
      return {
        normalized: `+91${val}`,
        dialCode: '+91',
        countryCode: 'IN',
        value: val,
      };
    }

    // Not a bare Indian mobile — try to detect an embedded country code
    // (e.g. "917622803823" → +91 7622803823).
    const detected = detectDialCode(val);
    if (detected) {
      return {
        normalized: `+${detected.code}${detected.local}`,
        dialCode: `+${detected.code}`,
        countryCode: detected.country,
        value: detected.local,
      };
    }

    // No recognisable country code — default to India (+91)
    return {
      normalized: `+91${val}`,
      dialCode: '+91',
      countryCode: 'IN',
      value: val,
    };
  }
}

// Date formatting for MySQL
export function formatMySqlDateTimeUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function normalizeMySqlDateTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return formatMySqlDateTimeUtc(value);

  const raw = String(value).trim();
  if (raw.length === 0) return null;
  // If already in MySQL format
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return formatMySqlDateTimeUtc(parsed);
}

// Validate all fields in a form
export function validateForm(fields: Record<string, string>, validators: Record<string, (value: string) => ValidationResult>): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  let isValid = true;

  for (const [field, value] of Object.entries(fields)) {
    const validator = validators[field];
    if (validator) {
      const result = validator(value);
      if (!result.valid) {
        errors[field] = result.error || 'Invalid value';
        isValid = false;
      }
    }
  }

  return { isValid, errors };
}
