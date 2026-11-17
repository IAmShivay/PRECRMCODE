// Source Type Definitions for Production-Ready CRM

/**
 * Standardized source types enum for all lead sources in the system.
 * These represent normalized, production-ready source categories.
 */
export enum SourceType {
  MANUAL = 'MANUAL',
  WEBHOOK = 'WEBHOOK',
  FACEBOOK_LEAD_ADS = 'FACEBOOK_LEAD_ADS',
  GOOGLE_ADS = 'GOOGLE_ADS',
  LANDING_PAGE = 'LANDING_PAGE',
  REFERRAL = 'REFERRAL',
  LINKEDIN = 'LINKEDIN',
  TWITTER = 'TWITTER',
  INSTAGRAM = 'INSTAGRAM',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  OTHER = 'OTHER',
}

/**
 * Source category for grouping and reporting purposes.
 */
export type SourceCategory = 'paid' | 'organic' | 'referral' | 'manual';

/**
 * Configuration for a source type.
 * Defines the metadata and behavior of a source type.
 */
export interface SourceConfig {
  id: SourceType;
  displayName: string;
  description?: string;
  category: SourceCategory;
  platform?: string;
  isActive: boolean;
}

/**
 * Normalized source instance in the registry.
 * Represents a specific source configuration for a workspace.
 */
