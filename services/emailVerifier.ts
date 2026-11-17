/**
 * Email Verifier Service
 * Integrates with Reoon Email Verifier API to validate email addresses
 */

/**
 * Result from Reoon Email Verifier API (QUICK mode)
 */
export interface EmailVerificationResult {
  email: string;
  status: 'valid' | 'safe' | 'risky' | 'invalid' | 'disposable' | 'spamtrap' | 'unknown';
  username: string;
  domain: string;
  is_valid_syntax: boolean;
  is_disposable: boolean;
  is_role_account: boolean;
  mx_accepts_mail: boolean;
  is_spamtrap: boolean;
  is_free_email: boolean;
  mx_records: string[];
  verification_mode: 'quick' | 'power';
}

/**
 * Balance information from Reoon Email Verifier API
 */
export interface EmailVerifierBalance {
  api_status: 'active' | 'inactive';
  remaining_daily_credits: number;
  remaining_instant_credits: number;
  status: 'success' | 'error';
}

/**
 * Verification mode
 */
export type VerificationMode = 'quick' | 'power';

/**
 * Get the Reoon API key from environment variables
 */
function getApiKey(): string {
  const apiKey = process.env.REOON_API_KEY;
  if (!apiKey) {
    throw new Error('REOON_API_KEY environment variable is not set');
  }
  return apiKey;
}

// Email verifier logs are very noisy; enable only when debugging.
const ENABLE_EMAIL_VERIFIER_LOGS: boolean =
  String(process.env.EMAIL_VERIFIER_LOGS || '').toLowerCase() === 'true';

