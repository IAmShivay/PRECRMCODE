/**
 * Export Leads to Excel Script
 *
 * This script fetches leads from the NoCodeBackend database for a specific workspace
 * and date range, then exports them to an Excel file.
 *
 * Usage:
 *   node scripts/export-leads-to-excel.js
 *
 * Environment variables required (set in .env.local or load manually):
 *   - API_KEY: NoCodeBackend API key
 *   - INSTANCE: NoCodeBackend instance ID (default: 54182_scraft_crm_database)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration from environment
const API_KEY = process.env.API_KEY;
const INSTANCE = process.env.INSTANCE || '54182_scraft_crm_database';
const API_BASE_URL = 'https://api.nocodebackend.com';

// Script parameters
const WORKSPACE_NAME = 'Montdor Interior';
const START_DATE = '2025-02-11'; // Feb 11th, 2025
const END_DATE = new Date().toISOString().split('T')[0]; // Today

// Validate environment
if (!API_KEY) {
  console.error('ERROR: API_KEY environment variable is not set');
  console.error('Please set it in .env.local file or export it before running this script');
  process.exit(1);
}

/**
 * Make an API request to NoCodeBackend
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API Error: ${data?.message || data?.error || response.status}`);
  }

  return data;
}

/**
 * Fetch all workspaces to find the target workspace ID
 * Handles pagination to get all workspaces
 */
