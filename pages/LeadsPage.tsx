import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import LeadsTable from '../components/LeadsTable';
import CreateLeadForm from '../components/CreateLeadForm';
import type { LeadCustomField } from '../components/types';
import { getAuthToken } from '../lib/storage';
import { TrashIcon } from '@heroicons/react/24/outline';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type CsvData = {
  headers: string[];
  rows: string[][];
};

type BulkImportResultRow = {
  row_index: number;
  action: 'created' | 'updated' | 'failed';
  lead_id?: number;
  error?: string;
  warnings?: string[];
};

type ImportProgress = { done: number; total: number };
type ImportSummary = { created: number; updated: number; failed: number };
type ImportFailure = { rowNumber: number; error: string };
type ImportWarning = { rowNumber: number; warning: string };
type ImportState = {
  progress: ImportProgress;
  summary: ImportSummary;
  failures: ImportFailure[];
  warnings: ImportWarning[];
};

const createInitialImportState = (): ImportState => ({
  progress: { done: 0, total: 0 },
  summary: { created: 0, updated: 0, failed: 0 },
  failures: [],
  warnings: [],
});

export default function LeadsPage() {
  const { currentWorkspace } = useAuth();
  const { addToast } = useToast();
  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const tableRef = useRef<{ refresh: () => void }>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const importModalRef = useRef<HTMLDivElement>(null);

  const [importStep, setImportStep] = React.useState<'upload' | 'map' | 'review' | 'importing' | 'done'>('upload');
  const [csvData, setCsvData] = React.useState<CsvData | null>(null);
  const [csvFileName, setCsvFileName] = React.useState<string>('');
  const [customFields, setCustomFields] = React.useState<LeadCustomField[]>([]);
  const [columnMapping, setColumnMapping] = React.useState<Record<string, number | null>>({});
  const [importMode, setImportMode] = React.useState<'create' | 'upsert_email'>('create');
  const [verifyEmails, setVerifyEmails] = React.useState(false);
  const [importState, setImportState] = React.useState<ImportState>(() => createInitialImportState());

  useEffect(() => {
    if (!showCreateForm) return;

    const modal = modalRef.current;
    if (!modal) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusableElements = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      );

    const focusFirst = () => {
      const focusable = getFocusableElements();
      const target = focusable[0] || modal;
      target.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowCreateForm(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !modal.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!modal.contains(event.target as Node)) {
        focusFirst();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    requestAnimationFrame(() => {
      focusFirst();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      } else {
        openButtonRef.current?.focus();
      }
    };
  }, [showCreateForm]);

  const closeImportModal = React.useCallback(() => {
    setShowImportModal(false);
    setImportStep('upload');
    setCsvData(null);
    setCsvFileName('');
    setColumnMapping({});
    setImportMode('create');
    setVerifyEmails(false);
    setImportState(createInitialImportState());
  }, []);

  useEffect(() => {
    if (!showImportModal) return;

    const modal = importModalRef.current;
    if (!modal) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusableElements = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      );

    const focusFirst = () => {
      const focusable = getFocusableElements();
      const target = focusable[0] || modal;
      target.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeImportModal();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !modal.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!modal.contains(event.target as Node)) {
        focusFirst();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    requestAnimationFrame(() => {
      focusFirst();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      } else {
        importButtonRef.current?.focus();
      }
    };
  }, [showImportModal, closeImportModal]);

  useEffect(() => {
    if (!showImportModal || !currentWorkspace) return;

    let isActive = true;
    const fetchCustomFields = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/api/workspaces/${currentWorkspace.id}/custom-fields`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = await res.json();
        if (!isActive) return;
        if (res.ok && payload.status === 'success' && Array.isArray(payload.data)) {
          setCustomFields(payload.data.filter((f: LeadCustomField) => f.is_active === 1));
        } else {
          setCustomFields([]);
        }
      } catch (error) {
        if (isActive) setCustomFields([]);
      }
    };

    fetchCustomFields();
    return () => {
      isActive = false;
    };
  }, [showImportModal, currentWorkspace]);

  const normalizeHeader = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');

  const parseCsv = (text: string): CsvData => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let inQuotes = false;
    let field = '';
    let row: string[] = [];
    const rows: string[][] = [];

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      if (inQuotes) {
        if (char === '"') {
          if (normalized[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          row.push(field);
          field = '';
        } else if (char === '\n') {
          row.push(field);
          field = '';
          rows.push(row);
          row = [];
        } else {
          field += char;
        }
      }
    }

    if (inQuotes) {
      throw new Error('CSV contains an unterminated quoted field');
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    const trimmedRows = rows
      .map((r) => r.map((cell) => String(cell ?? '')))
      .filter((r) => r.some((cell) => cell.trim().length > 0));

    if (trimmedRows.length === 0) {
      throw new Error('CSV is empty');
    }

    const headers = trimmedRows[0].map((h) => h.trim());
    const dataRows = trimmedRows.slice(1);

    for (const r of dataRows) {
      if (r.length > headers.length) {
        throw new Error('CSV row has more columns than the header row');
      }
    }

    const padded = dataRows.map((r) => {
      const out = r.slice();
      while (out.length < headers.length) out.push('');
      return out;
    });

    return { headers, rows: padded };
  };

  const pickColumn = (headers: string[], candidates: string[]): number | null => {
    const normalizedHeaders = headers.map(normalizeHeader);
    for (const candidate of candidates) {
      const idx = normalizedHeaders.indexOf(normalizeHeader(candidate));
      if (idx >= 0) return idx;
    }
    return null;
  };

  const buildDefaultMapping = (data: CsvData, fields: LeadCustomField[]): Record<string, number | null> => {
    const mapping: Record<string, number | null> = {
      name: pickColumn(data.headers, ['name', 'full name', 'fullname']),
      email: pickColumn(data.headers, ['email', 'email address', 'e-mail']),
      phone: pickColumn(data.headers, ['phone', 'phone number', 'mobile', 'mobile number']),
      source_old: pickColumn(data.headers, ['source_old', 'source', 'lead source']),
      source_ref: pickColumn(data.headers, ['source_ref', 'source ref', 'source reference', 'external id', 'id']),
      status: pickColumn(data.headers, ['status', 'stage', 'pipeline stage']),
    };

    for (const field of fields) {
      const direct = pickColumn(data.headers, [field.slug, field.label]);
      mapping[`cf:${field.id}`] = direct;
    }

    return mapping;
  };

  const buildImportRows = (): Array<Record<string, any>> => {
    if (!csvData || !currentWorkspace) return [];
    const { rows } = csvData;

    const getValue = (row: string[], index: number | null): string | null => {
      if (index === null || index < 0) return null;
      const raw = row[index] ?? '';
      const str = String(raw).trim();
      return str.length > 0 ? str : null;
    };

    const output: Array<Record<string, any>> = [];

    for (const r of rows) {
      const record: Record<string, any> = {};

      const name = getValue(r, columnMapping.name ?? null);
      const email = getValue(r, columnMapping.email ?? null);
      const phone = getValue(r, columnMapping.phone ?? null);
      const sourceOld = getValue(r, columnMapping.source_old ?? null);
      const sourceRef = getValue(r, columnMapping.source_ref ?? null);
      const status = getValue(r, columnMapping.status ?? null);

      if (name) record.name = name;
      if (email) record.email = email;
      if (phone) record.phone = phone;
      if (sourceOld) record.source_old = sourceOld;
      if (sourceRef) record.source_ref = sourceRef;
      if (status) record.status = status;

      for (const field of customFields) {
        const idx = columnMapping[`cf:${field.id}`] ?? null;
        const value = getValue(r, idx);
        if (value) {
          record[field.slug] = value;
        }
      }

      output.push(record);
    }

    return output;
  };

  const downloadTemplate = () => {
    const header = ['name', 'email', 'phone', 'source_old', 'source_ref', 'status'];
    const csv = `${header.join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileSelected = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setCsvData(parsed);
      setCsvFileName(file.name);
      const mapping = buildDefaultMapping(parsed, customFields);
      setColumnMapping(mapping);
      setImportStep('map');
    } catch (error) {
      addToast('error', (error as Error).message || 'Failed to parse CSV');
    }
  };

  const startImport = async () => {
    if (!currentWorkspace || !csvData) return;

    const rows = buildImportRows();
    const total = rows.length;
    if (total === 0) {
      addToast('error', 'No rows found to import');
      return;
    }

    setImportStep('importing');
    setImportState({
      progress: { done: 0, total },
      summary: { created: 0, updated: 0, failed: 0 },
      failures: [],
      warnings: [],
    });

    const token = getAuthToken();
    const batchSize = 100;
    const allFailures: ImportFailure[] = [];
    const allWarnings: ImportWarning[] = [];
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          workspace_id: currentWorkspace.id,
          rows: batch,
          mode: importMode,
          verify_emails: verifyEmails,
          concurrency: 2,
        }),
      });

      const payload = await res.json();
      if (!res.ok || payload.status !== 'success' || !payload.data) {
        throw new Error(payload.message || payload.error || 'Bulk import request failed');
      }

      created += Number(payload.data.created || 0);
      updated += Number(payload.data.updated || 0);
      failed += Number(payload.data.failed || 0);

      const resultRows: BulkImportResultRow[] = Array.isArray(payload.data.results) ? payload.data.results : [];
      for (const r of resultRows) {
        const absoluteRowNumber = start + r.row_index + 2;
        if (r.action === 'failed' && r.error) {
          allFailures.push({ rowNumber: absoluteRowNumber, error: r.error });
        }
        if (Array.isArray(r.warnings)) {
          for (const w of r.warnings) {
            allWarnings.push({ rowNumber: absoluteRowNumber, warning: w });
          }
        }
      }

      setImportState({
        progress: { done: Math.min(total, start + batch.length), total },
        summary: { created, updated, failed },
        failures: allFailures.slice(0, 200),
        warnings: allWarnings.slice(0, 200),
      });
    }

    tableRef.current?.refresh();
    window.dispatchEvent(new CustomEvent('leadsChanged'));
    setImportStep('done');

    if (failed === 0) {
      addToast('success', `Imported ${created + updated} leads`);
    } else {
      addToast('warning', `Import finished with ${failed} failed rows`);
    }
  };

  const handleCreateSuccess = () => {
    setShowCreateForm(false);
    // Refresh the leads table
    tableRef.current?.refresh();
  };

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-500">Please select a workspace to view leads.</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-white">
      <div className="w-full -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 sm:py-2.5 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-gray-900 leading-tight">Leads</h1>
            <span className="hidden sm:inline text-xs text-gray-400 font-normal">{currentWorkspace.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/trash"
              className="px-2.5 py-1 border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5"
            >
              <TrashIcon className="w-3.5 h-3.5" />
              Trash
            </Link>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-2.5 py-1 border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors text-xs font-medium"
              ref={importButtonRef}
            >
              Bulk Import
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-2.5 py-1 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors text-xs font-medium"
              ref={openButtonRef}
            >
              + Add Lead
            </button>
          </div>
        </div>
      </div>
      <div className="w-full py-4">

        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div
              ref={importModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-import-title"
              tabIndex={-1}
              className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 id="bulk-import-title" className="text-xl font-semibold text-gray-900">
                      Bulk Import Leads
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Upload a CSV, map columns, preview, then import into {currentWorkspace.name}.
                    </p>
                  </div>
                  <button
                    onClick={closeImportModal}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>

                {importStep === 'upload' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={downloadTemplate}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Download CSV template
                      </button>
                    </div>

                    <div className="border border-gray-200 rounded-lg p-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">CSV file</label>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleCsvFileSelected(file);
                        }}
                        className="block w-full text-sm text-gray-700"
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        The first row must be headers. Supported delimiter: comma.
                      </p>
                    </div>
                  </div>
                )}

                {importStep === 'map' && csvData && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-600">
                        File: <span className="font-medium text-gray-900">{csvFileName}</span> · Rows: <span className="font-medium text-gray-900">{csvData.rows.length}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setImportStep('upload');
                            setCsvData(null);
                            setCsvFileName('');
                            setColumnMapping({});
                          }}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          Back
                        </button>
                        <button
                          onClick={() => setImportStep('review')}
                          className="px-3 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
                          disabled={!csvData}
                        >
                          Next
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        { key: 'name', label: 'Name' },
                        { key: 'email', label: 'Email' },
                        { key: 'phone', label: 'Phone' },
                        { key: 'source_old', label: 'Source' },
                        { key: 'source_ref', label: 'Source Ref' },
                        { key: 'status', label: 'Status' },
                      ].map((field) => (
                        <div key={field.key}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                          <select
                            value={columnMapping[field.key] ?? ''}
                            onChange={(e) => {
                              const value = e.target.value === '' ? null : Number(e.target.value);
                              setColumnMapping((prev) => ({ ...prev, [field.key]: value }));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                          >
                            <option value="">Not mapped</option>
                            {csvData.headers.map((h, idx) => (
                              <option key={`${field.key}-${idx}`} value={idx}>
                                {h || `(Column ${idx + 1})`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    {customFields.length > 0 && (
                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="text-sm font-medium text-gray-900 mb-3">Custom fields</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {customFields.map((field) => (
                            <div key={field.id}>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                {field.label}
                              </label>
                              <select
                                value={columnMapping[`cf:${field.id}`] ?? ''}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? null : Number(e.target.value);
                                  setColumnMapping((prev) => ({ ...prev, [`cf:${field.id}`]: value }));
                                }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                              >
                                <option value="">Not mapped</option>
                                {csvData.headers.map((h, idx) => (
                                  <option key={`cf-${field.id}-${idx}`} value={idx}>
                                    {h || `(Column ${idx + 1})`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-gray-500">
                      Unmapped fields are ignored. Imported custom fields use their configured slug.
                    </div>
                  </div>
                )}

                {importStep === 'review' && csvData && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-600">
                        File: <span className="font-medium text-gray-900">{csvFileName}</span> · Rows: <span className="font-medium text-gray-900">{csvData.rows.length}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setImportStep('map')}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          Back
                        </button>
                        <button
                          onClick={() => void startImport()}
                          className="px-3 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
                        >
                          Import
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border border-gray-200 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
                        <select
                          value={importMode}
                          onChange={(e) => setImportMode(e.target.value === 'upsert_email' ? 'upsert_email' : 'create')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="create">Create new leads</option>
                          <option value="upsert_email">Upsert by email (update existing)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-2">
                          Upsert requires an email column; rows without email are created.
                        </p>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email verification</label>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={verifyEmails}
                            onChange={(e) => setVerifyEmails(e.target.checked)}
                          />
                          Verify emails during import
                        </label>
                        <p className="text-xs text-gray-500 mt-2">
                          This may consume verification credits and slows down imports.
                        </p>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
                        <div className="text-sm text-gray-700">
                          First 5 rows shown below.
                        </div>
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-lg overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            {['name', 'email', 'phone', 'source_old', 'source_ref', 'status'].map((h) => (
                              <th key={h} className="text-left font-medium text-gray-700 px-3 py-2">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {buildImportRows()
                            .slice(0, 5)
                            .map((r, idx) => {
                              const rowNumber = idx + 2;
                              const rowKeyBase = [
                                r.source_ref,
                                r.email,
                                r.phone,
                                r.name,
                              ]
                                .map((value) => String(value ?? '').trim())
                                .filter(Boolean)
                                .join('|');
                              const rowKey = rowKeyBase ? `${rowKeyBase}-${rowNumber}` : `preview-row-${rowNumber}`;

                              return (
                                <tr key={rowKey} className="border-t border-gray-200">
                                  {['name', 'email', 'phone', 'source_old', 'source_ref', 'status'].map((k) => (
                                    <td key={k} className="px-3 py-2 text-gray-900">
                                      {String(r[k] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {importStep === 'importing' && (
                  <div className="space-y-4">
                    <div className="text-sm text-gray-700">
                      Imported {importState.progress.done} of {importState.progress.total}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gray-900 h-2 rounded-full"
                        style={{
                          width:
                            importState.progress.total > 0
                              ? `${Math.round((importState.progress.done / importState.progress.total) * 100)}%`
                              : '0%',
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Created</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.created}</div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Updated</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.updated}</div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Failed</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.failed}</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      Keep this window open until the import completes.
                    </div>
                  </div>
                )}

                {importStep === 'done' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Created</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.created}</div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Updated</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.updated}</div>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <div className="text-xs text-gray-500">Failed</div>
                        <div className="text-lg font-semibold text-gray-900">{importState.summary.failed}</div>
                      </div>
                    </div>

                    {importState.failures.length > 0 && (
                      <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                        <div className="text-sm font-medium text-red-900 mb-2">Failed rows (first {importState.failures.length})</div>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-red-900">
                                <th className="px-2 py-1">Row</th>
                                <th className="px-2 py-1">Error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importState.failures.map((f) => (
                                <tr key={`failure-${f.rowNumber}-${f.error}`} className="border-t border-red-200">
                                  <td className="px-2 py-1 text-red-900">{f.rowNumber}</td>
                                  <td className="px-2 py-1 text-red-900">{f.error}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {importState.warnings.length > 0 && (
                      <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
                        <div className="text-sm font-medium text-yellow-900 mb-2">Warnings (first {importState.warnings.length})</div>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-yellow-900">
                                <th className="px-2 py-1">Row</th>
                                <th className="px-2 py-1">Warning</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importState.warnings.map((w) => (
                                <tr key={`warning-${w.rowNumber}-${w.warning}`} className="border-t border-yellow-200">
                                  <td className="px-2 py-1 text-yellow-900">{w.rowNumber}</td>
                                  <td className="px-2 py-1 text-yellow-900">{w.warning}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={closeImportModal}
                        className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-lead-title"
              tabIndex={-1}
              className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <CreateLeadForm
                workspaceId={currentWorkspace.id}
                onSuccess={handleCreateSuccess}
                onCancel={() => setShowCreateForm(false)}
              />
            </div>
          </div>
        )}

        <div className="bg-white">
          <LeadsTable
            ref={tableRef}
            workspaceId={currentWorkspace.id}
          />
        </div>
      </div>
    </div>
  );
}
