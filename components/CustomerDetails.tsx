import React from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Customer, CustomerCustomField, CustomerOrderItem, CustomerProfileUpdate } from './types';
import { updateCustomer } from '../lib/api-client';
import { formatWorkspaceCurrency } from '../lib/currency';

interface CustomerDetailsProps {
  canEdit?: boolean;
  customer: Customer;
  currency?: string;
  onSaved: (customer: Customer) => void;
  onClose: () => void;
}

interface Draft {
  email: string;
  phone: string;
  address: string;
  custom_fields: CustomerCustomField[];
  order_items: Record<string, CustomerOrderItem[]>;
}

function makeDraft(customer: Customer): Draft {
  return {
    email: customer.email || '',
    phone: customer.phone || '',
    address: customer.address || '',
    custom_fields: (customer.custom_fields || []).map((field) => ({ ...field })),
    order_items: Object.fromEntries(customer.orders.map((order) => [
      String(order.deal_id),
      (order.items || []).map((item) => ({ ...item })),
    ])),
  };
}

function formatDate(value: string): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export default function CustomerDetails({ customer, currency, onSaved, onClose, canEdit = false }: CustomerDetailsProps) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [draft, setDraft] = React.useState<Draft>(() => makeDraft(customer));

  React.useEffect(() => {
    setEditing(false);
    setError('');
    setDraft(makeDraft(customer));
  }, [customer.id]);

  const updateField = (index: number, patch: Partial<CustomerCustomField>) => {
    setDraft((current) => ({
      ...current,
      custom_fields: current.custom_fields.map((field, position) =>
        position === index ? { ...field, ...patch } : field
      ),
    }));
  };

  const updateItem = (dealId: number, index: number, patch: Partial<CustomerOrderItem>) => {
    const key = String(dealId);
    setDraft((current) => ({
      ...current,
      order_items: {
        ...current.order_items,
        [key]: (current.order_items[key] || []).map((item, position) =>
          position === index ? { ...item, ...patch } : item
        ),
      },
    }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const fieldNames = draft.custom_fields.map((field) => field.label.trim().toLowerCase());
    if (fieldNames.some((name) => !name) || new Set(fieldNames).size !== fieldNames.length) {
      setError('Custom fields need unique names.');
      return;
    }

    const update: CustomerProfileUpdate = {
      workspace_id: customer.workspace_id,
      ...(draft.email.trim() !== (customer.lead_email || '') ? { email: draft.email.trim() } : {}),
      ...(draft.phone.trim() !== (customer.lead_phone || '') ? { phone: draft.phone.trim() } : {}),
      address: draft.address.trim(),
      custom_fields: draft.custom_fields.map((field) => ({
        label: field.label.trim(),
        value: field.value.trim(),
      })),
      order_items: Object.fromEntries(customer.orders.map((order) => [
        String(order.deal_id),
        (draft.order_items[String(order.deal_id)] || []).map((item) => ({
          name: item.name.trim(),
          quantity: Number(item.quantity),
        })),
      ])),
    };

    setSaving(true);
    try {
      const response = await updateCustomer(customer.id, update);
      if (!response.data) throw new Error('Customer was not returned by the server');
      onSaved(response.data);
      setDraft(makeDraft(response.data));
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-label={`Details for ${customer.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{customer.name}</h2>
          <p className="mt-0.5 text-xs text-gray-500">Contact details and order history</p>
        </div>
        <div className="flex items-center gap-3">
          {!editing && (
            <button type="button" disabled={!canEdit} onClick={() => { setDraft(makeDraft(customer)); setError(''); setEditing(true); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              Edit customer
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving} className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50">Close</button>
        </div>
      </div>

      <form onSubmit={(event) => { void save(event); }} className="mt-5 space-y-6">
        {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contact details</h3>
            {editing ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium text-gray-600">Email
                  <input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email address" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400" />
                </label>
                <label className="block text-xs font-medium text-gray-600">Phone number
                  <input type="tel" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone number" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400" />
                </label>
                <label className="block text-xs font-medium text-gray-600">Address
                  <textarea rows={3} value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} placeholder="Street, city, state, postal code" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400" />
                </label>
                {customer.contact && <p className="text-xs text-gray-500">Deal contact: {customer.contact}</p>}
                {customer.lead_id && (
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, email: customer.lead_email || '', phone: customer.lead_phone || '' }))} className="text-xs font-medium text-gray-600 underline hover:text-gray-900">
                    Use lead email and phone
                  </button>
                )}
              </div>
            ) : (
              <dl className="mt-3 space-y-3 text-sm">
                <div><dt className="text-xs text-gray-500">Email</dt><dd className="mt-0.5 text-gray-800">{customer.email || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Phone</dt><dd className="mt-0.5 text-gray-800">{customer.phone || '—'}</dd></div>
                {customer.contact && <div><dt className="text-xs text-gray-500">Deal contact</dt><dd className="mt-0.5 text-gray-800">{customer.contact}</dd></div>}
                <div><dt className="text-xs text-gray-500">Address</dt><dd className="mt-0.5 whitespace-pre-line text-gray-800">{customer.address || '—'}</dd></div>
              </dl>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Custom fields</h3>
              {editing && <button type="button" onClick={() => setDraft((current) => ({ ...current, custom_fields: [...current.custom_fields, { label: '', value: '' }] }))} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black"><PlusIcon className="h-3.5 w-3.5" /> Add field</button>}
            </div>
            {editing ? (
              <div className="mt-3 space-y-2">
                {draft.custom_fields.length === 0 && <p className="text-sm text-gray-400">No custom fields added.</p>}
                {draft.custom_fields.map((field, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} placeholder="Field name" aria-label={`Custom field ${index + 1} name`} required maxLength={80} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
                    <input value={field.value} onChange={(event) => updateField(index, { value: event.target.value })} placeholder="Value" aria-label={`Custom field ${index + 1} value`} maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
                    <button type="button" onClick={() => setDraft((current) => ({ ...current, custom_fields: current.custom_fields.filter((_, position) => position !== index) }))} aria-label={`Remove custom field ${index + 1}`} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"><XMarkIcon className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            ) : (customer.custom_fields || []).length > 0 ? (
              <dl className="mt-3 space-y-3 text-sm">
                {customer.custom_fields.map((field) => <div key={field.label}><dt className="text-xs text-gray-500">{field.label}</dt><dd className="mt-0.5 whitespace-pre-line text-gray-800">{field.value || '—'}</dd></div>)}
              </dl>
            ) : <p className="mt-3 text-sm text-gray-400">No custom fields added.</p>}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Order history</h3>
          <div className="mt-3 divide-y divide-gray-100">
            {customer.orders.map((order) => {
              const items = editing ? draft.order_items[String(order.deal_id)] || [] : order.items || [];
              return (
                <div key={order.deal_id} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div><div className="font-medium text-gray-800">{order.deal_name}</div><div className="text-xs text-gray-500">{order.pipeline_slug} · {formatDate(order.won_at)}</div></div>
                    <div className="font-semibold text-gray-900">{formatWorkspaceCurrency(order.value, currency)}</div>
                  </div>
                  {editing ? (
                    <div className="mt-3 space-y-2">
                      {items.map((item, index) => (
                        <div key={index} className="flex flex-wrap items-center gap-2">
                          <input value={item.name} onChange={(event) => updateItem(order.deal_id, index, { name: event.target.value })} placeholder="Item ordered" aria-label={`Item ${index + 1} for ${order.deal_name}`} required maxLength={200} className="min-w-40 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
                          <input type="number" min={1} max={100000} value={item.quantity} onChange={(event) => updateItem(order.deal_id, index, { quantity: Number(event.target.value) })} aria-label={`Quantity for item ${index + 1} in ${order.deal_name}`} required className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400" />
                          <button type="button" onClick={() => setDraft((current) => ({ ...current, order_items: { ...current.order_items, [String(order.deal_id)]: (current.order_items[String(order.deal_id)] || []).filter((_, position) => position !== index) } }))} aria-label={`Remove item ${index + 1} from ${order.deal_name}`} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"><XMarkIcon className="h-4 w-4" /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setDraft((current) => ({ ...current, order_items: { ...current.order_items, [String(order.deal_id)]: [...(current.order_items[String(order.deal_id)] || []), { name: '', quantity: 1 }] } }))} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black"><PlusIcon className="h-3.5 w-3.5" /> Add item</button>
                    </div>
                  ) : items.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-gray-600">{items.map((item, index) => <li key={`${item.name}-${index}`}>{item.quantity} × {item.name}</li>)}</ul>
                  ) : <p className="mt-2 text-xs text-gray-400">No items recorded.</p>}
                </div>
              );
            })}
          </div>
        </div>

        {editing && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" onClick={() => { setDraft(makeDraft(customer)); setEditing(false); setError(''); }} disabled={saving} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50">{saving ? 'Saving…' : 'Save customer'}</button>
          </div>
        )}
      </form>
    </section>
  );
}
