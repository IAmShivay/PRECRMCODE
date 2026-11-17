import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { validateName, validateEmail, validatePassword } from '../../lib/validation';
import { ApiError, type ValidationResult } from '../types';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

interface SignupFormProps {
  prefillEmail?: string;
  onSignupSuccess?: () => void;
}

const SignupForm: React.FC<SignupFormProps> = ({ prefillEmail, onSignupSuccess }) => {
  const navigate = useNavigate();
  const { signup } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefillEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsTouched, setTermsTouched] = useState(false);

  // Prefill email when it changes
  useEffect(() => {
    if (prefillEmail) {
      setEmail(prefillEmail);
    }
  }, [prefillEmail]);

  const handleFieldBlur = (field: string) => {
    setTouched({ ...touched, [field]: true });
    validateField(field);
  };

  const validateField = (field: string) => {
    let result: ValidationResult = { valid: true };

    switch (field) {
      case 'name':
        result = validateName(name);
        break;
      case 'email':
        result = validateEmail(email);
        break;
      case 'password':
        result = validatePassword(password);
        break;
      case 'confirmPassword': {
        const value = String(confirmPassword || '');
        if (!value.trim()) {
          result = { valid: false, error: 'Please confirm your password.' };
        } else if (value !== password) {
          result = { valid: false, error: 'Passwords do not match.' };
        }
        break;
      }
    }

    setErrors((prev) => ({
      ...prev,
      [field]: result.valid ? '' : result.error || '',
    }));

    return result.valid;
  };

  const validateAll = () => {
    const nameValid = validateField('name');
    const emailValid = validateField('email');
    const passwordValid = validateField('password');
    const confirmPasswordValid = validateField('confirmPassword');
    return nameValid && emailValid && passwordValid && confirmPasswordValid;
  };

  useEffect(() => {
    if (!touched.confirmPassword) return;
    validateField('confirmPassword');
  }, [password, confirmPassword, touched.confirmPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Mark all fields as touched
    setTouched({ name: true, email: true, password: true, confirmPassword: true });
    setTermsTouched(true);

    if (!validateAll()) {
      return;
    }

    if (!acceptedTerms) {
      setErrors((prev) => ({ ...prev, terms: 'You must accept the Terms of Service to continue.' }));
      return;
    }

    setIsLoading(true);

    try {
      await signup(name, email.toLowerCase().trim(), password, acceptedTerms);

      // Call success callback if provided
      if (onSignupSuccess) {
        onSignupSuccess();
      } else {
        // Normal signup flow - navigate to workspace creation
        navigate('/onboarding/workspace');
      }
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
        {/* Name field */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Full name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => handleFieldBlur('name')}
          disabled={isLoading}
          aria-invalid={!!(touched.name && errors.name)}
          aria-describedby={touched.name && errors.name ? 'signup-name-error' : undefined}
          className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 ${
            touched.name && errors.name
              ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
              : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
          } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
          placeholder="Enter your full name"
        />
        {touched.name && errors.name && (
          <p id="signup-name-error" className="text-red-500 text-sm mt-1" role="alert" aria-live="polite">
            {errors.name}
          </p>
        )}
      </div>

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
          aria-describedby={touched.email && errors.email ? 'signup-email-error' : undefined}
          className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 ${
            touched.email && errors.email
              ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
              : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
          } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
          placeholder="Enter your email"
          autoComplete="email"
        />
        {touched.email && errors.email && (
          <p id="signup-email-error" className="text-red-500 text-sm mt-1" role="alert" aria-live="polite">
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
            aria-describedby={touched.password && errors.password ? 'signup-password-error' : undefined}
            className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 pr-12 ${
              touched.password && errors.password
                ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
                : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
            } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder="Create a password"
            autoComplete="new-password"
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
          <p id="signup-password-error" className="text-red-500 text-sm mt-1" role="alert" aria-live="polite">
            {errors.password}
          </p>
        )}
        <p className="text-gray-400 text-sm mt-1">Must be at least 8 characters</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
          Confirm password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => handleFieldBlur('confirmPassword')}
            disabled={isLoading}
            aria-invalid={!!(touched.confirmPassword && errors.confirmPassword)}
            aria-describedby={
              touched.confirmPassword && errors.confirmPassword ? 'signup-confirm-password-error' : undefined
            }
            className={`w-full px-4 py-3 rounded-xl border transition-all duration-200 pr-12 ${
              touched.confirmPassword && errors.confirmPassword
                ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
                : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
            } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder="Re-enter your password"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
          >
            {showConfirmPassword ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        </div>
        {touched.confirmPassword && errors.confirmPassword && (
          <p
            id="signup-confirm-password-error"
            className="text-red-500 text-sm mt-1"
            role="alert"
            aria-live="polite"
          >
            {errors.confirmPassword}
          </p>
        )}
      </div>

      <div className="flex items-start gap-3">
        <input
          id="accept-terms"
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => {
            setAcceptedTerms(e.target.checked);
            setErrors((prev) => {
              const next = { ...prev };
              delete next.terms;
              return next;
            });
          }}
          onBlur={() => setTermsTouched(true)}
          disabled={isLoading}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
        />
        <label htmlFor="accept-terms" className="text-sm text-gray-600">
          I agree to the{' '}
          <Link to="/terms" className="text-black font-medium hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-black font-medium hover:underline">
            Privacy Policy
          </Link>
          .
        </label>
      </div>
      {termsTouched && errors.terms && (
        <p className="text-red-500 text-sm" role="alert" aria-live="polite">
          {errors.terms}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-black text-white py-3 rounded-full font-medium hover:bg-gray-800 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-black flex items-center justify-center"
      >
        {isLoading ? (
          <>
            <Spinner />
            Creating account...
          </>
        ) : (
          'Create account'
        )}
      </button>

        {/* Sign in link */}
        <p className="text-center text-gray-500 text-sm">
          Already have an account?{' '}
          <a href="/login" className="text-black font-medium hover:underline">
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
};

export default SignupForm;
