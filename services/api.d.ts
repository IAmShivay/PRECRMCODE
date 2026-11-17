import type {
  ApiResponse,
  Lead,
  LeadStatus,
  LeadActivity,
  LeadCreateData,
  LeadUpdateData,
  CustomField,
  CustomFieldValue,
  User,
  Workspace,
  WorkspaceMember,
  Notification,
  NotificationCreateData,
  NotificationUpdateData,
  Source,
  SourceCreateData,
  SourceUpdateData,
  Deal,
  DealCreateData,
  DealUpdateData,
} from '../types/index.js';

export interface GetLeadsParams {
  workspace_id?: number;
  status_id?: number;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
}

export interface SearchLeadsParams {
  workspace_id?: number;
  email?: string;
  name?: string;
  source_ref?: string;
}

export interface GetWebhookLogsParams {
  workspace_id?: number;
  lead_id?: number;
  source?: string;
  status?: string;
  event_id?: string;
  page?: number;
  limit?: number;
  includeTotal?: boolean;
  sort?: string;
  order?: string;
  only?: string;
  by?: string;
  cache?: 'default' | 'no-store' | 'no-cache';
  bypassCache?: boolean;
}

export interface GetWorkspacesParams {
  owner_id?: number;
  page?: number;
  limit?: number;
}

export interface GetWorkspaceMembersParams {
  bypassCache?: boolean;
  workspace_id?: number;
  user_id?: number;
  page?: number;
  limit?: number;
}

export interface GetNotificationsParams {
  workspace_id?: number;
  recipient_user_id?: number;
  read_at?: string | null;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
  cache?: 'default' | 'no-store' | 'no-cache';
  bypassCache?: boolean;
}

export const leadsApi: {
  getLeads(params?: GetLeadsParams): Promise<ApiResponse<Lead[]>>;
  getLeadById(id: number): Promise<ApiResponse<Lead>>;
  searchLeads(searchParams: SearchLeadsParams): Promise<ApiResponse<Lead[]>>;
  createLead(lead: LeadCreateData | any): Promise<ApiResponse<Lead>>;
  updateLead(id: number, lead: LeadUpdateData | any): Promise<ApiResponse<Lead>>;
  deleteLead(id: number): Promise<ApiResponse<any>>;
};

export const leadStatusesApi: {
  getStatuses(workspaceId?: number): Promise<ApiResponse<LeadStatus[]>>;
  getStatusById(id: number): Promise<ApiResponse<LeadStatus>>;
  createStatus(status: any): Promise<ApiResponse<LeadStatus>>;
  updateStatus(id: number, status: any): Promise<ApiResponse<LeadStatus>>;
  deleteStatus(id: number): Promise<ApiResponse<any>>;
};

export const leadActivitiesApi: {
  getActivityById(id: number): Promise<ApiResponse<LeadActivity>>;
  getActivities(leadId: number): Promise<ApiResponse<LeadActivity[]>>;
  createActivity(activity: any): Promise<ApiResponse<LeadActivity>>;
  updateActivity(id: number, activity: any): Promise<ApiResponse<LeadActivity>>;
  deleteActivity(id: number): Promise<ApiResponse<any>>;
};

export const customFieldsApi: {
  getCustomFields(workspaceId: number): Promise<ApiResponse<CustomField[]>>;
  createCustomField(field: any): Promise<ApiResponse<CustomField>>;
  updateCustomField(id: number, field: any): Promise<ApiResponse<CustomField>>;
  deleteCustomField(id: number): Promise<ApiResponse<any>>;
};

export const customFieldValuesApi: {
  getCustomFieldValueById(id: number): Promise<ApiResponse<CustomFieldValue>>;
  getCustomFieldValues(leadId: number): Promise<ApiResponse<CustomFieldValue[]>>;
  createCustomFieldValue(value: any): Promise<ApiResponse<CustomFieldValue>>;
  updateCustomFieldValue(id: number, value: any): Promise<ApiResponse<CustomFieldValue>>;
  deleteCustomFieldValue(id: number): Promise<ApiResponse<any>>;
};

export const webhookLogsApi: {
  getWebhookLogs(params?: GetWebhookLogsParams): Promise<ApiResponse<any[]>>;
  createWebhookLog(log: any): Promise<ApiResponse<any>>;
  updateWebhookLog(id: number, log: any): Promise<ApiResponse<any>>;
  deleteWebhookLog(id: number): Promise<ApiResponse<any>>;
};

