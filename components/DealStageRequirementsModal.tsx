import React from 'react';
import {
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon,
  PaperClipIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import type { Deal, DealCustomField, DealFieldValues, DealDocument } from './types';
import { dealFieldErrors } from '../lib/dealFields';
import { saveDeal, uploadDealDocument } from '../lib/api-client';
import { useToast } from '../contexts/ToastContext';

const MAX_BYTES = 10 * 1024 * 1024;

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : '';
}

function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = extensionOf(file.name);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export interface StageRequirementTarget {
  slug: string;
  name?: string;
  label?: string;
  color?: string;
  counts_as_conversion?: boolean;
}

interface DealStageRequirementsModalProps {
  open: boolean;
  deal: Deal | null;
  targetStage: StageRequirementTarget | null;
  sourceStage?: StageRequirementTarget | null;
  fields: DealCustomField[];
  requiredDocuments: string[];
  onClose: () => void;
  onSuccess: (updatedDeal: Deal) => void;
}

export default function DealStageRequirementsModal({
  open,
  deal,
  targetStage,
  sourceStage,
  fields,
  requiredDocuments,
  onClose,
  onSuccess,
}: DealStageRequirementsModalProps) {
  const { addToast } = useToast();
  const [fieldValues, setFieldValues] = React.useState<DealFieldValues>({});
  const [attachedDocs, setAttachedDocs] = React.useState<DealDocument[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [selectedDocKind, setSelectedDocKind] = React.useState('');
  const [uploadError, setUploadError] = React.useState('');
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const compulsoryFields = React.useMemo(() => {
    if (!targetStage) return [];
    return fields.filter(
      (f) => !f.archived && f.required_in_stages.includes(targetStage.slug)
    );
  }, [fields, targetStage]);

  const conversionRequiredDocs = React.useMemo(() => {
    if (!targetStage?.counts_as_conversion) return [];
    return requiredDocuments;
  }, [targetStage, requiredDocuments]);

  const attachedDocKinds = React.useMemo(() => {
    return new Set(
      attachedDocs.map((doc) => String(doc.kind || '').trim().toLowerCase())
    );
  }, [attachedDocs]);

  const missingDocKinds = React.useMemo(() => {
    return conversionRequiredDocs.filter(
      (kind) => !attachedDocKinds.has(kind.toLowerCase())
    );
  }, [conversionRequiredDocs, attachedDocKinds]);

  React.useEffect(() => {
    if (!open || !deal) {
      setFieldValues({});
      setAttachedDocs([]);
      setSubmitting(false);
      setUploading(false);
      setUploadError('');
      setSelectedDocKind('');
      return;
    }
    const initialValues: DealFieldValues = { ...(deal.custom_fields ?? {}) };
    for (const field of fields) {
      if (initialValues[field.id]) continue;
      const lower = field.label.trim().toLowerCase();
      if ((lower === 'deal value' || lower === 'value' || lower === 'amount') && deal.value !== undefined && deal.value !== null) {
        initialValues[field.id] = String(deal.value);
      } else if ((lower === 'expected close date' || lower === 'close date') && deal.expected_close_date) {
        initialValues[field.id] = String(deal.expected_close_date).split(' ')[0].split('T')[0];
      } else if (lower === 'contact' && deal.contact) {
        initialValues[field.id] = String(deal.contact);
      } else if (lower === 'priority' && deal.priority) {
        initialValues[field.id] = String(deal.priority);
      }
    }
    setFieldValues(initialValues);
    setAttachedDocs(deal.documents ?? []);
    setSubmitting(false);
    setUploading(false);
    setUploadError('');
  }, [open, deal]);

  React.useEffect(() => {
    if (missingDocKinds.length > 0 && !missingDocKinds.includes(selectedDocKind.toLowerCase())) {
      setSelectedDocKind(missingDocKinds[0] || '');
    }
  }, [missingDocKinds, selectedDocKind]);

  if (!open || !deal || !targetStage) return null;

  const currentErrors = dealFieldErrors(fields, fieldValues, targetStage.slug);
  const canSubmit =
    !submitting &&
    !uploading &&
    Object.keys(currentErrors).length === 0 &&
    missingDocKinds.length === 0;

  const handleFieldValueChange = (id: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
  };

  const handleFileUpload = async (file: File) => {
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setUploadError('File must be between 1 byte and 10 MB.');
      return;
    }
    const docKind = (selectedDocKind || missingDocKinds[0] || 'Document').trim();
    setUploading(true);
    setUploadError('');
    try {
      const base64Data = await readAsBase64(file);
      const uploaded = await uploadDealDocument(deal.id, {
        name: file.name,
        kind: docKind,
        mime: mimeOf(file),
        size: file.size,
        data: base64Data,
      });
      setAttachedDocs((prev) => [...prev, uploaded]);
      addToast('success', `${docKind} uploaded successfully`);
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to upload document'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileUpload(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileUpload(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const mergedFields: DealFieldValues = {
        ...(deal.custom_fields ?? {}),
        ...fieldValues,
      };
      const patchPayload: Record<string, any> = {
        stage: targetStage.slug,
        custom_fields: mergedFields,
      };
      for (const field of fields) {
        const val = fieldValues[field.id];
        if (!val) continue;
        const lower = field.label.trim().toLowerCase();
        if (lower === 'deal value' || lower === 'value' || lower === 'amount') {
          const num = Number(val);
          if (Number.isFinite(num)) patchPayload.value = num;
        } else if (lower === 'expected close date' || lower === 'close date') {
          patchPayload.expected_close_date = val;
        } else if (lower === 'contact') {
          patchPayload.contact = val;
        } else if (lower === 'priority') {
          patchPayload.priority = val;
        }
      }
      const updated = await saveDeal(patchPayload, deal.id);
      const finalizedDeal: Deal = {
        ...deal,
        ...updated,
        documents: attachedDocs,
      };
      const targetName = targetStage.name || targetStage.label || targetStage.slug;
      addToast('success', `Deal moved to ${targetName}`);
      onSuccess(finalizedDeal);
      onClose();
    } catch (err: unknown) {
      addToast(
        'error',
        err instanceof Error ? err.message : 'Failed to move deal'
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stage-requirements-title"
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white font-semibold text-xs"
              style={{ backgroundColor: targetStage.color }}
            >
              <ArrowRightIcon className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="stage-requirements-title"
                className="text-base font-semibold text-gray-900"
              >
                Move Deal to {targetStage.name || targetStage.label || targetStage.slug}
              </h2>
              <p className="text-xs text-gray-500">
                Complete compulsory requirements to advance this deal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || uploading}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gray-50 border-b border-gray-100 px-6 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700">{deal.name}</span>
            <span className="text-gray-400">#{deal.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-gray-600 bg-gray-200">
              {sourceStage?.name || sourceStage?.label || deal.stage}
            </span>
            <ArrowRightIcon className="w-3.5 h-3.5 text-gray-400" />
            <span
              className="px-2 py-0.5 rounded font-medium text-white"
              style={{ backgroundColor: targetStage.color }}
            >
              {targetStage.name || targetStage.label || targetStage.slug}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {compulsoryFields.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Compulsory Properties
                </span>
                <span className="text-xs text-amber-600 font-medium">
                  Required before moving forward
                </span>
              </div>

              <div className="space-y-3.5">
                {compulsoryFields.map((field) => {
                  const fieldId = `cr-${field.id}`;
                  const error = currentErrors[field.id];
                  const value = fieldValues[field.id] ?? '';

                  return (
                    <div key={field.id} className="space-y-1">
                      <label
                        htmlFor={fieldId}
                        className="block text-xs font-medium text-gray-700"
                      >
                        {field.label}
                        <span className="text-red-500 ml-0.5">*</span>
                      </label>

                      {field.type === 'textarea' ? (
                        <textarea
                          id={fieldId}
                          value={value}
                          rows={3}
                          maxLength={4000}
                          disabled={submitting}
                          onChange={(e) =>
                            handleFieldValueChange(field.id, e.target.value)
                          }
                          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none transition ${
                            error
                              ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                              : 'border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                          }`}
                        />
                      ) : field.type === 'select' ? (
                        <select
                          id={fieldId}
                          value={value}
                          disabled={submitting}
                          onChange={(e) =>
                            handleFieldValueChange(field.id, e.target.value)
                          }
                          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none transition ${
                            error
                              ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                              : 'border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                          }`}
                        >
                          <option value="">Select an option</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={fieldId}
                          type={field.type === 'phone' ? 'tel' : field.type}
                          step={field.type === 'number' ? 'any' : undefined}
                          maxLength={4000}
                          value={value}
                          disabled={submitting}
                          onChange={(e) =>
                            handleFieldValueChange(field.id, e.target.value)
                          }
                          className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none transition ${
                            error
                              ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                              : 'border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                          }`}
                        />
                      )}

                      {error && (
                        <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{error}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {conversionRequiredDocs.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Required Paperwork & Documents
                </span>
                <span className="text-xs text-gray-500">
                  {missingDocKinds.length === 0 ? (
                    <span className="text-green-600 font-medium flex items-center gap-1">
                      <CheckCircleIcon className="w-3.5 h-3.5" /> All paperwork attached
                    </span>
                  ) : (
                    <span className="text-amber-600 font-medium">
                      {missingDocKinds.length} missing
                    </span>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {conversionRequiredDocs.map((kind) => {
                  const isAttached = attachedDocKinds.has(kind.toLowerCase());
                  return (
                    <div
                      key={kind}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
                        isAttached
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium uppercase">
                        <PaperClipIcon className="w-3.5 h-3.5" />
                        <span>{kind}</span>
                      </div>
                      {isAttached ? (
                        <CheckCircleIcon className="w-4 h-4 text-green-600" />
                      ) : (
                        <span className="text-[10px] font-semibold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">
                          Required
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {missingDocKinds.length > 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-4 bg-gray-50 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-gray-700">
                      Upload Document
                    </label>
                    <select
                      value={selectedDocKind}
                      onChange={(e) => setSelectedDocKind(e.target.value)}
                      disabled={uploading}
                      className="text-xs rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 uppercase"
                    >
                      {conversionRequiredDocs.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition flex flex-col items-center justify-center ${
                      dragActive
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400 bg-white'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleFileInputChange}
                      disabled={uploading}
                    />
                    <ArrowUpTrayIcon className="w-6 h-6 text-gray-400 mb-1" />
                    <p className="text-xs font-medium text-gray-700">
                      {uploading ? 'Uploading…' : 'Click to upload or drag & drop'}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      PDF, JPG, PNG, DOC up to 10 MB
                    </p>
                  </div>

                  {uploadError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{uploadError}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || uploading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Moving…</span>
                </>
              ) : (
                <span>Save & Move to {targetStage.name || targetStage.label || targetStage.slug}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
