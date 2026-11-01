/**
 * Tests the Gmail search links on the sender strip. A root domain uses
 * from:*domain so subdomain senders are matched; a subdomain keeps the exact
 * from:@domain search. Extracts gmailFromSearchHref() from src/content.js and
 * also checks every call site passes the root/subdomain flag as intended.
 * Run: node tests/domain-search-link.js
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Unbalanced braces extracting ${name}`);
}

// eval is safe here: input is this repo's own committed source.
const gmailFromSearchHref = eval('(' + extractFunction(src, 'gmailFromSearchHref') + ')');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

const base = 'https://mail.google.com/mail/u/0/#search/';
check('root domain uses from:*domain',
  gmailFromSearchHref('example.com', true) === base + 'from%3A*example.com');
check('subdomain keeps exact from:@domain',
  gmailFromSearchHref('mail.example.com', false) === base + 'from%3A%40mail.example.com');
check('domain is URI-encoded',
  gmailFromSearchHref('a b.com', true) === base + 'from%3A*a%20b.com');

check('no hard-coded from: search URLs left outside the helper',
  (src.match(/#search\/from/g) || []).length === 1);
check('strip domain link wildcards only when it is the root domain',
  src.includes('domainLink.href = gmailFromSearchHref(info.fullDomain, info.rootDomain === info.fullDomain);'));
check('restored domain link uses the same rule',
  src.includes('domainA.href = gmailFromSearchHref(origInfo.fullDomain, origInfo.rootDomain === origInfo.fullDomain);'));
check('root domain links always wildcard',
  (src.match(/gmailFromSearchHref\((info|origInfo)\.rootDomain, true\)/g) || []).length === 3);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
