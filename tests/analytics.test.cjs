const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const backend = fs.readFileSync('analytics/Code.gs', 'utf8');
const browserCode = fs.readFileSync('assets/visit-analytics.js', 'utf8');
const site = 'https://andrews2017.github.io';
const endpoint = 'https://script.google.com/macros/s/EXAMPLE/exec';
function payload(overrides = {}) {
  return {site, page: '/index.html', mode: 'visit', eventId: randomUUID(), sessionId: randomUUID(),
    city: 'Princeton', region: 'New Jersey', country: 'United States', referrer: 'google.com', ...overrides};
}
function server() {
  let now = new Date('2026-09-11T12:00:00Z');
  const properties = new Map([['SPREADSHEET_ID', 'private-sheet']]);
  const sheets = {};
  const sent = [], triggers = [];
  let quota = 100;
  const createSheet = name => sheets[name] = {
    rows: [Array(10).fill('header')],
    getLastRow() { return this.rows.length; },
    appendRow(row) { this.rows.push(row); return this; },
    getRange(start, col, count, width) {
      return {getDisplayValues: () => this.rows.slice(start - 1, start - 1 + count)
        .map(row => row.slice(col - 1, col - 1 + width).map(String)), setNumberFormat() {}};
    },
    deleteRows(start, count) { this.rows.splice(start - 1, count); }
  };
  createSheet('Visits'); createSheet('Tests');
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  }
  const context = vm.createContext({Date: FakeDate, console: {log() {}, error() {}},
    Utilities: {getUuid: randomUUID, formatDate(date, zone) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date).map(p => [p.type, p.value]));
      return `${p.year}-${p.month}-${p.day}`;
    }},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
      setProperties: values => Object.entries(values).forEach(([k, v]) => properties.set(k, v)),
      deleteProperty: key => properties.delete(key)
    })},
    SpreadsheetApp: {openById: () => ({getSheetByName: name => sheets[name], getUrl: () => 'private-sheet-url'})},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock() {}, releaseLock() {}})},
    MailApp: {getRemainingDailyQuota: () => quota, sendEmail: mail => {sent.push(mail); quota--; }},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(name) {
        const t = {getHandlerFunction: () => name};
        for (const method of ['timeBased', 'everyDays', 'atHour', 'nearMinute', 'inTimezone']) t[method] = () => t;
        t.create = () => triggers.push(t); return t;
      }
    }
  });
  vm.runInContext(backend, context);
  return {context, sheets, sent, properties, triggers,
    setDate: date => {now = new Date(date);}, setQuota: value => {quota = value;},
    post: event => context.doPost({postData: {contents: JSON.stringify(event)}})};
}
function storage() {
  const map = new Map();
  return {getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k)};
}
function browser(options = {}) {
  const calls = [];
  const context = vm.createContext({window: {VISIT_ANALYTICS_CONFIG: {endpoint, site, ...options.config}},
    location: {origin: options.origin || site, pathname: options.path || '/index.html'},
    navigator: options.navigator || {}, document: {referrer: 'https://www.google.com/search?q=private'},
    sessionStorage: options.storage || storage(), localStorage: options.localStorage || storage(),
    crypto: {randomUUID}, URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      calls.push({url, init});
      if (url.startsWith('https://ipwho.is/')) {
        if (options.geoFailure) throw new Error('blocked');
        return {ok: true, json: async () => ({success: true, city: 'Princeton', region: 'New Jersey', country: 'United States', ip: 'DO-NOT-STORE'})};
      }
      if (options.postFailure) throw new Error('offline');
      return {type: 'opaque'};
    }
  });
  vm.runInContext(browserCode, context);
  return {context, calls, run: () => vm.runInContext(browserCode, context), api: context.window.VisitAnalytics};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('production collector validates, deduplicates events, normalizes homepage, and never sends immediate emails', () => {
  const s = server(), p = payload({page: '/'});
  assert.equal(s.post(p).ok, true);
  assert.equal(s.post(p).duplicate, true);
  assert.equal(s.sheets.Visits.rows.length, 2);
  assert.equal(s.sheets.Visits.rows[1][4], '/index.html');
  assert.equal(s.sent.length, 0);
  for (const change of [{site: 'https://evil.example'}, {page: '/private'}, {mode: 'email'}, {sessionId: '-1234567890123456'}, {eventId: []}]) {
    assert.equal(s.post(payload(change)).ok, false);
  }
  assert.equal(s.context.doPost({postData: {contents: 'x'.repeat(2049)}}).ok, false);
  assert.equal(s.context.doPost({postData: {contents: '{invalid'}}).ok, false);
});

