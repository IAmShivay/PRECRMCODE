import { canViewDeal, type WorkspaceAccess } from '../types/permissions.js';
import { dealsApi, leadsApi, webhookLogsApi } from './api.js';
import {
  ApiResponse,
  Customer,
  CustomerCustomField,
  CustomerOrder,
  CustomerOrderItem,
  CustomerProfileUpdate,
  Lead,
  StoredDealLog,
} from '../types/index.js';
import { getDealStageConfiguration } from './dealStages.js';

const CUSTOMER_PROFILE_STATUS = 'customer_profile';

interface StoredCustomerProfileLog extends StoredDealLog {
  source?: string;
  event_id?: string;
}

function asRows<T>(data: T | T[] | undefined): T[] {
  return Array.isArray(data) ? data : data ? [data] : [];
}

function parsePayload(value: StoredDealLog['payload']): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown): string {
  return text(value);
}

function profilePayload(log: StoredCustomerProfileLog, workspaceId: number): Record<string, unknown> | null {
  if (Number(log.workspace_id) !== workspaceId || log.status !== CUSTOMER_PROFILE_STATUS) return null;
  const payload = parsePayload(log.payload);
  return payload && typeof payload.customer_id === 'string' ? payload : null;
}

function profileFields(value: unknown): CustomerCustomField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field): CustomerCustomField[] => {
    if (!field || typeof field !== 'object') return [];
    const label = text((field as Record<string, unknown>).label);
    return label ? [{ label, value: text((field as Record<string, unknown>).value) }] : [];
  });
}

function profileItems(value: unknown): Record<string, CustomerOrderItem[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const items: Record<string, CustomerOrderItem[]> = {};
  for (const [dealId, rawItems] of Object.entries(value)) {
    if (!validId(dealId) || !Array.isArray(rawItems)) continue;
    items[dealId] = rawItems.flatMap((item): CustomerOrderItem[] => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const name = text(record.name);
      const quantity = Number(record.quantity);
      return name && Number.isSafeInteger(quantity) && quantity > 0 ? [{ name, quantity }] : [];
    });
  }
  return items;
}

export function applyCustomerProfiles(
  customers: Customer[],
  profileLogs: StoredCustomerProfileLog[],
  workspaceId: number
): Customer[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const log of [...profileLogs].sort((a, b) => Number(a.id || 0) - Number(b.id || 0))) {
    const payload = profilePayload(log, workspaceId);
    if (payload) latest.set(String(payload.customer_id), payload);
  }

  return customers.map((customer) => {
    const profile = latest.get(customer.id);
    if (!profile) return customer;
    const orderItems = profileItems(profile.order_items);
    return {
      ...customer,
      email: Object.hasOwn(profile, 'email') ? text(profile.email) : customer.email,
      phone: Object.hasOwn(profile, 'phone') ? text(profile.phone) : customer.phone,
      address: text(profile.address),
      custom_fields: profileFields(profile.custom_fields),
      orders: customer.orders.map((order) => ({ ...order, items: orderItems[String(order.deal_id)] || [] })),
    };
  });
}

function convertedOrderFromLog(log: StoredDealLog, workspaceId: number, conversionStages: Set<string>): {
  leadId?: number;
  contact: string;
  order: CustomerOrder;
} | null {
  if (Number(log.workspace_id) !== workspaceId || log.status !== 'deal') return null;
  const payload = parsePayload(log.payload);
  const dealId = validId(log.id);
  if (!payload || !conversionStages.has(text(payload.stage)) || !dealId) return null;

  const rawValue = Number(payload.value);
  const leadId = validId(payload.lead_id) || validId(log.lead_id);
  return {
    leadId,
    contact: text(payload.contact),
    order: {
      deal_id: dealId,
      deal_name: text(payload.name) || `Deal ${dealId}`,
      value: Number.isFinite(rawValue) && rawValue >= 0 ? rawValue : 0,
      pipeline_slug: text(payload.pipeline_slug) || 'default',
      won_at: timestamp(payload.converted_at) || timestamp(payload.won_at) || timestamp(payload.updated_at) || timestamp(payload.created_at) || timestamp(log.created_at),
      items: [],
    },
  };
}

