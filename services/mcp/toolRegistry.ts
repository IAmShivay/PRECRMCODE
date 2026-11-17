import { emitAutomationEvent } from '../automations/engine.js';
import {
  leadsApi,
  dealsApi,
  leadActivitiesApi,
  customFieldsApi,
  customFieldValuesApi,
  notificationsApi,
} from '../api.js';
import {
  DEAL_STATUS,
  DEFAULT_DEAL_STAGE_SLUG,
  DEFAULT_PIPELINE_SLUG,
  MCP_SECURITY_MUTATING_HIGH,
  MCP_SECURITY_MUTATING_LOW,
  MCP_SECURITY_READ_ONLY,
  MCP_TOOL_CREATE_DEAL,
  MCP_TOOL_CREATE_LEAD,
  MCP_TOOL_GET_CUSTOMER_DETAILS,
  MCP_TOOL_GET_DEAL_ASSOCIATIONS,
  MCP_TOOL_GET_LEAD_DETAILS,
  MCP_TOOL_GET_PIPELINE_SUMMARY,
  MCP_TOOL_LIST_CUSTOM_FIELDS,
  MCP_TOOL_LIST_NOTIFICATIONS,
  MCP_TOOL_LIST_PIPELINE_STAGES,
  MCP_TOOL_LOG_ACTIVITY,
  MCP_TOOL_MOVE_DEAL_STAGE,
  MCP_TOOL_SEARCH_CUSTOMERS,
  MCP_TOOL_SEARCH_DEALS,
  MCP_TOOL_SEARCH_LEADS,
  MCP_TOOL_SEND_WHATSAPP_MESSAGE,
  MCP_TOOL_UPDATE_LEAD,
  MCP_TOOL_VERIFY_EMAIL,
} from '../../types/constants.js';
import type {
  ApiResponse,
  Lead,
  McpToolDefinition,
  McpToolExecutionContext,
} from '../../types/index.js';
import { createDealRecord, parseDealFromLog } from '../deals.js';
import { getDealStageConfigurationForPipeline } from '../dealStages.js';
import { verifyEmail } from '../emailVerifier.js';
import { enqueueWhatsAppMessage } from '../whatsapp.js';
import { getWorkspaceAccess } from '../workspacePermissions.js';
import { canViewDeal } from '../../types/permissions.js';
import { getCustomersForWorkspace } from '../customers.js';
import { listAssociationsForDeal } from '../dealAssociations.js';
import { checkMcpRateLimit } from './rateLimiter.js';
import { stripHtmlTags } from '../../utils/validation.js';

function sanitizeStr(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return stripHtmlTags(val.trim()).slice(0, maxLen);
}