test('public input cannot become spreadsheet formulas or leak full referrers/IPs', () => {
  const s = server();
  s.post(payload({city: '=IMPORTXML("evil")', region: '+SUM(1)', country: '@test',
    referrer: 'https://example.com/private?q=secret', ip: '192.0.2.1'}));
  const row = s.sheets.Visits.rows[1];
  assert.deepEqual(Array.from(row.slice(6, 9)), ['Unknown', 'Unknown', 'Unknown']);
  assert.equal(row[5], 'Direct / unknown');
  assert.equal(JSON.stringify(row).includes('192.0.2.1'), false);
});

test('session tests require an unexpired private token, dedupe sessions, and enforce a three-email cap', () => {
  const s = server();
  assert.equal(s.post(payload({mode: 'session-test', testToken: 'bad'})).ok, false);
  s.context.enableSessionTests();
  const token = s.properties.get('TEST_TOKEN');
  const p = payload({mode: 'session-test', testToken: token});
  assert.equal(s.post(p).ok, true);
  assert.equal(s.post({...p, eventId: randomUUID()}).duplicate, true);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].body, /Princeton, New Jersey, United States/);
  assert.equal(s.sent[0].to, 'niyongabor.andre@gmail.com');
  s.post(payload({mode: 'session-test', testToken: token}));
  s.post(payload({mode: 'session-test', testToken: token}));
  assert.equal(s.post(payload({mode: 'session-test', testToken: token})).ok, false);
  assert.equal(s.sent.length, 3);
  assert.equal(s.sheets.Visits.rows.length, 1);
  s.setDate('2026-09-11T14:00:00Z');
  assert.equal(s.post(payload({mode: 'session-test', testToken: token})).ok, false);
  s.context.disableSessionTests();
  assert.equal(s.properties.has('TEST_TOKEN'), false);
});

test('test mode preserves quota for the scheduled summary', () => {
  const s = server(); s.context.enableSessionTests(); s.setQuota(1);
  assert.equal(s.post(payload({mode: 'session-test', testToken: s.properties.get('TEST_TOKEN')})).ok, false);
  assert.equal(s.sent.length, 0);
});

test('daily summary uses yesterday, counts sessions across pages, excludes tests, and sends once', () => {
  const s = server(), sessionId = randomUUID();
  s.setDate('2026-09-10T19:00:00Z');
  s.post(payload({sessionId, city: '', region: '', country: '', referrer: 'google.com'}));
  s.post(payload({sessionId, page: '/publications.html', referrer: ''}));
  s.post(payload({city: '', region: '', country: ''}));
  s.setDate('2026-09-11T12:00:00Z');
  s.post(payload()); // Today's traffic must not enter yesterday's email.
  s.context.sendDailySummary(); s.context.sendDailySummary();
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].subject, /2026-09-10/);
  assert.match(s.sent[0].body, /Tracked sessions: 2\nTracked page loads: 3/);
  assert.match(s.sent[0].body, /Princeton, New Jersey, United States: 1/);
  assert.match(s.sent[0].body, /Unknown: 1/);
  assert.match(s.sent[0].body, /google.com: 2/);
});

test('New York day boundaries and DST use calendar dates', () => {
  const s = server();
  for (const [time, expected] of [['2026-09-11T02:00:00Z', '2026-09-09'],
    ['2026-03-09T12:00:00Z', '2026-03-08'], ['2026-11-02T13:00:00Z', '2026-11-01']]) {
    assert.equal(s.context.previousDay_(new Date(time)), expected);
  }
});

