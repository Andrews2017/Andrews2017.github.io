/* Paste into a standalone Google Apps Script project. See analytics/README.md. */
const SETTINGS = Object.freeze({
  recipient: 'niyongabor.andre@gmail.com',
  site: 'https://andrews2017.github.io',
  timezone: 'America/New_York',
  maxEventsPerDay: 1000,
  maxTestEmailsPerDay: 3,
  retentionDays: 30,
  pages: ['/', '/index.html', '/publications.html', '/awards.html', '/reviewing.html', '/talks.html']
});
const HEADERS = ['Received at', 'Report date', 'Event ID', 'Session ID', 'Page', 'Referrer host', 'City', 'Region', 'Country', 'Mode'];

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) {
    const book = SpreadsheetApp.create('Website visitor summaries');
    book.setSpreadsheetTimeZone(SETTINGS.timezone);
    book.getSheets()[0].setName('Visits').appendRow(HEADERS);
    book.insertSheet('Tests').appendRow(HEADERS);
    book.getSheets().forEach(function(sheet) { sheet.getRange('A:J').setNumberFormat('@'); });
    props.setProperty('SPREADSHEET_ID', book.getId());
  }
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailySummary') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1)
    .atHour(8).nearMinute(0).inTimezone(SETTINGS.timezone).create();
  console.log('Private results: ' + SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')).getUrl());
  console.log('Daily summaries will be sent to ' + SETTINGS.recipient + ' around 8 a.m. ' + SETTINGS.timezone);
}

function enableSessionTests() {
  const token = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    TEST_TOKEN: token,
    TEST_UNTIL: String(Date.now() + 60 * 60 * 1000)
  });
  console.log('Test token (valid for one hour; paste only into the local test page): ' + token);
}

function disableSessionTests() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('TEST_TOKEN');
  props.deleteProperty('TEST_UNTIL');
}

function doGet() {
  return json_({ok: true, service: 'Website visit collector'});
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 2048) return json_({ok: false, error: 'Invalid request'});
    const event = validateEvent_(JSON.parse(raw));
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return json_({ok: false, error: 'Busy; try later'});
    try {
      const now = new Date();
      const day = day_(now);
      const props = PropertiesService.getScriptProperties();
      const test = event.mode === 'session-test';
      if (test && (!props.getProperty('TEST_TOKEN') ||
          event.testToken !== props.getProperty('TEST_TOKEN') ||
          Number(props.getProperty('TEST_UNTIL')) < now.getTime())) {
        return json_({ok: false, error: 'Session tests are disabled or token is invalid'});
      }
      const sheet = sheet_(test ? 'Tests' : 'Visits');
      const rows = recentRows_(sheet).filter(function(row) { return String(row[1]) === day; });
      if (rows.some(function(row) { return row[2] === event.eventId || (test && row[3] === event.sessionId); })) {
        return json_({ok: true, duplicate: true});
      }
      const limit = test ? SETTINGS.maxTestEmailsPerDay : SETTINGS.maxEventsPerDay;
      if (rows.length >= limit) return json_({ok: false, error: 'Daily limit reached'});
      if (test && MailApp.getRemainingDailyQuota() < 2) return json_({ok: false, error: 'Email quota reserved for summary'});
      const row = [now.toISOString(), day, event.eventId, event.sessionId, event.page,
        event.referrer, event.city, event.region, event.country, event.mode];
      // Record before mailing: failures remain visible and cannot cause a retry email flood.
      sheet.appendRow(row);
      if (test) {
        MailApp.sendEmail({to: SETTINGS.recipient, subject: '[TEST] Website session received',
          body: 'The browser-to-Apps-Script session test was received.\n\n' +
            'Time: ' + row[0] + '\nPage: ' + event.page + '\nApproximate location: ' + location_(row) +
            '\nSession: ' + event.sessionId + '\n\nTest traffic is excluded from daily summaries.'});
      }
      return json_({ok: true});
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error('Visit collection failed: ' + error.message);
    return json_({ok: false, error: 'Request could not be recorded; check Apps Script executions'});
  }
}

