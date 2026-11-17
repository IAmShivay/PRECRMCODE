import { Router, Response } from 'express';
import { webhookLogsApi, leadsApi } from '../services/api.js';
import { authMiddleware } from '../middleware/auth.js';
import { workspaceAuthMiddleware } from '../middleware/workspaceAuth.js';
import { adminOnlyMiddleware } from '../middleware/adminOnly.js';
import { getAllSourceOptions } from '../utils/sourceHelpers.js';
import { Source, AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { getWebFormDealMapping, MAPPING_LOOKUP_ATTEMPTS, saveWebFormDealMapping } from '../services/webFormDeals.js';
import { getDealStageConfigurationForPipeline } from '../services/dealStages.js';
import { listWorkspacePipelines } from '../services/deals.js';
import { validDealAssignee } from '../services/workspacePermissions.js';
import { validate, webFormDealMappingSchema } from '../utils/validation.js';
import { DEFAULT_PIPELINE_SLUG } from '../types/constants.js';

// Legacy types for backward compatibility in sources routes
interface LegacySourceCreateData {
  workspace_id: number;
  source: string;
  event_id: string;
  payload?: string;
  status?: string;
}

const router: Router = Router();

interface ApiDataResponse<T = any> {
  status: 'success' | 'error' | 'failed';
  data?: T;
  message?: string;
  error?: string;
  id?: number;
}

interface SourceOption {
  value: string;
  label: string;
}

// IMPORTANT: /:workspaceId/options must be defined BEFORE /:workspaceId/:sourceId so that
// /api/sources/14/options matches this route and not the :sourceId one (which would
// look for a source with event_id "options" and return 404).

router.get('/:workspaceId/options', authMiddleware, workspaceAuthMiddleware, async (_req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiDataResponse<SourceOption[]>>): Promise<void> => {
  try {
    // Always return the full list of standard source types for the dropdown.
    // The registry is used when creating leads (for source_id); the UI should
    // always offer all choices (Manual, Webhook, Facebook, Google, etc.).
    const sourceOptions: SourceOption[] = getAllSourceOptions(true);
    res.json({ status: 'success', data: sourceOptions });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.get('/:workspaceId', authMiddleware, workspaceAuthMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string }>, res: Response<ApiDataResponse<Source[]>>): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const workspaceIdNum = Number(workspaceId);
    
    // Fetch sources
    const response = await webhookLogsApi.getWebhookLogs({
      workspace_id: workspaceIdNum,
      status: 'source_registry'
    }) as ApiDataResponse<any[]>;
    
    if (response.status !== 'success' || !response.data) {
      res.json(response);
      return;
    }
    
    // Fetch all leads for this workspace to count per source
    let leadCountsBySourceId: Map<string, number> = new Map();
    let leadCountsBySourceName: Map<string, number> = new Map();
    
    // Create a set of valid, active source IDs
    const activeSourceIds = new Set<string>();
    if (response.data && Array.isArray(response.data)) {
      response.data.forEach((s: any) => activeSourceIds.add(String(s.event_id)));
    }
    
    try {
      const leadsResponse = await leadsApi.getLeads({
        workspace_id: workspaceIdNum,
        limit: 10000 // Get all leads to count accurately
      }) as ApiResponse<any[]>;
      
      if (leadsResponse.status === 'success' && Array.isArray(leadsResponse.data)) {
        // Filter out deleted leads
        const activeLeads = leadsResponse.data.filter((lead: any) => {
          const deletedAtStr = lead.deleted_at ? String(lead.deleted_at).trim() : '';
          return deletedAtStr === '' || deletedAtStr === 'null' || deletedAtStr === 'undefined';
        });
        
        // Count leads by source_id and source_old
        activeLeads.forEach((lead: any) => {
          const sourceId = lead.source_id ? String(lead.source_id) : '';
          // If the lead has a source_id AND that source still exists, use it
          if (sourceId && activeSourceIds.has(sourceId)) {
            leadCountsBySourceId.set(sourceId, (leadCountsBySourceId.get(sourceId) || 0) + 1);
          } else if (lead.source_old) {
            // Otherwise, fall back to matching by name (orphaned source_id or missing source_id)
            const sourceName = String(lead.source_old).trim().toLowerCase();
            leadCountsBySourceName.set(sourceName, (leadCountsBySourceName.get(sourceName) || 0) + 1);
          }
        });
      }
    } catch (leadsError) {
      console.error('Error fetching leads for source counts:', leadsError);
      // Continue without lead counts if there's an error
    }
    
    // Add lead counts to each source
    const sourcesWithCounts = response.data.map((source: any) => {
      const sourceId = source.event_id;
      const sourceName = String(source.source || '').trim().toLowerCase();
      
      let leadCount = leadCountsBySourceId.get(sourceId) || 0;
      
      // If we also have leads that match by name but had no source_id, add them
      if (leadCountsBySourceName.has(sourceName)) {
        leadCount += (leadCountsBySourceName.get(sourceName) || 0);
      }
      
      return {
        ...source,
        leadCount
      };
    });
    
    res.json({
      ...response,
      data: sourcesWithCounts
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.get('/:workspaceId/:sourceId', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }>, res: Response<ApiDataResponse<Source>>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const response = await webhookLogsApi.getWebhookLogs({
      workspace_id: Number(workspaceId),
      status: 'source_registry'
    });

    if (response.status === 'success' && response.data) {
      const source: Source | undefined = response.data.find((s: any) => s.event_id === sourceId);
      if (source) {
        res.json({ status: 'success', data: source });
        return;
      }
    }
    res.status(404).json({ status: 'error', message: 'Source not found' });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.get('/:workspaceId/:sourceId/deal-mapping', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const mapping = await getWebFormDealMapping(Number(workspaceId), sourceId, MAPPING_LOOKUP_ATTEMPTS);
    res.json({ status: 'success', data: mapping });
  } catch (error) {
    console.error('Error in GET /api/sources/:workspaceId/:sourceId/deal-mapping:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.put('/:workspaceId/:sourceId/deal-mapping', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, validate(webFormDealMappingSchema), async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const workspaceIdNum = Number(workspaceId);
    const body = req.body as any;

    if (Number(body?.workspace_id) !== workspaceIdNum || String(body?.source_id || '') !== sourceId) {
      res.status(400).json({ status: 'error', message: 'The mapping does not match this source' });
      return;
    }

    const sourceLookup = (await webhookLogsApi.getWebhookLogs({
      workspace_id: workspaceIdNum,
      status: 'source_registry',
      event_id: sourceId,
      limit: 10,
      bypassCache: true,
    })) as ApiResponse<any[]>;

    const sourceRow = sourceLookup.status === 'success' && Array.isArray(sourceLookup.data)
      ? sourceLookup.data.find((item: any) => String(item?.event_id || '') === sourceId)
      : null;

    if (!sourceRow) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const pipelineSlug = String(body?.pipeline_slug || DEFAULT_PIPELINE_SLUG).trim() || DEFAULT_PIPELINE_SLUG;
    const pipelines = await listWorkspacePipelines(workspaceIdNum);
    const knownPipelines = new Set<string>([DEFAULT_PIPELINE_SLUG, ...pipelines.map((pipeline) => pipeline.slug)]);

    if (!knownPipelines.has(pipelineSlug)) {
      res.status(400).json({ status: 'error', message: 'Invalid pipeline' });
      return;
    }

    const { stages } = await getDealStageConfigurationForPipeline(workspaceIdNum, pipelineSlug);
    const stage = String(body?.stage || '').trim();

    if (!stages.some((item) => item.slug === stage)) {
      res.status(400).json({ status: 'error', message: 'Invalid stage' });
      return;
    }

    const ownerId = body?.owner_user_id ? Number(body.owner_user_id) : null;
    if (ownerId !== null && !await validDealAssignee(workspaceIdNum, ownerId)) {
      res.status(400).json({ status: 'error', message: 'Assign deals to an existing workspace member' });
      return;
    }

    const mapping = await saveWebFormDealMapping({
      workspace_id: workspaceIdNum,
      source_id: sourceId,
      enabled: Boolean(body?.enabled),
      pipeline_slug: pipelineSlug,
      stage,
      owner_user_id: ownerId,
      fields: body?.fields || {},
      deal_custom_fields: body?.deal_custom_fields || {},
    });

    res.json({ status: 'success', data: mapping });
  } catch (error) {
    console.error('Error in PUT /api/sources/:workspaceId/:sourceId/deal-mapping:', error);
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.post('/', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{}, {}, LegacySourceCreateData>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const body: LegacySourceCreateData = req.body || {} as LegacySourceCreateData;
    const { workspace_id, source, event_id, payload, status } = body;

    if (!workspace_id || !source || !event_id) {
      res.status(400).json({
        status: 'error',
        message: 'Missing required fields: workspace_id, source, event_id'
      });
      return;
    }

    const existingCheck = await webhookLogsApi.getWebhookLogs({
      workspace_id: Number(workspace_id),
      status: 'source_registry'
    }) as ApiDataResponse<any[]>;

    if (existingCheck.status === 'success' && existingCheck.data) {
      const existingSource: any | undefined = existingCheck.data.find((s: any) => s.event_id === event_id);
      if (existingSource) {
        res.status(400).json({
          status: 'error',
          message: 'Source with this event_id already exists'
        });
        return;
      }
    }

    const response = await webhookLogsApi.createWebhookLog({
      workspace_id: Number(workspace_id),
      lead_id: 0,
      source,
      source_old: source,
      event_id,
      payload: payload || JSON.stringify({ type: 'source_registry' }),
      status: status || 'source_registry',
    }) as ApiDataResponse<any>;

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

interface SourceUpdateWithActive {
  source?: string;
  payload?: string;
  isActive?: boolean;
}

router.put('/:workspaceId/:sourceId', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }, {}, SourceUpdateWithActive>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const body: SourceUpdateWithActive = req.body || {} as SourceUpdateWithActive;
    const { source, payload, isActive } = body;

    const findResponse = await webhookLogsApi.getWebhookLogs({
      workspace_id: Number(workspaceId),
      status: 'source_registry'
    }) as ApiDataResponse<any[]>;

    if (findResponse.status !== 'success' || !findResponse.data) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const existingSource: Source | undefined = findResponse.data.find((s: any) => s.event_id === sourceId);
    if (!existingSource) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const oldSourceName: string = existingSource.source;
    const newSourceName: string = source !== undefined ? source.trim() : oldSourceName;

    // Parse existing payload to get config
    let existingPayload: any = {};
    try {
      existingPayload = existingSource.payload ? JSON.parse(existingSource.payload) : {};
    } catch (parseError) {
      console.error('Error parsing existing payload:', parseError);
      existingPayload = {};
    }

    // Update payload if provided or if isActive changed
    let updatedPayload = existingPayload;
    
    if (isActive !== undefined || payload !== undefined) {
      updatedPayload = {
        ...existingPayload,
        ...((payload) ? { ...JSON.parse(payload) } : {}),
        config: {
          ...existingPayload.config,
          ...(isActive !== undefined ? { isActive } : {}),
        },
      };
    }

    // Check if anything actually changed
    const nameChanged = newSourceName !== oldSourceName;
    const payloadChanged = JSON.stringify(updatedPayload) !== JSON.stringify(existingPayload);

    if (!nameChanged && !payloadChanged) {
      res.json({ status: 'success', message: 'No changes detected' });
      return;
    }

    const updateResponse = await webhookLogsApi.updateWebhookLog(existingSource.id, {
      workspace_id: existingSource.workspace_id,
      lead_id: existingSource.lead_id || 0,
      source: newSourceName,
      event_id: existingSource.event_id,
      payload: payloadChanged ? JSON.stringify(updatedPayload) : existingSource.payload,
      status: 'source_registry',
    }) as ApiDataResponse<any>;

    if (updateResponse.status !== 'success') {
      res.status(500).json({
        status: 'error',
        message: 'Failed to update source registry'
      });
      return;
    }

    // Update leads if source name changed
    if (nameChanged) {
      try {
        const targetWorkspaceId = Number(workspaceId);
        const leadsResponse = await leadsApi.getLeads({
          workspace_id: targetWorkspaceId,
          limit: 10000 // Ensure we get all leads for the update
        }) as ApiResponse<any[]>;

        if (leadsResponse.status === 'success' && leadsResponse.data) {
          // Manual filtering for safety, matching leadsRoutes.ts logic
          let leads = leadsResponse.data;
          
          // 1. Filter by workspace_id manually
          leads = leads.filter((lead: any) => Number(lead.workspace_id) === targetWorkspaceId);
          
          // 2. Filter out deleted leads
          leads = leads.filter((lead: any) => {
            const deletedAtStr = lead.deleted_at ? String(lead.deleted_at).trim() : '';
            return deletedAtStr === '' || deletedAtStr === 'null' || deletedAtStr === 'undefined';
          });

          console.log(`[SourceUpdate] Checking ${leads.length} leads for update. OldSource: "${oldSourceName}", SourceId: "${sourceId}"`);
          
          const leadsToUpdate: any[] = leads.filter((lead: any) => {
            const leadSourceOld = (lead.source_old || '').trim().toLowerCase();
            const targetSourceOld = oldSourceName.trim().toLowerCase();
            const leadSourceId = String(lead.source_id || '');
            const targetSourceId = String(sourceId);

            const nameMatch = leadSourceOld === targetSourceOld;
            const idMatch = leadSourceId === targetSourceId;
            
            // Debug logging for potential matches
            if (leadSourceOld.includes(targetSourceOld) || leadSourceId === targetSourceId) {
               console.log(`[SourceUpdate] Lead ${lead.id} check: nameMatch=${nameMatch} ('${leadSourceOld}' vs '${targetSourceOld}'), idMatch=${idMatch} ('${leadSourceId}' vs '${targetSourceId}')`);
            }

            return nameMatch || idMatch;
          });
          
          const uniqueById = new Map<number, any>();
          leadsToUpdate.forEach((lead: any) => {
            if (lead?.id) uniqueById.set(Number(lead.id), lead);
          });

          const updatePromises: Promise<any>[] = Array.from(uniqueById.values()).map((lead: any) => 
            leadsApi.updateLead(lead.id, {
              workspace_id: lead.workspace_id,
              status_id: lead.status_id,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              source_old: newSourceName,
              source_ref: lead.source_ref,
              source_id: lead.source_id,
              email_valid: lead.email_valid,
              phone_valid: lead.phone_valid,
            })
          );

          await Promise.all(updatePromises);
          console.log(`Updated ${updatePromises.length} leads from source "${oldSourceName}" to "${newSourceName}"`);
        }
      } catch (leadsError) {
        console.error('Error updating leads:', leadsError);
      }
    }

    res.json({
      status: 'success',
      message: 'Source updated successfully',
      data: updateResponse.data
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

router.delete('/:workspaceId/:sourceId', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;

    const findResponse = await webhookLogsApi.getWebhookLogs({
      workspace_id: Number(workspaceId),
      status: 'source_registry'
    }) as ApiDataResponse<any[]>;

    if (findResponse.status !== 'success' || !findResponse.data) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const existingSource: Source | undefined = findResponse.data.find((s: any) => s.event_id === sourceId);
    if (!existingSource) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const deleteResponse = await webhookLogsApi.deleteWebhookLog(existingSource.id) as ApiDataResponse<any>;
    res.json(deleteResponse);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

/**
 * PATCH endpoint for toggling source active status
 * This is a more efficient endpoint for just enabling/disabling a source
 */
router.patch('/:workspaceId/:sourceId', authMiddleware, workspaceAuthMiddleware, adminOnlyMiddleware, async (req: AuthenticatedRequest<{ workspaceId: string; sourceId: string }, {}, { isActive: boolean }>, res: Response<ApiDataResponse>): Promise<void> => {
  try {
    const { workspaceId, sourceId } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      res.status(400).json({ status: 'error', message: 'isActive field is required' });
      return;
    }

    const findResponse = await webhookLogsApi.getWebhookLogs({
      workspace_id: Number(workspaceId),
      status: 'source_registry'
    }) as ApiDataResponse<any[]>;

    if (findResponse.status !== 'success' || !findResponse.data) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    const existingSource: Source | undefined = findResponse.data.find((s: any) => s.event_id === sourceId);
    if (!existingSource) {
      res.status(404).json({ status: 'error', message: 'Source not found' });
      return;
    }

    // Parse existing payload to update config
    let existingPayload: any = {};
    try {
      existingPayload = existingSource.payload ? JSON.parse(existingSource.payload) : {};
    } catch (parseError) {
      console.error('Error parsing existing payload:', parseError);
      existingPayload = { config: { isActive } };
    }

    // Update config with new isActive status
    const updatedPayload = {
      ...existingPayload,
      config: {
        ...existingPayload.config,
        isActive,
      },
    };

    const updateResponse = await webhookLogsApi.updateWebhookLog(existingSource.id, {
      workspace_id: existingSource.workspace_id,
      lead_id: existingSource.lead_id || 0,
      source: existingSource.source,
      event_id: existingSource.event_id,
      payload: JSON.stringify(updatedPayload),
      status: 'source_registry',
    }) as ApiDataResponse<any>;

    if (updateResponse.status !== 'success') {
      res.status(500).json({
        status: 'error',
        message: 'Failed to update source status'
      });
      return;
    }

    res.json({
      status: 'success',
      message: isActive ? 'Source enabled successfully' : 'Source disabled successfully',
      data: updateResponse.data
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: (error as Error).message
    });
  }
});

export default router;
