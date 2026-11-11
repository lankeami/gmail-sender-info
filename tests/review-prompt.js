/**
 * Eligibility for the in-email review prompt.
 * Extracts shouldShowReviewPrompt() and effectiveReviewDismissCount() from
 * src/content.js so the tests exercise the shipped decision, not a copy.
 * Run: node tests/review-prompt.js
 */

const fs = require('fs');
const path = require('path');

function extractFunction(filePath, name) {
  const source = fs.readFileSync(filePath, 'utf8');
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in ${filePath}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces extracting ${name} from ${filePath}`);
}

const srcDir = path.join(__dirname, '..', 'src');
const contentPath = path.join(srcDir, 'content.js');
const loaded = eval(
  '(function(){\n' +
  extractFunction(contentPath, 'effectiveReviewDismissCount') + '\n' +
  extractFunction(contentPath, 'reviewAiResultSettlement') + '\n' +
  extractFunction(contentPath, 'reviewAiAvailabilitySettlement') + '\n' +
  extractFunction(contentPath, 'reviewPromptWarningEffect') + '\n' +
  extractFunction(contentPath, 'shouldShowReviewPrompt') + '\n' +
  'return { effectiveReviewDismissCount, reviewAiResultSettlement, reviewAiAvailabilitySettlement, reviewPromptWarningEffect, shouldShowReviewPrompt };\n' +
  '})()'
);
const {
  effectiveReviewDismissCount,
  reviewAiResultSettlement,
  reviewAiAvailabilitySettlement,
  reviewPromptWarningEffect,
  shouldShowReviewPrompt,
} = loaded;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

const DAY = 86400000;
const now = Date.parse('2026-11-11T00:00:00.000Z');

function eligible(over) {
  return Object.assign({
    gsi_first_use_time: now - 40 * DAY,
    gsi_email_view_count: 214,
    gsi_warned_at: now - 10 * DAY,
    gsi_review_dismiss_count: 0,
    shownThisTab: false,
  }, over || {});
}

function show(overState, overVerdicts) {
  return shouldShowReviewPrompt(
    eligible(overState),
    now,
    Object.assign({ auth: 'trusted', ai: null, aiDone: true }, overVerdicts || {})
  );
}

console.log('trusted vs warning vs loading');
check('trusted auth, AI settled with no verdict: show', show() === true);
check('trusted auth, AI Ok: show', show(null, { ai: 'Ok' }) === true);
check('auth caution: hide', show(null, { auth: 'caution' }) === false);
check('auth dangerous: hide', show(null, { auth: 'dangerous' }) === false);
check('auth still loading: hide', show(null, { auth: null }) === false);
check('auth loading string: hide', show(null, { auth: 'loading' }) === false);
check('auth Checking label: hide', show(null, { auth: 'Checking' }) === false);
check('AI Caution blocks a trusted email', show(null, { ai: 'Caution' }) === false);
check('AI Reject blocks a trusted email', show(null, { ai: 'Reject' }) === false);
check('missing verdicts: hide', shouldShowReviewPrompt(eligible(), now, null) === false);
check('missing state: hide', shouldShowReviewPrompt(null, now, { auth: 'trusted', ai: null }) === false);

console.log('day and count thresholds');
check('exactly 7 days and warned: show', show({ gsi_first_use_time: now - 7 * DAY }) === true);
check('just under 7 days: hide', show({ gsi_first_use_time: now - 7 * DAY + 1 }) === false);
check('20 opened emails: show', show({ gsi_email_view_count: 20 }) === true);
check('19 opened emails: hide', show({ gsi_email_view_count: 19 }) === false);
check('missing view count: hide', show({ gsi_email_view_count: undefined }) === false);
check('missing first use: hide', show({ gsi_first_use_time: undefined }) === false);

console.log('warned_at vs 30-day fallback');
check('warned after 7 days, before 30: show', show({
  gsi_warned_at: now - DAY,
  gsi_first_use_time: now - 7 * DAY,
}) === true);
check('no warning at 7 days: hide', show({
  gsi_warned_at: null,
  gsi_first_use_time: now - 7 * DAY,
}) === false);
check('no warning just under 30 days: hide', show({
  gsi_warned_at: null,
  gsi_first_use_time: now - 30 * DAY + 1,
}) === false);
check('no warning at exactly 30 days: show', show({
  gsi_warned_at: null,
  gsi_first_use_time: now - 30 * DAY,
}) === true);

console.log('dismiss counts 0/1/2');
check('dismiss count 0: show', show({ gsi_review_dismiss_count: 0 }) === true);
check('dismiss count 1 after the snooze expired: show', show({
  gsi_review_dismiss_count: 1,
  gsi_review_snoozed_at: now - 30 * DAY,
}) === true);
check('dismiss count 2: hide', show({ gsi_review_dismiss_count: 2 }) === false);
check('dismiss count 2 after the snooze expired: hide', show({
  gsi_review_dismiss_count: 2,
  gsi_review_snoozed_at: now - 31 * DAY,
}) === false);

console.log('30-day snooze');
check('snoozed 29 days ago: hide', show({
  gsi_review_dismiss_count: 1,
  gsi_review_snoozed_at: now - 29 * DAY,
}) === false);
check('snoozed just under 30 days: hide', show({
  gsi_review_dismiss_count: 0,
  gsi_review_snoozed_at: now - 30 * DAY + 1,
}) === false);
check('snoozed exactly 30 days: show', show({
  gsi_review_dismiss_count: 0,
  gsi_review_snoozed_at: now - 30 * DAY,
}) === true);

console.log('clicked');
check('already rated: hide', show({ gsi_review_clicked_at: now - DAY }) === false);
check('clicked wins over a fresh install otherwise eligible', show({
  gsi_review_clicked_at: 1,
  gsi_review_dismiss_count: 0,
}) === false);

console.log('per-tab once');
check('already shown this tab: hide', show({ shownThisTab: true }) === false);
check('not yet shown this tab: show', show({ shownThisTab: false }) === true);

console.log('migration of old snooze');
{
  const recent = eligible();
  delete recent.gsi_review_dismiss_count;
  recent.gsi_review_snoozed_at = now - 10 * DAY;
  check('old snooze with no count is still inside the 30-day wait',
    shouldShowReviewPrompt(recent, now, { auth: 'trusted', ai: null, aiDone: true }) === false);
  check('old snooze counts as dismiss 1', effectiveReviewDismissCount(recent) === 1);

  const expired = eligible();
  delete expired.gsi_review_dismiss_count;
  expired.gsi_review_snoozed_at = now - 31 * DAY;
  check('old snooze past 30 days can ask once more',
    shouldShowReviewPrompt(expired, now, { auth: 'trusted', ai: 'Ok', aiDone: true }) === true);
  check('that second chance is still only one dismissal',
    effectiveReviewDismissCount(expired) === 1);
  check('the next Not now after an old snooze is the last',
    effectiveReviewDismissCount(expired) + 1 === 2);
}
check('no snooze and no count is zero dismissals', effectiveReviewDismissCount({}) === 0);
check('explicit count 0 is not rewritten to 1',
  effectiveReviewDismissCount({ gsi_review_dismiss_count: 0, gsi_review_snoozed_at: now }) === 0);
check('explicit count 2 is kept',
  effectiveReviewDismissCount({ gsi_review_dismiss_count: 2, gsi_review_snoozed_at: now }) === 2);
check('decision does not mutate the state object', (() => {
  const state = eligible();
  shouldShowReviewPrompt(state, now, { auth: 'trusted', ai: null });
  return state.gsi_email_view_count === 214 && state.gsi_review_dismiss_count === 0;
})());

console.log('AI completion');
{
  check('no show while AI is pending', show(null, { aiDone: false, ai: null }) === false);
  const ok = reviewAiResultSettlement({ verdict: 'Ok' }, null);
  check('Ok result is done', ok.aiDone === true && ok.ai === 'Ok' && ok.failed === false);
  check('show after AI Ok', show(null, { ai: ok.ai, aiDone: ok.aiDone }) === true);
  const timedOut = reviewAiResultSettlement({ timeout: true }, null);
  const unavailable = reviewAiResultSettlement(null, null);
  const parseFailed = reviewAiResultSettlement({ parseError: 'bad json' }, null);
  check('timeout is done and does not block', timedOut.aiDone === true && timedOut.ai == null && timedOut.failed === true);
  check('missing result is done and does not block', unavailable.aiDone === true && unavailable.failed === true);
  check('parse error is done and does not block', parseFailed.aiDone === true && parseFailed.failed === true);
  check('show after AI failure', show(null, { ai: timedOut.ai, aiDone: timedOut.aiDone }) === true);
  const caution = reviewAiResultSettlement({ verdict: 'Caution' }, null);
  const reject = reviewAiResultSettlement({ verdict: 'Reject' }, null);
  check('no show after AI Caution', show(null, { ai: caution.ai, aiDone: caution.aiDone }) === false);
  check('no show after AI Reject', show(null, { ai: reject.ai, aiDone: reject.aiDone }) === false);
  check('failed retry keeps an earlier Caution', reviewAiResultSettlement({ timeout: true }, 'Caution').ai === 'Caution');
  const noModel = reviewAiAvailabilitySettlement({ available: false, status: 'unavailable' });
  const disabled = reviewAiAvailabilitySettlement({ available: false, status: 'downloadable' });
  const downloading = reviewAiAvailabilitySettlement({ available: false, status: 'downloading' });
  check('on-device AI unavailable is done', noModel.aiDone === true && noModel.ai == null);
  check('AI disabled is done', disabled.aiDone === true && disabled.ai == null);
  check('show when on-device AI is not available', show(null, { ai: noModel.ai, aiDone: noModel.aiDone }) === true);
  check('a download still in progress is not done', downloading.aiDone === false);
  check('no show while the model is downloading', show(null, { ai: null, aiDone: downloading.aiDone }) === false);
}

console.log('warning removal does not consume the ask');
{
  const session = {
    shownThisTab: true,
    gsi_review_dismiss_count: 1,
    gsi_review_snoozed_at: now - 2 * DAY,
  };
  const cautionAuth = reviewPromptWarningEffect(session, { auth: 'caution', ai: null, aiDone: true });
  check('auth warning clears the per-tab showing', cautionAuth.shownThisTab === false && cautionAuth.removeRow === true);
  check('auth warning writes no storage', cautionAuth.storage === null);
  check('auth warning leaves the dismiss count', session.gsi_review_dismiss_count === 1);
  check('auth warning leaves the snooze', session.gsi_review_snoozed_at === now - 2 * DAY);
  const aiCaution = reviewPromptWarningEffect(session, { auth: 'trusted', ai: 'Caution', aiDone: true });
  check('AI Caution clears the per-tab showing', aiCaution.shownThisTab === false && aiCaution.storage === null);
  check('AI Reject clears the per-tab showing',
    reviewPromptWarningEffect(session, { auth: 'trusted', ai: 'Reject', aiDone: true }).shownThisTab === false);
  check('dangerous verdict clears the per-tab showing',
    reviewPromptWarningEffect(session, { auth: 'dangerous', ai: null, aiDone: true }).shownThisTab === false);
  check('a settled Trusted result does not clear a real showing',
    reviewPromptWarningEffect({ shownThisTab: true }, { auth: 'trusted', ai: 'Ok', aiDone: true }).shownThisTab === true);
  check('next Trusted email in the tab can still show', shouldShowReviewPrompt(
    eligible({
      shownThisTab: cautionAuth.shownThisTab,
      gsi_review_dismiss_count: session.gsi_review_dismiss_count,
      gsi_review_snoozed_at: null,
    }),
    now,
    { auth: 'trusted', ai: 'Ok', aiDone: true }
  ) === true);
  check('keeping the flag would hide that next email', shouldShowReviewPrompt(
    eligible({ shownThisTab: true }),
    now,
    { auth: 'trusted', ai: 'Ok', aiDone: true }
  ) === false);
}

console.log('shipped copy');
{
  const content = fs.readFileSync(contentPath, 'utf8');
  const css = fs.readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const summary = 'Spot phishing in Gmail. See who really sent each email: verified logo, domain, and a Trusted, Use Caution or Not Trusted verdict.';
  check('old nag class removed from content script', !content.includes('gsi-review-nag'));
  check('old nag class removed from css', !css.includes('gsi-review-nag'));
  check('store reviews url', content.includes('https://chromewebstore.google.com/detail/aogdnanhellgfimhgebopmcpaagoeckk/reviews'));
  check('support url', content.includes('https://lankeami.github.io/gmail-sender-info/support.html'));
  check('new-tab links set rel noopener', (content.match(/rel = 'noopener'/g) || []).length >= 2);
  check('Rate it and Not now are buttons', content.includes("rate.type = 'button'") && content.includes("later.type = 'button'"));
  check('prompt copy', content.includes("Checked ' + count.toLocaleString() + ' emails for you."));
  check('prompt follow-up sentence', content.includes("If it's helped, a quick rating helps other people find it."));
  check('old long lead is gone', !content.includes('Gmail Sender Info has checked '));
  check('sync uses the warning effect', content.includes('reviewPromptWarningEffect('));
  check('AI result uses settlement', content.includes('reviewAiResultSettlement('));
  check('unavailable AI uses settlement', content.includes('reviewAiAvailabilitySettlement('));
  check('manifest description is the approved summary', manifest.description === summary);
  check('manifest description is 129 characters', manifest.description.length === 129);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
