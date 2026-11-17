import type { Lead } from '../types/index.js';
import type { CreateLeadRequest, LeadWebhookLog } from '../components/types.js';
import { leadsApi, webhookLogsApi } from './api.js';
import { SourceRegistry } from './sourceRegistry.js';
import { normalizeSourceString } from '../types/sources.js';

// ============ WEBHOOK SERVICE ============
// This service handles incoming webhooks from various sources to create leads automatically

export interface WebhookPayload {
  source: string; // Now accepts any string, will be normalized
  event_id?: string;
  data: any;
}

// Standard webhook lead data interface
interface WebhookLeadData {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  tags?: string[];
  // Custom fields
  [key: string]: any;
}

class WebhookService {
  private workspaceId: number;
  private sourceRegistry: SourceRegistry;

  constructor(workspaceId: number) {
    this.workspaceId = workspaceId;
    this.sourceRegistry = new SourceRegistry(workspaceId);
  }

  /**
   * Process incoming webhook and create lead
   */
  async processWebhook(payload: WebhookPayload): Promise<{ success: boolean; lead?: Lead; error?: string; log?: LeadWebhookLog }> {
    try {
      // Extract lead data from webhook payload
      const leadData = this.extractLeadData(payload);

      // Validate required fields
      if (!leadData.name && !leadData.email) {
        throw new Error('Either name or email is required');
      }

      // Normalize source using source registry
      const normalizedSource = await this.sourceRegistry.mapIncomingSource(payload.source);
      const sourceType = normalizedSource?.id || normalizeSourceString(payload.source);

      // Get default status for this workspace (or use first available)
      const defaultStatusId = await this.getDefaultStatusId();

      // Create the lead
      const createLeadRequest: CreateLeadRequest = {
        workspace_id: this.workspaceId,
        status_id: defaultStatusId,
        name: leadData.name || `${leadData.email?.split('@')[0] || 'Unknown'}`,
        email: leadData.email || '',
        phone: leadData.phone || '',
        source_old: sourceType as any,
        source_ref: payload.event_id,
        ...(normalizedSource?.sourceId ? { source_id: normalizedSource.sourceId } : {}),
      };

      const leadResponse = await leadsApi.createLead(createLeadRequest);

      if (leadResponse.status === 'success' && leadResponse.data) {
        const lead = leadResponse.data;

        // Log successful webhook
        const log = await this.logWebhook(
          sourceType,
          payload.event_id || '',
          JSON.stringify(payload.data),
          'success',
          null,
          lead.id
        );

        return { success: true, lead, log };
      } else {
        throw new Error(leadResponse.message || 'Failed to create lead from webhook');
      }
    } catch (error: any) {
      const sourceType = normalizeSourceString(payload.source);
      
      // Log failed webhook
      const log = await this.logWebhook(
        sourceType,
        payload.event_id || '',
        JSON.stringify(payload.data),
        'failed',
        error?.message || 'Unknown error',
        null
      );

      return {
        success: false,
        error: error?.message || 'Failed to process webhook',
        log,
      };
    }
  }

  /**
   * Extract lead data from various webhook formats
   */
  private extractLeadData(payload: WebhookPayload): WebhookLeadData {
    const { source, data } = payload;

    switch (source) {
      case 'facebook':
        return this.extractFacebookLeadData(data);

      case 'google':
        return this.extractGoogleLeadData(data);

      case 'landing_page':
        return this.extractLandingPageData(data);

      default:
        return this.extractGenericLeadData(data);
    }
  }

  /**
   * Extract lead data from Facebook Lead Ads webhook
   * Format: https://developers.facebook.com/docs/marketing-apis/leadgen
   */
  private extractFacebookLeadData(data: any): WebhookLeadData {
    // Facebook Lead Ads webhook format
    if (data.leadgen_id) {
      return {
        name: `${data.field_data?.find((f: any) => f.name === 'full_name')?.values?.[0] || ''}`,
        email: data.field_data?.find((f: any) => f.name === 'email')?.values?.[0] || '',
        phone: data.field_data?.find((f: any) => f.name === 'phone_number')?.values?.[0] || '',
        company: data.field_data?.find((f: any) => f.name === 'company_name')?.values?.[0] || '',
        notes: data.field_data?.find((f: any) => f.name === 'notes')?.values?.[0] || '',
      };
    }

    // Alternative Facebook format
    return {
      name: data.full_name || data.name || '',
      email: data.email || '',
      phone: data.phone || data.phone_number || '',
      company: data.company || '',
      notes: data.notes || data.ad_name || '',
    };
  }

  /**
   * Extract lead data from Google Ads webhook
   */
  private extractGoogleLeadData(data: any): WebhookLeadData {
    // Google Ads webhook format
    if (data.user_column_data) {
      const getFieldValue = (columnName: string) => {
        const column = data.user_column_data.find((c: any) => c.column_name === columnName);
        return column?.string_value || column?.int_value || column?.float_value || '';
      };

      return {
        name: getFieldValue('Full Name') || getFieldValue('name') || '',
        email: getFieldValue('Email') || getFieldValue('email') || '',
        phone: getFieldValue('Phone') || getFieldValue('phone') || '',
        company: getFieldValue('Company') || getFieldValue('company') || '',
        notes: getFieldValue('Notes') || getFieldValue('notes') || '',
      };
    }

    return {
      name: data.full_name || data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      company: data.company || '',
      notes: data.notes || '',
    };
  }

