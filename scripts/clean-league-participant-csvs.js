#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = path.join('data_exports', 'league-decision-task', 'participant_csvs');
const DEFAULT_OUTPUT = path.join('data_exports', 'league-decision-task', 'cleaned');
const EXPECTED_FULL_ROWS = 5;

function usage() {
  console.log(`Usage:
  node scripts/clean-league-participant-csvs.js [input-dir] [output-dir]

Defaults:
  input-dir:  ${DEFAULT_INPUT}
  output-dir: ${DEFAULT_OUTPUT}

Outputs:
  league_decision_trials_full.csv      Rows from participants with exactly 5 data rows.
  league_decision_trials_partial.csv   Rows from participants with 1-4 data rows.
  league_decision_trials_nonempty.csv  Full + partial rows.
  participant_qc.csv                   One QC row per participant CSV.
  cleaning_summary.json                Counts and output paths.`);
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }

  return {
    inputDir: argv[0] || DEFAULT_INPUT,
    outputDir: argv[1] || DEFAULT_OUTPUT
  };
}

function parseDelimitedLine(line, delimiter = ',') {
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

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  if (lines.length === 0) {
    return { header: [], rows: [] };
  }

  const header = parseDelimitedLine(lines[0], ',');
  const rows = lines.slice(1).map((line, index) => {
    const values = parseDelimitedLine(line, ',');
    return {
      lineNumber: index + 2,
      values,
      row: Object.fromEntries(header.map((key, columnIndex) => [key, values[columnIndex] ?? '']))
    };
  });

  return { header, rows };
}

function csvEscape(value) {
  const text = String(value ?? '').replace(/\r?\n/g, '\\n');
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

function participantIdFromFilename(file) {
  return path.basename(file, '.csv');
}

function classifyParticipant(dataRows) {
  if (dataRows === EXPECTED_FULL_ROWS) return 'full';
  if (dataRows > 0 && dataRows < EXPECTED_FULL_ROWS) return 'partial';
  if (dataRows > EXPECTED_FULL_ROWS) return 'overcomplete';
  return 'empty';
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clean({ inputDir, outputDir }) {
  const resolvedInput = path.resolve(inputDir);
  const resolvedOutput = path.resolve(outputDir);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input directory not found: ${resolvedInput}`);
  }

  const files = fs.readdirSync(resolvedInput)
    .filter((file) => file.endsWith('.csv'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No CSV files found in ${resolvedInput}`);
  }

  let canonicalHeader = null;
  const qcRows = [];
  const fullRows = [];
  const partialRows = [];
  const nonemptyRows = [];

  for (const file of files) {
    const fullPath = path.join(resolvedInput, file);
    const text = fs.readFileSync(fullPath, 'utf8');
    const parsed = parseCsv(text);
    const participantFileId = participantIdFromFilename(file);
    const dataRows = parsed.rows.length;
    const status = classifyParticipant(dataRows);
    const headerMatches = canonicalHeader === null || sameArray(canonicalHeader, parsed.header);

    if (canonicalHeader === null) {
      canonicalHeader = parsed.header;
    }

    qcRows.push({
      participant_file: file,
      participant_id_from_file: participantFileId,
      status,
      data_rows: dataRows,
      expected_full_rows: EXPECTED_FULL_ROWS,
      header_columns: parsed.header.length,
      header_matches_canonical: headerMatches ? 'yes' : 'no',
      bytes: fs.statSync(fullPath).size,
      source_modified_at: fs.statSync(fullPath).mtime.toISOString()
    });

    const cleanedRows = parsed.rows.map((entry, index) => {
      const workerId = entry.row.worker_id || participantFileId;
      return {
        participant_file: file,
        participant_id_from_file: participantFileId,
        participant_id: workerId,
        participant_status: status,
        participant_data_rows: dataRows,
        row_index_within_participant: index + 1,
        source_line_number: entry.lineNumber,
        ...entry.row
      };
    });

    if (status === 'full') {
      fullRows.push(...cleanedRows);
    } else if (status === 'partial') {
      partialRows.push(...cleanedRows);
    }

    if (status !== 'empty') {
      nonemptyRows.push(...cleanedRows);
    }
  }

  const baseHeaders = [
    'participant_file',
    'participant_id_from_file',
    'participant_id',
    'participant_status',
    'participant_data_rows',
    'row_index_within_participant',
    'source_line_number',
    ...canonicalHeader
  ];
  const qcHeaders = [
    'participant_file',
    'participant_id_from_file',
    'status',
    'data_rows',
    'expected_full_rows',
    'header_columns',
    'header_matches_canonical',
    'bytes',
    'source_modified_at'
  ];

  const outputs = {
    full: path.join(resolvedOutput, 'league_decision_trials_full.csv'),
    partial: path.join(resolvedOutput, 'league_decision_trials_partial.csv'),
    nonempty: path.join(resolvedOutput, 'league_decision_trials_nonempty.csv'),
    qc: path.join(resolvedOutput, 'participant_qc.csv'),
    summary: path.join(resolvedOutput, 'cleaning_summary.json')
  };

  writeCsv(outputs.full, baseHeaders, fullRows);
  writeCsv(outputs.partial, baseHeaders, partialRows);
  writeCsv(outputs.nonempty, baseHeaders, nonemptyRows);
  writeCsv(outputs.qc, qcHeaders, qcRows);

  const summary = {
    generated_at: new Date().toISOString(),
    input_dir: resolvedInput,
    output_dir: resolvedOutput,
    expected_full_rows: EXPECTED_FULL_ROWS,
    participant_csvs: files.length,
    full_participants: qcRows.filter((row) => row.status === 'full').length,
    partial_participants: qcRows.filter((row) => row.status === 'partial').length,
    empty_participants: qcRows.filter((row) => row.status === 'empty').length,
    overcomplete_participants: qcRows.filter((row) => row.status === 'overcomplete').length,
    full_rows: fullRows.length,
    partial_rows: partialRows.length,
    nonempty_rows: nonemptyRows.length,
    header_mismatch_files: qcRows
      .filter((row) => row.header_matches_canonical !== 'yes')
      .map((row) => row.participant_file),
    outputs
  };

  fs.writeFileSync(outputs.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

try {
  clean(parseArgs(process.argv.slice(2)));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
