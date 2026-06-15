#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_CONFIG = path.join(REPO_ROOT, 'workers', 'league-study-data-collector', 'wrangler.jsonc');
const WORKER_DIR = path.dirname(WORKER_CONFIG);
const OUTPUT_DIR = path.join(REPO_ROOT, 'data_exports', 'league-decision-task', 'participant_csvs');
const CSV_PREFIX = 'league-decision-task/single-files/';

function runWrangler(args) {
  const windowsNpx = 'C:\\Program Files\\nodejs\\npx.cmd';
  const command = process.platform === 'win32' && fs.existsSync(windowsNpx) ? windowsNpx : 'npx';
  const commandLine = [command, 'wrangler', ...args]
    .map((arg) => `"${String(arg).replace(/"/g, '\\"')}"`)
    .join(' ');

  return execSync(commandLine, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function parseWranglerJson(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find JSON array in Wrangler output: ${text}`);
  }

  return JSON.parse(text.slice(start, end + 1));
}

function listCsvKeys() {
  const stdout = runWrangler([
    'kv',
    'key',
    'list',
    '--config',
    WORKER_CONFIG,
    '--binding',
    'STUDY_DATA',
    '--remote',
    '--prefix',
    CSV_PREFIX
  ]);

  return parseWranglerJson(stdout).map((entry) => entry.name).sort();
}

function downloadCsv(key) {
  const csv = runWrangler([
    'kv',
    'key',
    'get',
    key,
    '--config',
    WORKER_CONFIG,
    '--binding',
    'STUDY_DATA',
    '--remote',
    '--text'
  ]);

  const filename = path.basename(key);
  const file = path.join(OUTPUT_DIR, filename);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(file, csv.replace(/^\uFEFF/, ''), 'utf8');
  return file;
}

const keys = listCsvKeys();
if (keys.length === 0) {
  console.log('No participant CSV files found.');
  process.exit(0);
}

const files = keys.map(downloadCsv);
console.log(`Downloaded ${files.length} participant CSV file(s) into ${OUTPUT_DIR}`);
