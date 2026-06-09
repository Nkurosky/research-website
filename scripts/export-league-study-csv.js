#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = path.join('data_exports', 'league-decision-task');
const DEFAULT_OUTPUT = path.join('data_exports', 'league-decision-task', 'csv_exports');

function usage() {
  console.log(`Usage:
  node scripts/export-league-study-csv.js [input-file-or-dir] [output-dir] [--all-saves]

Defaults:
  input-file-or-dir: ${DEFAULT_INPUT}
  output-dir:        ${DEFAULT_OUTPUT}

Outputs:
  decision_trials.csv  One row per study decision/survey record from payload.decision_tsv.
  raw_events.csv       One row per raw jsPsych-style event from payload.rows.

By default, only files with "final_submit" in the filename are exported. Use
--all-saves to include autosaves too.`);
}

function parseArgs(argv) {
  const positional = [];
  let includeAllSaves = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--all-saves') {
      includeAllSaves = true;
      continue;
    }
    positional.push(arg);
  }

  return {
    inputPath: positional[0] || DEFAULT_INPUT,
    outputDir: positional[1] || DEFAULT_OUTPUT,
    includeAllSaves
  };
}

function walkJsonFiles(inputPath) {
  const resolved = path.resolve(inputPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Input path not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return resolved.endsWith('.json') ? [resolved] : [];
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(entryPath);
      }
    }
  }
  walk(resolved);
  return files.sort();
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseTsv(tsv) {
  const lines = String(tsv || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = parseDelimitedLine(lines[0], '\t');
  const rows = lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, '\t');
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
  });

  return { header, rows };
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = (typeof value === 'string' ? value : JSON.stringify(value))
    .replace(/\r?\n/g, '\\n');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(file, headers, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function unionHeaders(rows, preferred = []) {
  const seen = new Set(preferred);
  const headers = [...preferred];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  return headers;
}

function sourceLabel(file) {
  const cwd = process.cwd();
  return path.relative(cwd, file).replace(/\\/g, '/');
}

function exportCsv({ inputPath, outputDir, includeAllSaves }) {
  const files = walkJsonFiles(inputPath).filter((file) => {
    return includeAllSaves || path.basename(file).includes('final_submit');
  });

  const decisionRows = [];
  const rawRows = [];
  let decisionHeaders = [];

  for (const file of files) {
    const submission = readJson(file);
    const payload = submission.payload || {};
    const source_file = sourceLabel(file);

    const parsed = parseTsv(payload.decision_tsv);
    if (parsed.header.length > 0 && parsed.rows.length > 0) {
      decisionHeaders = parsed.header;
      for (const row of parsed.rows) {
        decisionRows.push({
          source_file,
          received_at: submission.received_at || '',
          saved_at: payload.saved_at || '',
          participant_id: payload.participant_id || '',
          save_reason: payload.reason || '',
          save_sequence: payload.sequence ?? '',
          ...row
        });
      }
    }

    if (Array.isArray(payload.rows)) {
      for (const row of payload.rows) {
        rawRows.push({
          source_file,
          received_at: submission.received_at || '',
          saved_at: payload.saved_at || '',
          study_slug: payload.study_slug || '',
          participant_id: payload.participant_id || '',
          save_reason: payload.reason || '',
          save_sequence: payload.sequence ?? '',
          ...row
        });
      }
    }
  }

  const resolvedOutput = path.resolve(outputDir);
  const decisionFile = path.join(resolvedOutput, 'decision_trials.csv');
  const rawFile = path.join(resolvedOutput, 'raw_events.csv');

  const decisionPreferred = [
    'source_file',
    'received_at',
    'saved_at',
    'participant_id',
    'save_reason',
    'save_sequence',
    ...decisionHeaders
  ];
  const rawPreferred = [
    'source_file',
    'received_at',
    'saved_at',
    'study_slug',
    'participant_id',
    'save_reason',
    'save_sequence'
  ];

  writeCsv(decisionFile, unionHeaders(decisionRows, decisionPreferred), decisionRows);
  writeCsv(rawFile, unionHeaders(rawRows, rawPreferred), rawRows);

  console.log(`Read ${files.length} submission file(s).`);
  console.log(`Wrote ${decisionRows.length} decision row(s): ${decisionFile}`);
  console.log(`Wrote ${rawRows.length} raw event row(s): ${rawFile}`);
}

try {
  exportCsv(parseArgs(process.argv.slice(2)));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
