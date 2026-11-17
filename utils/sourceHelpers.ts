// Source Helper Utilities
// Helper functions for working with normalized sources

import {
  SourceType,
  SourceConfig,
  SourceCategory,
  DEFAULT_SOURCE_CONFIGS,
  normalizeSourceString as normalizeSource,
  getSourceDisplayName as getDisplayName,
  getSourceCategory as getCategory,
  isSourceActive as isActive,
} from '../types/sources.js';

/**
 * Generate a consistent source ID for a source type and workspace.
 * Format: {TYPE_SHORT}_ws{workspaceId}_{timestamp}
 * Example: FACEBOOK_LEAD_ADS, workspaceId=1 => "fb_ads_ws1_k1j2m3"
 * 
 * @param sourceType - The type of source
 * @param workspaceId - The workspace ID
 * @returns Generated source ID string
 */
export function generateSourceId(sourceType: SourceType, workspaceId: number): string {
  const typeShort = sourceType
    .toLowerCase()
    .replace(/_/g, '')
    .substring(0, 5);
  const workspaceSuffix = `_ws${workspaceId}`;
  const timestamp = Date.now().toString(36);

  return `${typeShort}${workspaceSuffix}_${timestamp}`;
}

/**
 * Normalize various source string formats to enum.
 * Handles case, spacing, hyphens, underscores, and legacy aliases.
 * 
 * @param source - Source string to normalize
 * @returns Normalized SourceType enum value
 */
export function normalizeSourceString(source: string): SourceType {
  return normalizeSource(source);
}

/**
 * Get human-readable display name for a source type.
 * 
 * @param sourceType - Source type enum
 * @returns Display name string
 */
export function getSourceDisplayName(sourceType: SourceType): string {
  return getDisplayName(sourceType);
}

/**
 * Get category for a source type.
 * 
 * @param sourceType - Source type enum
 * @returns Source category
 */
export function getSourceCategory(sourceType: SourceType): SourceCategory {
  return getCategory(sourceType);
}

/**
 * Check if a source is active/enabled.
 * 
 * @param sourceType - Source type enum
 * @returns true if active, false otherwise
 */
export function isSourceActive(sourceType: SourceType): boolean {
  return isActive(sourceType);
}

/**
 * Get full config for a source type.
 * 
 * @param sourceType - Source type enum
 * @returns SourceConfig object
 */
export function getSourceConfig(sourceType: SourceType): SourceConfig {
  return DEFAULT_SOURCE_CONFIGS[sourceType] || {
    id: SourceType.OTHER,
    displayName: sourceType,
    description: 'Unknown source',
    category: 'organic',
    isActive: true,
  };
}

/**
 * Get all sources by category.
 * 
 * @param category - Category to filter by
 * @returns Array of SourceType enums
 */
export function getSourcesByCategory(category: SourceCategory): SourceType[] {
  return Object.values(SourceType).filter(
    (type) => getCategory(type) === category
  );
}

/**
 * Get all active source types.
 * 
 * @returns Array of active SourceType enums
 */
export function getActiveSourceTypes(): SourceType[] {
  return Object.values(SourceType).filter(isActive);
}

/**
 * Get all source types grouped by category.
 * 
 * @returns Object mapping categories to SourceType arrays
 */
export function getSourceTypesByCategory(): Record<SourceCategory, SourceType[]> {
  return {
    paid: getSourcesByCategory('paid'),
    organic: getSourcesByCategory('organic'),
    referral: getSourcesByCategory('referral'),
    manual: getSourcesByCategory('manual'),
  };
}

/**
 * Check if a source is a paid advertising source.
 * 
 * @param sourceType - Source type enum
 * @returns true if paid source
 */
export function isPaidSource(sourceType: SourceType): boolean {
  return getCategory(sourceType) === 'paid';
}

/**
 * Check if a source is organic (not paid).
 * 
 * @param sourceType - Source type enum
 * @returns true if organic source
 */
export function isOrganicSource(sourceType: SourceType): boolean {
  const category = getCategory(sourceType);
  return category === 'organic' || category === 'referral';
}

/**
 * Check if a source is manual (user-entered).
 * 
 * @param sourceType - Source type enum
 * @returns true if manual source
 */
export function isManualSource(sourceType: SourceType): boolean {
  return sourceType === SourceType.MANUAL;
}

/**
 * Parse source ID to extract source type.
 * Example: "fb_ads_ws1_k1j2m3" => SourceType.FACEBOOK_LEAD_ADS
 * 
 * @param sourceId - Source ID string
 * @returns SourceType enum or null if cannot determine
 */
export function parseSourceId(sourceId: string): SourceType | null {
  // Try to match against known source type patterns
  const lowerId = sourceId.toLowerCase();

  for (const [_key, type] of Object.entries(DEFAULT_SOURCE_CONFIGS)) {
    const typeShort = type.id.toLowerCase().replace(/_/g, '').substring(0, 5);
    if (lowerId.startsWith(typeShort)) {
      return type.id;
    }
  }

  return null;
}

/**
 * Validate a source value (enum or string).
 * 
 * @param source - Source to validate
 * @returns true if valid source
 */
export function isValidSource(source: string | SourceType): boolean {
  if (!source) {
    return false;
  }

  // Check if it's a valid SourceType enum
  if (Object.values(SourceType).includes(source as SourceType)) {
    return true;
  }

  // Try to normalize and check again
  try {
    const normalized = normalizeSource(source);
    return Object.values(SourceType).includes(normalized);
  } catch {
    return false;
  }
}

