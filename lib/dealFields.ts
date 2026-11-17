import type { DealCustomField, DealFieldValues } from '../types/dealFields';

/** Shared by forms and the server so drag/drop and API writes use the same rules. */
export function dealFieldErrors(fields: DealCustomField[], values: DealFieldValues, stage: string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.archived) continue;
    const value = (values[field.id] ?? '').trim();
    if (!value) {
      if (field.required_in_stages.includes(stage)) errors[field.id] = `${field.label} is required for this stage`;
      continue;
    }
    if (value.length > 4000) errors[field.id] = `${field.label} must be 4,000 characters or fewer`;
    else if (field.type === 'number' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) errors[field.id] = `${field.label} must be a number`;
    else if (field.type === 'number' && !Number.isFinite(Number(value))) errors[field.id] = `${field.label} must be a finite number`;
    else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[field.id] = `${field.label} must be a valid email`;
    else if (field.type === 'select' && !field.options.includes(value)) errors[field.id] = `Choose an available option for ${field.label}`;
    else if (field.type === 'date') {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        errors[field.id] = `${field.label} must be a valid date`;
      }
    }
  }
  return errors;
}

export function activeDealFieldValues(fields: DealCustomField[], values: DealFieldValues): DealFieldValues {
  return Object.fromEntries(fields.filter((field) => !field.archived).map((field) => [field.id, values[field.id] ?? '']));
}