function validateEvent_(input) {
  if (!input || input.site !== SETTINGS.site || !SETTINGS.pages.includes(input.page) ||
      !['visit', 'session-test'].includes(input.mode)) throw new Error('Invalid event');
  const id = /^[a-zA-Z0-9][a-zA-Z0-9-]{15,79}$/;
  if (typeof input.eventId !== 'string' || typeof input.sessionId !== 'string' ||
      !id.test(input.eventId) || !id.test(input.sessionId)) throw new Error('Invalid ID');
  const result = {eventId: input.eventId, sessionId: input.sessionId,
    page: input.page === '/' ? '/index.html' : input.page, mode: input.mode, testToken: input.testToken};
  ['city', 'region', 'country'].forEach(function(field) { result[field] = clean_(input[field]); });
  result.referrer = /^[a-zA-Z0-9.-]{1,100}$/.test(input.referrer || '') ? input.referrer : 'Direct / unknown';
  return result;
}

function clean_(value) {
  // Plain text only; prevent formulas in the private Google Sheet.
  if (typeof value !== 'string') return 'Unknown';
  const text = value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80);
  return !text || /^[=+@-]/.test(text) ? 'Unknown' : text;
}

function day_(date) { return Utilities.formatDate(date, SETTINGS.timezone, 'yyyy-MM-dd'); }
function previousDay_(date) {
  const today = day_(date).split('-').map(Number);
  return new Date(Date.UTC(today[0], today[1] - 1, today[2] - 1)).toISOString().slice(0, 10);
}
function sheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup first');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}
function recentRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - SETTINGS.maxEventsPerDay + 1);
  return sheet.getRange(start, 1, last - start + 1, HEADERS.length).getDisplayValues();
}
function location_(row) {
  const parts = [row[6], row[7], row[8]].filter(function(value) { return value && value !== 'Unknown'; });
  return parts.length ? parts.join(', ') : 'Unknown';
}
function rank_(counts) {
  return Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
    .slice(0, 20).map(function(key) { return '  ' + key + ': ' + counts[key]; }).join('\n') || '  None';
}
function summary_(rows, date) {
  const visits = rows.filter(function(row) { return String(row[1]) === date && row[9] === 'visit'; });
  const sessions = new Map();
  const pages = Object.create(null), locations = Object.create(null), referrers = Object.create(null);
  visits.forEach(function(row) {
    pages[row[4]] = (pages[row[4]] || 0) + 1;
    if (!sessions.has(row[3])) sessions.set(row[3], row.slice());
    else if (location_(sessions.get(row[3])) === 'Unknown') {
      const first = sessions.get(row[3]);
      first[6] = row[6]; first[7] = row[7]; first[8] = row[8];
    }
  });
  sessions.forEach(function(row) {
    const place = location_(row);
    locations[place] = (locations[place] || 0) + 1;
    referrers[row[5]] = (referrers[row[5]] || 0) + 1;
  });
  return 'Website summary for ' + date + ' (' + SETTINGS.timezone + ')\n' + SETTINGS.site +
    '\n\nTracked sessions: ' + sessions.size + '\nTracked page loads: ' + visits.length +
    (visits.length >= SETTINGS.maxEventsPerDay ? '\nDaily collection cap reached; counts may be incomplete.' : '') +
    '\n\nPages (page loads, top 20)\n' + rank_(pages) +
    '\n\nApproximate locations (sessions, top 20)\n' + rank_(locations) +
    '\n\nReferrer hosts (sessions, top 20)\n' + rank_(referrers) +
    '\n\nSessions are browser-tab sessions with a 30-minute gap between page loads, not unique people. ' +
    'Locations are approximate IP-based estimates, may reflect VPNs, and are supplied by the browser. ' +
    'Blocked tracking, failed requests, bots, or forged events can affect counts. No IP addresses are stored by this app.';
}

function sendDailySummary() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const date = previousDay_(now);
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('LAST_SUMMARY') === date) return;
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('No email quota remaining');
    const sheet = sheet_('Visits');
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getDisplayValues() : [];
    MailApp.sendEmail({to: SETTINGS.recipient, subject: 'Website daily summary — ' + date,
      body: summary_(rows, date)});
    props.setProperty('LAST_SUMMARY', date);
    const cutoff = day_(new Date(now.getTime() - SETTINGS.retentionDays * 86400000));
    [sheet, sheet_('Tests')].forEach(function(s) {
      if (s.getLastRow() < 2) return;
      const dates = s.getRange(2, 2, s.getLastRow() - 1, 1).getDisplayValues();
      let count = 0;
      while (count < dates.length && String(dates[count][0]) < cutoff) count++;
      if (count) s.deleteRows(2, count);
    });
  } finally {
    lock.releaseLock();
  }
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