export const notificationsApi: {
  getNotifications(params?: GetNotificationsParams): Promise<ApiResponse<Notification[]>>;
  getNotificationById(id: number): Promise<ApiResponse<Notification>>;
  createNotification(notification: NotificationCreateData | any): Promise<ApiResponse<Notification>>;
  updateNotification(id: number, notification: NotificationUpdateData | any): Promise<ApiResponse<Notification>>;
  deleteNotification(id: number): Promise<ApiResponse<any>>;
};

export const usersApi: {
  getUsers(): Promise<ApiResponse<User[]>>;
  getUserById(id: number): Promise<ApiResponse<User>>;
  createUser(user: any): Promise<ApiResponse<User>>;
  updateUser(id: number, user: any): Promise<ApiResponse<User>>;
  searchUserByEmail(email: string): Promise<ApiResponse<User[]>>;
};

export const workspacesApi: {
  getWorkspaces(params?: GetWorkspacesParams): Promise<ApiResponse<Workspace[]>>;
  getWorkspaceById(id: number, bypassCache?: boolean): Promise<ApiResponse<Workspace>>;
  createWorkspace(workspace: any): Promise<ApiResponse<Workspace>>;
  updateWorkspace(id: number, workspace: any): Promise<ApiResponse<Workspace>>;
  deleteWorkspace(id: number): Promise<ApiResponse<any>>;
};

export const workspaceMembersApi: {
  getWorkspaceMembers(
    workspaceIdOrParams: number | GetWorkspaceMembersParams
  ): Promise<ApiResponse<WorkspaceMember[]>>;
  getWorkspaceMemberById(memberId: number): Promise<ApiResponse<WorkspaceMember>>;
  addWorkspaceMember(member: any): Promise<ApiResponse<WorkspaceMember>>;
  updateWorkspaceMember(memberId: number, member: any): Promise<ApiResponse<WorkspaceMember>>;
  deleteWorkspaceMember(memberId: number): Promise<ApiResponse<any>>;
};

export const workspaceInvitationsApi: {
  getInvitations(params?: any): Promise<ApiResponse<any[]>>;
  getInvitationById(id: number): Promise<ApiResponse<any>>;
  createInvitation(invitation: any): Promise<ApiResponse<any>>;
  updateInvitation(id: number, invitation: any): Promise<ApiResponse<any>>;
  deleteInvitation(id: number): Promise<ApiResponse<any>>;
};

export const sourcesApi: {
  getSources(workspaceId: number): Promise<ApiResponse<any[]>>;
  getSourceById(workspaceId: number, sourceId: string): Promise<ApiResponse<any>>;
  createSource(workspaceId: number, name: string): Promise<ApiResponse<any>>;
  updateSource(id: number, source: any): Promise<ApiResponse<any>>;
  deleteSource(workspaceId: number, sourceId: string): Promise<ApiResponse<any>>;
};

export const dealsApi: {
  getDeals(params?: any): Promise<ApiResponse<Deal[]>>;
  getDealById(id: number): Promise<ApiResponse<Deal>>;
  createDeal(deal: DealCreateData | any): Promise<ApiResponse<Deal>>;
  updateDeal(id: number, deal: DealUpdateData | any): Promise<ApiResponse<Deal>>;
  deleteDeal(id: number): Promise<ApiResponse<any>>;
};

export const dealPipelinesApi: {
  getPipelines(params?: any): Promise<ApiResponse<any[]>>;
  createPipeline(pipeline: any): Promise<ApiResponse<any>>;
};

export const dealStageHistoryApi: {
  createStageHistory(entry: any): Promise<ApiResponse<any>>;
};

export const dealAssociationsApi: {
  getAssociations(params?: any): Promise<ApiResponse<any[]>>;
  getAssociationById(id: number): Promise<ApiResponse<any>>;
  createAssociation(association: any): Promise<ApiResponse<any>>;
  deleteAssociation(id: number): Promise<ApiResponse<any>>;
};

export interface TableApi<T = any> {
  list(filters?: Record<string, string | number | boolean | null | undefined>, options?: { fresh?: boolean }): Promise<ApiResponse<T[]>>;
  get(id: number): Promise<ApiResponse<T>>;
  create(row: Partial<T> | any): Promise<ApiResponse<T>>;
  update(id: number, row: Partial<T> | any): Promise<ApiResponse<T>>;
  remove(id: number): Promise<ApiResponse<any>>;
}

export const automationsApi: TableApi;
export const automationRunsApi: TableApi;
export const tasksApi: TableApi;
