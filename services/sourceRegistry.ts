// Source Registry Service
// Centralized management for normalized source registration and validation

import { webhookLogsApi } from './api.js';
import {
  SourceType,
  SourceConfig,
  NormalizedSource,
  SourceRegistryEntry,
  DEFAULT_SOURCE_CONFIGS,
  normalizeSourceString,
  isValidSourceType,
} from '../types/sources.js';

/**
 * SourceRegistry class for managing normalized source instances.
 * Uses webhook_logs table with status='source_registry' as storage.
 */
export class SourceRegistry {
  private workspaceId: number;

  constructor(workspaceId: number) {
    this.workspaceId = workspaceId;
  }

  /**
   * Register a new source instance for the workspace.
   * @param sourceType - Type of source to register
   * @param displayName - Custom display name (optional)
   * @param config - Additional config overrides (optional)
   * @param webhookUrl - Webhook URL for this source (optional)
   * @param apiCredentials - API credentials (optional)
   * @returns Registered source with generated sourceId
   */
  async registerSource(
    sourceType: string,
    displayName?: string,
    config?: Partial<SourceConfig>,
    webhookUrl?: string,
    apiCredentials?: Record<string, string>
  ): Promise<NormalizedSource> {
    // Normalize source type
    const normalizedType = normalizeSourceString(sourceType);
    
    // Generate source ID
    const sourceId = this.generateSourceId(normalizedType);
    
    // Get default config
    const defaultConfig = DEFAULT_SOURCE_CONFIGS[normalizedType];
    
    // Merge with custom config
    const mergedConfig: SourceConfig = {
      ...defaultConfig,
      ...config,
      id: normalizedType,
      isActive: config?.isActive ?? true,
    };

    // Create normalized source
    const normalizedSource: NormalizedSource = {
      id: normalizedType,
      sourceId,
      workspaceId: this.workspaceId,
      displayName: displayName || defaultConfig.displayName,
      config: mergedConfig,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Add optional properties if provided
    if (webhookUrl !== undefined) {
      normalizedSource.webhookUrl = webhookUrl;
    }
    if (apiCredentials !== undefined) {
      normalizedSource.apiCredentials = apiCredentials;
    }

    // Store in webhook_logs table with status='source_registry'
    await webhookLogsApi.createWebhookLog({
      workspace_id: this.workspaceId,
      lead_id: 0, // Always 0 for registry entries
      source: normalizedType,
      source_old: normalizedType,
      event_id: sourceId,
      payload: JSON.stringify(normalizedSource),
      status: 'source_registry',
    });

    return normalizedSource;
  }

  /**
   * Get a normalized source by sourceId.
   * @param sourceId - The source ID to look up
   * @returns NormalizedSource or null if not found
   */
  async getSource(sourceId: string): Promise<NormalizedSource | null> {
    try {
      const response = await webhookLogsApi.getWebhookLogs({
        workspace_id: this.workspaceId,
        status: 'source_registry',
      });

      if (response.status === 'success' && response.data) {
        const entry = response.data.find(
          (log: SourceRegistryEntry) => log.event_id === sourceId
        );

        if (entry && entry.payload) {
          return JSON.parse(entry.payload) as NormalizedSource;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error fetching source ${sourceId}:`, error);
      return null;
    }
  }

  /**
   * Get all registered sources for the workspace.
   * @returns Array of NormalizedSource
   */
  async getAllSources(): Promise<NormalizedSource[]> {
    try {
      const response = await webhookLogsApi.getWebhookLogs({
        workspace_id: this.workspaceId,
        status: 'source_registry',
      });

      if (response.status === 'success' && response.data) {
        return response.data
          .filter((log: SourceRegistryEntry) => log.status === 'source_registry')
          .map((log: SourceRegistryEntry) => {
            try {
              return JSON.parse(log.payload) as NormalizedSource;
            } catch (parseError) {
              console.error(`Error parsing source config for ${log.event_id}:`, parseError);
              return null;
            }
          })
          .filter((source): source is NormalizedSource => source !== null);
      }

      return [];
    } catch (error) {
      console.error('Error fetching all sources:', error);
      return [];
    }
  }

  /**
   * Get source by type.
   * @param sourceType - Type of source to find
   * @returns NormalizedSource or null if not found
   */
  async getSourceByType(sourceType: SourceType): Promise<NormalizedSource | null> {
    const allSources = await this.getAllSources();
    return allSources.find((s) => s.id === sourceType) || null;
  }

  /**
   * Validate if a source type is registered.
   * @param sourceType - Type to validate
   * @returns true if registered and active
   */
  async validateSource(sourceType: string): Promise<boolean> {
    // First check if it's a valid source type
    if (!isValidSourceType(sourceType)) {
      return false;
    }

    const normalizedType = normalizeSourceString(sourceType);
    const source = await this.getSourceByType(normalizedType);
    
    return source !== null && source.config.isActive;
  }

  /**
   * Map incoming source identifier to normalized source.
   * @param incomingSource - External source identifier
   * @returns NormalizedSource or null if not found/mapped
   */
  async mapIncomingSource(incomingSource: string): Promise<NormalizedSource | null> {
    // Try to normalize and find by type
    const normalizedType = normalizeSourceString(incomingSource);
    
    // First try to find existing source by type
    let source = await this.getSourceByType(normalizedType);
    
    // If not found, register it automatically
    if (!source) {
      try {
        source = await this.registerSource(normalizedType);
      } catch (error) {
        console.error(`Error auto-registering source ${incomingSource}:`, error);
        return null;
      }
    }

    return source;
  }

  /**
   * Update an existing source.
   * @param sourceId - Source ID to update
   * @param updates - Updates to apply
   * @returns Updated NormalizedSource or null if not found
   */
  async updateSource(
    sourceId: string,
    updates: {
      displayName?: string;
      config?: Partial<SourceConfig>;
      webhookUrl?: string;
      apiCredentials?: Record<string, string>;
    }
  ): Promise<NormalizedSource | null> {
    try {
      const existing = await this.getSource(sourceId);
      
      if (!existing) {
        return null;
      }

      // Find the registry entry ID
      const response = await webhookLogsApi.getWebhookLogs({
        workspace_id: this.workspaceId,
        status: 'source_registry',
      });

      if (response.status !== 'success' || !response.data) {
        return null;
      }

      const entry = response.data.find(
        (log: SourceRegistryEntry) => log.event_id === sourceId
      );

      if (!entry) {
        return null;
      }

      // Create updated source
      const updated: NormalizedSource = {
        ...existing,
        displayName: updates.displayName || existing.displayName,
        config: updates.config ? { ...existing.config, ...updates.config } : existing.config,
        webhookUrl: updates.webhookUrl !== undefined ? updates.webhookUrl : (existing.webhookUrl || null),
        apiCredentials: updates.apiCredentials !== undefined ? updates.apiCredentials : (existing.apiCredentials || null),
        updatedAt: new Date(),
      };

      // Update in database
      await webhookLogsApi.updateWebhookLog(entry.id, {
        workspace_id: this.workspaceId,
        lead_id: 0,
        source: updated.id,
        source_old: updated.id,
        event_id: updated.sourceId,
        payload: JSON.stringify(updated),
        status: 'source_registry',
      });

      return updated;
    } catch (error) {
      console.error(`Error updating source ${sourceId}:`, error);
      return null;
    }
  }

  /**
   * Delete (disable) a source.
   * @param sourceId - Source ID to delete
   * @returns true if successful
   */
  async deleteSource(sourceId: string): Promise<boolean> {
    try {
      const source = await this.getSource(sourceId);
      
      if (!source) {
        return false;
      }

      // Instead of deleting, just mark as inactive
      const updated = await this.updateSource(sourceId, {
        config: { isActive: false },
      });

      return updated !== null;
    } catch (error) {
      console.error(`Error deleting source ${sourceId}:`, error);
      return false;
    }
  }

  /**
   * Get source ID for a source type.
   * If source is registered, returns its sourceId.
   * Otherwise, registers it and returns the new sourceId.
   * @param sourceType - Type of source
   * @returns Source ID string
   */
  async getSourceId(sourceType: string): Promise<string> {
    const normalizedType = normalizeSourceString(sourceType);
    
    const existing = await this.getSourceByType(normalizedType);
    
    if (existing) {
      return existing.sourceId;
    }

    // Register new source
    const registered = await this.registerSource(normalizedType);
    return registered.sourceId;
  }

  /**
   * Generate a consistent source ID for a source type.
   * @param sourceType - Type of source
   * @returns Generated source ID
   */
  private generateSourceId(sourceType: SourceType): string {
    // Create a deterministic but unique ID based on source type and workspace
    const typeShort = sourceType.toLowerCase().replace(/_/g, '').substring(0, 5);
    const workspaceSuffix = `_ws${this.workspaceId}`;
    const timestamp = Date.now().toString(36);
    
    return `${typeShort}${workspaceSuffix}_${timestamp}`;
  }

  /**
   * Sync registry with database.
   * Ensures all default source types are registered.
   * @returns Number of sources synced
   */
  async syncRegistry(): Promise<number> {
    let synced = 0;

    for (const sourceType of Object.values(SourceType)) {
      const existing = await this.getSourceByType(sourceType);
      
      if (!existing) {
        await this.registerSource(sourceType);
        synced++;
      }
    }

    return synced;
  }
}

/**
 * Create a SourceRegistry instance for a workspace.
 */
export function createSourceRegistry(workspaceId: number): SourceRegistry {
  return new SourceRegistry(workspaceId);
}
