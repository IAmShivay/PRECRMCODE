import React from 'react';
import { PaperClipIcon, ArrowDownTrayIcon, XMarkIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { deleteDealDocument, listDealDocuments, uploadDealDocument, dealDocumentDownloadUrl } from '../lib/api-client';
import { getAuthToken } from '../lib/storage';
import type { DealDocument } from '../components/types';

const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

export default function DealDocuments({
  dealId,
  initialDocuments,
  canEdit,
  canDownload,
  requiredDocuments,
  onChanged,
}: {
  dealId: number;
  initialDocuments: DealDocument[];
  canEdit: boolean;
  canDownload: boolean;
  requiredDocuments: string[];
  onChanged: (documents: DealDocument[]) => void;
}) {
  const [documents, setDocuments] = React.useState<DealDocument[]>(initialDocuments);
  const [kind, setKind] = React.useState('MOU');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setDocuments(initialDocuments);
  }, [dealId, initialDocuments]);

  const refresh = async () => {
    try {
      const next = await listDealDocuments(dealId);
      setDocuments(next);
      onChanged(next);
    } catch {
      // Keep the current list when a background refresh fails.
    }
  };

  const missingKinds = requiredDocuments.filter(
    (required) => !documents.some((doc) => String(doc.kind || '').toLowerCase() === required.toLowerCase())
  );

  const upload = async (file: File) => {
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setError('File must be between 1 byte and 10 MB.');
      return;
    }
    const label = kind.trim() || 'Document';
    setBusy(true);
    setError('');
    try {
      const data = await readAsBase64(file);
      const created = await uploadDealDocument(dealId, {
        name: file.name,
        kind: label,
        mime: mimeOf(file),
        size: file.size,
        data,
      });
      const next = [...documents, created];
      setDocuments(next);
      onChanged(next);
      if (fileRef.current) fileRef.current.value = '';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to upload document');
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: DealDocument) => {
    const token = getAuthToken();
    if (!token) {
      setError('Authentication required');
      return;
    }
    try {
      const response = await fetch(dealDocumentDownloadUrl(dealId, doc.id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = doc.name || 'document';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('Download failed');
    }
  };

  const remove = async (docId: string) => {
    setBusy(true);
    setError('');
    try {
      await deleteDealDocument(dealId, docId);
      const next = documents.filter((doc) => doc.id !== docId);
      setDocuments(next);
      onChanged(next);
      setConfirmDeleteId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Documents {documents.length > 0 && <span className="text-gray-400">({documents.length})</span>}
        </label>
      </div>
      {missingKinds.length > 0 && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Required before conversion: {missingKinds.join(', ')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">No documents yet. Attach the MOU, quotation, or NDA for this deal.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
              <PaperClipIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{doc.name}</p>
                <p className="text-xs text-gray-500">
                  <span className="font-semibold uppercase">{doc.kind}</span>
                  {' · '}{formatSize(doc.size)}
                </p>
              </div>
              {canDownload && (
                <button type="button" onClick={() => void download(doc)} title={`Download ${doc.name}`} aria-label={`Download ${doc.name}`}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
                  <ArrowDownTrayIcon className="h-4 w-4" />
                </button>
              )}
              {canEdit && confirmDeleteId === doc.id ? (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={busy} onClick={() => void remove(doc.id)}
                    className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Delete</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmDeleteId(null)} aria-label="Cancel delete"
                    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-4 w-4" /></button>
                </span>
              ) : canEdit && (
                <button type="button" onClick={() => setConfirmDeleteId(doc.id)} title={`Delete ${doc.name}`} aria-label={`Delete ${doc.name}`}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">Kind
            <input value={kind} maxLength={60} disabled={busy} onChange={(event) => setKind(event.target.value)} placeholder="MOU"
              aria-label="Document kind"
              className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-900 focus:border-gray-900 focus:outline-none" />
            <span className="text-[11px] text-gray-400">10 MB max · pdf, jpg, png, webp, doc</span>
          </label>
          <div
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (busy) return;
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            onClick={() => { if (!busy) fileRef.current?.click(); }}
            className={[
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-4 text-center transition',
              busy ? 'opacity-50 cursor-not-allowed' : '',
              dragActive ? 'border-gray-900 bg-gray-900/[0.04]' : 'border-gray-300 bg-gray-50 hover:bg-white hover:border-gray-400',
            ].join(' ')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
            aria-label="Upload document drop zone"
          >
            <ArrowUpTrayIcon className="h-5 w-5 text-gray-400 mb-1.5" />
            <p className="text-xs font-semibold text-gray-700">Drag & drop file here</p>
            <p className="text-[11px] text-gray-500">or click to browse</p>
            {busy && <p className="mt-1.5 text-xs text-gray-500">Uploading…</p>}
          </div>
          <input ref={fileRef} type="file" aria-label="Choose document file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" disabled={busy} hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }} />
        </div>
      )}
    </div>
  );
}