export function buildCustomers(workspaceId: number, dealLogs: StoredDealLog[], leads: Lead[], conversionStages: Set<string> = new Set(['won'])): Customer[] {
  const leadById = new Map(
    leads
      .filter((lead) => Number(lead.workspace_id) === workspaceId)
      .map((lead) => [Number(lead.id), lead])
  );
  const customerById = new Map<string, Customer>();

  for (const log of dealLogs) {
    const won = convertedOrderFromLog(log, workspaceId, conversionStages);
    if (!won) continue;
    const id = won.leadId ? `lead:${won.leadId}` : `deal:${won.order.deal_id}`;
    const lead = won.leadId ? leadById.get(won.leadId) : undefined;
    const existing = customerById.get(id);

    if (existing) {
      existing.orders.push(won.order);
      existing.order_count += 1;
      existing.total_value += won.order.value;
      if (won.order.won_at && (!existing.first_won_at || won.order.won_at < existing.first_won_at)) {
        existing.first_won_at = won.order.won_at;
      }
      if (won.order.won_at && won.order.won_at > existing.last_won_at) {
        existing.last_won_at = won.order.won_at;
        existing.contact = won.contact || existing.contact;
      }
      continue;
    }

    customerById.set(id, {
      id,
      workspace_id: workspaceId,
      ...(won.leadId ? { lead_id: won.leadId } : {}),
      name: text(lead?.name) || won.contact || won.order.deal_name,
      ...(text(lead?.email) ? { email: text(lead?.email) } : {}),
      ...(text(lead?.phone) ? { phone: text(lead?.phone) } : {}),
      ...(text(lead?.email) ? { lead_email: text(lead?.email) } : {}),
      ...(text(lead?.phone) ? { lead_phone: text(lead?.phone) } : {}),
      address: '',
      contact: won.contact,
      custom_fields: [],
      order_count: 1,
      total_value: won.order.value,
      first_won_at: won.order.won_at,
      last_won_at: won.order.won_at,
      orders: [won.order],
    });
  }

  return Array.from(customerById.values())
    .map((customer) => ({
      ...customer,
      orders: customer.orders.sort((a, b) => b.won_at.localeCompare(a.won_at) || b.deal_id - a.deal_id),
    }))
    .sort((a, b) => b.last_won_at.localeCompare(a.last_won_at) || a.name.localeCompare(b.name));
}

export async function getConvertedLeadIdsForWorkspace(workspaceId: number): Promise<Set<number>> {
  const { stages } = await getDealStageConfiguration(workspaceId);
  const conversionStages = new Set(stages.filter((stage) => stage.counts_as_conversion).map((stage) => stage.slug));
  const dealsResponse = await dealsApi.getDeals({ workspace_id: workspaceId, limit: 10000 }) as ApiResponse<StoredDealLog[]>;
  if (dealsResponse.status !== 'success') throw new Error('Failed to load converted deals');
  const ids = new Set<number>();
  for (const log of asRows(dealsResponse.data)) {
    const leadId = convertedOrderFromLog(log, workspaceId, conversionStages)?.leadId;
    if (leadId) ids.add(leadId);
  }
  return ids;
}