/**
 * Get source icon/emoji for UI display.
 * 
 * @param sourceType - Source type enum
 * @returns Emoji string or empty string
 */
export function getSourceIcon(sourceType: SourceType): string {
  const iconMap: Record<SourceType, string> = {
    [SourceType.MANUAL]: '✏️',
    [SourceType.WEBHOOK]: '🔗',
    [SourceType.FACEBOOK_LEAD_ADS]: '📘',
    [SourceType.GOOGLE_ADS]: '🔍',
    [SourceType.LANDING_PAGE]: '🌐',
    [SourceType.REFERRAL]: '🤝',
    [SourceType.LINKEDIN]: '💼',
    [SourceType.TWITTER]: '🐦',
    [SourceType.INSTAGRAM]: '📸',
    [SourceType.EMAIL]: '📧',
    [SourceType.SMS]: '💬',
    [SourceType.OTHER]: '📋',
  };

  return iconMap[sourceType] || '';
}

/**
 * Get source color for UI display (hex color).
 * 
 * @param sourceType - Source type enum
 * @returns Hex color string
 */
export function getSourceColor(sourceType: SourceType): string {
  const colorMap: Record<SourceType, string> = {
    [SourceType.MANUAL]: '#6B7280',
    [SourceType.WEBHOOK]: '#8B5CF6',
    [SourceType.FACEBOOK_LEAD_ADS]: '#1877F2',
    [SourceType.GOOGLE_ADS]: '#4285F4',
    [SourceType.LANDING_PAGE]: '#10B981',
    [SourceType.REFERRAL]: '#F59E0B',
    [SourceType.LINKEDIN]: '#0077B5',
    [SourceType.TWITTER]: '#1DA1F2',
    [SourceType.INSTAGRAM]: '#E4405F',
    [SourceType.EMAIL]: '#EA4335',
    [SourceType.SMS]: '#34D399',
    [SourceType.OTHER]: '#9CA3AF',
  };

  return colorMap[sourceType] || '#9CA3AF';
}

/**
 * Format source for display (icon + name).
 * 
 * @param sourceType - Source type enum
 * @returns Formatted string with icon and name
 */
export function formatSourceDisplay(sourceType: SourceType): string {
  const icon = getSourceIcon(sourceType);
  const name = getDisplayName(sourceType);
  return icon ? `${icon} ${name}` : name;
}

/**
 * Create source option for dropdown/select components.
 * 
 * @param sourceType - Source type enum
 * @returns Object with value and label properties
 */
export function createSourceOption(sourceType: SourceType): {
  value: SourceType;
  label: string;
} {
  return {
    value: sourceType,
    label: formatSourceDisplay(sourceType),
  };
}

/**
 * Get all source options for UI components.
 * 
 * @param filterActive - Only include active sources (default: true)
 * @returns Array of source option objects
 */
export function getAllSourceOptions(filterActive: boolean = true): Array<{
  value: SourceType;
  label: string;
}> {
  const sourceTypes = filterActive ? getActiveSourceTypes() : Object.values(SourceType);
  return sourceTypes.map(createSourceOption);
}

/**
 * Get source options grouped by category for UI components.
 * 
 * @param filterActive - Only include active sources (default: true)
 * @returns Object mapping categories to source option arrays
 */
export function getSourceOptionsByCategory(
  filterActive: boolean = true
): Record<SourceCategory, Array<{ value: SourceType; label: string }>> {
  const categories = getSourceTypesByCategory();
  const result: Record<SourceCategory, Array<{ value: SourceType; label: string }>> = {
    paid: [],
    organic: [],
    referral: [],
    manual: [],
  };

  for (const [category, types] of Object.entries(categories)) {
    const filtered = filterActive
      ? types.filter(isActive)
      : types;
    result[category as SourceCategory] = filtered.map(createSourceOption);
  }

  return result;
}

/**
 * Merge incoming source data with normalized source.
 * Useful for handling legacy source formats during migration.
 * 
 * @param incoming - Incoming source value (string or SourceType)
 * @param workspaceId - Workspace ID for context
 * @returns Object with normalized source type and display info
 */
export function normalizeIncomingSource(
  incoming: string | SourceType,
  workspaceId?: number
): {
  type: SourceType;
  displayName: string;
  category: SourceCategory;
  sourceId: string | undefined;
} {
  const type = typeof incoming === 'string' 
    ? normalizeSource(incoming)
    : incoming;

  return {
    type,
    displayName: getDisplayName(type),
    category: getCategory(type),
    sourceId: workspaceId ? generateSourceId(type, workspaceId) : undefined,
  };
}

/**
 * Compare two sources to see if they represent the same source type.
 * Handles legacy string formats.
 * 
 * @param source1 - First source to compare
 * @param source2 - Second source to compare
 * @returns true if sources are equivalent
 */
export function areSourcesEquivalent(
  source1: string | SourceType,
  source2: string | SourceType
): boolean {
  const normalized1 = typeof source1 === 'string'
    ? normalizeSource(source1)
    : source1;
  const normalized2 = typeof source2 === 'string'
    ? normalizeSource(source2)
    : source2;

  return normalized1 === normalized2;
}
