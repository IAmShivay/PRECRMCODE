import React from 'react';
import type { DealCustomField, DealFieldValues } from './types';
import { dealFieldErrors } from '../lib/dealFields';

export default function DealCustomFieldsForm({ fields, values, stage, stageName, onChange, disabled = false }: {
  fields: DealCustomField[];
  values: DealFieldValues;
  stage: string;
  stageName?: string;
  onChange: (values: DealFieldValues) => void;
  disabled?: boolean;
}) {
  const prefix = React.useId();
  const active = fields.filter((field) => !field.archived);
  const archived = fields.filter((field) => field.archived && values[field.id]);
  const errors = dealFieldErrors(fields, values, stage);
  if (!active.length && !archived.length) return null;
  return <section className="col-span-full border-t border-gray-100 pt-4 space-y-3">
    <h3 className="text-sm font-semibold text-gray-900">Custom fields</h3>
    <p className="text-xs text-gray-500">Fields marked * are required in {stageName || 'the selected stage'}.</p>
    {active.map((field) => {
      const id = `${prefix}-${field.id}`;
      const required = field.required_in_stages.includes(stage);
      const props = {
        id, value: values[field.id] ?? '', disabled, required,
        'aria-invalid': Boolean(errors[field.id]), 'aria-describedby': errors[field.id] ? `${id}-error` : undefined,
        className: 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50',
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ ...values, [field.id]: event.target.value }),
      };
      return <div key={field.id}>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{field.label}{required && <span className="text-red-600"> *</span>}</label>
        {field.type === 'textarea' ? <textarea {...props} rows={3} maxLength={4000} />
          : field.type === 'select' ? <select {...props}><option value="">Select an option</option>
            {props.value && !field.options.includes(props.value) && <option value={props.value} disabled>{props.value} (unavailable)</option>}
            {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          : <input {...props} type={field.type === 'phone' ? 'tel' : field.type} step={field.type === 'number' ? 'any' : undefined} maxLength={4000} />}
        {errors[field.id] && <p id={`${id}-error`} className="mt-1 text-xs text-red-600">{errors[field.id]}</p>}
      </div>;
    })}
    {archived.length > 0 && <details className="text-xs text-gray-500"><summary className="cursor-pointer">Archived field values</summary>
      <dl className="mt-2 space-y-2">{archived.map((field) => <div key={field.id}><dt className="font-medium">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{values[field.id]}</dd></div>)}</dl>
    </details>}
  </section>;
}
