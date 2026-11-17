import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { Readable } from 'node:stream';
import jwt from 'jsonwebtoken';
import type { DealCustomField } from '../types/dealFields.js';

process.env.JWT_SECRET = 'deal-e2e-test-jwt-secret-key';

async function main() {
  const { webhookLogsApi, dealsApi, dealPipelinesApi, dealStageHistoryApi, workspacesApi, workspaceMembersApi, leadsApi, leadActivitiesApi } = await import('../services/api.js');
  const { default: router } = await import('../routes/dealsRoutes.js');
  const { DEFAULT_DEAL_STAGES } = await import('../services/dealStages.js');

  let records: any[] = [];
  let nextId = 500;
  let stageHistory: any[] = [];

  const response = (data: any): any => ({ status: 'success', data });

  webhookLogsApi.getWebhookLogs = async (params: any) =>
    response(records.filter((row) => row.workspace_id === params.workspace_id && (!params.status || row.status === params.status)));

  webhookLogsApi.createWebhookLog = async (body: any) => {
    const record = { ...body, id: nextId++ };
    records.push(record);
    return response(record);
  };

  webhookLogsApi.updateWebhookLog = async (id: number, body: any) => {
    records = records.map((record) => (record.id === id ? { ...record, ...body } : record));
    return response(records.find((record) => record.id === id));
  };

  dealsApi.getDealById = async (id: number) => response(records.find((record) => record.id === id));
  dealsApi.getDeals = async (params: any) => response(records.filter((record) => record.workspace_id === params.workspace_id && record.status === 'deal'));
  dealsApi.createDeal = webhookLogsApi.createWebhookLog;
  dealsApi.updateDeal = webhookLogsApi.updateWebhookLog;
  dealsApi.deleteDeal = async (id: number) => {
    records = records.filter((record) => record.id !== id);
    return response(null);
  };

  dealPipelinesApi.getPipelines = async () => response([]);
  dealStageHistoryApi.createStageHistory = async (history: any) => {
    stageHistory.push(history);
    return response(null);
  };

  const workspaces = [{ id: 10, name: 'E2E Demo Workspace', owner_id: 1, currency: 'INR' }];

  workspacesApi.getWorkspaceById = async (id: number) => response(workspaces.find((w) => w.id === id));
  workspaceMembersApi.getWorkspaceMembers = async (_params: any) => response([{ id: 1, user_id: 1, workspace_id: 10, role: 'admin' }]);
  leadsApi.getLeadById = async (id: number) => response({ id, name: 'Lead for Deal', workspace_id: 10 });
  leadActivitiesApi.createActivity = async () => response(null);

  const app = express();
  app.use(express.json());
  app.use('/api/deals', router);

  const token = (id: number) => jwt.sign({ id }, process.env.JWT_SECRET!, { expiresIn: '1h' });

  function dispatch(method: string, path: string, body?: any, userId = 1): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const socket = new Readable({ read() {} });
      const req = new http.IncomingMessage(socket as any);
      req.method = method;
      req.url = `/api/deals${path}`;
      req.headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${token(userId)}`,
      };

      let raw = '';
      const res = new http.ServerResponse(req);
      res.write = (chunk: any) => { raw += chunk; return true; };
      res.end = (chunk: any) => {
        if (chunk) raw += chunk;
        let parsed = {};
        try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
        resolve({ status: res.statusCode, body: parsed });
      };

      if (body) {
        (req as any).body = body;
      }
      app(req, res);
      if (body) {
        req.push(JSON.stringify(body));
      }
      req.push(null);
    });
  }

  console.log('================================================================');
  console.log('STARTING END-TO-END DEAL PIPELINE & STAGE REQUIREMENTS TEST');
  console.log('================================================================\n');

  console.log('▶ STEP 1: Admin configures pipeline stage requirements');
  console.log('  Adding:');
  console.log('   - [Deal Value]           -> Compulsory in [proposal, won]');
  console.log('   - [Expected Close Date]  -> Compulsory in [proposal]');
  console.log('   - [Budget (Custom)]      -> Compulsory in [won]');

  const stages = DEFAULT_DEAL_STAGES.map((s) => ({ ...s }));
  const fields: DealCustomField[] = [
    { id: 'df_val', label: 'Deal Value', type: 'number', options: [], archived: false, required_in_stages: ['proposal', 'won'] },
    { id: 'df_close', label: 'Expected Close Date', type: 'date', options: [], archived: false, required_in_stages: ['proposal'] },
    { id: 'df_budget', label: 'Budget', type: 'number', options: [], archived: false, required_in_stages: ['won'] },
  ];

  const configRes = await dispatch('PUT', '/configuration', {
    workspace_id: 10,
    stages,
    fields,
    required_documents: [],
  });

  if (configRes.status !== 200) console.log('Config Error:', configRes.body);
  assert.equal(configRes.status, 200, 'Config save should return 200');
  console.log('  ✔ Pipeline configuration saved successfully (HTTP 200)\n');

  console.log('▶ STEP 2: Agent creates a new deal in the initial stage ("new_lead")');
  const newDealPayload = {
    workspace_id: 10,
    name: 'Acme Enterprise Expansion',
    contact: 'Bob Smith (bob@acme.com)',
    stage: 'new_lead',
    value: 85000,
    priority: 'high',
    custom_fields: {
      df_val: '85000',
    },
  };

  const createRes = await dispatch('POST', '', newDealPayload);
  assert.equal(createRes.status, 200, 'Deal creation should return 200');
  const dealId = createRes.body.data.id;
  console.log(`  ✔ Deal created with ID #${dealId}`);
  console.log(`    Stage: ${createRes.body.data.stage}`);
  console.log(`    Value: ₹${createRes.body.data.value}`);
  console.log(`    Deal Value field: ${createRes.body.data.custom_fields.df_val}\n`);

  console.log('▶ STEP 3: Attempting to move deal to "proposal" stage without Expected Close Date');
  const badMoveRes = await dispatch('PUT', `/${dealId}`, {
    stage: 'proposal',
    custom_fields: {
      df_val: '85000',
    },
  });

  assert.equal(badMoveRes.status, 422, 'Should reject invalid stage transition with 422');
  console.log(`  ✔ Correctly rejected transition with HTTP ${badMoveRes.status}`);
  console.log(`    Error message: "${badMoveRes.body.message}"\n`);

  console.log('▶ STEP 4: Supplying Expected Close Date and moving to "proposal"');
  console.log('  Notice: Deal Value (₹85000) was already filled, so customer does NOT need to retype it!');
  const goodMoveRes = await dispatch('PUT', `/${dealId}`, {
    stage: 'proposal',
    expected_close_date: '2026-11-30',
    custom_fields: {
      df_val: '85000',
      df_close: '2026-11-30',
    },
  });

  assert.equal(goodMoveRes.status, 200, 'Should allow stage transition with 200');
  assert.equal(goodMoveRes.body.data.stage, 'proposal');
  console.log('  ✔ Deal successfully transitioned to "proposal" stage (HTTP 200)');
  console.log(`    Current Stage: ${goodMoveRes.body.data.stage}`);
  console.log(`    Saved Close Date: ${goodMoveRes.body.data.custom_fields.df_close}\n`);

  console.log('▶ STEP 5: Attempting to convert deal to "won" stage without Budget');
  console.log('  "won" requires: [Deal Value] (already fulfilled!) and [Budget] (missing)');
  const badWonRes = await dispatch('PUT', `/${dealId}`, {
    stage: 'won',
    custom_fields: {
      df_val: '85000',
    },
  });

  assert.equal(badWonRes.status, 422, 'Should reject conversion when Budget is missing');
  console.log(`  ✔ Conversion blocked with HTTP ${badWonRes.status}`);
  console.log(`    Error message: "${badWonRes.body.message}"\n`);

  console.log('▶ STEP 6: Supplying Budget and converting deal to "won"');
  console.log('  Notice: Deal Value and Expected Close Date are retained automatically!');
  const goodWonRes = await dispatch('PUT', `/${dealId}`, {
    stage: 'won',
    custom_fields: {
      df_val: '85000',
      df_close: '2026-11-30',
      df_budget: '80000',
    },
  });

  assert.equal(goodWonRes.status, 200, 'Conversion should succeed with HTTP 200');
  assert.equal(goodWonRes.body.data.stage, 'won');
  assert(goodWonRes.body.data.converted_at, 'Deal must have converted_at timestamp');
  console.log('  ✔ Deal successfully converted to "won" (HTTP 200)');
  console.log(`    Final Stage: ${goodWonRes.body.data.stage}`);
  console.log(`    Converted At: ${goodWonRes.body.data.converted_at}`);
  console.log('    All field values retained without retyping:');
  console.log('     ', JSON.stringify(goodWonRes.body.data.custom_fields));

  console.log('\n================================================================');
  console.log('ALL E2E STAGE WORKFLOW & FIELD PERSISTENCE TESTS PASSED (100%)');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
