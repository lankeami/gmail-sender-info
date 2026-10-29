/**
 * Tests that extractEmailData() escapes the envelope email with CSS.escape()
 * before interpolating it into the .gD[email="..."] selector, so an address
 * containing quotes/brackets cannot break out of the attribute selector.
 * Extracts extractEmailData() from src/content.js at runtime (same pattern as
 * the other tests) and runs it against a stubbed document.
 * Run: node tests/extract-email-data-selector.js
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

// Node has no CSS global. Minimal stand-in for CSS.escape(): backslash-escape
// every character that is not [A-Za-z0-9_-] (a safe subset of the spec'd
// behavior for these inputs).
const CSS = { escape: (s) => String(s).replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c) };

const selectors = [];
const document = {
  querySelector(sel) { selectors.push(sel); return null; },
};

// eval is safe here: input is this repo's own committed source, read from
// disk in a local test harness.
const extractEmailData = eval('(' + extractFunction(path.join(__dirname, '..', 'src', 'content.js'), 'extractEmailData') + ')');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

// 1. Normal address: selector uses the escaped value
selectors.length = 0;
extractEmailData('alice@example.com');
check('first selector is the escaped envelope-email selector',
  selectors[0] === '.gD[email="alice\\@example\\.com"]');

// 2. Hostile address cannot break out of the attribute selector
selectors.length = 0;
const evil = 'x"] , body [data-x="';
extractEmailData(evil);
check('quote and bracket characters are escaped in the selector',
  selectors[0] === '.gD[email="x\\"\\]\\ \\,\\ body\\ \\[data-x\\=\\"' + '"]');
check('selector contains no unescaped double quote besides its delimiters',
  (selectors[0].match(/(?<!\\)"/g) || []).length === 2);

// 3. No envelope email: plain selector, no escaping needed
selectors.length = 0;
extractEmailData(undefined);
check('no envelope email uses the generic selector', selectors[0] === '.gD[email]');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
