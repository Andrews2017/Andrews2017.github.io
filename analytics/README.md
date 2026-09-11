# Daily visitor email setup

The website is prepared for daily summaries to **niyongabor.andre@gmail.com**.
The deployment endpoint is configured in `assets/analytics-config.js`; publishing enables collection on the production website.
Local tests do not verify Google authorization, the scheduled trigger, or actual email delivery. Use the checks below to verify your deployment.

## 1. Create and authorize the Google script

1. Sign into your personal Gmail account at https://script.google.com/ and create a **New project**.
2. Replace the editor's `Code.gs` with the contents of [`Code.gs`](Code.gs).
3. In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**. Replace that file with [`appsscript.json`](appsscript.json).
4. Save, select **setup** in the function menu, and click **Run**. Authorize spreadsheet creation, email sending, and scheduled triggers for your own script. No Gmail inbox-reading permission is requested.
5. The execution log links to a new private spreadsheet with **Visits** and **Tests** tabs. Keep it private. The **Triggers** panel should show one `sendDailySummary` trigger.

Setup is safe to rerun: it reuses the stored spreadsheet ID and replaces only this script's daily-summary trigger. It does not erase visit history.

## 2. Deploy the collector

Choose **Deploy → New deployment → Web app**:

- **Execute as:** Me (`niyongabor.andre@gmail.com`).
- **Who has access:** Anyone, including visitors who are not signed into Google.
- Click **Deploy** and copy the URL ending in **/exec**, not `/dev`.

Open that URL in an incognito window: it should return `{"ok":true,"service":"Website visit collector"}` rather than ask for Google sign-in. This health check does not send mail or record a visit.

In [`../assets/analytics-config.js`](../assets/analytics-config.js), set:

```js
endpoint: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
```

Keep `site` as `https://andrews2017.github.io`. The deployment URL is public; it is not a password. Do not put OAuth credentials or test tokens into this repository.

When changing `Code.gs` later, update the Google editor and use **Deploy → Manage deployments → Edit → New version → Deploy**. Editing the script alone does not update the `/exec` deployment. Changing Script Properties or running `enableSessionTests` does not require redeployment.

## 3. Test session email delivery locally

1. Run **enableSessionTests** in the Apps Script editor. Copy the temporary token from its execution log; it expires after one hour.
2. From this repository root, run `python3 -m http.server 8000 --bind 127.0.0.1`.
3. Open http://127.0.0.1:8000/tools/visit-test.html and paste the token into its password field. This diagnostic page makes no requests before you click the test button.
4. Click **Send session test**. Expect one `[TEST] Website session received` email with your approximate location, and one row in the **Tests** sheet.
5. Click again, or reload and paste the token again: the same browser-tab session should not send another request/email. **Start a new test session** allows another attempt, with a server limit of three attempts that reach the mail step per New York calendar day.
6. Run **disableSessionTests** afterward. Normal daily collection remains enabled once configured and published.

A dispatched request is not proof of receipt: cross-origin Apps Script requests use `no-cors`, so JavaScript cannot read the response. Check the actual email (including spam), the private **Tests** sheet, and **Executions** in Apps Script. An expired token, missing setup, wrong deployment permissions, or quota limit can reject a request even when the browser reports dispatch. If a request was rejected, correct the issue and start a new test session. A mail failure may leave a test row; that attempt remains counted to prevent repeated sends.

Explicit test clicks perform location lookup even when automatic analytics is opted out. Test events never enter the **Visits** sheet or production summary.

## 4. Publish and check the daily summary

Publish the updated website after configuring the endpoint. Normal collection runs on the five main pages **only on the production origin**, not localhost, this test page, the privacy page, or the archived page.

The trigger sends one summary for the **previous calendar day**, around **8:00 a.m. America/New_York**. Google's trigger timing is approximate (nearMinute permits about ±15 minutes). The email includes:

- Tracked page loads and browser-tab sessions, including zero-visit days.
- Top pages, approximate city/region/country locations, and referrer hosts.
- A note when the collection cap was reached.

A session resets after a 30-minute gap between tracked page loads. Sessions are not unique people; separate tabs, blocked storage, bots, and blockers affect counts. To test the daily email immediately, run **sendDailySummary** in the Google editor: it sends yesterday's actual report, possibly with zero visits. Repeating it for that date does not resend. Today's visits appear in tomorrow's report. Missed trigger days are not automatically backfilled.

## Data and free limits

Location is looked up **in the visitor's browser** using `https://ipwho.is/?fields=success,city,region,country`. Looking up an unspecified IP from Apps Script instead would locate Google's server, not the visitor. IPWhois receives the visitor's IP; this application requests only coarse location fields and never stores IPs, coordinates, names, email addresses, query strings, or full referrer URLs. Location failure records **Unknown** without losing the visit.

The website links to [`../privacy.html`](../privacy.html), which explains collection and offers browser opt-out. Automatic collection respects Do Not Track, Global Privacy Control, and the local opt-out setting. Random session IDs and location cache use session storage; the opt-out flag uses local storage. Closed tabs normally end the storage lifetime, though browser session restoration may retain it.

Raw rows are pruned to approximately 30 days after a successful summary. Email summaries remain in your Gmail until you delete them. Google and GitHub may retain their own service logs. Keep the Google Sheet private.

Current free allowances: personal Apps Script accounts allow 100 email recipients/day; IPWhois documents 1,000 free lookups/day per website domain for browser requests. This implementation caps production collection at 1,000 events/day and test emails at three/day, reserving at least one remaining email recipient for summaries. The limits of other scripts on your Google account are shared. No custom domain or paid account is needed.

The endpoint is public: the declared site and allowed paths are validated, but they **do not authenticate** traffic or prove it came from a real visitor. Rate caps and the private, expiring test token limit email abuse; bots can still forge visits or exhaust collection/Google quotas. There is no reliable guarantee that every visit will be recorded. Normal collection never sends per-visit emails.

## Local verification

Run `node --test tests/analytics.test.cjs` (Node 18+). Tests mock browser, Sheets, email, locks, and triggers: they exercise aggregation, DST/date boundaries, duplicate handling, caps, validation, retention, opt-outs, location failures, and session tests **without sending email or making network requests**.

## References

- [Google: web app deployment](https://developers.google.com/apps-script/guides/web)
- [Google: email quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Google: scheduled triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Google: trigger timing](https://developers.google.com/apps-script/reference/script/clock-trigger-builder)
- [IPWhois: free endpoint, CORS limits, and location fields](https://ipwhois.io/documentation)
