# Plan: AI Spam/Phishing Scoring via Chrome Prompt API

## Overview

Add an on-device AI spam/phishing scoring feature using Chrome's built-in Prompt API (Gemini Nano). The feature extracts structured data from the currently viewed email and feeds it to the local model, which returns one of three verdicts: **Ok**, **Caution**, or **Reject** along with reasons.

## Design Decisions

### Where to run the Prompt API

**Service worker (`background.js`)**. The Prompt API is available in extension contexts. The service worker is the right place because:
- It already handles async requests from content.js via `chrome.runtime.sendMessage`
- Content scripts run in an isolated world and may not have reliable access to `LanguageModel`
- Follows the same message-passing pattern as `getSenderInfo`

### Data extraction location

**Content script (`content.js`)** for DOM-based data, **page-fetch.js** for nothing new (headers are already handled). The content script will extract:
1. Display name vs sender email (DOM)
2. Subject line text (DOM)
3. Email body text, truncated (DOM)
4. Links with their href and visible text (DOM)

### Integration with existing verdict system

The AI score is **advisory and displayed separately** from the SPF/DKIM/DMARC verdict:
- Shows as a new "AI Analysis" section inside the Details accordion
- Displayed as a labeled row (like the Security section) with the AI verdict
- Does NOT override the existing auth-based verdict (different signal types)
- If the AI returns "Reject", an inline badge appears on the banner top row (next to or instead of the existing verdict badge only if AI verdict is worse)

### Graceful degradation

If the Prompt API is unavailable (no Gemini Nano, unsupported browser, model not downloaded), the feature silently doesn't appear. No errors, no broken UI.

### Session management

- Create **one session** with the system prompt on first use
- **Clone** the session for each email analysis (avoids context contamination between emails)
- Destroy the clone after getting a result

### Caching

