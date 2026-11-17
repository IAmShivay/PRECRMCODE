import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { validateWorkspaceName } from '../../lib/validation';
import { ApiError, type ValidationResult } from '../types';

interface WorkspaceFormProps {
  isSkippable?: boolean;
  isNewWorkspace?: boolean;
}

const WorkspaceForm: React.FC<WorkspaceFormProps> = ({ isSkippable = false, isNewWorkspace = false }) => {
  const navigate = useNavigate();
  const { user, createWorkspace } = useAuth();

  const [workspaceName, setWorkspaceName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleFieldBlur = (field: string) => {
    setTouched({ ...touched, [field]: true });
    validateField(field);
  };

  const validateField = (field: string) => {
    let result: ValidationResult = { valid: true };

    if (field === 'workspaceName') {
      result = validateWorkspaceName(workspaceName);
    }

    setErrors((prev) => ({
      ...prev,
      [field]: result.valid ? '' : result.error || '',
    }));

    return result.valid;
  };

  const validateAll = () => {
    return validateField('workspaceName');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Mark all fields as touched
    setTouched({ workspaceName: true });

    if (!validateAll()) {
      return;
    }

    const trimmedName = workspaceName.trim();
    if (!trimmedName) {
      setErrors((prev) => ({ ...prev, workspaceName: 'Workspace name is required' }));
      return;
    }

    setIsLoading(true);

    try {
      await createWorkspace(trimmedName);
      setIsSuccess(true);

      // Navigate to dashboard after a short delay to show success
      setTimeout(() => {
        navigate('/dashboard');
      }, 1000);
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

  const handleSkip = () => {
    navigate('/dashboard');
  };

  const Spinner = () => (
    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  const SuccessCheck = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );

  if (isSuccess) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Workspace created!</h3>
        <p className="text-gray-500">Redirecting to your dashboard...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Welcome message - only show for onboarding */}
      {!isNewWorkspace && (
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border border-gray-200">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-lg">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1">
              <p className="text-gray-800 font-medium text-lg mb-1">
                Almost there, {user?.name?.split(' ')[0]}!
              </p>
              <p className="text-gray-500 text-sm">
                Create your first workspace to start organizing your contacts and deals.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Workspace suggestions */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Quick suggestions:</p>
        <div className="flex flex-wrap gap-2">
          {['My Company', 'Sales Team', 'Marketing', 'Personal CRM'].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setWorkspaceName(suggestion)}
              disabled={isLoading}
              className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:border-black hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {/* Form-wide error */}
      {formError && (
        <div
          className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm flex items-start gap-3"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span>{formError}</span>
        </div>
      )}

      {/* Workspace name field */}
      <div>
        <label htmlFor="workspaceName" className="block text-sm font-medium text-gray-700 mb-2">
          Workspace name
        </label>
        <div className="relative">
          <input
            id="workspaceName"
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            onBlur={() => handleFieldBlur('workspaceName')}
            disabled={isLoading}
            aria-invalid={!!(touched.workspaceName && errors.workspaceName)}
            aria-describedby={touched.workspaceName && errors.workspaceName ? 'workspace-name-error' : undefined}
            className={`w-full px-4 py-4 rounded-xl border transition-all duration-200 text-lg ${
              touched.workspaceName && errors.workspaceName
                ? 'border-red-300 focus:ring-2 focus:ring-red-100 focus:border-red-400'
                : 'border-gray-200 focus:ring-2 focus:ring-black/5 focus:border-black'
            } outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
            placeholder="My Company"
          />
          {workspaceName && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {workspaceName.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
          )}
        </div>
        {touched.workspaceName && errors.workspaceName && (
          <p id="workspace-name-error" className="text-red-500 text-sm mt-2 flex items-center gap-1" role="alert" aria-live="polite">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {errors.workspaceName}
          </p>
        )}
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isLoading || !workspaceName.trim()}
        className="w-full bg-black text-white py-4 rounded-full font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-black flex items-center justify-center text-base shadow-lg shadow-black/20"
      >
        {isLoading ? (
          <>
            <Spinner />
            Creating workspace...
          </>
        ) : (
          <>
            <SuccessCheck />
            Create workspace
          </>
        )}
      </button>

      {/* Skip button */}
      {isSkippable && (
        <button
          type="button"
          onClick={handleSkip}
          disabled={isLoading}
          className="w-full bg-white text-gray-600 py-3 rounded-full font-medium hover:bg-gray-50 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200"
        >
          Skip for now
        </button>
      )}

      {/* Info text - only show for onboarding */}
      {!isNewWorkspace && (
        <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>You can create more workspaces later from your dashboard</span>
        </div>
      )}
    </form>
  );
};

export default WorkspaceForm;
