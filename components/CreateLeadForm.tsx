import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { LeadStatus, CreateLeadRequest, LeadCustomField } from './types';
import { getAuthToken } from '../lib/storage';
import { verifyEmail } from '../lib/api-client';
import { getCustomFieldOptions } from '../lib/customFields';
import { validatePhone } from '../lib/validation';

// Vite exposes environment variables via import.meta.env; fall back to local backend in dev
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface CreateLeadFormProps {
  workspaceId: number;
  onSuccess?: (lead: any) => void;
  onCancel?: () => void;
}

interface FormData {
  name: string;
  email: string;
  phone: string;
  status_id: number;
  source: string;
  source_ref?: string;
  source_other?: string; // When source is OTHER: custom "please specify" value, sent as source_ref
  // Custom fields
  customFields: Record<number, string>;
}


export default function CreateLeadForm({ workspaceId, onSuccess, onCancel }: CreateLeadFormProps) {
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [customFields, setCustomFields] = useState<LeadCustomField[]>([]);
  const [sources, setSources] = useState<{ value: string; label: string }[]>([]);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    phone: '',
    status_id: 0, // Will be set when statuses load
    source: 'LANDING_PAGE',
    source_ref: '',
    source_other: '',
    customFields: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Email verification states
  const [emailVerification, setEmailVerification] = useState<{
    status: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error';
    message?: string;
  }>({ status: 'idle' });

  // Fetch statuses and custom fields on mount
  useEffect(() => {
    const fetchData = async () => {
      // Don't fetch if workspaceId is invalid
      if (!workspaceId || workspaceId <= 0) {
        console.warn('Invalid workspaceId:', workspaceId);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const token = getAuthToken();
        
        // Fetch statuses from backend API endpoint
        const statusesParams = new URLSearchParams();
        statusesParams.append('workspace_id', workspaceId.toString());
        const statusesQuery = statusesParams.toString();
        
        let statusesResponse;
        let statusesData;
        try {
          statusesResponse = await fetch(
            `${API_BASE_URL}/api/lead-statuses?${statusesQuery}`,
            {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            }
          );
          statusesData = await statusesResponse.json();
        } catch (statusErr) {
          console.error('Error fetching statuses:', statusErr);
          setLoading(false);
          return;
        }

        // Fetch custom fields from backend API endpoint
        let fieldsResponse = null;
        try {
          const fieldsRes = await fetch(
            `${API_BASE_URL}/api/workspaces/${workspaceId}/custom-fields`,
            {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            }
          );
          fieldsResponse = await fieldsRes.json();
        } catch (fieldsErr) {
          console.error('Error fetching custom fields:', fieldsErr);
        }

        if (statusesResponse.ok && statusesData.status === 'success' && statusesData.data) {
          // Ensure data is an array
          const statusesArray = Array.isArray(statusesData.data) 
            ? statusesData.data 
            : [statusesData.data];
          
          // Filter active statuses - is_active is a number (1 = active, 0 = inactive)
          const activeStatuses = statusesArray
            .filter((s: LeadStatus) => s.is_active === 1)
            .filter((s: LeadStatus) => !workspaceId || s.workspace_id === workspaceId)
            .sort((a: LeadStatus, b: LeadStatus) => a.order_index - b.order_index);
          
          setStatuses(activeStatuses);

          // Set default status to the default one, or first available status
          const defaultStatus = activeStatuses.find((s: LeadStatus) => s.is_default === 1);
          if (defaultStatus) {
            setFormData(prev => ({ ...prev, status_id: defaultStatus.id }));
          } else if (activeStatuses.length > 0) {
            // If no default status, use the first one
            setFormData(prev => ({ ...prev, status_id: activeStatuses[0].id }));
          }
        } else {
          console.error('Failed to fetch statuses:', {
            responseOk: statusesResponse.ok,
            responseStatus: statusesResponse.status,
            dataStatus: statusesData.status,
            data: statusesData
          });
        }

        if (fieldsResponse && fieldsResponse.status === 'success' && fieldsResponse.data) {
          const activeFields = fieldsResponse.data.filter((f: LeadCustomField) => f.is_active === 1);
          setCustomFields(activeFields);
        }

        // Fetch sources from registry API endpoint
        let sourcesResponse = null;
        try {
          const sourcesRes = await fetch(
            `${API_BASE_URL}/api/sources/${workspaceId}/options`,
            {
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            }
          );
          sourcesResponse = await sourcesRes.json();
        } catch (sourcesErr) {
          console.error('Error fetching sources:', sourcesErr);
        }

        if (sourcesResponse && sourcesResponse.status === 'success' && sourcesResponse.data) {
          // Use pre-formatted source options from API
          const sourceOptions: { value: string; label: string }[] = Array.isArray(
            sourcesResponse.data
          )
            ? sourcesResponse.data
            : [sourcesResponse.data];
          setSources(sourceOptions);
          
          // Set default source to Landing Page if available
          const landingPageSource = sourceOptions.find(
            (s) => s.value === 'LANDING_PAGE'
          );
          if (landingPageSource) {
            setFormData(prev => ({ ...prev, source: 'LANDING_PAGE' }));
          }
        } else {
          console.error('Failed to fetch sources:', sourcesResponse);
        }
      } catch (err) {
        console.error('Error fetching form data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [workspaceId]);

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Name is required
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    // Email is required and must be valid
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    // Phone is optional but must pass the shared backend validation rules if provided.
    if (formData.phone.trim()) {
      const phoneValidation = validatePhone(formData.phone, false);
      if (!phoneValidation.valid) {
        newErrors.phone = phoneValidation.error || 'Invalid phone format';
      }
    }

    // When source is Other, the "please specify" field is required
    if (formData.source === 'OTHER' && !formData.source_other?.trim()) {
      newErrors.source_other = 'Please specify the source (e.g. Trade Show, Cold Call)';
    }

    // Validate required custom fields
    customFields.forEach(field => {
      if (field.is_required === 1 && !formData.customFields[field.id]?.trim()) {
        newErrors[`custom_${field.id}`] = `${field.label} is required`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle input change
  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      // When switching away from Other, clear the "please specify" value
      if (field === 'source' && value !== 'OTHER') {
        next.source_other = '';
      }
      return next;
    });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    if (field === 'source' && errors.source_other) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.source_other;
        return newErrors;
      });
    }
  };

  const handleEmailBlur = async () => {
    const email = formData.email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailVerification({ status: 'idle' });
      return;
    }

    setEmailVerification({ status: 'verifying' });
    try {
      const result = await verifyEmail(email, 'auto');
      if (result.email_valid) {
        const message =
          result.email_verification_mode === 'quick'
            ? 'Looks deliverable (quick check)'
            : result.status === 'safe'
              ? 'Looks deliverable (safe check)'
              : 'Looks deliverable';
        setEmailVerification({
          status: 'valid',
          message,
        });
      } else {
        const message =
          result.email_verdict === 'unknown_accept_all'
            ? 'Cannot confirm mailbox (accept-all domain)'
            : result.status === 'disposable'
              ? 'Disposable email not allowed'
              : result.status === 'spamtrap'
                ? 'Spam trap detected'
                : 'Email is not deliverable';
        setEmailVerification({ status: 'invalid', message });
      }
    } catch (error) {
      console.error('Email verification failed:', error);
      setEmailVerification({ status: 'error', message: 'Verification failed' });
    }
  };

  // Handle custom field change
  const handleCustomFieldChange = (fieldId: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      customFields: { ...prev.customFields, [fieldId]: value },
    }));
    // Clear error
    if (errors[`custom_${fieldId}`]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[`custom_${fieldId}`];
        return newErrors;
      });
    }
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const token = getAuthToken();
      
      // When source is Other, use the "please specify" value as source_ref; otherwise use Source Reference
      const sourceRef = formData.source === 'OTHER'
        ? (formData.source_other?.trim() || undefined)
        : (formData.source_ref?.trim() || undefined);

      // Create lead using backend API endpoint
      const leadData: CreateLeadRequest = {
        workspace_id: workspaceId,
        status_id: formData.status_id,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        source_old: formData.source as CreateLeadRequest['source_old'],
        ...(sourceRef && { source_ref: sourceRef }),
      };

      // Add custom fields to the payload using their slug (backend extracts by slug/label)
      const payload: any = { ...leadData };
      Object.entries(formData.customFields).forEach(([fieldId, value]) => {
        if (value.trim()) {
          const field = customFields.find(f => f.id === Number(fieldId));
          if (field) {
            // Use field slug as the key - backend will extract custom fields by slug/label
            payload[field.slug] = value;
          }
        }
      });

      const leadResponse = await fetch(`${API_BASE_URL}/api/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const leadResponseData = await leadResponse.json();

      if (leadResponse.ok && leadResponseData.status === 'success' && leadResponseData.data) {
        const newLead = leadResponseData.data;

        // Custom field values are already created by the backend
        // But if we need to create them separately, we can do it here
        // For now, the backend handles custom fields in the lead creation payload

        // Notify sidebar to refresh count
        window.dispatchEvent(new CustomEvent('leadsChanged'));
        
        if (onSuccess) {
          onSuccess(newLead);
        }
      } else {
        const errorMessage = leadResponseData.message || leadResponseData.error || 'Failed to create lead. Please try again.';
        setSubmitError(errorMessage);
      }
    } catch (err) {
      console.error('Error creating lead:', err);
      setSubmitError('An error occurred while creating the lead. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Render custom field input based on type
  const renderCustomField = (field: LeadCustomField) => {
    const value = formData.customFields[field.id] || '';
    const error = errors[`custom_${field.id}`];
    const inputId = `create-lead-custom-${field.id}`;
    const errorId = `create-lead-custom-${field.id}-error`;
    const describedBy = error ? errorId : undefined;

    switch (field.field_type) {
      case 'text':
        return (
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              error ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
            }`}
            placeholder={`Enter ${field.label.toLowerCase()}`}
          />
        );

      case 'textarea':
        return (
          <textarea
            id={inputId}
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            rows={3}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              error ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
            }`}
            placeholder={`Enter ${field.label.toLowerCase()}`}
          />
        );

      case 'select':
        const options = getCustomFieldOptions(field.options);
        return (
          <select
            id={inputId}
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white ${
              error ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
            }`}
          >
            <option value="">Select {field.label.toLowerCase()}</option>
            {options.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'checkbox':
        const normalizedValue = String(value ?? '').trim().toLowerCase();
        const isChecked = normalizedValue === '1' || normalizedValue === 'true';
        return (
          <div className="flex items-center">
            <input
              id={inputId}
              type="checkbox"
              checked={isChecked}
              onChange={(e) => handleCustomFieldChange(field.id, e.target.checked ? '1' : '0')}
              aria-invalid={!!error}
              aria-describedby={describedBy}
              className={`h-4 w-4 text-gray-900 focus:ring-gray-900 border-gray-300 rounded ${
                error ? 'border-gray-500' : ''
              }`}
            />
            <label htmlFor={inputId} className="ml-2 text-sm text-gray-700">
              {field.label}
            </label>
          </div>
        );

      default:
        return (
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
              error ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
            }`}
            placeholder={`Enter ${field.label.toLowerCase()}`}
          />
        );
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 id="create-lead-title" className="text-xl font-semibold text-gray-900">Create New Lead</h2>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            type="button"
            aria-label="Close"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-6">
        {/* Field Requirements Info */}
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <p className="font-semibold text-gray-900 mb-2">
            <span className="font-semibold">*</span> Required Fields
          </p>
          <ul className="space-y-1 text-gray-700">
            <li>• <span className="font-medium">Name</span> - Required</li>
            <li>• <span className="font-medium">Email</span> - Required and must be unique</li>
            <li>• <span className="font-medium">Status</span> - Required</li>
            <li>• <span className="font-medium">Source</span> - Required (if Other, you must specify the source)</li>
            <li>• <span className="font-medium">Phone</span> - Optional</li>
            <li>• <span className="font-medium">Source Reference</span> - Optional</li>
          </ul>
          <p className="mt-2 text-xs text-gray-600 italic">
            * Custom fields may have additional requirements
          </p>
        </div>

        {submitError && (
          <div
            className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-800"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {submitError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Name */}
          <div className="md:col-span-2">
            <label htmlFor="create-lead-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="font-semibold">*</span>
            </label>
            <input
              id="create-lead-name"
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              disabled={loading}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'create-lead-name-error' : undefined}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-gray-900 ${
                errors.name ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
              }`}
              placeholder="Full name"
            />
            {errors.name && (
              <p id="create-lead-name-error" className="mt-1 text-sm text-gray-800" role="alert" aria-live="polite">
                {errors.name}
              </p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="create-lead-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="font-semibold">*</span> <span className="text-xs text-gray-500">(must be unique)</span>
            </label>
            <div className="relative">
              <input
                id="create-lead-email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                onBlur={handleEmailBlur}
                disabled={loading}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'create-lead-email-error' : undefined}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-gray-900 pr-10 ${
                  errors.email ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
                }`}
                placeholder="email@example.com"
              />
              {emailVerification.status === 'valid' && (
                <CheckIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-green-600" />
              )}
              {emailVerification.status === 'invalid' && (
                <ExclamationTriangleIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-red-600" />
              )}
              {emailVerification.status === 'verifying' && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {errors.email && (
              <p id="create-lead-email-error" className="mt-1 text-sm text-gray-800" role="alert" aria-live="polite">
                {errors.email}
              </p>
            )}
            {emailVerification.message && emailVerification.status !== 'verifying' && (
              <p className={`mt-1 text-sm ${emailVerification.status === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                {emailVerification.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">Email must be unique across all leads</p>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="create-lead-phone" className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              id="create-lead-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              disabled={loading}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'create-lead-phone-error' : undefined}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-gray-900 ${
                errors.phone ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
              }`}
              placeholder="+1 555 123 4567"
            />
            {errors.phone && (
              <p id="create-lead-phone-error" className="mt-1 text-sm text-gray-800" role="alert" aria-live="polite">
                {errors.phone}
              </p>
            )}
          </div>

          {/* Status */}
          <div>
            <label htmlFor="create-lead-status" className="block text-sm font-medium text-gray-700 mb-1">
              Status <span className="font-semibold">*</span>
            </label>
            {loading || statuses.length === 0 ? (
              <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
                {loading ? (
                  <div className="animate-pulse bg-gray-200 h-5 rounded"></div>
                ) : (
                  <p className="text-gray-500 text-sm">No statuses available. Please create a status first.</p>
                )}
              </div>
            ) : (
              <select
                id="create-lead-status"
                value={formData.status_id}
                onChange={(e) => handleInputChange('status_id', Number(e.target.value))}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                {statuses.map(status => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Source */}
          <div>
            <label htmlFor="create-lead-source" className="block text-sm font-medium text-gray-700 mb-1">
              Source <span className="font-semibold">*</span>
            </label>
            <select
              id="create-lead-source"
              value={formData.source}
              onChange={(e) => handleInputChange('source', e.target.value as any)}
              disabled={loading || sources.length === 0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white text-gray-900"
            >
              {sources.length === 0 ? (
                <option value="">Loading sources...</option>
              ) : (
                sources.map(source => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Source Reference (when not Other) or Please specify (when Other) */}
          {formData.source === 'OTHER' ? (
            <div className="md:col-span-2">
              <label htmlFor="create-lead-source-other" className="block text-sm font-medium text-gray-700 mb-1">
                Please specify the source <span className="font-semibold">*</span>
              </label>
              <input
                id="create-lead-source-other"
                type="text"
                value={formData.source_other}
                onChange={(e) => handleInputChange('source_other', e.target.value)}
                disabled={loading}
                aria-invalid={!!errors.source_other}
                aria-describedby={errors.source_other ? 'create-lead-source-other-error' : undefined}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 text-gray-900 ${
                  errors.source_other ? 'border-gray-500 focus:ring-gray-900' : 'border-gray-300 focus:ring-gray-900'
                }`}
                placeholder="e.g. Trade Show, Cold Call, Event, Partner"
              />
              {errors.source_other && (
                <p id="create-lead-source-other-error" className="mt-1 text-sm text-gray-800" role="alert" aria-live="polite">
                  {errors.source_other}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">Required when Source is Other</p>
            </div>
          ) : (
            <div className="md:col-span-2">
              <label htmlFor="create-lead-source-ref" className="block text-sm font-medium text-gray-700 mb-1">
                Source Reference
              </label>
              <input
                id="create-lead-source-ref"
                type="text"
                value={formData.source_ref}
                onChange={(e) => handleInputChange('source_ref', e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="Campaign ID, Ad ID, or reference code"
              />
              <p className="mt-1 text-xs text-gray-500">Optional reference for tracking lead source</p>
            </div>
          )}

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <>
              <div className="md:col-span-2 border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Additional Information</h3>
              </div>

              {customFields.map(field => (
                <div key={field.id} className="md:col-span-2">
                  <label htmlFor={`create-lead-custom-${field.id}`} className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  {field.is_required === 1 && <span className="font-semibold">*</span>}
                  </label>
                  {renderCustomField(field)}
                  {errors[`custom_${field.id}`] && (
                    <p
                      id={`create-lead-custom-${field.id}-error`}
                      className="mt-1 text-sm text-gray-800"
                      role="alert"
                      aria-live="polite"
                    >
                      {errors[`custom_${field.id}`]}
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                Creating...
              </>
            ) : (
              'Create Lead'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
