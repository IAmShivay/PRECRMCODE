import crypto from 'crypto';
import path from 'path';
import type { DealDocument } from '../types/index.js';

export const DEAL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const DEAL_DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const DEAL_DOCUMENT_ALLOWED_FORMATS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'];

export const DEAL_DOCUMENT_STATUS = 'deal_document';

export function normalizeDocumentKind(kind: unknown): string {
  return String(kind || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
}

export function sanitizeDocumentName(name: unknown): string {
  const base = path.basename(String(name || '').trim()).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 150);
  return base || 'document';
}

export function extensionForDocument(mime: string, name: string): string {
  const mapped = DEAL_DOCUMENT_MIME_EXTENSIONS[mime];
  if (mapped) return mapped;
  const fromName = path.extname(name).replace(/^\./, '').toLowerCase().slice(0, 10);
  return /^[a-z0-9]+$/.test(fromName) ? fromName : 'bin';
}

export function documentPublicId(workspaceId: number, dealId: number, docId: string): string {
  return `scraft/deals/${workspaceId}/${dealId}/${docId}`;
}

export function dealDocumentRow(workspaceId: number, dealId: number, doc: DealDocument, now: string): {
  workspace_id: number;
  lead_id: number;
  source: string;
  event_id: string;
  payload: string;
  status: string;
  created_at: string;
} {
  return {
    workspace_id: workspaceId,
    lead_id: dealId,
    source: DEAL_DOCUMENT_STATUS,
    event_id: doc.id,
    payload: JSON.stringify(doc),
    status: DEAL_DOCUMENT_STATUS,
    created_at: now,
  };
}

function normalizeDocumentRecord(record: Record<string, unknown>): DealDocument | null {
  const doc: DealDocument = {
    id: String(record.id || ''),
    name: String(record.name || ''),
    kind: String(record.kind || ''),
    mime: String(record.mime || ''),
    size: Number(record.size || 0),
    storage_path: String(record.storage_path || ''),
    resource_type: typeof record.resource_type === 'string' ? record.resource_type : undefined,
    uploaded_by: record.uploaded_by === null || record.uploaded_by === undefined ? null : Number(record.uploaded_by),
    uploaded_at: typeof record.uploaded_at === 'string' ? record.uploaded_at : undefined,
  };
  return doc.id && doc.storage_path ? doc : null;
}

export function parseDealDocumentRow(log: { payload?: unknown }): DealDocument | null {
  const raw = (log as { payload?: unknown })?.payload;
  let item: unknown = raw;
  if (typeof raw === 'string') {
    try {
      item = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!item || typeof item !== 'object') return null;
  return normalizeDocumentRecord(item as Record<string, unknown>);
}

export function parseDealDocuments(payload: unknown): DealDocument[] {
  const raw = (payload as { documents?: unknown })?.documents;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(normalizeDocumentRecord)
    .filter((doc): doc is DealDocument => !!doc);
}

export function newDocumentId(): string {
  return `doc_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
