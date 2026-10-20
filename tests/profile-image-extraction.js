/**
 * Tests for extractProfileImageUrl() — Gmail profile image extraction.
 * Covers three bugs from issue #52:
 *   1. Strategy 1 requires img.ajn class — should work with any class
 *   2. Strategy 2 only searches inside .gE/.gs/.adn — avatar can be a sibling
 *   3. Strategy 2 requires googleusercontent.com/a — too strict
 *
 * Run: node tests/profile-image-extraction.js
 */

const fs = require('fs');
const path = require('path');

// --- Extract function from source (same pattern as parse-auth-results.js) ---
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

// --- CSS.escape polyfill (browser API, not in Node) ---
global.CSS = {
  escape(value) {
    return String(value).replace(/([^\w-])/g, '\\$1');
  },
};

// --- Minimal DOM mock ---
// Just enough to exercise extractProfileImageUrl's querySelector/closest/querySelectorAll calls.

function cssUnescape(s) {
  return s.replace(/\\(.)/g, '$1');
}

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this._attrs = attrs;
    this.className = attrs.class || '';
    this.src = attrs.src || '';
    this._children = [];
    this.parentElement = null;
  }

  append(...children) {
    for (const c of children) {
      c.parentElement = this;
      this._children.push(c);
    }
    return this;
  }

  getAttribute(name) {
    return this._attrs[name] ?? null;
  }

  /** Minimal compound-selector matching: tag.class[attr="val"] */
  _matches(sel) {
    let remaining = sel.trim();

    const tagMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch) {
      if (this.tagName !== tagMatch[1].toUpperCase()) return false;
      remaining = remaining.slice(tagMatch[1].length);
    }

    while (remaining.startsWith('.')) {
      const classMatch = remaining.match(/^\.([a-zA-Z0-9_-]+)/);
      if (classMatch) {
        const classes = (this.className || '').split(/\s+/).filter(Boolean);
        if (!classes.includes(classMatch[1])) return false;
        remaining = remaining.slice(classMatch[0].length);
      } else break;
    }

    while (remaining.startsWith('[')) {
      const attrMatch = remaining.match(/^\[([a-zA-Z0-9_:-]+)(?:="((?:[^"\\]|\\.)*)")?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2];
        if (attrVal !== undefined) {
          if (this._attrs[attrName] !== cssUnescape(attrVal)) return false;
        } else {
          if (!(attrName in this._attrs)) return false;
        }
        remaining = remaining.slice(attrMatch[0].length);
      } else break;
    }

    return remaining.length === 0;
  }

  querySelector(sel) {
    for (const child of this._children) {
      if (child._matches(sel)) return child;
      const found = child.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(sel) {
    const results = [];
    for (const child of this._children) {
      if (child._matches(sel)) results.push(child);
      results.push(...child.querySelectorAll(sel));
    }
    return results;
  }

  closest(sel) {
    const selectors = sel.split(',').map(s => s.trim());
    let el = this;
    while (el) {
      if (selectors.some(s => el._matches(s))) return el;
      el = el.parentElement;
    }
    return null;
  }
}

// --- Test runner ---
let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  const pass = actual === expected || (actual == null && expected == null);
  if (pass) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// --- Extract functions under test ---
const srcFile = path.join(__dirname, '..', 'src', 'content.js');
const isGoogleAvatarUrl = eval(
  '(' + extractFunction(srcFile, 'isGoogleAvatarUrl') + ')'
);
const extractProfileImageUrl = eval(
  '(' + extractFunction(srcFile, 'extractProfileImageUrl') + ')'
);

// =========================================================================
// Bug #1: Strategy 1 should not require .ajn class on the <img>
// Gmail rotates CSS class names; only data-hovercard-id is stable.
// =========================================================================
console.log('\n--- Bug 1: Strategy 1 without .ajn class ---');
{
  const email = 'alice@example.com';
  const photoUrl = 'https://lh3.googleusercontent.com/a/photo123';

  const avatarImg = new El('img', {
    class: 'xyz',
    'data-hovercard-id': email,
    'data-name': 'Alice',
    src: photoUrl,
  });
  const doc = new El('div');
  doc.append(avatarImg);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('finds img by data-hovercard-id regardless of class', result.url, photoUrl);
  assert('match source is hovercard-src', result.debug.matchSource, 'hovercard-src');
  delete global.document;
}

// =========================================================================
// Bug #2: Strategy 2 — avatar is a sibling of .gE (in a .go container),
// not a child. Need to traverse up to the common parent before searching.
// =========================================================================
console.log('\n--- Bug 2: Avatar in sibling container of .gE ---');
{
  const email = 'bob@example.com';
  const photoUrl = 'https://lh3.googleusercontent.com/a/bob-photo';

  const senderSpan = new El('span', { class: 'gD', email });
  const gE = new El('div', { class: 'gE' });
  gE.append(senderSpan);

  const avatarImg = new El('img', { src: photoUrl });
  const goContainer = new El('div', { class: 'go' });
  goContainer.append(avatarImg);

  const parent = new El('div', { class: 'nH' });
  parent.append(gE, goContainer);

  const doc = new El('div');
  doc.append(parent);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('finds avatar in sibling .go container', result.url, photoUrl);
  delete global.document;
}

// =========================================================================
// Bug #3: Strategy 2 URL check requires /a path — should accept any
// googleusercontent.com path (e.g. /ogw/, /ci/).
// =========================================================================
console.log('\n--- Bug 3: googleusercontent URL without /a/ path ---');
{
  const email = 'carol@example.com';
  const photoUrl = 'https://lh3.googleusercontent.com/ogw/carol-photo';

  const senderSpan = new El('span', { class: 'gD', email });
  const avatarImg = new El('img', { src: photoUrl });
  const container = new El('div', { class: 'gE' });
  container.append(senderSpan, avatarImg);

  const doc = new El('div');
  doc.append(container);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('finds img with non-/a/ googleusercontent URL', result.url, photoUrl);
  delete global.document;
}

// =========================================================================
// Regression: Strategy 1 still works with .ajn class
// =========================================================================
console.log('\n--- Regression: Strategy 1 with .ajn class ---');
{
  const email = 'dave@example.com';
  const photoUrl = 'https://lh3.googleusercontent.com/a/dave-photo';

  const avatarImg = new El('img', {
    class: 'ajn',
    'data-hovercard-id': email,
    'data-name': 'Dave',
    src: photoUrl,
  });
  const doc = new El('div');
  doc.append(avatarImg);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('still works with .ajn class', result.url, photoUrl);
  assert('match source is hovercard-src', result.debug.matchSource, 'hovercard-src');
  delete global.document;
}

// =========================================================================
// Regression: default-user placeholder is still rejected
// =========================================================================
console.log('\n--- Regression: Rejects default-user placeholder ---');
{
  const email = 'eve@example.com';

  const avatarImg = new El('img', {
    class: 'ajn',
    'data-hovercard-id': email,
    src: 'https://lh3.googleusercontent.com/a/default-user=s40',
  });
  const doc = new El('div');
  doc.append(avatarImg);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('rejects default-user URL', result.url, null);
  delete global.document;
}

// =========================================================================
// Regression: null / empty email returns null without error
// =========================================================================
console.log('\n--- Regression: null email ---');
{
  const doc = new El('div');
  global.document = doc;
  const result = extractProfileImageUrl(null);
  assert('null email returns null url', result.url, null);
  delete global.document;
}

// =========================================================================
// Security: isGoogleAvatarUrl rejects non-avatar URLs
// =========================================================================
console.log('\n--- Security: isGoogleAvatarUrl validation ---');
{
  assert('accepts /a/ path', isGoogleAvatarUrl('https://lh3.googleusercontent.com/a/photo'), true);
  assert('accepts /a-/ path', isGoogleAvatarUrl('https://lh3.googleusercontent.com/a-/ALV-photo'), true);
  assert('accepts /cm/ path', isGoogleAvatarUrl('https://lh3.googleusercontent.com/cm/AGP-photo'), true);
  assert('accepts /ogw/ path', isGoogleAvatarUrl('https://lh3.googleusercontent.com/ogw/AF2b-photo'), true);
  assert('accepts lh3.google.com host', isGoogleAvatarUrl('https://lh3.google.com/a-/ALV-photo'), true);
  assert('accepts lh5.google.com host', isGoogleAvatarUrl('https://lh5.google.com/a/photo'), true);
  assert('rejects /ci/ path (inline content)', isGoogleAvatarUrl('https://ci3.googleusercontent.com/meips/img'), false);
  assert('rejects non-lh hostname', isGoogleAvatarUrl('https://evil.googleusercontent.com/a/photo'), false);
  assert('rejects non-google host', isGoogleAvatarUrl('https://evil.com/a/lh3.googleusercontent.com'), false);
  assert('rejects default-user', isGoogleAvatarUrl('https://lh3.googleusercontent.com/a/default-user=s40'), false);
  assert('rejects empty string', isGoogleAvatarUrl(''), false);
  assert('rejects malformed URL', isGoogleAvatarUrl('not-a-url'), false);
}

// =========================================================================
// Security: Strategy 2 skips images inside message body (.a3s, .ii)
// =========================================================================
console.log('\n--- Security: Skips body-embedded images ---');
{
  const email = 'mallory@evil.com';
  const fakeAvatar = 'https://lh3.googleusercontent.com/a/fake-trusted-photo';

  const senderSpan = new El('span', { class: 'gD', email });
  const bodyImg = new El('img', { src: fakeAvatar });
  const messageBody = new El('div', { class: 'a3s' });
  messageBody.append(bodyImg);
  const container = new El('div', { class: 'gE' });
  container.append(senderSpan, messageBody);

  const doc = new El('div');
  doc.append(container);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('rejects avatar-like img inside .a3s message body', result.url, null);
  delete global.document;
}

// =========================================================================
// Security: Strategy 2 accepts avatar outside message body
// =========================================================================
console.log('\n--- Security: Accepts avatar outside message body ---');
{
  const email = 'frank@example.com';
  const realAvatar = 'https://lh3.googleusercontent.com/cm/real-photo';

  const senderSpan = new El('span', { class: 'gD', email });
  const headerImg = new El('img', { src: realAvatar });
  const bodyImg = new El('img', { src: 'https://lh3.googleusercontent.com/a/fake' });
  const messageBody = new El('div', { class: 'a3s' });
  messageBody.append(bodyImg);
  const container = new El('div', { class: 'gE' });
  container.append(senderSpan, headerImg, messageBody);

  const doc = new El('div');
  doc.append(container);
  global.document = doc;

  const result = extractProfileImageUrl(email);
  assert('picks header avatar, skips body img', result.url, realAvatar);
  delete global.document;
}

// =========================================================================
// Bug: Strategy 2 must not pick up another person's hovercard avatar
// (e.g. the reply-box shows the current user's photo, not the sender's)
// =========================================================================
console.log('\n--- Bug: Skips other person\'s hovercard avatar ---');
{
  const senderEmail = 'scott@bollandbranch.com';
  const userAvatar = 'https://lh3.googleusercontent.com/a/jay-photo';

  const senderSpan = new El('span', { class: 'gD', email: senderEmail });
  const gE = new El('div', { class: 'gE' });
  gE.append(senderSpan);

  // Reply-box avatar for a different user
  const replyImg = new El('img', {
    src: userAvatar,
    'data-hovercard-id': 'jay@bollandbranch.com',
  });
  const replyBox = new El('div', { class: 'cf wS' });
  replyBox.append(replyImg);

  const parent = new El('div', { class: 'nH' });
  parent.append(gE, replyBox);

  const doc = new El('div');
  doc.append(parent);
  global.document = doc;

  const result = extractProfileImageUrl(senderEmail);
  assert('rejects avatar belonging to a different user', result.url, null);
  delete global.document;
}

// Same scenario but with the sender's own hovercard img present too
console.log('\n--- Bug: Picks sender avatar, skips other person\'s ---');
{
  const senderEmail = 'scott@bollandbranch.com';
  const senderAvatar = 'https://lh3.googleusercontent.com/cm/scott-photo';
  const userAvatar = 'https://lh3.googleusercontent.com/a/jay-photo';

  const senderSpan = new El('span', { class: 'gD', email: senderEmail });
  const gE = new El('div', { class: 'gE' });
  gE.append(senderSpan);

  // Reply-box avatar for a different user (appears first in DOM order)
  const replyImg = new El('img', {
    src: userAvatar,
    'data-hovercard-id': 'jay@bollandbranch.com',
  });
  const replyBox = new El('div', { class: 'cf wS' });
  replyBox.append(replyImg);

  // Sender's avatar (no hovercard id, just a googleusercontent img)
  const senderImg = new El('img', { src: senderAvatar });
  const goContainer = new El('div', { class: 'go' });
  goContainer.append(senderImg);

  const parent = new El('div', { class: 'nH' });
  parent.append(gE, replyBox, goContainer);

  const doc = new El('div');
  doc.append(parent);
  global.document = doc;

  const result = extractProfileImageUrl(senderEmail);
  assert('picks sender avatar, skips other user', result.url, senderAvatar);
  delete global.document;
}

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
