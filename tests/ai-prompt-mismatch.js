/**
 * Assertion script for AI system prompt — SENDER MISMATCH criterion.
 * Verifies that criterion 1 instructs the model to check body content,
 * subject, and in-body brand assertions (not just the display name).
 * Run: node tests/ai-prompt-mismatch.js
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'page-fetch.js'),
  'utf8'
);

// Extract the AI_SYSTEM_PROMPT string (template literal or regular string)
const promptMatch = src.match(
  /const AI_SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/
);
if (!promptMatch) {
  console.error('FAIL: Could not extract AI_SYSTEM_PROMPT from page-fetch.js');
  process.exit(1);
}
const prompt = promptMatch[1];

// Extract criterion 1 text (everything from "1. SENDER MISMATCH:" to the next numbered criterion)
const criterion1Match = prompt.match(
  /1\.\s*SENDER MISMATCH:[\s\S]*?(?=\n\d+\.\s)/
);
if (!criterion1Match) {
  console.error('FAIL: Could not extract criterion 1 from AI_SYSTEM_PROMPT');
  process.exit(1);
}
const criterion1 = criterion1Match[0];

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

console.log('AI prompt — SENDER MISMATCH criterion tests\n');

// Criterion 1 must reference body content
assert(
  /body/i.test(criterion1),
  'criterion 1 mentions "body"'
);

assert(
  /body content/i.test(criterion1) || /email body/i.test(criterion1),
  'criterion 1 references "body content" or "email body"'
);

// Must reference subject as a signal source
assert(
  /subject/i.test(criterion1),
  'criterion 1 mentions "subject"'
);

// Must reference in-body brand assertions
assert(
  /company name|portal name|department name|brand identity|brand.*identity|"signed by"|attribution/i.test(criterion1),
  'criterion 1 references in-body brand assertions (company names, portal names, etc.)'
);

// Must handle generic display names explicitly
assert(
  /generic/i.test(criterion1) || /\bHR\b/.test(criterion1) || /IT Support/i.test(criterion1),
  'criterion 1 addresses generic display names (e.g. "HR", "IT Support")'
);

// Auth context should note domain authentication != brand affiliation
const authMatch = prompt.match(/AUTHENTICATION CONTEXT:[\s\S]*/);
if (!authMatch) {
  console.error('FAIL: Could not find AUTHENTICATION CONTEXT section');
  failed++;
} else {
  assert(
    /does not vouch|does not prove|does not mean|doesn.t guarantee|not.*affiliated|not.*legitimate business/i.test(authMatch[0]),
    'AUTHENTICATION CONTEXT notes that passing auth does not vouch for brand affiliation'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
