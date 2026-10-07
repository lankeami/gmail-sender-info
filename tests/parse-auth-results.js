/**
 * Assertion script for Authentication-Results parsing.
 * Extracts parseAuthResults() from src/content.js and parseAuthResultsHtml()
 * from src/page-fetch.js at runtime, so the tests exercise the shipped code
 * rather than a hand-maintained copy that can drift.
 * Run: node tests/parse-auth-results.js
 */

const fs = require('fs');
const path = require('path');

// Brace-matching extraction. Assumes the function body contains no unbalanced
// braces inside string/regex literals (true for both parsers); extraction
// failures throw loudly rather than silently testing stale logic.
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

// eval is safe here: input is this repo's own committed source, read from
// disk in a local test harness — never remote or user-supplied data.
const srcDir = path.join(__dirname, '..', 'src');
const parseAuthResults = eval('(' + extractFunction(path.join(srcDir, 'content.js'), 'parseAuthResults') + ')');
const parseAuthResultsHtml = eval('(' + extractFunction(path.join(srcDir, 'page-fetch.js'), 'parseAuthResultsHtml') + ')');

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

// softfail and bestguesspass values (valid for spf and dmarc respectively)
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

// Word boundary: PASSIVE should not match as PASS
const h4 = parseAuthResultsHtml("SPF: PASSIVE DKIM: 'PASS'");
assertNoKey('PASSIVE should not match as SPF pass', h4, 'spf');
assert('PASSIVE excluded, only dkim kept', h4, { dkim: 'pass' });

// Multi-space "Gateway   SPF:" should not also set spf
const h5 = parseAuthResultsHtml("Gateway   SPF: PASS DKIM: 'PASS'");
assertNoKey('multi-space gateway SPF should not set spf key', h5, 'spf');
assert('multi-space gateway SPF parsed correctly', h5, { gatewaySpf: 'pass', dkim: 'pass' });

// --- Quoted strings and comments (RFC 7601 CFWS) ---
console.log('\n=== quoted strings and comments ===');

// Semicolon inside a quoted reason must not sever the quote pair
const q1 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="policy; spf=pass"; dkim=pass');
assertNoKey('semicolon inside quoted reason: no spf', q1, 'spf');
assert('semicolon inside quoted reason: dkim kept', q1, { dkim: 'pass' });

// Parenthesized comments must not be parsed as results
const q2 = parseAuthResults('Authentication-Results: mx.google.com; x-custom=pass (upstream said spf=pass earlier); dkim=pass');
assertNoKey('comment injection: no spf', q2, 'spf');
assert('comment injection: dkim kept', q2, { dkim: 'pass' });

// Nested comments
const q3 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass (outer (inner spf=pass) text); dkim=pass');
assertNoKey('nested comment injection: no spf', q3, 'spf');

// Real-world Gmail comment placement still parses (regression guard)
const q4 = parseAuthResults('Authentication-Results: mx.google.com; spf=pass (google.com: domain of a@b.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@b.com; dkim=pass');
assert('real-world comment: spf still parsed', q4, { spf: 'pass', dkim: 'pass' });

// Unterminated quote: do not parse its contents as results
const q5 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="unterminated spf=pass dkim=pass');
assertNoKey('unterminated quote: no spf', q5, 'spf');
assertNoKey('unterminated quote: no dkim', q5, 'dkim');

// Escaped quote (quoted-pair) must not close the quoted string
const q6 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="trusted \\"; spf=pass"; dkim=pass; dmarc=pass');
assertNoKey('escaped quote inside reason: no spf', q6, 'spf');
assert('escaped quote inside reason: dkim/dmarc kept', q6, { dkim: 'pass', dmarc: 'pass' });

// Escaped backslash before a real closing quote still closes it (regression guard)
const q7 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass reason="trusted \\\\" spf=fail; dkim=pass');
assert('escaped backslash then real close quote: spf=fail kept', q7, { spf: 'fail', dkim: 'pass' });

// Escaped ) must not close a comment
const q8 = parseAuthResults('Authentication-Results: mx.google.com; x-custom=pass (trusted \\); spf=pass); dkim=pass');
assertNoKey('escaped paren inside comment: no spf', q8, 'spf');
assert('escaped paren inside comment: dkim kept', q8, { dkim: 'pass' });

// Unterminated comment discards the rest of the field
const q9 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass (unterminated spf=pass dkim=pass');
assertNoKey('unterminated comment: no spf', q9, 'spf');
assertNoKey('unterminated comment: no dkim', q9, 'dkim');

// Text before an unterminated comment still parses (regression guard)
const q10 = parseAuthResults('Authentication-Results: mx.google.com; spf=pass (score 4 and the rest never closes');
assert('value before unterminated comment kept', q10, { spf: 'pass' });

// Nested comment with an escaped paren inside
const q11 = parseAuthResults('Authentication-Results: mx.google.com; foo=pass (outer (inner \\) spf=pass) text); dkim=pass');
assertNoKey('nested comment with escaped paren: no spf', q11, 'spf');
assert('nested comment with escaped paren: dkim kept', q11, { dkim: 'pass' });

// --- Repeated methods: first result wins (pre-refactor behavior) ---
console.log('\n=== repeated methods ===');

const r1 = parseAuthResults('Authentication-Results: mx.google.com; dkim=pass header.i=@esp.example; dkim=fail header.i=@customer.example; spf=pass; dmarc=pass');
assert('repeated dkim: first result wins', r1, { dkim: 'pass', spf: 'pass', dmarc: 'pass' });

const r2 = parseAuthResults('Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=a.com; x=y spf=pass smtp.helo=b.com');
assert('repeated spf: first result wins', r2, { spf: 'fail' });

// --- Per-method value lists (match pre-refactor behavior) ---
console.log('\n=== per-method value lists ===');

const v1 = parseAuthResults('Authentication-Results: mx.google.com; dkim=softfail; dmarc=softfail; spf=bestguesspass');
assert('nonstandard per-method values rejected', v1, null);

const v2 = parseAuthResultsHtml('DKIM: SOFTFAIL DMARC: SOFTFAIL SPF: BESTGUESSPASS');
assert('html nonstandard per-method values rejected', v2, {});

// --- HTML path: Received-SPF and repeated Gateway SPF ---
console.log('\n=== html Received-SPF / repeated gateway ===');

// The raw Received-SPF: header embedded in the Show Original page must not
// be read as a direct SPF result on gateway-only emails
const g1 = parseAuthResultsHtml("Gateway SPF: PASS DKIM: 'PASS' Received-SPF: pass (google.com: domain of a@b.com designates 1.2.3.4 as permitted sender)");
assertNoKey('Received-SPF not treated as direct SPF', g1, 'spf');
assert('Received-SPF page: gateway + dkim only', g1, { gatewaySpf: 'pass', dkim: 'pass' });

// Every Gateway SPF occurrence must be excised before the plain-SPF match
const g2 = parseAuthResultsHtml("Gateway SPF: PASS summary repeated Gateway SPF: PASS DKIM: 'PASS'");
assertNoKey('second Gateway SPF not treated as plain SPF', g2, 'spf');
assert('double gateway: gatewaySpf + dkim only', g2, { gatewaySpf: 'pass', dkim: 'pass' });

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
