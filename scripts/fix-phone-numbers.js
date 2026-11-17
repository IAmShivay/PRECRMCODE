/**
 * Migration script: Fix historical phone numbers
 *
 * Re-normalizes every lead's phone number using the updated normalizePhone()
 * logic so that bare 10-digit Indian mobile numbers always get +91 prepended
 * instead of being misidentified as Russian (+7), Omani (+968), etc.
 *
 * Usage:
 *   node scripts/fix-phone-numbers.js              # dry-run (default)
 *   node scripts/fix-phone-numbers.js --apply       # actually update records
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { normalizePhone, validatePhone } from '../dist-server/lib/validation.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_BASE_URL = 'https://api.nocodebackend.com';
const INSTANCE = process.env.INSTANCE || '54182_scraft_crm_database';
const API_KEY = process.env.API_KEY;
const BATCH_SIZE = 200;
const DRY_RUN = !process.argv.includes('--apply');

if (!API_KEY) {
  console.error('ERROR: API_KEY not found. Make sure .env.local exists with API_KEY set.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Fetch all leads (paginated)
// ---------------------------------------------------------------------------
async function fetchAllLeads() {
  const allLeads = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await apiGet(
      `/read/leads?Instance=${INSTANCE}&page=${page}&limit=${BATCH_SIZE}`
    );

    if (response.status !== 'success' || !Array.isArray(response.data) || response.data.length === 0) {
      break;
    }

    allLeads.push(...response.data);
    console.log(`  Fetched page ${page} (${response.data.length} leads, ${allLeads.length} total)`);

    hasMore = response.metadata?.hasMore === true || response.data.length === BATCH_SIZE;
    page++;
  }

  return allLeads;
}

// ---------------------------------------------------------------------------
// Update a single lead
// ---------------------------------------------------------------------------
async function updateLead(id, fields) {
  return apiPut(`/update/leads/${id}?Instance=${INSTANCE}`, fields);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Phone Number Migration ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY (will update records)'}`);
  console.log('');

  // 1. Fetch all leads
  console.log('Fetching all leads...');
  const leads = await fetchAllLeads();
  console.log(`Total leads fetched: ${leads.length}\n`);

  // 2. Identify leads that need fixing
  const fixes = [];

  for (const lead of leads) {
    const rawPhone = (lead.phone || '').trim();
    if (!rawPhone) continue; // no phone, skip

    // Run through the updated normalizer
    const validation = validatePhone(rawPhone, false);
    const newPhone = validation.valid && validation.normalized ? validation.normalized : null;

    if (!newPhone) continue; // couldn't normalize, skip

    // Compare: does the new normalization differ from what's stored?
    if (newPhone !== rawPhone) {
      fixes.push({
        id: lead.id,
        workspace_id: lead.workspace_id,
        name: lead.name || '',
        email: lead.email || '',
        oldPhone: rawPhone,
        newPhone,
        oldPhoneValid: lead.phone_valid,
      });
    }
  }

  console.log(`Leads that need phone number fixes: ${fixes.length}`);
  if (fixes.length === 0) {
    console.log('Nothing to fix. All phone numbers are already correct.');
    return;
  }

  // 3. Print summary table
  console.log('');
  console.log('ID'.padEnd(8) + 'WS'.padEnd(6) + 'Name'.padEnd(25) + 'Old Phone'.padEnd(20) + 'New Phone'.padEnd(20) + 'Valid');
  console.log('-'.repeat(99));

  for (const fix of fixes) {
    console.log(
      String(fix.id).padEnd(8) +
      String(fix.workspace_id).padEnd(6) +
      fix.name.substring(0, 23).padEnd(25) +
      fix.oldPhone.padEnd(20) +
      fix.newPhone.padEnd(20) +
      String(fix.oldPhoneValid ?? '?')
    );
  }

  console.log('');

  // 4. Apply fixes (or just report in dry-run mode)
  if (DRY_RUN) {
    console.log(`DRY RUN complete. ${fixes.length} leads would be updated.`);
    console.log('Run with --apply to actually update records:');
    console.log('  node scripts/fix-phone-numbers.js --apply');
    return;
  }

  console.log(`Applying ${fixes.length} fixes...`);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    try {
      const result = await updateLead(fix.id, {
        phone: fix.newPhone,
        phone_valid: 1,
      });

      if (result.status === 'success' || result.message === 'Record updated successfully' || result.error === 'Record updated successfully') {
        successCount++;
      } else {
        console.error(`  FAIL lead ${fix.id}: ${result.message || result.error || JSON.stringify(result)}`);
        errorCount++;
      }
    } catch (err) {
      console.error(`  ERROR lead ${fix.id}: ${err.message}`);
      errorCount++;
    }

    // Progress every 25 records
    if ((i + 1) % 25 === 0 || i === fixes.length - 1) {
      console.log(`  Progress: ${i + 1}/${fixes.length} (${successCount} ok, ${errorCount} errors)`);
    }
  }

  console.log('');
  console.log('=== Migration Complete ===');
  console.log(`  Updated: ${successCount}`);
  console.log(`  Errors:  ${errorCount}`);
  console.log(`  Total:   ${fixes.length}`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