- Cache AI results by **message ID** (same strategy as `securityCache`)
- In-memory only (results don't persist across extension reloads)

---

## Implementation Steps

### Step 1: Update `manifest.json`

No permission changes needed — the Prompt API requires no special permissions in Chrome 138+. However, we should bump the version.

### Step 2: Add AI analysis to `background.js`

New message handler: `{ action: 'analyzeEmail', data: { ... } }`

```
// Pseudocode
let aiSession = null;

async function getAiSession() {
  if (aiSession) return aiSession;
  if (typeof LanguageModel === 'undefined') return null;
  const avail = await LanguageModel.availability();
  if (avail === 'unavailable') return null;
  aiSession = await LanguageModel.create({
    initialPrompts: [{
      role: 'system',
      content: SYSTEM_PROMPT
    }]
  });
  return aiSession;
}

// In message handler:
case 'analyzeEmail': {
  const session = await getAiSession();
  if (!session) { sendResponse({ unavailable: true }); return; }
  const clone = await session.clone();
  const result = await clone.prompt(buildUserPrompt(data));
  clone.destroy();
  sendResponse(parseAiResult(result));
}
```

**System prompt:**
```
You are a cybersecurity expert analyzing email metadata for spam and phishing indicators.

Given the email data below, evaluate these criteria:
1. SENDER MISMATCH: Does the display name impersonate a known brand/entity but the email address doesn't match? (e.g., display name "Bank of America" but sender is random-user@gmail.com)
2. URGENCY/THREAT LANGUAGE: Does the subject or body contain urgent threats, scare tactics, or pressure to act immediately? (e.g., "Account Suspended", "Unauthorized Login", "Act Now")
3. LINK DISCREPANCIES: Do any links point to domains different from the sender's domain? Note: link shorteners (bit.ly, t.co, etc.) and subdomained links (e.g., sender.example.com linking to example.com) are generally acceptable.

Respond with ONLY a JSON object:
{"verdict":"Ok|Caution|Reject","reasons":["reason1","reason2"]}

- "Ok" — No significant phishing indicators found.
- "Caution" — Some suspicious signals that warrant user attention.
- "Reject" — Strong phishing/spam indicators, likely malicious.
```

**User prompt:** Structured text with the extracted fields (display name, sender email, subject, body snippet, links list).

### Step 3: Extract email data in `content.js`

New function `extractEmailData()` called from `insertBanner()`:

```js
function extractEmailData(envelopeEmail) {
  // Display name from .gD element textContent
  const senderEl = document.querySelector('.gD[email]');
  const displayName = senderEl ? senderEl.textContent.trim() : '';

  // Subject line
  const subjectEl = document.querySelector('.hP');
  const subject = subjectEl ? subjectEl.textContent.trim() : '';

  // Body text (truncated to ~2000 chars to fit token limits)
  const bodyEl = document.querySelector('.ii .a3s');
  const bodyText = bodyEl ? bodyEl.innerText.substring(0, 2000) : '';

  // Links in the body
  const links = [];
  if (bodyEl) {
    const anchors = bodyEl.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && !href.startsWith('mailto:')) {
        // Gmail rewrites links through google.com/url?q= — extract actual URL
        let actualUrl = href;
        try {
          const parsed = new URL(href);
          if (parsed.hostname.includes('google.com') && parsed.pathname === '/url') {
            actualUrl = parsed.searchParams.get('q') || href;
          }
        } catch {}
        links.push({ href: actualUrl, text: text.substring(0, 100) });
      }
    }
  }

  return { displayName, senderEmail: envelopeEmail, subject, bodyText, links };
}
```

### Step 4: New message type and handler in `content.js`

Send the extracted data to background.js:

```js
function requestAiAnalysis(emailData) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: 'analyzeEmail', data: emailData },
        (resp) => {
          if (chrome.runtime.lastError || !resp) resolve(null);
          else resolve(resp);
        }
      );
    } catch {
      resolve(null);
    }
  });
}
```

### Step 5: Render AI analysis section in the banner accordion

New function `createAiSection(container, emailData)`:
- Shows "AI Analysis" column header
- Shows "Analyzing..." loading state
- On result: shows verdict pill (Ok = green, Caution = orange, Reject = red)
- Shows reasons as bulleted text items below
- If API unavailable, section doesn't appear at all

Layout inside the accordion content `.gsi-details-table`:
```
| Favicons | Security | AI Analysis | Summary |
```

Wait — the current layout is 3 columns (Favicons | Security | Summary). Adding AI Analysis makes it 4. Alternative: place it below the table as a separate section, or replace/merge with the Summary column.

**Decision:** Add it as a **separate section below the details table**, similar to the Debug section. This keeps the existing layout intact and gives the AI analysis room for its reasons list.

```
[Banner top row: logo + verdict badge + domain + source badge]
[Accordion]
  [Details table: Favicons | Security | Summary]
  [AI Analysis section]  ← new
  [Debug section]
```

### Step 6: Add styles to `styles.css`

```css
/* AI Analysis section */
.gsi-ai-section { ... }
.gsi-ai-header { ... }
.gsi-ai-verdict { ... }
.gsi-ai-verdict-ok { color: #1b5e20; background: #e8f5e9; }
.gsi-ai-verdict-caution { color: #e65100; background: #fff3e0; }
.gsi-ai-verdict-reject { color: #c62828; background: #ffebee; }
.gsi-ai-reasons { ... }
.gsi-ai-loading { ... }
.gsi-ai-reason-item { ... }
```

### Step 7: Wire it all together in `insertBanner()`

After the existing accordion content is built (after `createSecuritySection` call), add:

```js
// AI Analysis (async, won't block banner render)
(async () => {
  // Check if API is even available before extracting data
  const aiCheck = await requestAiCheck(); // lightweight "is AI available?" message
  if (!aiCheck) return; // silently skip

  const emailData = extractEmailData(envelopeEmail);
  const aiSection = createAiSection(accordionContent);
  const result = await requestAiAnalysis(emailData);
  updateAiSection(aiSection, result);
})();
```

### Step 8: Update documentation

Update `CLAUDE.md`:
- Add AI Analysis section to the Banner Layout table
- Document new message protocol (`analyzeEmail`)
- Document new CSS classes
- Note Chrome 138+ requirement for the Prompt API

Update `README.md`:
- Document the AI scoring feature
- Note that it requires Chrome 138+ with Gemini Nano

---

## File Changes Summary

| File | Changes |
|------|---------|
| `manifest.json` | Version bump only |
| `src/background.js` | Add `LanguageModel` session management, `analyzeEmail` handler, AI result parsing |
| `src/content.js` | Add `extractEmailData()`, `requestAiAnalysis()`, `createAiSection()`, wire into `insertBanner()` |
| `src/styles.css` | Add AI Analysis section styles |
| `CLAUDE.md` | Document new feature |
| `README.md` | Document new feature for users |

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Prompt API unavailable | Feature silently doesn't render; existing functionality unaffected |
| Model download required | Show download progress if status is "downloadable" |
| Gemini Nano returns malformed JSON | Parse with try/catch, fall back to "Caution" if unparseable |
| Token limits exceeded | Truncate body text to ~2000 chars, limit links to first 20 |
| Service worker idle timeout | Session may be garbage collected; re-create on next use |
| AI hallucinates/gives wrong verdict | Label clearly as "AI Analysis" and keep it advisory, don't override auth verdicts |
| Link shorteners flagged as suspicious | Instruct model in system prompt that shorteners/subdomains are generally acceptable |