async function findWorkspaceId(workspaceName) {
  console.log(`Searching for workspace: "${workspaceName}"...`);

  let allWorkspaces = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;

  // Fetch all pages of workspaces
  while (hasMore) {
    const response = await apiRequest(`/read/workspaces?Instance=${INSTANCE}&page=${page}&limit=${limit}`);

    if (response.status !== 'success' || !response.data) {
      throw new Error('Failed to fetch workspaces');
    }

    const workspaces = response.data;
    allWorkspaces.push(...workspaces);
    console.log(`  Fetched page ${page}: ${workspaces.length} workspaces`);

    if (workspaces.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.log(`Total workspaces found: ${allWorkspaces.length}`);

  // Search for the workspace (partial match too)
  const workspace = allWorkspaces.find(ws =>
    ws.name && ws.name.toLowerCase().includes(workspaceName.toLowerCase())
  );

  if (!workspace) {
    console.log('\nAvailable workspaces:');
    allWorkspaces.forEach(ws => {
      console.log(`  - ${ws.name} (ID: ${ws.id})`);
    });
    throw new Error(`Workspace "${workspaceName}" not found`);
  }

  console.log(`Found workspace: ${workspace.name} (ID: ${workspace.id})`);
  return workspace.id;
}

/**
 * Fetch all leads for a workspace with pagination
 */
async function fetchAllLeads(workspaceId, startDate, endDate) {
  console.log(`\nFetching leads from ${startDate} to ${endDate}...`);

  let allLeads = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await apiRequest(
      `/read/leads?Instance=${INSTANCE}&workspace_id=${workspaceId}&page=${page}&limit=${limit}&sort=created_at&order=desc`
    );

    if (response.status !== 'success' || !response.data) {
      throw new Error(`Failed to fetch leads (page ${page})`);
    }

    const leads = response.data;
    console.log(`  Fetched page ${page}: ${leads.length} leads`);

    // Filter by date range (created_at filtering)
    const filteredLeads = leads.filter(lead => {
      if (!lead.created_at) return true; // Include if no date
      const leadDate = lead.created_at.split('T')[0];
      return leadDate >= startDate && leadDate <= endDate;
    });

    allLeads.push(...filteredLeads);

    // Check if we should continue pagination
    // If the oldest lead on this page is before our start date, we can stop
    if (leads.length > 0) {
      const oldestLeadDate = leads[leads.length - 1]?.created_at?.split('T')[0];
      if (oldestLeadDate && oldestLeadDate < startDate) {
        hasMore = false;
      } else if (leads.length < limit) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  console.log(`Total leads found: ${allLeads.length}`);
  return allLeads;
}

/**
 * Fetch lead statuses for the workspace
 */
async function fetchLeadStatuses(workspaceId) {
  const response = await apiRequest(
    `/read/lead_statuses?Instance=${INSTANCE}&workspace_id=${workspaceId}`
  );

  if (response.status !== 'success' || !response.data) {
    return {};
  }

  // Create a map of status_id -> status name
  const statusMap = {};
  response.data.forEach(status => {
    statusMap[status.id] = status.name;
  });

  return statusMap;
}

/**
 * Fetch custom field values for a lead
 */
async function fetchCustomFieldValues(leadId) {
  const response = await apiRequest(
    `/read/lead_custom_field_values?Instance=${INSTANCE}&lead_id=${leadId}`
  );

  if (response.status !== 'success' || !response.data) {
    return [];
  }

  return response.data;
}

/**
 * Fetch custom fields for the workspace
 */
async function fetchCustomFields(workspaceId) {
  const response = await apiRequest(
    `/read/lead_custom_fields?Instance=${INSTANCE}&workspace_id=${workspaceId}`
  );

  if (response.status !== 'success' || !response.data) {
    return [];
  }

  return response.data;
}

/**
 * Format date for Excel
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  // Convert MySQL datetime to more readable format
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateStr;
  }
}

/**
 * Escape CSV value
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert leads to CSV format
 */
function leadsToCsv(leads, statusMap, customFields, customFieldValuesMap) {
  // Define CSV columns
  const baseColumns = [
    'Lead ID',
    'Name',
    'Email',
    'Phone',
    'Status',
    'Source',
    'Source Reference',
    'Owner ID',
    'Email Valid',
    'Phone Valid',
    'Email Verification Status',
    'Email Verified At',
    'Created At',
    'Updated At',
    'Deleted At',
  ];

  // Add custom field columns
  const customFieldColumns = customFields.map(cf => cf.label);
  const allColumns = [...baseColumns, ...customFieldColumns];

  // Build CSV rows
  const rows = [];

  // Header row
  rows.push(allColumns.map(escapeCsvValue).join(','));

  // Data rows
  for (const lead of leads) {
    const row = [
      lead.id,
      lead.name || '',
      lead.email || '',
      lead.phone || '',
      statusMap[lead.status_id] || '',
      lead.source_old || '',
      lead.source_ref || '',
      lead.user_id || '',
      lead.email_valid ? 'Yes' : 'No',
      lead.phone_valid ? 'Yes' : 'No',
      lead.email_verification_status || '',
      formatDate(lead.email_verified_at),
      formatDate(lead.created_at),
      formatDate(lead.updated_at),
      formatDate(lead.deleted_at),
    ];

    // Add custom field values
    const cfValues = customFieldValuesMap.get(lead.id) || [];
    for (const cf of customFields) {
      const cfValue = cfValues.find(v => v.field_id === cf.id);
      row.push(cfValue ? cfValue.value : '');
    }

    rows.push(row.map(escapeCsvValue).join(','));
  }

  return rows.join('\n');
}

/**
 * Save CSV to file
 */
function saveCsvFile(csvContent, filename) {
  const outputPath = path.join(PROJECT_ROOT, filename);

  fs.writeFileSync(outputPath, csvContent, 'utf8');
  console.log(`\nCSV file saved to: ${outputPath}`);
  return outputPath;
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Leads Export to Excel (CSV) Script');
    console.log('='.repeat(60));
    console.log(`Workspace: ${WORKSPACE_NAME}`);
    console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
    console.log('='.repeat(60));

    // Step 1: Find workspace ID
    const workspaceId = await findWorkspaceId(WORKSPACE_NAME);

    // Step 2: Fetch lead statuses
    const statusMap = await fetchLeadStatuses(workspaceId);

    // Step 3: Fetch custom fields
    console.log('\nFetching custom fields...');
    const customFields = await fetchCustomFields(workspaceId);
    console.log(`Found ${customFields.length} custom fields`);

    // Step 4: Fetch all leads
    const leads = await fetchAllLeads(workspaceId, START_DATE, END_DATE);

    if (leads.length === 0) {
      console.log('\nNo leads found for the specified date range.');
      return;
    }

    // Step 5: Fetch custom field values for all leads
    console.log('\nFetching custom field values...');
    const customFieldValuesMap = new Map();

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const values = await fetchCustomFieldValues(lead.id);
      customFieldValuesMap.set(lead.id, values);

      if ((i + 1) % 50 === 0) {
        console.log(`  Fetched custom values for ${i + 1}/${leads.length} leads`);
      }
    }

    // Step 6: Convert to CSV
    console.log('\nGenerating CSV file...');
    const csvContent = leadsToCsv(leads, statusMap, customFields, customFieldValuesMap);

    // Step 7: Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `leads-export-${WORKSPACE_NAME.replace(/\s+/g, '-')}-${timestamp}.csv`;
    const outputPath = saveCsvFile(csvContent, filename);

    console.log('\n' + '='.repeat(60));
    console.log('Export completed successfully!');
    console.log(`Total leads exported: ${leads.length}`);
    console.log(`File: ${outputPath}`);
    console.log('='.repeat(60));

    // Print summary
    console.log('\nSummary:');
    console.log(`  Total leads: ${leads.length}`);
    console.log(`  With valid emails: ${leads.filter(l => l.email_valid).length}`);
    console.log(`  With valid phones: ${leads.filter(l => l.phone_valid).length}`);
    console.log(`  Deleted leads: ${leads.filter(l => l.deleted_at).length}`);

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