function debugLog(...args: unknown[]): void {
  if (ENABLE_EMAIL_VERIFIER_LOGS) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/**
 * Verify an email address using Reoon Email Verifier API
 * 
 * @param email - Email address to verify
 * @param mode - Verification mode ('quick' or 'power')
 * @returns Verification result
 */
export async function verifyEmail(
  email: string,
  mode: VerificationMode = 'quick'
): Promise<EmailVerificationResult> {
  const apiKey = getApiKey();
  
  // Validate email format before making API call
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  const url = new URL('https://emailverifier.reoon.com/api/v1/verify');
  url.searchParams.append('email', email);
  url.searchParams.append('key', apiKey);
  url.searchParams.append('mode', mode);

  debugLog(`[EmailVerifier] Verifying email: ${email} (mode: ${mode})`);

  try {
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EmailVerifier] API error: ${response.status} - ${errorText}`);
      throw new Error(`Reoon API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as EmailVerificationResult;

    // Log verification result for debugging
    debugLog(`[EmailVerifier] Verification result for ${email}:`, {
      status: data.status,
      is_valid_syntax: data.is_valid_syntax,
      is_disposable: data.is_disposable,
      mx_accepts_mail: data.mx_accepts_mail,
    });

    return data;
  } catch (error: any) {
    console.error('[EmailVerifier] Failed to verify email:', error);
    
    // Handle timeout errors specifically
    if (error.name === 'AbortError' || error.code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error('Email verification timed out. The service may be slow or unavailable. Please try again.');
    }
    
    // Handle network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error('Unable to connect to email verification service. Please check your internet connection.');
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Get remaining API credits
 * 
 * @returns Balance information
 */
export async function getBalance(): Promise<EmailVerifierBalance> {
  const apiKey = getApiKey();

  const url = new URL('https://emailverifier.reoon.com/api/v1/check-account-balance/');
  url.searchParams.append('key', apiKey);

  debugLog('[EmailVerifier] Checking API balance');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[EmailVerifier] Balance API error: ${response.status} - ${errorText}`);
      throw new Error(`Reoon Balance API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as EmailVerifierBalance;

    debugLog('[EmailVerifier] Balance:', {
      daily: data.remaining_daily_credits,
      instant: data.remaining_instant_credits,
    });

    return data;
  } catch (error) {
    console.error('[EmailVerifier] Failed to check balance:', error);
    throw error;
  }
}

/**
 * Check if an email is valid based on verification result
 * 
 * @param result - Verification result
 * @param mode - Verification mode used ('quick' or 'power')
 * @returns True if email is valid
 */
export function isEmailValid(result: EmailVerificationResult, mode: VerificationMode = 'quick'): boolean {
  // Reject obviously invalid emails regardless of API response
  const email = result.email.toLowerCase();
  const invalidPatterns = [
    /^example@/i,
    /^test@/i,
    /^testing@/i,
    /^tester@/i,
    /^test\d*@/i,  // test1@, test2@, etc.
    /^admin@/i,
    /^noreply@/i,
    /^no-reply@/i,
    /@example\./i,
    /@test\./i,
    /@localhost/i,
  ];

  // Check against known invalid patterns
  for (const pattern of invalidPatterns) {
    if (pattern.test(email)) {
      debugLog(`[EmailVerifier] Email rejected by pattern: ${email}`);
      return false;
    }
  }

  // Reject emails with test/invalid usernames on common domains
  const commonDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
  const domain = email.split('@')[1] || '';

  if (commonDomains.includes(domain)) {
    const username = email.split('@')[0] || '';
    const testUsernames = [
      'test', 'testing', 'tester', 'test1', 'test2', 'test3',
      'example', 'sample', 'demo', 'temp', 'temporary',
      'noreply', 'no-reply', 'donotreply'
    ];

    // Check if username contains test keywords
    for (const testWord of testUsernames) {
      // Exact match
      if (username === testWord) {
        debugLog(`[EmailVerifier] Email rejected - test username on common domain: ${email}`);
        return false;
      }

      // Starts with test word followed by separator or number
      const pattern = new RegExp(`^${testWord}[._0-9]`, 'i');
      if (pattern.test(username)) {
        debugLog(`[EmailVerifier] Email rejected - test username variant on common domain: ${email}`);
        return false;
      }
    }
  }
  
  // For 'quick' mode, be more strict - require status to be explicitly 'valid'
  // Quick mode can have false positives, so we need stricter checks
  if (mode === 'quick') {
    // In quick mode, we apply the same strict validation regardless of domain
    // All emails must pass all validation checks
    const isValid = result.status === 'valid' &&
                   result.is_valid_syntax === true &&
                   result.is_disposable === false &&
                   result.mx_accepts_mail === true &&
                   result.is_spamtrap === false;

    if (!isValid) {
      debugLog(`[EmailVerifier] Email validation failed (quick mode):`, {
        email: result.email,
        status: result.status,
        is_valid_syntax: result.is_valid_syntax,
        is_disposable: result.is_disposable,
        mx_accepts_mail: result.mx_accepts_mail,
        is_spamtrap: result.is_spamtrap,
        reason: !result.is_valid_syntax ? 'invalid_syntax' :
                result.is_disposable ? 'disposable' :
                !result.mx_accepts_mail ? 'mx_rejects' :
                result.is_spamtrap ? 'spamtrap' :
                result.status !== 'valid' ? `status_${result.status}` : 'unknown'
      });
    }

    return isValid;
  }
  
  // For 'power' mode, trust the API more as it does deeper verification
  const isValid = (result.status === 'valid' || result.status === 'safe') &&
                   result.is_valid_syntax === true &&
                   result.is_disposable === false &&
                   result.mx_accepts_mail === true &&
                   result.is_spamtrap === false;
  
  if (!isValid) {
    debugLog(`[EmailVerifier] Email validation failed (power mode):`, {
      email: result.email,
      status: result.status,
      is_valid_syntax: result.is_valid_syntax,
      is_disposable: result.is_disposable,
      mx_accepts_mail: result.mx_accepts_mail,
      is_spamtrap: result.is_spamtrap,
      reason: !result.is_valid_syntax ? 'invalid_syntax' :
              result.is_disposable ? 'disposable' :
              !result.mx_accepts_mail ? 'mx_rejects' :
              result.is_spamtrap ? 'spamtrap' :
              result.status !== 'valid' ? `status_${result.status}` : 'unknown'
    });
  }
  
  return isValid;
}

/**
 * Get human-readable status description
 * 
 * @param result - Verification result
 * @returns Status description
 */
export function getStatusDescription(result: EmailVerificationResult): string {
  switch (result.status) {
    case 'valid':
      return 'Email is valid and deliverable';
    case 'safe':
      return 'Email looks safe and deliverable';
    case 'risky':
      return 'Email looks risky (cannot guarantee deliverability)';
    case 'invalid':
      return 'Email is invalid or does not exist';
    case 'disposable':
      return 'Email is from a disposable/temporary service';
    case 'spamtrap':
      return 'Email is identified as a spam trap';
    default:
      return 'Unknown status';
  }
}
