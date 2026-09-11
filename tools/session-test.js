(function () {
  'use strict';
  const status = document.getElementById('test-status');
  const button = document.getElementById('send-test');
  const reset = document.getElementById('reset-test');
  button.addEventListener('click', async function () {
    button.disabled = true;
    reset.disabled = true;
    status.textContent = 'Looking up approximate location and dispatching the test…';
    try {
      const result = await window.VisitAnalytics.testSession(document.getElementById('test-token').value);
      status.textContent = result === 'already-dispatched' ?
        'A request was already dispatched in this session. No additional email was requested.' :
        'Request dispatched. This browser cannot confirm acceptance or email delivery. Check your inbox, the private Tests sheet, and Apps Script Executions. Invalid or expired tokens and quota limits can reject a request.';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; reset.disabled = false; }
  });
  reset.addEventListener('click', function () {
    window.VisitAnalytics.resetTestSession();
    status.textContent = 'New test session ready. The server still limits test emails to three per day.';
  });
})();