function sanitizePositiveInt(val: unknown): number | null {
  const n = Number(val);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export const crmToolDefinitions: McpToolDefinition[] = [
  {
    name: MCP_TOOL_SEARCH_LEADS,
    description: 'Search for leads by query, email, phone or status within the workspace',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term matching name, email, or company' },
        email: { type: 'string', description: 'Filter by exact or partial email address' },
        phone: { type: 'string', description: 'Filter by phone number' },
        status_id: { type: 'number', description: 'Filter by lead status ID' },
        limit: { type: 'number', description: 'Maximum number of leads to return (1 to 50)' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const limit = Math.min(Math.max(Number(params?.limit || 10), 1), 50);
      const res = await leadsApi.getLeads({
        workspace_id: context.workspace_id,
        status_id: sanitizePositiveInt(params?.status_id) || undefined,
        limit,
      });
      if (res.status !== 'success' || !Array.isArray(res.data)) return { leads: [] };
      let leads = res.data.filter((lead: Lead) => Number(lead.workspace_id) === context.workspace_id);
      if (params?.email) {
        const emailFilter = sanitizeStr(params.email, 100).toLowerCase();
        leads = leads.filter((lead) => String(lead.email || '').toLowerCase().includes(emailFilter));
      }
      if (params?.phone) {
        const phoneFilter = sanitizeStr(params.phone, 30).replace(/\D/g, '');
        leads = leads.filter((lead) => String(lead.phone || '').replace(/\D/g, '').includes(phoneFilter));
      }
      if (params?.query) {
        const q = sanitizeStr(params.query, 100).toLowerCase();
        leads = leads.filter(
          (lead) =>
            String(lead.name || '').toLowerCase().includes(q) ||
            String(lead.email || '').toLowerCase().includes(q) ||
            String(lead.phone || '').includes(q)
        );
      }
      return {
        total: leads.length,
        leads: leads.slice(0, limit).map((lead) => ({
          id: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          status_id: lead.status_id,
          created_at: lead.created_at,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_GET_LEAD_DETAILS,
    description: 'Retrieve full details for a lead including custom fields and activities',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number', description: 'ID of the lead' },
      },
      required: ['lead_id'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const leadId = sanitizePositiveInt(params?.lead_id);
      if (!leadId) throw new Error('Valid lead_id is required');
      const leadRes = await leadsApi.getLeadById(leadId);
      const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : leadRes.data;
      if (!lead || Number(lead.workspace_id) !== context.workspace_id) throw new Error('Lead not found in this workspace');
      const [customValuesRes, activitiesRes] = await Promise.all([
        customFieldValuesApi.getCustomFieldValues(leadId).catch(() => ({ data: [] })),
        leadActivitiesApi.getActivities(leadId).catch(() => ({ data: [] })),
      ]);
      const customValues = Array.isArray(customValuesRes?.data) ? customValuesRes.data : [];
      const activities = Array.isArray(activitiesRes?.data) ? activitiesRes.data : [];
      return {
        lead: {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          status_id: lead.status_id,
          email_valid: lead.email_valid,
          created_at: lead.created_at,
          updated_at: lead.updated_at,
        },
        custom_fields: customValues,
        recent_activities: activities.slice(0, 10).map((act: any) => ({
          id: act.id,
          type: act.type,
          title: act.title,
          description: act.description,
          created_at: act.created_at,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_CREATE_LEAD,
    description: 'Create a new lead in the CRM workspace',
    security_level: MCP_SECURITY_MUTATING_LOW,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the lead' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        status_id: { type: 'number', description: 'Initial status ID (defaults to 1)' },
        source: { type: 'string', description: 'Lead source (e.g., ai_chatbot, website, manual)' },
      },
      required: ['name'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const name = sanitizeStr(params?.name, 200);
      if (!name) throw new Error('Lead name is required');
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess || access.role === 'viewer') throw new Error('Insufficient permissions to create leads');
      const res = await leadsApi.createLead({
        workspace_id: context.workspace_id,
        name,
        email: sanitizeStr(params?.email, 150).toLowerCase(),
        phone: sanitizeStr(params?.phone, 30),
        status_id: sanitizePositiveInt(params?.status_id) || 1,
        source: sanitizeStr(params?.source, 50) || 'ai_chatbot',
      });
      const created = Array.isArray(res.data) ? res.data[0] : res.data;
      return { success: res.status === 'success', lead: created };
    },
  },
  {
    name: MCP_TOOL_UPDATE_LEAD,
    description: 'Update basic details for an existing lead',
    security_level: MCP_SECURITY_MUTATING_LOW,
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number', description: 'ID of the lead to update' },
        name: { type: 'string', description: 'Updated full name' },
        email: { type: 'string', description: 'Updated email address' },
        phone: { type: 'string', description: 'Updated phone number' },
        status_id: { type: 'number', description: 'Updated status ID' },
      },
      required: ['lead_id'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const leadId = sanitizePositiveInt(params?.lead_id);
      if (!leadId) throw new Error('Valid lead_id is required');
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess || access.role === 'viewer') throw new Error('Insufficient permissions to update leads');
      const leadRes = await leadsApi.getLeadById(leadId);
      const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : leadRes.data;
      if (!lead || Number(lead.workspace_id) !== context.workspace_id) throw new Error('Lead not found in this workspace');
      const patch: Record<string, any> = {};
      if (params.name) patch.name = sanitizeStr(params.name, 200);
      if (params.email !== undefined) patch.email = sanitizeStr(params.email, 150).toLowerCase();
      if (params.phone !== undefined) patch.phone = sanitizeStr(params.phone, 30);
      if (params.status_id !== undefined) patch.status_id = sanitizePositiveInt(params.status_id) || 1;
      const updateRes = await leadsApi.updateLead(leadId, patch);
      const updated = Array.isArray(updateRes.data) ? updateRes.data[0] : updateRes.data;
      return { success: updateRes.status === 'success', lead: updated };
    },
  },
  {
    name: MCP_TOOL_SEARCH_DEALS,
    description: 'Search and filter deals in the pipeline by stage, value range, or priority',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Stage slug to filter (e.g. new_lead, proposal, won)' },
        priority: { type: 'string', description: 'Priority level (low, medium, high)' },
        min_value: { type: 'number', description: 'Minimum deal value' },
        max_value: { type: 'number', description: 'Maximum deal value' },
        pipeline_slug: { type: 'string', description: 'Pipeline slug (defaults to default)' },
        limit: { type: 'number', description: 'Maximum results to return' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const rawRes = (await dealsApi.getDeals({
        workspace_id: context.workspace_id,
        limit: 1000,
      })) as ApiResponse<any>;
      const logs = rawRes?.status === 'success' && rawRes.data
        ? (Array.isArray(rawRes.data) ? rawRes.data : [rawRes.data])
        : [];
      let deals = logs
        .filter((log) => Number(log?.workspace_id) === context.workspace_id && String(log?.status || '') === DEAL_STATUS)
        .map(parseDealFromLog)
        .filter((deal) => canViewDeal(access, deal.owner_id, deal.pipeline_slug || DEFAULT_PIPELINE_SLUG));
      if (params?.stage) {
        const stageStr = sanitizeStr(params.stage, 50).toLowerCase();
        deals = deals.filter((d) => String(d.stage).toLowerCase() === stageStr);
      }
      if (params?.priority) {
        const prioStr = sanitizeStr(params.priority, 20).toLowerCase();
        deals = deals.filter((d) => String(d.priority).toLowerCase() === prioStr);
      }
      if (params?.min_value !== undefined && Number.isFinite(Number(params.min_value))) {
        deals = deals.filter((d) => Number(d.value) >= Number(params.min_value));
      }
      if (params?.max_value !== undefined && Number.isFinite(Number(params.max_value))) {
        deals = deals.filter((d) => Number(d.value) <= Number(params.max_value));
      }
      const limit = Math.min(Math.max(Number(params?.limit || 20), 1), 50);
      return {
        total: deals.length,
        deals: deals.slice(0, limit).map((d) => ({
          id: d.id,
          name: d.name,
          value: d.value,
          stage: d.stage,
          contact: d.contact,
          priority: d.priority,
          expected_close_date: d.expected_close_date,
          lead_id: d.lead_id,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_GET_PIPELINE_SUMMARY,
    description: 'Get aggregate pipeline statistics, stage counts, total monetary values and conversion metrics',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        pipeline_slug: { type: 'string', description: 'Pipeline slug (defaults to default)' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const pipelineSlug = sanitizeStr(params?.pipeline_slug, 50) || DEFAULT_PIPELINE_SLUG;
      const [config, dealsRes] = await Promise.all([
        getDealStageConfigurationForPipeline(context.workspace_id, pipelineSlug),
        dealsApi.getDeals({ workspace_id: context.workspace_id, limit: 1000 }) as Promise<ApiResponse<any>>,
      ]);
      const logs = dealsRes?.status === 'success' && dealsRes.data
        ? (Array.isArray(dealsRes.data) ? dealsRes.data : [dealsRes.data])
        : [];
      const deals = logs
        .filter((log: any) => Number(log?.workspace_id) === context.workspace_id && String(log?.status || '') === DEAL_STATUS)
        .map(parseDealFromLog)
        .filter((deal) => canViewDeal(access, deal.owner_id, deal.pipeline_slug || DEFAULT_PIPELINE_SLUG))
        .filter((deal) => (deal.pipeline_slug || DEFAULT_PIPELINE_SLUG) === pipelineSlug);
      const stageMap: Record<string, { count: number; total_value: number; name: string }> = {};
      for (const st of config.stages) {
        stageMap[st.slug] = { count: 0, total_value: 0, name: st.name };
      }
      let totalValue = 0;
      let wonCount = 0;
      let wonValue = 0;
      for (const d of deals) {
        totalValue += Number(d.value || 0);
        const stageInfo = stageMap[d.stage];
        if (stageInfo) {
          stageInfo.count += 1;
          stageInfo.total_value += Number(d.value || 0);
        }
        const stageConfig = config.stages.find((s) => s.slug === d.stage);
        if (stageConfig?.counts_as_conversion) {
          wonCount += 1;
          wonValue += Number(d.value || 0);
        }
      }
      return {
        pipeline_slug: pipelineSlug,
        total_deals: deals.length,
        total_pipeline_value: totalValue,
        won_deals_count: wonCount,
        won_deals_value: wonValue,
        conversion_rate_percentage: deals.length > 0 ? Number(((wonCount / deals.length) * 100).toFixed(1)) : 0,
        stages: Object.entries(stageMap).map(([slug, data]) => ({
          slug,
          name: data.name,
          deal_count: data.count,
          value: data.total_value,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_CREATE_DEAL,
    description: 'Create a new deal with a name, value, contact, stage, and optional lead association',
    security_level: MCP_SECURITY_MUTATING_LOW,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Deal title or name' },
        value: { type: 'number', description: 'Monetary value of the deal' },
        contact: { type: 'string', description: 'Contact name or email' },
        stage: { type: 'string', description: 'Target stage slug (defaults to new_lead)' },
        priority: { type: 'string', description: 'Deal priority: low, medium, high' },
        expected_close_date: { type: 'string', description: 'Expected closing date (YYYY-MM-DD)' },
        lead_id: { type: 'number', description: 'Associated lead ID' },
        pipeline_slug: { type: 'string', description: 'Target pipeline slug' },
      },
      required: ['name', 'value'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess || access.permissions.deals !== 'edit') {
        throw new Error('Insufficient permissions to create deals');
      }
      const name = sanitizeStr(params.name, 200);
      if (!name) throw new Error('Deal name is required');
      const val = Number(params.value);
      if (!Number.isFinite(val) || val < 0 || val > 1000000000) {
        throw new Error('Deal value must be a valid non-negative number <= 1,000,000,000');
      }
      const pipelineSlug = sanitizeStr(params?.pipeline_slug, 50) || DEFAULT_PIPELINE_SLUG;
      const { stages } = await getDealStageConfigurationForPipeline(context.workspace_id, pipelineSlug);
      const result = await createDealRecord({
        workspaceId: context.workspace_id,
        name,
        value: val,
        contact: sanitizeStr(params.contact, 150) || undefined,
        stage: sanitizeStr(params.stage, 50) || DEFAULT_DEAL_STAGE_SLUG,
        priority: sanitizeStr(params.priority, 20).toLowerCase() || undefined,
        expectedCloseDate: sanitizeStr(params.expected_close_date, 20) || undefined,
        leadId: sanitizePositiveInt(params.lead_id) || undefined,
        pipelineSlug,
        stages,
        activityUserId: context.user_id,
      });
      return { success: true, id: result.id, deal: result.deal };
    },
  },
  {
    name: MCP_TOOL_MOVE_DEAL_STAGE,
    description: 'Move an existing deal to a target pipeline stage, validating stage requirements and required documents',
    security_level: MCP_SECURITY_MUTATING_HIGH,
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'number', description: 'ID of the deal to move' },
        target_stage: { type: 'string', description: 'Slug of the destination stage' },
      },
      required: ['deal_id', 'target_stage'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const dealId = sanitizePositiveInt(params?.deal_id);
      const targetStage = sanitizeStr(params?.target_stage, 50);
      if (!dealId || !targetStage) throw new Error('deal_id and target_stage are required');
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess || access.permissions.deals !== 'edit') {
        throw new Error('Insufficient permissions to move deals');
      }
      const existingRes = (await dealsApi.getDealById(dealId)) as ApiResponse<any>;
      const existingLog = Array.isArray(existingRes.data) ? existingRes.data[0] : existingRes.data;
      if (!existingLog || Number(existingLog.workspace_id) !== context.workspace_id || String(existingLog?.status || '') !== DEAL_STATUS) {
        throw new Error('Deal not found in this workspace');
      }
      const deal = parseDealFromLog(existingLog);
      const pipelineSlug = deal.pipeline_slug || DEFAULT_PIPELINE_SLUG;
      const { stages } = await getDealStageConfigurationForPipeline(context.workspace_id, pipelineSlug);
      const matchedStage = stages.find((s) => s.slug === targetStage);
      if (!matchedStage) throw new Error(`Target stage '${targetStage}' is invalid for pipeline '${pipelineSlug}'`);
      const payload = typeof existingLog.payload === 'string' ? JSON.parse(existingLog.payload) : (existingLog.payload || {});
      payload.stage = targetStage;
      payload.updated_at = new Date().toISOString();
      if (matchedStage.counts_as_conversion && !payload.won_at) {
        payload.won_at = payload.updated_at;
      }
      const updateRes = await dealsApi.updateDeal(dealId, {
        payload: JSON.stringify(payload),
      });
      if (updateRes.status === 'success' && deal.stage !== targetStage) {
        emitAutomationEvent({
          workspaceId: context.workspace_id,
          type: 'deal_moved',
          dealId,
          leadId: Number(deal.lead_id || 0) || undefined,
          pipelineSlug,
          stage: targetStage,
          previousStage: String(deal.stage || ''),
        });
      }
      return {
        success: updateRes.status === 'success',
        deal_id: dealId,
        previous_stage: deal.stage,
        new_stage: targetStage,
      };
    },
  },
  {
    name: MCP_TOOL_VERIFY_EMAIL,
    description: 'Verify an email address validity, disposable status, and deliverability via Reoon Email Verifier',
    security_level: MCP_SECURITY_MUTATING_LOW,
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address to verify' },
      },
      required: ['email'],
    },
    execute: async (_context: McpToolExecutionContext, params: any) => {
      const email = sanitizeStr(params?.email, 150).toLowerCase();
      if (!email || !email.includes('@')) throw new Error('Valid email address is required');
      const result = await verifyEmail(email, 'quick');
      return {
        email: result.email,
        status: result.status,
        is_safe: result.status === 'valid' || result.status === 'safe',
        is_disposable: result.is_disposable,
        is_spamtrap: result.is_spamtrap,
      };
    },
  },
  {
    name: MCP_TOOL_SEND_WHATSAPP_MESSAGE,
    description: 'Queue and send an outbound WhatsApp message to a customer or lead',
    security_level: MCP_SECURITY_MUTATING_HIGH,
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Recipient phone number with country code' },
        lead_id: { type: 'number', description: 'Optional associated lead ID' },
      },
      required: ['phone'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess || access.permissions.conversations === 'none') {
        throw new Error('Insufficient permissions to send WhatsApp messages');
      }
      const phone = sanitizeStr(params?.phone, 30).replace(/[^0-9+]/g, '');
      if (!phone || phone.length < 7) throw new Error('Valid phone number with country code is required');
      const queueRes = await enqueueWhatsAppMessage({
        workspaceId: context.workspace_id,
        leadId: sanitizePositiveInt(params?.lead_id) || 0,
        triggerKind: 'hello_world',
        leadPhone: phone,
      });
      return {
        queued: queueRes.queued,
        eventId: queueRes.eventId,
        reason: queueRes.reason,
      };
    },
  },
  {
    name: MCP_TOOL_LOG_ACTIVITY,
    description: 'Log an interaction, note, call, or meeting for a lead',
    security_level: MCP_SECURITY_MUTATING_LOW,
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number', description: 'ID of the lead' },
        type: { type: 'string', description: 'Activity type: note, call, meeting, email, whatsapp' },
        title: { type: 'string', description: 'Brief summary of the activity' },
        description: { type: 'string', description: 'Detailed activity notes' },
      },
      required: ['lead_id', 'title'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const leadId = sanitizePositiveInt(params?.lead_id);
      const title = sanitizeStr(params?.title, 200);
      if (!leadId || !title) throw new Error('lead_id and title are required');
      const leadRes = await leadsApi.getLeadById(leadId);
      const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : leadRes.data;
      if (!lead || Number(lead.workspace_id) !== context.workspace_id) throw new Error('Lead not found in this workspace');
      const actRes = await leadActivitiesApi.createActivity({
        lead_id: leadId,
        workspace_id: context.workspace_id,
        user_id: context.user_id,
        type: sanitizeStr(params?.type, 30) || 'note',
        title,
        description: sanitizeStr(params?.description, 2000),
        created_at: new Date().toISOString(),
      });
      const created = Array.isArray(actRes.data) ? actRes.data[0] : actRes.data;
      return { success: actRes.status === 'success', activity: created };
    },
  },
  {
    name: MCP_TOOL_SEARCH_CUSTOMERS,
    description: 'Search converted customers in the workspace by query, email or phone',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Customer search keyword' },
        limit: { type: 'number', description: 'Maximum customers to return (1 to 50)' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const customers = await getCustomersForWorkspace(context.workspace_id, access);
      let filtered = customers;
      if (params?.query) {
        const q = sanitizeStr(params.query, 100).toLowerCase();
        filtered = customers.filter(
          (c) =>
            String(c.name || '').toLowerCase().includes(q) ||
            String(c.email || '').toLowerCase().includes(q) ||
            String(c.phone || '').includes(q)
        );
      }
      const limit = Math.min(Math.max(Number(params?.limit || 20), 1), 50);
      return {
        total: filtered.length,
        customers: filtered.slice(0, limit).map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          order_count: c.order_count,
          total_value: c.total_value,
          first_won_at: c.first_won_at,
          last_won_at: c.last_won_at,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_GET_CUSTOMER_DETAILS,
    description: 'Retrieve full details for a converted customer including orders, deals and lifetime value',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'ID of the customer' },
      },
      required: ['customer_id'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const customerId = sanitizeStr(params?.customer_id, 100);
      if (!customerId) throw new Error('Valid customer_id is required');
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const customers = await getCustomersForWorkspace(context.workspace_id, access);
      const customer = customers.find((c) => String(c.id) === customerId);
      if (!customer) throw new Error('Customer not found in this workspace');
      return { customer };
    },
  },
  {
    name: MCP_TOOL_GET_DEAL_ASSOCIATIONS,
    description: 'Retrieve linked, parent-child, or blocker deal associations for a specific deal',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'number', description: 'ID of the deal' },
      },
      required: ['deal_id'],
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const dealId = sanitizePositiveInt(params?.deal_id);
      if (!dealId) throw new Error('Valid deal_id is required');
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const dealRes = await dealsApi.getDealById(dealId);
      const dealLog = Array.isArray(dealRes.data) ? dealRes.data[0] : dealRes.data;
      if (!dealLog || Number(dealLog.workspace_id) !== context.workspace_id) {
        throw new Error('Deal not found in this workspace');
      }
      const associations = await listAssociationsForDeal(context.workspace_id, dealId);
      return {
        deal_id: dealId,
        associations_count: associations.length,
        associations,
      };
    },
  },
  {
    name: MCP_TOOL_LIST_PIPELINE_STAGES,
    description: 'List configured stages and conversion rules for a pipeline',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        pipeline_slug: { type: 'string', description: 'Pipeline slug (defaults to default)' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const pipelineSlug = sanitizeStr(params?.pipeline_slug, 50) || DEFAULT_PIPELINE_SLUG;
      const config = await getDealStageConfigurationForPipeline(context.workspace_id, pipelineSlug);
      return {
        pipeline_slug: pipelineSlug,
        stages: config.stages.map((st) => ({
          slug: st.slug,
          name: st.name,
          color: st.color,
          counts_as_conversion: st.counts_as_conversion,
        })),
        fields_count: config.fields.length,
        required_documents: config.required_documents,
      };
    },
  },
  {
    name: MCP_TOOL_LIST_CUSTOM_FIELDS,
    description: 'List custom fields configured for leads in this workspace',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {},
    },
    execute: async (context: McpToolExecutionContext) => {
      const access = await getWorkspaceAccess(context.user_id, context.workspace_id);
      if (!access.hasAccess) throw new Error('Access denied to workspace');
      const res = await customFieldsApi.getCustomFields(context.workspace_id);
      const fields = Array.isArray(res.data) ? res.data : [];
      return {
        total: fields.length,
        fields: fields.map((f) => ({
          id: f.id,
          label: f.label,
          slug: f.slug,
          field_type: f.field_type,
          options: f.options,
          is_required: f.is_required,
        })),
      };
    },
  },
  {
    name: MCP_TOOL_LIST_NOTIFICATIONS,
    description: 'List recent notifications and alerts for the authenticated user',
    security_level: MCP_SECURITY_READ_ONLY,
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum notifications to return (1 to 50)' },
      },
    },
    execute: async (context: McpToolExecutionContext, params: any) => {
      const limit = Math.min(Math.max(Number(params?.limit || 15), 1), 50);
      const res = await notificationsApi.getNotifications({
        workspace_id: context.workspace_id,
        recipient_user_id: context.user_id,
        limit,
      });
      const notifications = Array.isArray(res.data) ? res.data : [];
      return {
        total: notifications.length,
        notifications: notifications.slice(0, limit).map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          read_at: n.read_at,
          created_at: n.created_at,
        })),
      };
    },
  },
];

export async function executeCrmTool(
  context: McpToolExecutionContext,
  name: string,
  params: any
): Promise<any> {
  const rateLimitCheck = checkMcpRateLimit(context.workspace_id, name);
  if (!rateLimitCheck.allowed) {
    throw new Error(rateLimitCheck.reason || 'Rate limit exceeded');
  }
  const tool = crmToolDefinitions.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(context, params);
}

export function getCrmGrokToolDeclarations(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}> {
  return crmToolDefinitions.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function getCrmGeminiFunctionDeclarations(): Array<{
  name: string;
  description: string;
  parameters: Record<string, any>;
}> {
  return crmToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}

export function getCrmMcpToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}> {
  return crmToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }));
}