  /**
   * Extract lead data from landing page form submission
   */
  private extractLandingPageData(data: any): WebhookLeadData {
    return {
      name: data.name || data.full_name || '',
      email: data.email || '',
      phone: data.phone || data.phone_number || '',
      company: data.company || '',
      notes: data.notes || data.message || data.comments || '',
      tags: data.tags || [],
      ...data, // Include any additional fields
    };
  }

  /**
   * Extract lead data from generic webhook
   */
  private extractGenericLeadData(data: any): WebhookLeadData {
    return {
      name: data.name || data.full_name || '',
      email: data.email || '',
      phone: data.phone || data.phone_number || '',
      company: data.company || '',
      notes: data.notes || data.message || data.description || '',
      tags: data.tags || [],
      ...data, // Include all fields
    };
  }

  /**
   * Get default status ID for the workspace
   */
  private async getDefaultStatusId(): Promise<number> {
    try {
      // Import here to avoid circular dependency
      const { leadStatusesApi } = await import('./api');
      const response = await leadStatusesApi.getStatuses(this.workspaceId);

      if (response.status === 'success' && response.data) {
        const defaultStatus = response.data.find((s: any) => s.is_default === 1);
        return defaultStatus?.id || response.data[0]?.id || 1;
      }

      return 1; // Fallback
    } catch (error) {
      console.error('Error getting default status:', error);
      return 1; // Fallback
    }
  }

  /**
   * Log webhook attempt
   */
  private async logWebhook(
    source: string,
    eventId: string,
    payload: string,
    status: 'success' | 'failed' | 'pending',
    error: string | null,
    leadId: number | null
  ): Promise<LeadWebhookLog> {
    try {
      const response = await webhookLogsApi.createWebhookLog({
        workspace_id: this.workspaceId,
        lead_id: leadId || 0,
        source,
        source_old: source,
        event_id: eventId,
        payload,
        status,
        error: error || undefined,
        created_at: new Date().toISOString(),
      });

      if (response.status === 'success' && response.data) {
        return response.data;
      }

      // Return log object even if API call failed
      return {
        id: 0,
        workspace_id: this.workspaceId,
        lead_id: leadId || 0,
        source,
        event_id: eventId,
        payload,
        status,
        error: error || '',
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error logging webhook:', error);
      // Return log object even if logging failed
      return {
        id: 0,
        workspace_id: this.workspaceId,
        lead_id: leadId || 0,
        source,
        event_id: eventId,
        payload,
        status,
        error: error?.toString() || '',
        created_at: new Date().toISOString(),
      };
    }
  }
}

// ============ WEBHOOK HANDLERS FOR SPECIFIC PLATFORMS ============

/**
 * Facebook Lead Ads webhook handler
 * Endpoint: /api/webhooks/facebook
 */
export async function handleFacebookWebhook(
  workspaceId: number,
  body: any
): Promise<{ success: boolean; lead?: Lead; error?: string }> {
  const service = new WebhookService(workspaceId);

  // Facebook sends raw HTTP body, need to parse
  let data = body;

  // Handle x-www-form-urlencoded format from Facebook
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch (e) {
      return {
        success: false,
        error: 'Invalid JSON in webhook payload',
      };
    }
  }

  // Extract lead data from Facebook format
  const payload: WebhookPayload = {
    source: 'facebook',
    event_id: data.leadgen_id || data.id,
    data,
  };

  return service.processWebhook(payload);
}

/**
 * Google Ads webhook handler
 * Endpoint: /api/webhooks/google
 */
export async function handleGoogleWebhook(
  workspaceId: number,
  body: any
): Promise<{ success: boolean; lead?: Lead; error?: string }> {
  const service = new WebhookService(workspaceId);

  const payload: WebhookPayload = {
    source: 'google',
    event_id: body.conversion_id || body.id,
    data: body,
  };

  return service.processWebhook(payload);
}

/**
 * Landing page form submission handler
 */
export async function handleLandingPageWebhook(
  workspaceId: number,
  formData: Record<string, any>
): Promise<{ success: boolean; lead?: Lead; error?: string }> {
  const service = new WebhookService(workspaceId);

  const payload: WebhookPayload = {
    source: 'landing_page',
    event_id: formData.utm_id || formData.session_id,
    data: formData,
  };

  return service.processWebhook(payload);
}

/**
 * Generic webhook handler
 * Endpoint: /api/webhooks/generic
 */
export async function handleGenericWebhook(
  workspaceId: number,
  source: string,
  body: any
): Promise<{ success: boolean; lead?: Lead; error?: string }> {
  const service = new WebhookService(workspaceId);

  const payload: WebhookPayload = {
    source: source as any,
    event_id: body.id || body.event_id,
    data: body,
  };

  return service.processWebhook(payload);
}

// Export the service class
export { WebhookService };
