import { LeadStatus, ApiResponse, CustomField, CustomFieldExtractedValue } from '../types/index.js';
import { leadStatusesApi } from '../services/api.js';
import { toCamelCase } from './authHelpers.js';

export async function getDefaultStatusIdForWorkspace(
  workspaceId: number
): Promise<number | null> {
  try {
    const response = await leadStatusesApi.getStatuses(workspaceId) as ApiResponse<LeadStatus[]>;
    if (response.status === 'success' && response.data && response.data.length > 0) {
      // First, try to find a status marked as default
      const defaultStatus: LeadStatus | undefined = response.data.find((s: LeadStatus) => s.is_default === 1);
      if (defaultStatus) return defaultStatus.id;
      
      // If no default is marked, prefer "Pending" status
      const pendingStatus: LeadStatus | undefined = response.data.find(
        (s: LeadStatus) => s.slug === 'pending' || s.name.toLowerCase() === 'pending'
      );
      if (pendingStatus) return pendingStatus.id;
      
      // Fall back to first status
      return response.data[0]?.id || null;
    }

    // If no statuses exist for this workspace yet, create "Pending" as default
    console.log(
      `No lead statuses found for workspace ${workspaceId} when creating lead, creating default "Pending" status...`
    );

    const createResponse = await leadStatusesApi.createStatus({
      workspace_id: workspaceId,
      name: 'Pending',
      slug: 'pending',
      color: '#6B7280',
      type: 'open',
      is_default: 1,
      is_active: 1,
      order_index: 1,
      is_qualified: 0,
    }) as ApiResponse<LeadStatus>;

    if (createResponse.status === 'success' && createResponse.id) {
      console.log(
        `Created default lead status for workspace ${workspaceId} with id ${createResponse.id}`
      );
      return createResponse.id;
    }

    console.error(
      'Failed to create default status for workspace',
      workspaceId,
      createResponse?.message || createResponse?.error
    );
    return null;
  } catch (error) {
    console.error('Error getting default status for workspace', workspaceId, error);
    return null;
  }
}

export function extractCustomFieldValuesFromPayload(
  payload: Record<string, any>,
  customFields: CustomField[]
): CustomFieldExtractedValue[] {
  const values: CustomFieldExtractedValue[] = [];

  if (!payload || !customFields || customFields.length === 0) {
    return values;
  }

  for (const field of customFields) {
    let value: any = null;

    const keysToTry: string[] = [
      field.slug,
      field.slug?.replace(/_/g, ''),
      field.slug?.replace(/_/g, '-'),
      field.label?.toLowerCase().replace(/\s+/g, '_'),
      field.label?.toLowerCase().replace(/\s+/g, '-'),
      toCamelCase(field.label),
    ].filter(Boolean);

    for (const key of keysToTry) {
      if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined && payload[key] !== null) {
        value = payload[key];
        break;
      }
    }

    if (value !== undefined && value !== null) {
      let convertedValue: string;
      if (field.field_type === 'number') {
        convertedValue = String(Number(value));
      } else if (field.field_type === 'checkbox') {
        convertedValue = String(
          value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0
        );
      } else if (field.field_type === 'multiselect' && Array.isArray(value)) {
        convertedValue = value.join(',');
      } else {
        convertedValue = String(value);
      }

      // Only include non-empty values (except for checkbox which can be '0' or '1')
      if (convertedValue !== '' || field.field_type === 'checkbox') {
        values.push({
          field_id: field.id,
          field_slug: field.slug,
          field_label: field.label,
          field_type: field.field_type,
          value: convertedValue,
        });
      }
    }
  }

  return values;
}


