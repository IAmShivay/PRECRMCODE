import { WEB_FORM_MAPPING_FIELD_KEYS } from './constants.js';

export type WebFormMappingFieldKey = typeof WEB_FORM_MAPPING_FIELD_KEYS[number];

export interface WebFormDealFieldMap {
  name?: string;
  contact?: string;
  value?: string;
  priority?: string;
  expected_close_date?: string;
}

export interface WebFormDealMapping {
  workspace_id: number;
  source_id: string;
  enabled: boolean;
  pipeline_slug: string;
  stage: string;
  owner_user_id: number | null;
  fields: WebFormDealFieldMap;
  deal_custom_fields: Record<string, string>;
  updated_at?: string;
}

export interface WebFormDealOutcome {
  status: 'created' | 'skipped';
  dealId?: number;
  reason?: string;
}
