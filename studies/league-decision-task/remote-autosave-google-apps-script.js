/*
 * Google Apps Script receiver for the League Decision Study.
 *
 * Deploy this as a Web App from a Google Sheet:
 *   1. Create a Google Sheet for study submissions.
 *   2. Extensions > Apps Script.
 *   3. Paste this file into Code.gs.
 *   4. Optional: set ACCESS_TOKEN to a random string and use the same value in index.html.
 *   5. Deploy > New deployment > Web app.
 *   6. Execute as: Me. Who has access: Anyone.
 *   7. Put the Web App URL into remoteAutosaveUrl in index.html.
 *
 * Each autosave is written as a JSON file in Drive, with a compact index row
 * in the active Google Sheet. This avoids Google Sheets cell-size limits.
 */

const ACCESS_TOKEN = '';
const DRIVE_FOLDER_ID = '';
const SHEET_NAME = 'Autosaves';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');

    if (ACCESS_TOKEN && payload.access_token !== ACCESS_TOKEN) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 403);
    }

    const receivedAt = new Date();
    const sheet = getAutosaveSheet();
    const folder = getDestinationFolder();
    const filename = [
      safeName(payload.study_slug || 'study'),
      safeName(payload.participant_id || 'participant'),
      String(payload.sequence || '0').padStart(5, '0'),
      safeName(payload.reason || 'autosave')
    ].join('_') + '.json';

    const file = folder.createFile(
      filename,
      JSON.stringify(payload, null, 2),
      MimeType.PLAIN_TEXT
    );

    sheet.appendRow([
      receivedAt,
      payload.study_slug || '',
      payload.participant_id || '',
      payload.reason || '',
      payload.sequence || '',
      payload.saved_at || '',
      payload.completed_rows || 0,
      payload.current_session_rows || 0,
      payload.recovered_previous_rows || 0,
      filename,
      file.getUrl()
    ]);

    return jsonResponse({ ok: true, file_url: file.getUrl() });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) }, 500);
  }
}

function getAutosaveSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'received_at',
      'study_slug',
      'participant_id',
      'reason',
      'sequence',
      'saved_at',
      'completed_rows',
      'current_session_rows',
      'recovered_previous_rows',
      'filename',
      'file_url'
    ]);
  }

  return sheet;
}

function getDestinationFolder() {
  if (DRIVE_FOLDER_ID) {
    return DriveApp.getFolderById(DRIVE_FOLDER_ID);
  }

  return DriveApp.getRootFolder();
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
