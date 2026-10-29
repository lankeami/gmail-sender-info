/**
 * Tests that lookupBimi() only returns BIMI logo URLs that are https and .svg.
 * Loads src/background.js into a vm sandbox with a mocked fetch that returns
 * canned dns.google TXT answers.
 * Run: node tests/bimi-https.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

function load(answers) {
  const sandbox = {
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} } },
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ Answer: answers.map((data) => ({ data })) }),
    }),
    console, URL, Promise, encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8'), sandbox);
  return sandbox;
}

async function lookup(...answers) {
  return load(answers).lookupBimi('example.com');
}

(async () => {
  const txt = (l) => `"v=BIMI1; l=${l};"`;

  check('https svg logo is accepted',
    await lookup(txt('https://example.com/logo.svg')) === 'https://example.com/logo.svg');
  check('http svg logo is rejected', await lookup(txt('http://example.com/logo.svg')) === null);
  check('protocol-relative logo is rejected', await lookup(txt('//example.com/logo.svg')) === null);
  check('data: URL is rejected', await lookup(txt('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=.svg')) === null);
  check('javascript: URL is rejected', await lookup(txt('javascript:alert(1)//.svg')) === null);
  check('ftp: URL is rejected', await lookup(txt('ftp://example.com/logo.svg')) === null);
  check('relative path is rejected', await lookup(txt('logo.svg')) === null);
  check('https non-svg logo is still rejected', await lookup(txt('https://example.com/logo.png')) === null);
  check('uppercase HTTPS scheme is accepted (URL parsing is case-insensitive)',
    await lookup(txt('HTTPS://example.com/logo.svg')) === 'HTTPS://example.com/logo.svg');
  check('no l= tag returns null', await lookup('"v=BIMI1; a=;"') === null);
  check('later https record is used when an earlier record is http',
    await lookup(txt('http://example.com/a.svg'), txt('https://example.com/b.svg')) === 'https://example.com/b.svg');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
