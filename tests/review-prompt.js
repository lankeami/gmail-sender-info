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
  extractFunction(contentPath, 'shouldShowReviewPrompt') + '\n' +
  'return { effectiveReviewDismissCount, shouldShowReviewPrompt };\n' +
  '})()'
);
const { effectiveReviewDismissCount, shouldShowReviewPrompt } = loaded;

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
    Object.assign({ auth: 'trusted', ai: null }, overVerdicts || {})
  );
}

console.log('trusted vs warning vs loading');
check('trusted auth, no AI verdict: show', show() === true);
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
    shouldShowReviewPrompt(recent, now, { auth: 'trusted', ai: null }) === false);
  check('old snooze counts as dismiss 1', effectiveReviewDismissCount(recent) === 1);

  const expired = eligible();
  delete expired.gsi_review_dismiss_count;
  expired.gsi_review_snoozed_at = now - 31 * DAY;
  check('old snooze past 30 days can ask once more',
    shouldShowReviewPrompt(expired, now, { auth: 'trusted', ai: 'Ok' }) === true);
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
  check('prompt copy', content.includes("If it's helped, a quick rating helps other people find it."));
  check('manifest description is the approved summary', manifest.description === summary);
  check('manifest description is 129 characters', manifest.description.length === 129);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
