(function () {
  'use strict';
  const status = document.getElementById('privacy-status');
  function update() {
    try {
      const disabled = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' ||
        localStorage.getItem('andre-visit-opt-out') === '1';
      status.textContent = disabled ? 'Visitor statistics are turned off in this browser.' :
        'Visitor statistics are allowed when collection is enabled on this site.';
    } catch (_) { status.textContent = 'Browser storage is unavailable; automatic tracking is disabled.'; }
  }
  function set(disabled) {
    try {
      if (disabled) localStorage.setItem('andre-visit-opt-out', '1');
      else localStorage.removeItem('andre-visit-opt-out');
      if (disabled) {
        Array.from({length: sessionStorage.length}, function (_, i) { return sessionStorage.key(i); })
          .filter(function (key) { return key && key.startsWith('andre-visit-'); })
          .forEach(function (key) { sessionStorage.removeItem(key); });
      }
    } catch (_) { /* update explains storage restrictions. */ }
    update();
  }
  document.getElementById('disable-analytics').addEventListener('click', function () { set(true); });
  document.getElementById('enable-analytics').addEventListener('click', function () { set(false); });
  update();
})();