export async function getCustomersForWorkspace(workspaceId: number, access?: WorkspaceAccess): Promise<Customer[]> {
  const { stages } = await getDealStageConfiguration(workspaceId);
  const conversionStages = new Set(stages.filter((stage) => stage.counts_as_conversion).map((stage) => stage.slug));
  const dealsResponse = await dealsApi.getDeals({ workspace_id: workspaceId, limit: 10000 }) as ApiResponse<StoredDealLog[]>;
  if (dealsResponse.status !== 'success') {
    throw new Error('Failed to load converted deals');
  }

  const logs = asRows(dealsResponse.data).filter((log) => {
    const payload = parsePayload(log.payload);
    return !access || canViewDeal(access, payload?.owner_id, payload?.pipeline_slug ? String(payload.pipeline_slug) : 'default');
  });
  const hasLinkedWonDeal = logs.some((log) => {
    const won = convertedOrderFromLog(log, workspaceId, conversionStages);
    return Boolean(won?.leadId);
  });
  let leads: Lead[] = [];
  if (hasLinkedWonDeal) {
    const leadsResponse = await leadsApi.getLeads({ workspace_id: workspaceId, limit: 10000 }) as ApiResponse<Lead[]>;
    if (leadsResponse.status === 'success') {
      leads = asRows(leadsResponse.data);
    }
  }

  const customers = buildCustomers(workspaceId, logs, leads, conversionStages);
  if (customers.length === 0) return customers;
  const profileLogs = await getCustomerProfileLogs(workspaceId);
  return applyCustomerProfiles(customers, profileLogs, workspaceId);
}

async function getCustomerProfileLogs(workspaceId: number): Promise<StoredCustomerProfileLog[]> {
  const response = await webhookLogsApi.getWebhookLogs({
    workspace_id: workspaceId,
    status: CUSTOMER_PROFILE_STATUS,
    limit: 10000,
    bypassCache: true,
  }) as ApiResponse<StoredCustomerProfileLog[]>;
  if (response.status !== 'success') throw new Error('Failed to load customer profiles');
  return asRows(response.data).filter((log) =>
    Number(log.workspace_id) === workspaceId && log.status === CUSTOMER_PROFILE_STATUS
  );
}

export class InvalidCustomerOrderError extends Error {}
export class InvalidCustomerProfileError extends Error {}

export async function updateCustomerProfile(
  workspaceId: number,
  customerId: string,
  update: CustomerProfileUpdate
): Promise<Customer | null> {
  const customers = await getCustomersForWorkspace(workspaceId);
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return null;

  const orderIds = new Set(customer.orders.map((order) => String(order.deal_id)));
  if (Object.keys(update.order_items).some((id) => !orderIds.has(id))) {
    throw new InvalidCustomerOrderError('Items can only be added to this customer’s converted deals');
  }

  const profileLogs = await getCustomerProfileLogs(workspaceId);
  const existing = profileLogs
    .filter((log) => profilePayload(log, workspaceId)?.customer_id === customerId)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  const previousPayload = profilePayload(existing || {}, workspaceId);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payload = {
    customer_id: customerId,
    ...(update.email !== undefined ? { email: update.email } : {}),
    ...(update.phone !== undefined ? { phone: update.phone } : {}),
    address: update.address,
    custom_fields: update.custom_fields,
    order_items: { ...profileItems(previousPayload?.order_items), ...update.order_items },
    created_at: text(previousPayload?.created_at) || now,
    updated_at: now,
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 60000) {
    throw new InvalidCustomerProfileError('Customer profile is too large');
  }
  const body = {
    workspace_id: workspaceId,
    lead_id: customer.lead_id || 0,
    source: CUSTOMER_PROFILE_STATUS,
    event_id: `customer_profile_${customerId.replace(':', '_')}`,
    payload: JSON.stringify(payload),
    status: CUSTOMER_PROFILE_STATUS,
    created_at: existing?.created_at || now,
  };
  const result = existing?.id
    ? await webhookLogsApi.updateWebhookLog(existing.id, body)
    : await webhookLogsApi.createWebhookLog(body);
  if (result.status !== 'success') throw new Error('Failed to save customer profile');

  return applyCustomerProfiles([customer], [{ ...body, id: existing?.id }], workspaceId)[0] || null;
}
