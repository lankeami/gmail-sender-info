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

  for (const rawSeg of segments) {
    const seg = rawSeg.replace(/"[^"]*"/g, '');

    const gwSpf = seg.match(new RegExp('(?:^|\\s)gateway\\.spf=' + VALUES + '\\b', 'i'));
    if (gwSpf) { results.gatewaySpf = gwSpf[1].toLowerCase(); }

    const spf = seg.match(new RegExp('(?:^|\\s)spf=' + VALUES + '\\b', 'i'));
    if (spf) results.spf = spf[1].toLowerCase();

    const dkim = seg.match(new RegExp('(?:^|\\s)dkim=' + VALUES + '\\b', 'i'));
    if (dkim) results.dkim = dkim[1].toLowerCase();

    const dmarc = seg.match(new RegExp('(?:^|\\s)dmarc=' + VALUES + '\\b', 'i'));
    if (dmarc) results.dmarc = dmarc[1].toLowerCase();
  }

  return Object.keys(results).length > 0 ? results : null;
}

// --- Copy of parseAuthResultsHtml from page-fetch.js (post-refactor) ---
function parseAuthResultsHtml(stripped) {
  const authData = {};
  const VALUES = '(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR|BESTGUESSPASS)';

  const gwSpfMatch = stripped.match(new RegExp('\\bGateway\\s+SPF:\\s*\'?' + VALUES + '\\b', 'i'));
  if (gwSpfMatch) authData.gatewaySpf = gwSpfMatch[1].toLowerCase();

  const spfSource = gwSpfMatch ? stripped.slice(0, gwSpfMatch.index) + stripped.slice(gwSpfMatch.index + gwSpfMatch[0].length) : stripped;
  const spfMatch = spfSource.match(new RegExp('(?<!\\w)SPF:\\s*\'?' + VALUES + '\\b', 'i'));
  if (spfMatch) authData.spf = spfMatch[1].toLowerCase();

  const dkimMatch = stripped.match(new RegExp('\\bDKIM:\\s*\'?' + VALUES + '\\b', 'i'));
  if (dkimMatch) authData.dkim = dkimMatch[1].toLowerCase();

  const dmarcMatch = stripped.match(new RegExp('\\bDMARC:\\s*\'?' + VALUES + '\\b', 'i'));
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

// No semicolons with gateway.spf (space-separated fallback)
const t6 = parseAuthResults('Authentication-Results: mx.google.com; gateway.spf=pass dkim=pass dmarc=pass');
assertNoKey('no-semicolon gateway.spf should not set spf key', t6, 'spf');
assert('no-semicolon gateway.spf parsed correctly', t6, { gatewaySpf: 'pass', dkim: 'pass', dmarc: 'pass' });

// i.spf prefix excluded (semicolon-separated)
const t7 = parseAuthResults('Authentication-Results: mx.google.com; i.spf=pass; dkim=pass');
assertNoKey('i.spf should not set spf key', t7, 'spf');
assert('i.spf excluded, only dkim kept', t7, { dkim: 'pass' });

// i.spf in space-separated fallback should not drop dkim/dmarc
const t7b = parseAuthResults('Authentication-Results: mx.google.com; i.spf=pass dkim=pass dmarc=fail');
assertNoKey('space-sep i.spf should not set spf key', t7b, 'spf');
assert('space-sep i.spf: dkim/dmarc still parsed', t7b, { dkim: 'pass', dmarc: 'fail' });

// softfail and bestguesspass values
const t8 = parseAuthResults('Authentication-Results: mx.google.com; spf=softfail; dmarc=bestguesspass');
assert('softfail and bestguesspass parsed', t8, { spf: 'softfail', dmarc: 'bestguesspass' });

// Case insensitivity
const t9 = parseAuthResults('Authentication-Results: mx.google.com; SPF=Pass; DKIM=FAIL');
assert('case insensitive values', t9, { spf: 'pass', dkim: 'fail' });

// Only gatewaySpf present returns non-null
const t10 = parseAuthResults('Authentication-Results: mx.google.com; gateway.spf=pass');
assert('only gatewaySpf → non-null result', t10, { gatewaySpf: 'pass' });

// Folded (multiline) header
const t11 = parseAuthResults('Authentication-Results: mx.google.com;\r\n\tspf=pass;\r\n\tdkim=fail');
assert('folded multiline header', t11, { spf: 'pass', dkim: 'fail' });

// spf= inside reason string should not match
const t12 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="spf=pass"; dkim=pass; dmarc=pass');
assertNoKey('spf inside reason string should not set spf key', t12, 'spf');
assert('reason string spf excluded, dkim/dmarc kept', t12, { dkim: 'pass', dmarc: 'pass' });

// Quoted reason with spaces before method names should not match
const t13 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="policy says spf=pass dkim=pass dmarc=pass"');
assertNoKey('quoted reason with spaces: no spf', t13, 'spf');
assertNoKey('quoted reason with spaces: no dkim', t13, 'dkim');
assertNoKey('quoted reason with spaces: no dmarc', t13, 'dmarc');
assert('quoted reason with spaces: null result', t13, null);

// gateway.spf=passive should not match as pass (missing \b)
const t14 = parseAuthResults('Authentication-Results: mx.google.com; gateway.spf=passive; dkim=pass');
assertNoKey('gateway.spf=passive should not set gatewaySpf', t14, 'gatewaySpf');
assert('gateway.spf=passive excluded, only dkim kept', t14, { dkim: 'pass' });

// --- parseAuthResultsHtml tests (HTML "Show Original" path) ---
console.log('\n=== parseAuthResultsHtml (HTML path) ===');

const h1 = parseAuthResultsHtml("SPF: 'PASS' DKIM: 'PASS' DMARC: 'PASS'");
assert('html plain pass', h1, { spf: 'pass', dkim: 'pass', dmarc: 'pass' });

const h2 = parseAuthResultsHtml("Gateway SPF: PASS DKIM: 'PASS' DMARC: 'PASS'");
assertNoKey('html gateway SPF should not set spf key', h2, 'spf');
assert('html gateway SPF → gatewaySpf', h2, { gatewaySpf: 'pass', dkim: 'pass', dmarc: 'pass' });

const h3 = parseAuthResultsHtml("Gateway SPF: PASS SPF: NONE DKIM: 'PASS'");
assert('html gateway SPF + plain SPF coexist', h3, { gatewaySpf: 'pass', spf: 'none', dkim: 'pass' });

// Word boundary: PASSIVE should not match as PASS (Copilot item 2)
const h4 = parseAuthResultsHtml("SPF: PASSIVE DKIM: 'PASS'");
assertNoKey('PASSIVE should not match as SPF pass', h4, 'spf');
assert('PASSIVE excluded, only dkim kept', h4, { dkim: 'pass' });

// Multi-space "Gateway   SPF:" should not also set spf
const h5 = parseAuthResultsHtml("Gateway   SPF: PASS DKIM: 'PASS'");
assertNoKey('multi-space gateway SPF should not set spf key', h5, 'spf');
assert('multi-space gateway SPF parsed correctly', h5, { gatewaySpf: 'pass', dkim: 'pass' });

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
