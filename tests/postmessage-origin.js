/**
 * Static checks on the window.postMessage bridge between content.js (isolated
 * world) and page-fetch.js (MAIN world). Both sides share one window, so every
 * message must target window.location.origin rather than '*', and every
 * message type that is sent must have a receiving listener that keeps the
 * `event.source === window` guard.
 * Run: node tests/postmessage-origin.js
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const files = { 'content.js': 'content', 'page-fetch.js': 'page-fetch' };
const sources = {};
for (const f of Object.keys(files)) sources[f] = fs.readFileSync(path.join(srcDir, f), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

// Find every `window.postMessage(` call, return {args: [top-level arg strings]}.
function findPostMessageCalls(src) {
  const calls = [];
  const marker = 'window.postMessage(';
  let idx = 0;
  while ((idx = src.indexOf(marker, idx)) !== -1) {
    const open = idx + marker.length - 1;
    let depth = 0, inStr = null, args = [], cur = '';
    let i = open;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        cur += c;
        if (c === '\\') { cur += src[++i]; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
      if (c === '(' || c === '{' || c === '[') { depth++; if (depth === 1) continue; }
      if (c === ')' || c === '}' || c === ']') {
        depth--;
        if (depth === 0) { args.push(cur.trim()); break; }
      }
      if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    const type = (args[0].match(/type:\s*'([^']+)'/) || [])[1];
    calls.push({ type, target: args[1] });
    idx = i;
  }
  return calls;
}

console.log('postMessage target origin');
const sent = { 'content.js': [], 'page-fetch.js': [] };
for (const f of Object.keys(files)) {
  const calls = findPostMessageCalls(sources[f]);
  sent[f] = calls;
  check(`${f}: found postMessage calls (${calls.length})`, calls.length > 0);
  check(`${f}: every call has a gsi-* type`, calls.every((c) => c.type && c.type.startsWith('gsi-')));
  check(`${f}: no call uses '*' as target origin`, calls.every((c) => c.target !== "'*'"));
  check(`${f}: every call targets window.location.origin`, calls.every((c) => c.target === 'window.location.origin'));
}

console.log('send/receive pairs');
// Message types handled by each side's window 'message' listeners.
function receivedTypes(src) {
  const types = new Set();
  for (const m of src.matchAll(/type\s*(?:===|!==)\s*'(gsi-[a-z-]+)'/g)) types.add(m[1]);
  return types;
}
const contentRecv = receivedTypes(sources['content.js']);
const pageRecv = receivedTypes(sources['page-fetch.js']);
for (const c of sent['content.js']) {
  check(`content.js sends ${c.type} -> page-fetch.js listens`, pageRecv.has(c.type));
}
for (const c of new Set(sent['page-fetch.js'].map((x) => x.type))) {
  check(`page-fetch.js sends ${c} -> content.js listens`, contentRecv.has(c));
}

console.log('source guard');
for (const f of Object.keys(files)) {
  const listeners = sources[f].split("window.addEventListener('message'").slice(1);
  check(`${f}: found message listeners (${listeners.length})`, listeners.length > 0);
  check(`${f}: every message listener checks event.source === window`,
    listeners.every((l) => /^[\s\S]{0,80}?if \(event\.source !== window\) return;/.test(l)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
