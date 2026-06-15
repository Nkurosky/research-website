const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://nathankurosky.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(env)
    }
  });
}

function safePathSegment(value, fallback) {
  const cleaned = String(value || fallback || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  return cleaned || fallback;
}

function requestOriginIsAllowed(request, env) {
  const origin = request.headers.get('Origin');
  return origin === (env.ALLOWED_ORIGIN || 'https://nathankurosky.com');
}

async function readJsonRequest(request, env) {
  const maxBytes = Number(env.MAX_BODY_BYTES || 1048576);
  const contentLength = Number(request.headers.get('Content-Length') || 0);

  if (contentLength && contentLength > maxBytes) {
    throw new Error('payload_too_large');
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    throw new Error('payload_too_large');
  }

  return JSON.parse(text);
}

function validatePayload(payload, env) {
  const expectedStudySlug = env.STUDY_SLUG || 'league-decision-task';

  if (!payload || typeof payload !== 'object') {
    throw new Error('invalid_payload');
  }

  if (payload.study_slug !== expectedStudySlug) {
    throw new Error('invalid_study');
  }

  if (!payload.participant_id || typeof payload.participant_id !== 'string') {
    throw new Error('missing_participant_id');
  }

  if (!Number.isFinite(Number(payload.sequence))) {
    throw new Error('missing_sequence');
  }
}

function objectKey(payload) {
  const study = safePathSegment(payload.study_slug, 'study');
  const participant = safePathSegment(payload.participant_id, 'participant');
  const sequence = String(Number(payload.sequence) || 0).padStart(6, '0');
  const reason = safePathSegment(payload.reason, 'autosave');
  const savedAt = safePathSegment(payload.saved_at || new Date().toISOString(), 'received');

  return `${study}/${participant}/${sequence}-${reason}-${savedAt}.json`;
}

function participantCsvKey(payload) {
  const study = safePathSegment(payload.study_slug, 'study');
  const participant = safePathSegment(payload.participant_id, 'participant');

  return `${study}/single-files/${participant}.csv`;
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

function csvEscape(value) {
  const text = String(value ?? '').replace(/\r?\n/g, '\\n');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function tsvToCsv(tsv) {
  return String(tsv || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => parseDelimitedLine(line, '\t').map(csvEscape).join(','))
    .join('\n') + '\n';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env)
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, env);
    }

    if (!requestOriginIsAllowed(request, env)) {
      return jsonResponse({ ok: false, error: 'forbidden_origin' }, 403, env);
    }

    try {
      const payload = await readJsonRequest(request, env);
      validatePayload(payload, env);

      const key = objectKey(payload);
      const participantCsv = tsvToCsv(payload.decision_tsv);
      const csvKey = participantCsvKey(payload);
      const metadata = {
        study_slug: payload.study_slug,
        participant_id: safePathSegment(payload.participant_id, 'participant'),
        reason: safePathSegment(payload.reason, 'autosave'),
        sequence: String(payload.sequence)
      };

      await env.STUDY_DATA.put(key, JSON.stringify({
        received_at: new Date().toISOString(),
        cf_ray: request.headers.get('CF-Ray') || '',
        country: request.cf?.country || '',
        payload
      }, null, 2), {
        metadata
      });

      await env.STUDY_DATA.put(csvKey, participantCsv, {
        metadata: {
          ...metadata,
          content_type: 'text/csv',
          updated_at: new Date().toISOString()
        }
      });

      return jsonResponse({ ok: true, csv_key: csvKey }, 201, env);
    } catch (err) {
      const message = err?.message || 'save_failed';
      const status = message === 'payload_too_large' ? 413 : 400;
      return jsonResponse({ ok: false, error: message }, status, env);
    }
  }
};
