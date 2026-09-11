(function () {
  'use strict';
  const config = window.VISIT_ANALYTICS_CONFIG || {};
  const prefix = 'andre-visit-';
  const paths = ['/', '/index.html', '/publications.html', '/awards.html', '/reviewing.html', '/talks.html'];
  const pending = new Map();
  function read(key) {
    try { return JSON.parse(sessionStorage.getItem(prefix + key)); } catch (_) { return null; }
  }
  function write(key, value) {
    try { sessionStorage.setItem(prefix + key, JSON.stringify(value)); } catch (_) { /* best effort */ }
  }
  function optedOut() {
    try {
      return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' ||
        localStorage.getItem(prefix + 'opt-out') === '1';
    } catch (_) { return true; }
  }
  function validEndpoint() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(config.endpoint || '');
  }
  function session(test) {
    const key = test ? 'test-session' : 'session';
    let value = read(key);
    if (!value || !value.id || Date.now() - value.last > 30 * 60 * 1000) {
      value = {id: crypto.randomUUID(), last: Date.now()};
    }
    value.last = Date.now();
    write(key, value);
    return value;
  }
  async function locate(id) {
    const cached = read('location');
    if (cached && cached.id === id) return cached.value;
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 2500);
    let value = {city: 'Unknown', region: 'Unknown', country: 'Unknown'};
    try {
      const response = await fetch('https://ipwho.is/?fields=success,city,region,country', {
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      const data = await response.json();
      if (response.ok && data.success) {
        value = {city: data.city || 'Unknown', region: data.region || 'Unknown', country: data.country || 'Unknown'};
      }
    } catch (_) { /* Visits are still recorded if location lookup fails. */ }
    finally { clearTimeout(timer); }
    write('location', {id: id, value: value});
    return value;
  }
  function referrer() {
    try {
      const url = new URL(document.referrer);
      return url.origin === config.site ? '' : url.hostname;
    } catch (_) { return ''; }
  }
  async function send(options) {
    const test = options && options.test === true;
    if (!validEndpoint()) throw new Error('Set the deployed /exec URL in assets/analytics-config.js first.');
    if (!test && (location.origin !== config.site || !paths.includes(location.pathname) || optedOut())) return 'skipped';
    if (test && (!options.token || !options.token.trim())) throw new Error('Enter the temporary test token.');
    const current = session(test);
    const key = (test ? 'test-' : 'visit-') + current.id;
    if (test && read(key)) return 'already-dispatched';
    if (pending.has(key)) return pending.get(key);
    const task = (async function () {
      const place = await locate(current.id);
      if (!test && optedOut()) return 'skipped';
      const payload = Object.assign({site: config.site, page: test ? '/index.html' : location.pathname,
        mode: test ? 'session-test' : 'visit', eventId: crypto.randomUUID(), sessionId: current.id,
        referrer: test ? '' : referrer()}, place);
      if (test) payload.testToken = options.token.trim();
      // A simple text/plain POST avoids CORS preflight. Its opaque response cannot confirm delivery.
      await fetch(config.endpoint, {method: 'POST', mode: 'no-cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', keepalive: true,
        headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(payload)});
      if (test) write(key, true);
      return 'dispatched';
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  window.VisitAnalytics = Object.freeze({
    testSession: function (token) { return send({test: true, token: token}); },
    resetTestSession: function () {
      try { sessionStorage.removeItem(prefix + 'test-session'); } catch (_) { /* best effort */ }
    }
  });
  if (validEndpoint() && location.origin === config.site && paths.includes(location.pathname) && !optedOut()) {
    send({test: false}).catch(function () { /* Analytics must never interrupt the website. */ });
  }
})();
