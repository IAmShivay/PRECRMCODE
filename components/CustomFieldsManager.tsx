import React, { useState, useEffect } from 'react';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { LeadCustomField } from './types';
import { ApiError } from './types';
import {
  getWorkspaceCustomFields,
  createWorkspaceCustomField,
  updateWorkspaceCustomField,
  deleteWorkspaceCustomField,
} from '../lib/api-client';
import { getCustomFieldOptions } from '../lib/customFields';

interface CustomFieldsManagerProps {
  workspaceId: number;
  onFieldsChange?: () => void; // Callback to refresh custom fields in parent component
}

type FieldConfig = Omit<LeadCustomField, 'id' | 'created_at'> & {
  tempId?: string;
};

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input', description: 'Single line text input' },
  { value: 'textarea', label: 'Text Area', description: 'Multi-line text input' },
  { value: 'number', label: 'Number', description: 'Numeric input' },
  { value: 'date', label: 'Date', description: 'Date picker' },
  { value: 'select', label: 'Dropdown', description: 'Single select from options' },
  { value: 'multiselect', label: 'Multi-select', description: 'Select multiple options' },
  { value: 'checkbox', label: 'Checkbox', description: 'Yes/No checkbox' },
];

export default function CustomFieldsManager({ workspaceId, onFieldsChange }: CustomFieldsManagerProps) {
  const [fields, setFields] = useState<LeadCustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingField, setEditingField] = useState<LeadCustomField | null>(null);
  const [formData, setFormData] = useState<FieldConfig>({
    workspace_id: workspaceId,
    label: '',
    slug: '',
    field_type: 'text',
    options: '',
    is_required: 0,
    is_active: 1,
    sort_order: 0,
  });

  // [existing code continues...]
  const [submitting, setSubmitting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  // Fetch custom fields
  useEffect(() => {
    const fetchFields = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await getWorkspaceCustomFields(workspaceId);
        if (response.status === 'success' && response.data) {
          // Sort by sort_order
          const sortedFields = response.data.sort((a, b) => a.sort_order - b.sort_order);
          setFields(sortedFields);
        } else {
          setError('Failed to load custom fields');
        }
      } catch (err) {
        console.error('Error fetching custom fields:', err);
        setError('Failed to load custom fields');
      } finally {
        setLoading(false);
      }
    };

    fetchFields();
  }, [workspaceId]);

  // Generate slug from label
  const generateSlug = (label: string): string => {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 50);
  };

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.label.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Auto-generate slug if not provided
      const slug = formData.slug || generateSlug(formData.label);

      const fieldData = {
        ...formData,
        slug,
      };

      if (editingField) {
        const response = await updateWorkspaceCustomField(editingField.id, fieldData);
        if (response.status === 'success') {
          // Update local state
          setFields(fields.map(f =>
            f.id === editingField.id ? { ...f, ...fieldData } : f
          ));
          handleCancelForm();
          // Notify parent to refresh custom fields
          onFieldsChange?.();
        } else {
          setError('Failed to update field');
        }
      } else {
        const response = await createWorkspaceCustomField(workspaceId, fieldData);
        if (response.status === 'success' && response.data) {
          // Refresh the fields list to get the complete field data from the server
          const refreshedResponse = await getWorkspaceCustomFields(workspaceId);
          if (refreshedResponse.status === 'success' && refreshedResponse.data) {
            const sortedFields = refreshedResponse.data.sort((a, b) => a.sort_order - b.sort_order);
            setFields(sortedFields);
          } else {
            // Fallback: add field to local state if refresh fails
            const newField = {
              ...fieldData,
              id: (response.data as any).id ?? response.id,
              created_at: new Date().toISOString(),
            } as LeadCustomField;
            setFields([...fields, newField]);
          }
          handleCancelForm();
          // Notify parent to refresh custom fields
          onFieldsChange?.();
        } else {
          setError('Failed to create field');
        }
      }
    } catch (err) {
      console.error('Error saving field:', err);

      if (err instanceof ApiError) {
        // Short, friendly messages for known cases
        if (err.status === 409) {
          setError('You can only have one custom field per workspace.');
        } else {
          setError(err.message || 'Failed to save field. Please try again.');
        }
      } else {
        setError('Failed to save field. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Handle edit
  const handleEdit = (field: LeadCustomField) => {
    setEditingField(field);
    setFormData({
      workspace_id: field.workspace_id,
      label: field.label,
      slug: field.slug,
      field_type: field.field_type,
      options: getCustomFieldOptions(field.options).join(', '),
      is_required: field.is_required,
      is_active: field.is_active,
      sort_order: field.sort_order,
    });
    setShowForm(true);
  };

  // Handle delete
  const handleDelete = async (fieldId: number) => {
    if (!confirm('Are you sure you want to delete this custom field? This action cannot be undone.')) {
      return;
    }

    setDeleteLoading(fieldId);
    try {
      const response = await deleteWorkspaceCustomField(fieldId, workspaceId);
      if (response.status === 'success') {
        setFields(fields.filter(f => f.id !== fieldId));
        // Notify parent to refresh custom fields
        onFieldsChange?.();
      } else {
        setError('Failed to delete field');
      }
    } catch (err) {
      console.error('Error deleting field:', err);
      setError('Failed to delete field. Please try again.');
    } finally {
      setDeleteLoading(null);
    }
  };

  // Handle toggle active
  const handleToggleActive = async (field: LeadCustomField) => {
    const newValue = field.is_active === 1 ? 0 : 1;

    try {
      const response = await updateWorkspaceCustomField(field.id, {
        is_active: newValue,
      });

      if (response.status === 'success') {
        setFields(fields.map(f =>
          f.id === field.id ? { ...f, is_active: newValue } : f
        ));
        // Notify parent to refresh custom fields (since active/inactive affects display)
        onFieldsChange?.();
      }
    } catch (err) {
      console.error('Error toggling field:', err);
      setError('Failed to update field');
    }
  };

  // Handle cancel form
  const handleCancelForm = () => {
    setShowForm(false);
    setEditingField(null);
    setFormData({
      workspace_id: workspaceId,
      label: '',
      slug: '',
      field_type: 'text',
      options: '',
      is_required: 0,
      is_active: 1,
      sort_order: 0,
    });
    setError(null);
  };

  // Get field type label
  const getFieldTypeLabel = (type: string) => {
    return FIELD_TYPES.find(t => t.value === type)?.label || type;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Custom Fields</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage custom fields for your leads. These fields will appear in the lead creation form.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors flex-shrink-0 whitespace-nowrap"
        >
          <PlusIcon className="h-5 w-5" />
          Add Field
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {error}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              {editingField ? 'Edit Field' : 'Add New Field'}
            </h3>
          </div>
          <form onSubmit={handleSubmit} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Label */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Field Label <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="e.g., Company Name"
                  required
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Field Slug (unique identifier)
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="company_name"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Auto-generated from label if left blank
                </p>
              </div>

              {/* Field Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Field Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.field_type}
                  onChange={(e) => setFormData({ ...formData, field_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  required
                >
                  {FIELD_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label} - {type.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Required Checkbox */}
              <div className="flex items-center pt-6">
                <input
                  type="checkbox"
                  id="is_required"
                  checked={formData.is_required === 1}
                  onChange={(e) => setFormData({ ...formData, is_required: e.target.checked ? 1 : 0 })}
                  className="h-4 w-4 text-gray-600 focus:ring-gray-900 border-gray-300 rounded"
                />
                <label htmlFor="is_required" className="ml-2 text-sm text-gray-700">
                  Required field
                </label>
              </div>

              {/* Options (for select/multiselect) */}
              {(formData.field_type === 'select' || formData.field_type === 'multiselect') && (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Options (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.options}
                    onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="Option1,Option2,Option3"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Enter options separated by commas
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelForm}
                disabled={submitting}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Saving...
                  </>
                ) : (
                  'Save Field'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fields List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-3"></div>
          <p className="text-gray-500">Loading custom fields...</p>
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-2">No custom fields yet</p>
          <p className="text-sm text-gray-400">
            Add custom fields to collect additional information from your leads
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map(field => (
            <div
              key={field.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium text-gray-900">{field.label}</span>
                    <span className="text-sm text-gray-400 ml-2">({field.slug})</span>
                  </div>
                  <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
                    {getFieldTypeLabel(field.field_type)}
                  </span>
                  {field.is_required === 1 && (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700">
                      Required
                    </span>
                  )}
                  {field.is_active === 0 && (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-500">
                      Inactive
                    </span>
                  )}
                </div>
                {(() => {
                  const opts = getCustomFieldOptions(field.options);
                  return opts.length > 0 ? (
                    <p className="text-sm text-gray-500 mt-1">
                      Options: {opts.join(', ')}
                    </p>
                  ) : null;
                })()}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleEdit(field)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit field"
                >
                  <PencilIcon className="h-4 w-4 text-gray-600" />
                </button>
                <button
                  onClick={() => handleToggleActive(field)}
                  className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${
                    field.is_active === 0 ? 'opacity-50' : ''
                  }`}
                  title={field.is_active === 1 ? 'Deactivate' : 'Activate'}
                >
                  {field.is_active === 1 ? (
                    <EyeIcon className="h-4 w-4 text-gray-600" />
                  ) : (
                    <EyeSlashIcon className="h-4 w-4 text-gray-400" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(field.id)}
                  disabled={deleteLoading === field.id}
                  className="p-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Delete field"
                >
                  {deleteLoading === field.id ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent"></div>
                  ) : (
                    <TrashIcon className="h-4 w-4 text-red-600" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Icon components
function EyeIcon({ className }: { className: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12C3.5 7.75 7.25 5 12 5s8.5 2.75 9.75 7c-1.25 4.25-5 7-9.75 7s-8.5-2.75-9.75-7zm9.75 3.25A3.25 3.25 0 1 0 8.75 12a3.25 3.25 0 0 0 3.25 3.25z"
      />
    </svg>
  );
}

function EyeSlashIcon({ className }: { className: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M4.5 4.5C2.97 5.79 1.8 7.6 1.25 9.75 2.5 14 6.25 16.75 11 16.75c1.4 0 2.72-.25 3.92-.73M9.53 9.53A3.25 3.25 0 0 1 14.47 14.47M6.53 6.53A8.96 8.96 0 0 1 11 5c4.75 0 8.5 2.75 9.75 7-.43 1.47-1.16 2.77-2.12 3.84"
      />
    </svg>
  );
}
