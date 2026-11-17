import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const timestamp = Date.now();
  const email = `playwright_e2e_${timestamp}@example.com`;
  const password = 'Password123!';

  const signRes = await fetch('http://localhost:3006/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Playwright Demo',
      email,
      password,
      accepted_terms: 1,
      accepted_terms_at: new Date().toISOString()
    })
  });
  const signData = await signRes.json();
  const token = signData.data.token;
  const user = signData.data.user;

  const wsRes = await fetch('http://localhost:3006/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ name: 'Enterprise CRM Workspace', owner_id: user.id, currency: 'INR' })
  });
  const wsData = await wsRes.json();
  const workspaceId = wsData.id;

  const workspaces = [
    { id: workspaceId, name: 'Enterprise CRM Workspace', owner_id: user.id, currency: 'INR' }
  ];

  const videoDir = path.resolve(process.cwd(), 'playwright-videos');
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    slowMo: 150,
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
  });

  await context.addInitScript(({ user, token, workspaces, currentWorkspaceId }) => {
    const authSession = {
      user,
      workspaces,
      currentWorkspaceId
    };
    localStorage.setItem('scraft_session', JSON.stringify(authSession));
    localStorage.setItem('scraft_user', JSON.stringify(user));
    localStorage.setItem('scraft_auth_token', token);
    localStorage.setItem('scraft_workspaces', JSON.stringify(workspaces));
    localStorage.setItem('scraft_current_workspace', String(currentWorkspaceId));
  }, { user, token, workspaces, currentWorkspaceId: workspaceId });

  const page = await context.newPage();

  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const settingsLink = page.locator('a[href="/settings"]');
  if (await settingsLink.isVisible()) {
    await settingsLink.click();
  } else {
    await page.goto('http://localhost:3000/settings', { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2000);

  const dealsTab = page.locator('button', { hasText: /^Deals$/ });
  await dealsTab.waitFor({ state: 'visible', timeout: 15000 });
  await dealsTab.click();
  await page.waitForTimeout(2000);

  const addExistingSelect = page.locator('select', { hasText: '+ Add existing field...' }).first();
  await addExistingSelect.waitFor({ state: 'visible', timeout: 15000 });
  await addExistingSelect.selectOption('std_expected_close_date');
  await page.waitForTimeout(1500);

  const proposalCheckbox = page.locator('input[type="checkbox"][aria-label*="Expected Close Date required in Proposal"]').first();
  await proposalCheckbox.waitFor({ state: 'visible', timeout: 10000 });
  await proposalCheckbox.check();
  await page.waitForTimeout(1000);

  await addExistingSelect.selectOption('std_value');
  await page.waitForTimeout(1500);

  const wonCheckbox = page.locator('input[type="checkbox"][aria-label*="Deal Value required in Won"]').first();
  await wonCheckbox.waitFor({ state: 'visible', timeout: 10000 });
  await wonCheckbox.check();
  await page.waitForTimeout(1500);

  const saveSettingsBtn = page.locator('button', { hasText: 'Save pipeline settings' });
  await saveSettingsBtn.click();
  await page.waitForTimeout(3000);

  const dealsNavLink = page.locator('a[href="/deals"]');
  if (await dealsNavLink.isVisible()) {
    await dealsNavLink.click();
  } else {
    await page.goto('http://localhost:3000/deals', { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(3000);

  const newDealBtn = page.locator('button', { hasText: 'New Deal' }).first();
  await newDealBtn.waitFor({ state: 'visible', timeout: 15000 });
  await newDealBtn.click();
  await page.waitForTimeout(1500);

  await page.fill('input[placeholder="Enter deal name"]', 'Enterprise AI Contract');
  await page.waitForTimeout(600);
  await page.fill('input[placeholder="e.g. Tirth (phone)"]', 'John Doe (VP Tech)');
  await page.waitForTimeout(600);
  await page.fill('input[inputmode="numeric"]', '85000');
  await page.waitForTimeout(600);

  const createDealBtn = page.locator('button', { hasText: 'Create deal' });
  await createDealBtn.click();
  await page.waitForTimeout(3000);

  const moveMenuBtn = page.locator('button[title="More actions"]').first();
  await moveMenuBtn.waitFor({ state: 'visible', timeout: 10000 });
  await moveMenuBtn.click();
  await page.waitForTimeout(1000);

  const proposalStageBtn = page.locator('button', { hasText: 'Proposal' }).last();
  await proposalStageBtn.click();
  await page.waitForTimeout(2000);

  const dateInput = page.locator('input[type="date"]').first();
  await dateInput.waitFor({ state: 'visible', timeout: 10000 });
  await dateInput.fill('2026-12-15');
  await page.waitForTimeout(1500);

  const saveAndMoveBtn = page.locator('button', { hasText: /Save & Move to/i });
  await saveAndMoveBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveAndMoveBtn.click();
  await page.waitForTimeout(3000);

  const moveMenuBtn2 = page.locator('button[title="More actions"]').first();
  await moveMenuBtn2.waitFor({ state: 'visible', timeout: 10000 });
  await moveMenuBtn2.click();
  await page.waitForTimeout(1000);

  const wonStageBtn = page.locator('button', { hasText: 'Won' }).last();
  await wonStageBtn.click();
  await page.waitForTimeout(3500);

  const pageVideo = page.video();
  const tempVideoPath = await pageVideo.path();

  await page.close();
  await context.close();
  await browser.close();

  const finalVideoPath = path.join(videoDir, 'deal-stage-requirements-e2e.webm');
  if (fs.existsSync(tempVideoPath)) {
    fs.copyFileSync(tempVideoPath, finalVideoPath);
    const stats = fs.statSync(finalVideoPath);
    console.log('SUCCESS_VIDEO_GENERATED');
    console.log('FINAL_VIDEO_PATH=' + finalVideoPath);
    console.log('VIDEO_SIZE_BYTES=' + stats.size);
  } else {
    throw new Error('Video file not found at ' + tempVideoPath);
  }
}

main().catch((err) => {
  console.error('Playwright E2E failed:', err);
  process.exit(1);
});
