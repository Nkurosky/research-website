#!/usr/bin/env node

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKER_CONFIG = path.join(REPO_ROOT, 'workers', 'league-study-data-collector', 'wrangler.jsonc');
const WORKER_DIR = path.dirname(WORKER_CONFIG);
const EXPORT_ROOT = path.join(REPO_ROOT, 'data_exports', 'league-decision-task');
const STUDY_PREFIX = 'league-decision-task/';

function usage() {
  console.log(`Usage:
  node scripts/pull-league-study-data.js [--all-saves] [--skip-csv]

What it does:
  1. Lists private Cloudflare KV records using your local Wrangler login.
  2. Downloads matching JSON submissions into ignored data_exports/.
  3. Builds CSVs with scripts/export-league-study-csv.js.

By default it downloads only final_submit records to avoid duplicate autosave rows.`);
}

function parseArgs(argv) {
  const args = {
    includeAllSaves: false,
    skipCsv: false
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--all-saves') {
      args.includeAllSaves = true;
      continue;
    }
    if (arg === '--skip-csv') {
      args.skipCsv = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

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

function listKeys(includeAllSaves) {
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
    STUDY_PREFIX
  ]);

  return parseWranglerJson(stdout)
    .map((entry) => entry.name)
    .filter((name) => includeAllSaves || name.includes('final_submit'))
    .sort();
}

function localFileForKey(key) {
  const parts = key.split('/');
  const filename = parts.pop();
  const participant = parts.pop() || 'unknown-participant';
  return path.join(EXPORT_ROOT, participant, filename);
}

function downloadKey(key) {
  const value = runWrangler([
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

  const file = localFileForKey(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value.replace(/^\uFEFF/, ''), 'utf8');
  return file;
}

function runCsvExport() {
  const command = process.execPath;
  execFileSync(command, [path.join(REPO_ROOT, 'scripts', 'export-league-study-csv.js')], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const keys = listKeys(args.includeAllSaves);

  if (keys.length === 0) {
    console.log('No matching Cloudflare KV submissions found.');
    return;
  }

  const files = keys.map(downloadKey);

  console.log(`Downloaded ${files.length} submission file(s) into ${EXPORT_ROOT}`);

  if (!args.skipCsv) {
    runCsvExport();
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
