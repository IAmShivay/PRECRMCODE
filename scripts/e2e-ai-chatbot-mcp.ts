import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  console.log('[E2E] Registering test user and workspace...');
  const email = `mcp_playwright_${Date.now()}@example.com`;
  const regRes = await fetch('http://localhost:3006/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'MCP Automation User',
      email,
      password: 'Password123!',
      accepted_terms: 1,
      accepted_terms_at: new Date().toISOString(),
    }),
  });
  const regJson = await regRes.json();
  const token = regJson.data.token;
  const user = regJson.data.user;

  const wsRes = await fetch('http://localhost:3006/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'AI & MCP Workspace',
      owner_id: user.id,
      currency: 'USD',
    }),
  });
  const wsJson = await wsRes.json();
  const workspaceId = wsJson.id || wsJson.data?.id;
  const workspace = { id: workspaceId, name: 'AI & MCP Workspace', owner_id: user.id, currency: 'USD' };

  console.log('[E2E] Created workspace ID:', workspace.id);

  const videoDir = path.resolve('playwright-videos');
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  await page.addInitScript(
    ({ t, u, w }) => {
      localStorage.setItem('scraft_auth_token', t);
      localStorage.setItem('scraft_user', JSON.stringify(u));
      localStorage.setItem('scraft_current_workspace', JSON.stringify(w));
      localStorage.setItem('scraft_workspaces', JSON.stringify([w]));
    },
    { t: token, u: user, w: workspace }
  );

  console.log('[E2E] Navigating to Dashboard...');
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  console.log('[E2E] Verifying floating AI Chatbot button...');
  const chatButton = page.locator('button[title="Open Scraft AI Assistant"]');
  await chatButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);
  await chatButton.click();

  console.log('[E2E] AI Assistant window opened. Waiting for welcome message...');
  await page.waitForSelector('text=Scraft AI Assistant', { timeout: 10000 });
  await page.waitForTimeout(1500);

  console.log('[E2E] Clicking quick prompt: "Show pipeline summary"...');
  const promptBtn = page.locator('button:has-text("Show pipeline summary")');
  await promptBtn.click();
  await page.waitForTimeout(5000);

  console.log('[E2E] Typing custom query in chat textarea...');
  const textarea = page.locator('textarea[placeholder*="Ask about deals"]');
  await textarea.fill('What tools and actions do you support?');
  await page.waitForTimeout(1000);
  const sendBtn = page.locator('button:has(svg.h-4.w-4)');
  await sendBtn.last().click();
  await page.waitForTimeout(5000);

  console.log('[E2E] Navigating to MCP Settings Page...');
  await page.goto('http://localhost:3000/settings/mcp', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Model Context Protocol (MCP) Connector', { timeout: 10000 });
  await page.waitForTimeout(1500);

  console.log('[E2E] Generating a new MCP Token...');
  const tokenInput = page.locator('input[placeholder*="Claude Desktop"]');
  await tokenInput.fill('Claude Desktop Macbook Pro');
  await page.waitForTimeout(800);
  const genBtn = page.locator('button:has-text("Generate MCP Token")');
  await genBtn.click();

  await page.waitForSelector('text=Token Generated Successfully!', { timeout: 10000 });
  await page.waitForTimeout(2000);

  console.log('[E2E] Verifying active tokens table and MCP tools grid...');
  await page.waitForSelector('text=Active Workspace MCP Tokens');
  await page.waitForSelector('text=Available MCP Tools & Actions');
  await page.waitForTimeout(2500);

  console.log('[E2E] Closing browser and saving video recording...');
  await page.close();
  await context.close();
  await browser.close();

  const videoFiles = fs
    .readdirSync(videoDir)
    .filter((f) => f.endsWith('.webm') && f.startsWith('page@'))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(videoDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (videoFiles.length > 0) {
    const latestVideo = path.join(videoDir, videoFiles[0]!.name);
    const targetVideo = path.join(videoDir, 'ai-chatbot-mcp-e2e.webm');
    fs.copyFileSync(latestVideo, targetVideo);
    console.log('[E2E] Video saved to:', targetVideo);

    const artifactDir = 'C:\\Users\\USER\\.gemini\\antigravity-cli\\brain\\3a75232d-0467-4638-a0f7-9e25481e27a1';
    if (fs.existsSync(artifactDir)) {
      const artifactVideo = path.join(artifactDir, 'ai-chatbot-mcp-e2e.webm');
      fs.copyFileSync(latestVideo, artifactVideo);
      console.log('[E2E] Video copied to artifact directory:', artifactVideo);
    }
  }

  console.log('[E2E] Test and video generation complete!');
}

run().catch((err) => {
  console.error('[E2E Error]', err);
  process.exit(1);
});