export interface NormalizedSource {
  id: SourceType;
  sourceId: string; // e.g., 'fb_lead_gen_001' (workspace-scoped)
  workspaceId: number;
  displayName: string;
  config: SourceConfig;
  webhookUrl?: string | null;
  apiCredentials?: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Source registry entry as stored in webhook_logs table.
 * Uses status='source_registry' to differentiate from actual webhook logs.
 */
export interface SourceRegistryEntry {
  id: number;
  workspace_id: number;
  lead_id: number; // Always 0 for registry entries
  source: string; // Source type (e.g., 'FACEBOOK_LEAD_ADS')
  event_id: string; // sourceId (e.g., 'fb_lead_gen_ws1')
  payload: string; // JSON string of full NormalizedSource config
  status: 'source_registry';
  created_at: string;
}

/**
 * Source creation data for registering new sources.
 */
export interface SourceCreateData {
  workspace_id: number;
  source: SourceType;
  event_id: string;
  payload?: string;
  displayName?: string;
  config?: Partial<SourceConfig>;
}

/**
 * Source update data.
 */
export interface SourceUpdateData {
  displayName?: string;
  config?: Partial<SourceConfig>;
  webhookUrl?: string;
  apiCredentials?: Record<string, string>;
}

/**
 * Default source configurations for each SourceType.
 */
export const DEFAULT_SOURCE_CONFIGS: Record<SourceType, SourceConfig> = {
  [SourceType.MANUAL]: {
    id: SourceType.MANUAL,
    displayName: 'Manual Entry',
    description: 'Leads manually entered by users',
    category: 'manual',
    isActive: true,
  },
  [SourceType.WEBHOOK]: {
    id: SourceType.WEBHOOK,
    displayName: 'Webhook',
    description: 'Generic webhook integration',
    category: 'organic',
    isActive: true,
  },
  [SourceType.FACEBOOK_LEAD_ADS]: {
    id: SourceType.FACEBOOK_LEAD_ADS,
    displayName: 'Facebook Lead Ads',
    description: 'Facebook Lead Ads campaigns',
    category: 'paid',
    platform: 'facebook',
    isActive: true,
  },
  [SourceType.GOOGLE_ADS]: {
    id: SourceType.GOOGLE_ADS,
    displayName: 'Google Ads',
    description: 'Google Ads conversion tracking',
    category: 'paid',
    platform: 'google',
    isActive: true,
  },
  [SourceType.LANDING_PAGE]: {
    id: SourceType.LANDING_PAGE,
    displayName: 'Landing Page',
    description: 'Website landing page submissions',
    category: 'organic',
    platform: 'website',
    isActive: true,
  },
  [SourceType.REFERRAL]: {
    id: SourceType.REFERRAL,
    displayName: 'Referral',
    description: 'Customer referrals',
    category: 'referral',
    isActive: true,
  },
  [SourceType.LINKEDIN]: {
    id: SourceType.LINKEDIN,
    displayName: 'LinkedIn',
    description: 'LinkedIn ads or lead gen forms',
    category: 'paid',
    platform: 'linkedin',
    isActive: true,
  },
  [SourceType.TWITTER]: {
    id: SourceType.TWITTER,
    displayName: 'Twitter/X',
    description: 'Twitter/X ads',
    category: 'paid',
    platform: 'twitter',
    isActive: true,
  },
  [SourceType.INSTAGRAM]: {
    id: SourceType.INSTAGRAM,
    displayName: 'Instagram',
    description: 'Instagram ads',
    category: 'paid',
    platform: 'instagram',
    isActive: true,
  },
  [SourceType.EMAIL]: {
    id: SourceType.EMAIL,
    displayName: 'Email Campaign',
    description: 'Email marketing campaigns',
    category: 'paid',
    platform: 'email',
    isActive: true,
  },
  [SourceType.SMS]: {
    id: SourceType.SMS,
    displayName: 'SMS Campaign',
    description: 'SMS marketing campaigns',
    category: 'paid',
    platform: 'sms',
    isActive: true,
  },
  [SourceType.OTHER]: {
    id: SourceType.OTHER,
    displayName: 'Other',
    description: 'Uncategorized sources',
    category: 'organic',
    isActive: true,
  },
};

/**
 * Legacy source string aliases for backward compatibility.
 * Maps old/free-form source strings to normalized SourceType.
 */
export const LEGACY_SOURCE_ALIASES: Record<string, SourceType> = {
  'manual': SourceType.MANUAL,
  'webhook': SourceType.WEBHOOK,
  'facebook': SourceType.FACEBOOK_LEAD_ADS,
  'facebook_lead_ads': SourceType.FACEBOOK_LEAD_ADS,
  'facebook-lead-ads': SourceType.FACEBOOK_LEAD_ADS,
  'fb': SourceType.FACEBOOK_LEAD_ADS,
  'fb_lead_gen': SourceType.FACEBOOK_LEAD_ADS,
  'google': SourceType.GOOGLE_ADS,
  'google_ads': SourceType.GOOGLE_ADS,
  'google-ads': SourceType.GOOGLE_ADS,
  'landing_page': SourceType.LANDING_PAGE,
  'landing-page': SourceType.LANDING_PAGE,
  'landing page': SourceType.LANDING_PAGE,
  'website': SourceType.LANDING_PAGE,
  'referral': SourceType.REFERRAL,
  'linkedin': SourceType.LINKEDIN,
  'twitter': SourceType.TWITTER,
  'x': SourceType.TWITTER,
  'instagram': SourceType.INSTAGRAM,
  'email': SourceType.EMAIL,
  'sms': SourceType.SMS,
  'other': SourceType.OTHER,
};

/**
 * Validates if a string is a valid SourceType.
 */
export function isValidSourceType(value: string): value is SourceType {
  return Object.values(SourceType).includes(value as SourceType);
}

/**
 * Normalizes a source string to SourceType enum.
 * Handles legacy aliases and case insensitivity.
 */
export function normalizeSourceString(source: string): SourceType {
  if (isValidSourceType(source)) {
    return source as SourceType;
  }

  const normalized = source.toLowerCase().replace(/[-\s]+/g, '_');
  const aliased = LEGACY_SOURCE_ALIASES[normalized];
  
  if (aliased) {
    return aliased;
  }

  return SourceType.OTHER;
}

/**
 * Gets the display name for a SourceType.
 */
export function getSourceDisplayName(sourceType: SourceType): string {
  return DEFAULT_SOURCE_CONFIGS[sourceType]?.displayName || sourceType;
}

/**
 * Gets the category for a SourceType.
 */
export function getSourceCategory(sourceType: SourceType): SourceCategory {
  return DEFAULT_SOURCE_CONFIGS[sourceType]?.category || 'organic';
}

/**
 * Checks if a source type is active.
 */
export function isSourceActive(sourceType: SourceType): boolean {
  return DEFAULT_SOURCE_CONFIGS[sourceType]?.isActive !== false;
}

/**
 * Gets all active source types.
 */
export function getActiveSourceTypes(): SourceType[] {
  return Object.values(SourceType).filter(isSourceActive);
}

/**
 * Gets sources by category.
 */
export function getSourcesByCategory(category: SourceCategory): SourceType[] {
  return Object.values(SourceType).filter(
    (type) => getSourceCategory(type) === category
  );
}
