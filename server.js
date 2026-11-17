#!/usr/bin/env node
// Entry point for Coolify - runs TypeScript server using tsx
// This file allows Coolify to find server.js while we use TypeScript

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use tsx to run the TypeScript server
const tsxPath = join(__dirname, 'node_modules', '.bin', 'tsx');
const serverPath = join(__dirname, 'server.ts');

const child = spawn('node', [tsxPath, serverPath], {
  stdio: 'inherit',
  cwd: __dirname,
  shell: process.platform === 'win32'
});

// Forward signals to child process
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

child.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code || 0);
  }
});
