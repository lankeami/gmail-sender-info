/**
 * Assertion script for parseAuthResults().
 * Copies the function from content.js for isolated testing.
 * Run: node tests/parse-auth-results.js
 */

// --- Copy of parseAuthResults from content.js (post-refactor) ---
function parseAuthResults(headerText) {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);

  let authLine = '';
  for (const line of lines) {
    if (line.toLowerCase().startsWith('authentication-results:')) {
      authLine = line.substring('authentication-results:'.length).trim();
      break;
    }
  }
  if (!authLine) return null;

  const results = {};
  const VALUES = '(pass|fail|softfail|neutral|none|temperror|permerror|bestguesspass)';
  const segments = authLine.includes(';') ? authLine.split(';').map(s => s.trim()) : [authLine];

  for (const seg of segments) {
    const gwSpf = seg.match(new RegExp('(?:^|\\s)gateway\\.spf=' + VALUES, 'i'));
    if (gwSpf) { results.gatewaySpf = gwSpf[1].toLowerCase(); }

    if (/^(arc|i)\.\w+=/i.test(seg)) continue;

    const spf = seg.match(new RegExp('(?<![.\\w])spf=' + VALUES, 'i'));
    if (spf) results.spf = spf[1].toLowerCase();

    const dkim = seg.match(new RegExp('(?:^|\\s)dkim=' + VALUES, 'i'));
    if (dkim) results.dkim = dkim[1].toLowerCase();

    const dmarc = seg.match(new RegExp('(?:^|\\s)dmarc=' + VALUES, 'i'));
    if (dmarc) results.dmarc = dmarc[1].toLowerCase();
  }

  return Object.keys(results).length > 0 ? results : null;
}

// --- Copy of parseAuthResultsHtml from page-fetch.js (post-refactor) ---
function parseAuthResultsHtml(stripped) {
  const authData = {};
  const VALUES = '(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR|BESTGUESSPASS)';

  const gwSpfMatch = stripped.match(new RegExp('\\bGateway\\s+SPF:\\s*\'?' + VALUES, 'i'));
  if (gwSpfMatch) authData.gatewaySpf = gwSpfMatch[1].toLowerCase();

  const spfMatch = stripped.match(new RegExp('(?<!Gateway\\s)(?<!\\w)SPF:\\s*\'?' + VALUES, 'i'));
  if (spfMatch) authData.spf = spfMatch[1].toLowerCase();

  const dkimMatch = stripped.match(new RegExp('\\bDKIM:\\s*\'?' + VALUES, 'i'));
  if (dkimMatch) authData.dkim = dkimMatch[1].toLowerCase();

  const dmarcMatch = stripped.match(new RegExp('\\bDMARC:\\s*\'?' + VALUES, 'i'));
  if (dmarcMatch) authData.dmarc = dmarcMatch[1].toLowerCase();

  return Object.keys(authData).length > 0 ? authData : null;
}

// --- Test helpers ---
let passed = 0;
let failed = 0;

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (a[aKeys[i]] !== b[aKeys[i]]) return false;
  }
  return true;
}

function assert(name, actual, expected) {
  if (deepEqual(actual, expected)) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertNoKey(name, obj, key) {
  if (obj && key in obj) {
    console.log(`  FAIL: ${name} — key "${key}" should not exist`);
    console.log(`    actual: ${JSON.stringify(obj)}`);
    failed++;
  } else {
    console.log(`  PASS: ${name}`);
    passed++;
  }
}

// --- parseAuthResults tests (raw header path) ---
console.log('\n=== parseAuthResults (raw header) ===');

// Existing behavior (regression guard)
const t1 = parseAuthResults('Authentication-Results: mx.google.com; spf=pass dkim=pass dmarc=pass');
assert('plain spf/dkim/dmarc pass', t1, { spf: 'pass', dkim: 'pass', dmarc: 'pass' });

// Space-separated (no semicolons) should still work
const t1b = parseAuthResults('Authentication-Results: mx.google.com; spf=pass dkim=fail dmarc=none');
assert('space-separated mixed results', t1b, { spf: 'pass', dkim: 'fail', dmarc: 'none' });

// Gateway.spf should NOT produce an spf key
const t2 = parseAuthResults('Authentication-Results: mx.google.com; gateway.spf=pass; dkim=pass; dmarc=pass');
assertNoKey('gateway.spf should not set spf key', t2, 'spf');
assert('gateway.spf → gatewaySpf key', t2, { gatewaySpf: 'pass', dkim: 'pass', dmarc: 'pass' });

// Both gateway.spf and plain spf present
const t3 = parseAuthResults('Authentication-Results: mx.google.com; gateway.spf=pass; spf=none; dkim=pass');
assert('gateway.spf + plain spf coexist', t3, { gatewaySpf: 'pass', spf: 'none', dkim: 'pass' });

// arc.spf should be excluded (only plain spf matters)
const t4 = parseAuthResults('Authentication-Results: mx.google.com; arc.spf=pass; spf=fail');
assert('arc.spf excluded, plain spf=fail kept', t4, { spf: 'fail' });
assertNoKey('arc.spf should not create any key', t4, 'arcSpf');

// Null for empty/no header
const t5 = parseAuthResults('Subject: Hello');
assert('no auth header → null', t5, null);

// --- parseAuthResultsHtml tests (HTML "Show Original" path) ---
console.log('\n=== parseAuthResultsHtml (HTML path) ===');

const h1 = parseAuthResultsHtml("SPF: 'PASS' DKIM: 'PASS' DMARC: 'PASS'");
assert('html plain pass', h1, { spf: 'pass', dkim: 'pass', dmarc: 'pass' });

const h2 = parseAuthResultsHtml("Gateway SPF: PASS DKIM: 'PASS' DMARC: 'PASS'");
assertNoKey('html gateway SPF should not set spf key', h2, 'spf');
assert('html gateway SPF → gatewaySpf', h2, { gatewaySpf: 'pass', dkim: 'pass', dmarc: 'pass' });

const h3 = parseAuthResultsHtml("Gateway SPF: PASS SPF: NONE DKIM: 'PASS'");
assert('html gateway SPF + plain SPF coexist', h3, { gatewaySpf: 'pass', spf: 'none', dkim: 'pass' });

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
