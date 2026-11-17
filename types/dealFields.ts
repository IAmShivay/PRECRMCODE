import type { DealFieldType } from './constants.js';
export type { DealFieldType };

export interface DealCustomField {
  id: string;
  label: string;
  type: DealFieldType;
  options: string[];
  required_in_stages: string[];
  archived: boolean;
}

export type DealFieldValues = Record<string, string>;