test('collection cap resets the next day; setup does not duplicate triggers; old rows are pruned', () => {
  const s = server(); s.context.setup(); s.context.setup(); assert.equal(s.triggers.length, 1);
  const old = ['2026-07-01T12:00:00Z', '2026-07-01', 'old', 'old', '/index.html', '', '', '', '', 'visit'];
  s.sheets.Visits.rows.push(old);
  const date = '2026-09-11';
  for (let i = 0; i < 1000; i++) s.sheets.Visits.rows.push(['', date, 'id' + i, 'session' + i, '/index.html', '', '', '', '', 'visit']);
  assert.equal(s.post(payload()).ok, false);
  s.setDate('2026-09-12T12:00:00Z');
  assert.equal(s.post(payload()).ok, true);
  s.context.sendDailySummary();
  assert.match(s.sent[0].body, /Daily collection cap reached/);
  assert.equal(s.sheets.Visits.rows.some(r => r[1] === '2026-07-01'), false);
});

test('disabled config, previews, excluded pages, privacy signals and opt-out make no network calls', async () => {
  const optedOut = storage(); optedOut.setItem('andre-visit-opt-out', '1');
  for (const options of [{config: {endpoint: ''}}, {origin: 'http://localhost:8000'},
    {path: '/privacy.html'}, {navigator: {doNotTrack: '1'}}, {navigator: {globalPrivacyControl: true}}, {localStorage: optedOut}]) {
    const b = browser(options); await settle(); assert.equal(b.calls.length, 0);
  }
});

test('browser sends only coarse location and referrer host; caches location and keeps session across loads', async () => {
  const b = browser(); await settle();
  const post = b.calls.find(c => c.url === endpoint);
  const p = JSON.parse(post.init.body);
  assert.equal(p.city, 'Princeton'); assert.equal(p.referrer, 'www.google.com');
  assert.equal(p.ip, undefined); assert.equal(p.testToken, undefined);
  assert.equal(post.init.mode, 'no-cors'); assert.equal(post.init.credentials, 'omit');
  b.run(); await settle();
  const posts = b.calls.filter(c => c.url === endpoint).map(c => JSON.parse(c.init.body));
  assert.equal(posts.length, 2); assert.equal(posts[0].sessionId, posts[1].sessionId);
  assert.notEqual(posts[0].eventId, posts[1].eventId);
  assert.equal(b.calls.filter(c => c.url.startsWith('https://ipwho.is/')).length, 1);
});

test('geolocation failure retains the visit as Unknown; expired sessions start afresh', async () => {
  const store = storage(); store.setItem('andre-visit-session', JSON.stringify({id: randomUUID(), last: 1}));
  const old = JSON.parse(store.getItem('andre-visit-session')).id;
  const b = browser({geoFailure: true, storage: store}); await settle();
  const p = JSON.parse(b.calls.find(c => c.url === endpoint).init.body);
  assert.equal(p.country, 'Unknown'); assert.notEqual(p.sessionId, old);
});

test('local session diagnostic dispatches once, survives reload, and can reset without claiming delivery', async () => {
  const b = browser({origin: 'http://localhost:8000', path: '/tools/visit-test.html'});
  const [one, two] = await Promise.all([b.api.testSession('private-token'), b.api.testSession('private-token')]);
  assert.equal(one, 'dispatched'); assert.equal(two, 'dispatched');
  assert.equal(b.calls.filter(c => c.url === endpoint).length, 1);
  assert.equal(await b.api.testSession('private-token'), 'already-dispatched');
  b.run(); assert.equal(await b.context.window.VisitAnalytics.testSession('private-token'), 'already-dispatched');
  b.api.resetTestSession(); assert.equal(await b.api.testSession('private-token'), 'dispatched');
  const posts = b.calls.filter(c => c.url === endpoint).map(c => JSON.parse(c.init.body));
  assert.equal(posts.length, 2); assert.notEqual(posts[0].sessionId, posts[1].sessionId);
  assert.equal(posts[0].mode, 'session-test');
});

test('network failure does not mark a test session as dispatched', async () => {
  const b = browser({origin: 'http://localhost:8000', postFailure: true});
  await assert.rejects(b.api.testSession('private-token'), /offline/);
  await assert.rejects(b.api.testSession('private-token'), /offline/);
  assert.equal(b.calls.filter(c => c.url === endpoint).length, 2);
});
