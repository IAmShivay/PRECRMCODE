import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { validateEmail } from '../../lib/validation';
import { ApiError, type ValidationResult } from '../types';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, workspaces } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Check for test credentials from debug page
  useEffect(() => {
    const testEmail = sessionStorage.getItem('test_login_email');
    const testPassword = sessionStorage.getItem('test_login_password');

    if (testEmail && testPassword) {
      setEmail(testEmail);
      setPassword(testPassword);
      // Clear the stored credentials after using
      sessionStorage.removeItem('test_login_email');
      sessionStorage.removeItem('test_login_password');
    }
  }, []);

  // Redirect after login – go back to the originally requested route when present
  useEffect(() => {
    if (loginSuccess && isAuthenticated) {
      const from = (location.state as any)?.from;
      const pathname = typeof from?.pathname === 'string' ? from.pathname : '/dashboard';
      const search = typeof from?.search === 'string' ? from.search : '';
      const hash = typeof from?.hash === 'string' ? from.hash : '';

      const target =
        pathname === '/login' || pathname === '/signup'
          ? '/dashboard'
          : `${pathname}${search}${hash}`;

      navigate(target, { replace: true });
    }
  }, [loginSuccess, isAuthenticated, workspaces, navigate, location.state]);

  const handleFieldBlur = (field: string) => {
    setTouched({ ...touched, [field]: true });
    validateField(field);
  };

  const validateField = (field: string) => {
    let result: ValidationResult = { valid: true };

    switch (field) {
      case 'email':
        result = validateEmail(email);
        break;
      case 'password':
        if (!password || password.trim() === '') {
          result = { valid: false, error: 'Password is required' };
        }
        break;
    }

    setErrors((prev) => ({
      ...prev,
      [field]: result.valid ? '' : result.error || '',
    }));

    return result.valid;
  };

  const validateAll = () => {
    const emailValid = validateField('email');
    const passwordValid = validateField('password');
    return emailValid && passwordValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Mark all fields as touched
    setTouched({ email: true, password: true });

    if (!validateAll()) {
      return;
    }

    setIsLoading(true);

    try {
      await login(email.toLowerCase().trim(), password.trim());
      setLoginSuccess(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const Spinner = () => (
    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  return (
    <div className="space-y-5">
      {/* Form-wide error */}
      {formError && (
        <div
          className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Email field */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => handleFieldBlur('email')}
          disabled={isLoading}
          aria-invalid={!!(touched.email && errors.email)}
          aria-describedby={touched.email && errors.email ? 'login-email-error' : undefined}
          className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 ${
            touched.email && errors.email
              ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
              : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
          } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
          placeholder="Enter your email"
          autoComplete="email"
        />
        {touched.email && errors.email && (
          <p id="login-email-error" className="text-red-500 text-sm mt-1" role="alert" aria-live="polite">
            {errors.email}
          </p>
        )}
      </div>

      {/* Password field */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => handleFieldBlur('password')}
            disabled={isLoading}
            aria-invalid={!!(touched.password && errors.password)}
            aria-describedby={touched.password && errors.password ? 'login-password-error' : undefined}
            className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 pr-12 ${
              touched.password && errors.password
                ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
                : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
            } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        </div>
        {touched.password && errors.password && (
          <p id="login-password-error" className="text-red-500 text-sm mt-1" role="alert" aria-live="polite">
            {errors.password}
          </p>
        )}
      </div>

      {/* Forgot password link (placeholder for future) */}
      <div className="flex justify-end">
        <a href="#" className="text-sm text-gray-500 hover:text-black transition-colors">
          Forgot password?
        </a>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-black text-white py-3 rounded-full font-medium hover:bg-gray-800 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-black flex items-center justify-center"
      >
        {isLoading ? (
          <>
            <Spinner />
            Signing in...
          </>
        ) : (
          'Sign in'
        )}
      </button>

        {/* Sign up link */}
        <p className="text-center text-gray-500 text-sm">
          Don't have an account?{' '}
          <a href="/signup" className="text-black font-medium hover:underline">
            Sign up
          </a>
        </p>
      </form>
    </div>
  );
};

export default LoginForm;
