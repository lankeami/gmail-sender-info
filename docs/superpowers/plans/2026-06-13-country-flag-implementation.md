# Country Flag Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display sender domain geographic location via emoji country flag on the Gmail Sender Info banner strip, with cached GeoIP lookups and graceful degradation on API failure.

**Architecture:** Add `lookupCountry(ip)` function to background service worker to resolve IPs to countries via ip-api.com. Extend existing `getSenderInfo` message response with `{ countryCode, countryName, countryMethod, resolvedIp }` fields. Render emoji flag in banner strip between domain and profile image; cache results 24h alongside existing BIMI/favicon data.

**Tech Stack:** Vanilla JavaScript (ES6), Chrome Manifest V3, dns.google API, ip-api.com GeoIP API, Chrome storage API

---

## File Structure

| File | Changes |
|------|---------|
| `src/background.js` | Add `lookupCountry(ip)`, add DNS A-record resolution to `resolveLogo()`, extend `getSenderInfo` response with country fields |
| `src/content.js` | Render `.gsi-country-flag` emoji element, update tooltip, add GeoIP debug section |
| `src/styles.css` | Add minimal `.gsi-country-flag` styling (positioning/flex) |
| `manifest.json` | Add `host_permissions: ["https://ip-api.com/*"]` |

---

## Task 1: Add lookupCountry() function to background.js

**Files:**
- Modify: `src/background.js:200-250` (insert after existing favicon helper functions)

- [ ] **Step 1: Add lookupCountry() function with timeout handling**

Insert this function after the `gstaticFaviconV2Url()` helper and before `detectHomograph()`:

```javascript
/**
 * Lookup country for an IP address via ip-api.com.
 * Returns { countryCode, countryName } or { countryCode: null } on timeout/failure.
 * Timeout: 5 seconds.
 */
async function lookupCountry(ip) {
  if (!ip) return { countryCode: null };
  
  const url = `https://ip-api.com/json/${encodeURIComponent(ip)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
  
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!resp.ok) return { countryCode: null };
    
    const data = await resp.json();
    if (data.status === 'success' && data.countryCode && data.country) {
      return { countryCode: data.countryCode, countryName: data.country };
    }
    return { countryCode: null };
  } catch (e) {
    clearTimeout(timeoutId);
    // Timeout, network error, or abort — silently degrade
    return { countryCode: null };
  }
}
```

- [ ] **Step 2: Verify function syntax is correct**

Run: `node --check src/background.js`
Expected: No output (syntax OK)

---

## Task 2: Add DNS A-record lookup to resolveLogo()

**Files:**
- Modify: `src/background.js:153-200` (modify `resolveLogo()` function)

- [ ] **Step 1: Add DNS A-record lookup step before returning from resolveLogo()**

In `resolveLogo(fullDomain)`, after the existing BIMI and favicon lookups but before the return statement, add:

```javascript
// --- Country lookup via DNS A-record + GeoIP ---
let countryCode = null;
let countryName = null;
let countryMethod = null;
let resolvedIp = null;

try {
  const aRecordUrl = `https://dns.google/resolve?name=${encodeURIComponent(fullDomain)}&type=A`;
  const aResp = await fetch(aRecordUrl);
  if (aResp.ok) {
    const aData = await aResp.json();
    if (aData.Answer && aData.Answer.length > 0) {
      // Extract first A record (IP address)
      for (const answer of aData.Answer) {
        if (answer.type === 1) { // type 1 = A record
          resolvedIp = answer.data;
          break;
        }
      }
      
      if (resolvedIp) {
        const countryResult = await lookupCountry(resolvedIp);
        if (countryResult.countryCode) {
          countryCode = countryResult.countryCode;
          countryName = countryResult.countryName;
          countryMethod = 'geoip';
        } else {
          countryMethod = 'geoip-timeout';
        }
      }
    }
  }
} catch (e) {
  // DNS lookup failed — silently skip country lookup
  countryMethod = null;
  countryCode = null;
}
```

- [ ] **Step 2: Verify the lookup is placed before the return statement**

Open `src/background.js` and confirm:
- The code block above is inserted before the final `return { ... }` statement in `resolveLogo()`
- It's placed after all BIMI and favicon logic

- [ ] **Step 3: Verify syntax**

Run: `node --check src/background.js`
Expected: No output

---

## Task 3: Extend resolveLogo() return object with country fields

**Files:**
- Modify: `src/background.js:195-200` (modify the return statement in `resolveLogo()`)

- [ ] **Step 1: Update the return statement in resolveLogo()**

Find the return statement in `resolveLogo()` (currently line ~199-200) and update it to include country fields:

**Old return (approximate):**
```javascript
return {
  fullDomain,
  rootDomain,
  homograph: detectHomograph(fullDomain),
  logoUrl: bimiUrl,
  logoSource: bimiUrl ? 'bimi' : 'favicon',
  faviconRootUrl: rootGoogleUrl,
  faviconRootIsGlobe: rootIsGlobe,
  faviconDirectUrl: `https://${rootDomain}/favicon.ico`,
  favicons: { sub, root, www },
};
```

**New return:**
```javascript
return {
  fullDomain,
  rootDomain,
  homograph: detectHomograph(fullDomain),
  logoUrl: bimiUrl,
  logoSource: bimiUrl ? 'bimi' : 'favicon',
  faviconRootUrl: rootGoogleUrl,
  faviconRootIsGlobe: rootIsGlobe,
  faviconDirectUrl: `https://${rootDomain}/favicon.ico`,
  favicons: { sub, root, www },
  countryCode,
  countryName,
  countryMethod,
  resolvedIp,
};
```

- [ ] **Step 2: Verify the return statement**

Open `src/background.js` and confirm the return object includes all four new fields: `countryCode`, `countryName`, `countryMethod`, `resolvedIp`.

- [ ] **Step 3: Verify syntax**

Run: `node --check src/background.js`
Expected: No output

- [ ] **Step 4: Commit background.js changes**

```bash
git add src/background.js
git commit -m "feat: add GeoIP country lookup to resolveLogo()"
```

---

## Task 4: Add country flag element rendering to banner strip

**Files:**
- Modify: `src/content.js:962-1000` (modify `insertBanner()` function)

- [ ] **Step 1: Add helper function to convert country code to flag emoji**

Insert this helper function before `insertBanner()` (around line 960):

```javascript
/**
 * Convert ISO 2-letter country code to flag emoji using regional indicator pairs.
 * US → 🇺🇸, GB → 🇬🇧, RU → 🇷🇺, etc.
 */
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return null;
  const codeUpper = code.toUpperCase();
  // Regional indicator: A=0x1F1E6, Z=0x1F1FF
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(
    codeUpper.charCodeAt(0) + offset,
    codeUpper.charCodeAt(1) + offset
  );
}
```

- [ ] **Step 2: Verify the helper function**

Run: `node --check src/content.js`
Expected: No output

---

## Task 5: Insert country flag into banner strip row

**Files:**
- Modify: `src/content.js:990-1010` (modify the section that builds the strip row)

- [ ] **Step 1: Find the strip row domain/root spans section**

Locate in `insertBanner()` where the domain and root spans are added (currently around line 995-1006):

```javascript
// Domain
const domainSpan = document.createElement('span');
domainSpan.classList.add('gsi-strip-domain');
domainSpan.textContent = info.fullDomain;
stripRow.appendChild(domainSpan);

// Root domain (if different)
if (info.rootDomain !== info.fullDomain) {
  const rootSpan = document.createElement('span');
  rootSpan.classList.add('gsi-strip-root');
  rootSpan.textContent = `(${info.rootDomain})`;
  stripRow.appendChild(rootSpan);
}
```

- [ ] **Step 2: Add country flag element creation after root domain span**

After the root domain block above, add:

```javascript
// Country flag (if available)
if (info.countryCode) {
  const flagEmoji = countryCodeToFlag(info.countryCode);
  if (flagEmoji) {
    const flagSpan = document.createElement('span');
    flagSpan.classList.add('gsi-country-flag');
    flagSpan.textContent = flagEmoji;
    flagSpan.title = info.countryName || info.countryCode;
    stripRow.appendChild(flagSpan);
  }
}
```

- [ ] **Step 3: Verify the insertion point**

Open `src/content.js` and confirm the country flag block is:
- Inside `insertBanner()`
- After the root domain span creation
- Before the profile image section (which starts with `// Profile image`)

- [ ] **Step 4: Verify syntax**

Run: `node --check src/content.js`
Expected: No output

---

## Task 6: Update tooltip to include country flag

**Files:**
- Modify: `src/content.js:640-700` (modify `showTooltip()` function)

- [ ] **Step 1: Find the tooltip row 2 (root domain line) in showTooltip()**

Locate in `showTooltip()` where the root domain is appended (currently around line 663-666):

```javascript
// Row 2: root domain (subtitle)
const rootLine = document.createElement('div');
rootLine.classList.add('gsi-domain-root');
rootLine.textContent = info.rootDomain;
tip.appendChild(rootLine);
```

- [ ] **Step 2: Add country flag display after root domain line**

After the root domain block, add:

```javascript
// Country flag (if available)
if (info.countryCode) {
  const flagEmoji = countryCodeToFlag(info.countryCode);
  if (flagEmoji) {
    const flagLine = document.createElement('div');
    flagLine.classList.add('gsi-domain-country');
    flagLine.textContent = `${flagEmoji} ${info.countryName || info.countryCode}`;
    flagLine.style.marginTop = '2px';
    flagLine.style.fontSize = '11px';
    flagLine.style.color = '#5f6368';
    tip.appendChild(flagLine);
  }
}
```

- [ ] **Step 3: Verify insertion point**

Open `src/content.js` and confirm the country flag block in `showTooltip()` is:
- After the root domain line
- Before the source badge row

- [ ] **Step 4: Verify syntax**

Run: `node --check src/content.js`
Expected: No output

---

## Task 7: Add GeoIP debug section to details panel

**Files:**
- Modify: `src/content.js:1470-1530` (modify the debug section building in the second IIFE)

- [ ] **Step 1: Find the debug lines array in the async debug block**

Locate in the async IIFE (around line 1480-1530) where `debugLines` is built. Look for the line:

```javascript
const debugLines = [
  `envelope: ${envelopeEmail || '(none)'} | X-Original-Sender: ${originalSender || '(not found)'} | path: ${result.authData ? 'HTML' : 'raw'}`,
];
```

- [ ] **Step 2: Add GeoIP debug lines before the BIMI line**

Find the line that says:
```javascript
debugLines.push(`BIMI: ${info.logoSource === 'bimi' ? 'pass (DNS)' : 'none'}`);
```

Before that line, insert:

```javascript
// GeoIP Resolution
debugLines.push('--- GeoIP Resolution ---');
if (info.countryCode) {
  debugLines.push(`Country Code: ${info.countryCode}`);
  debugLines.push(`Country Name: ${info.countryName || '(unknown)'}`);
  debugLines.push(`Method: ${info.countryMethod || 'unknown'}`);
  if (info.resolvedIp) {
    debugLines.push(`Resolved IP: ${info.resolvedIp}`);
  }
} else if (info.countryMethod === 'geoip-timeout') {
  debugLines.push('Status: timeout');
} else {
  debugLines.push('Status: (not resolved)');
}
```

- [ ] **Step 3: Verify the insertion point**

Open `src/content.js` and confirm:
- The GeoIP debug block is in the correct async IIFE (the one that builds the debug section)
- It's before the BIMI line
- It's after the Reply-To mismatch section

- [ ] **Step 4: Verify syntax**

Run: `node --check src/content.js`
Expected: No output

- [ ] **Step 5: Commit content.js changes**

```bash
git add src/content.js
git commit -m "feat: render country flag on banner strip and tooltip"
```

---

## Task 8: Add minimal CSS for country flag

**Files:**
- Modify: `src/styles.css:275-290`

- [ ] **Step 1: Add .gsi-country-flag styling**

Add this at the end of the file, before or after `.gsi-via-badge`:

```css
.gsi-country-flag {
  font-size: 16px;
  display: inline-block;
  white-space: nowrap;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Verify the style is valid CSS**

Run: `cat src/styles.css | tail -20` to verify syntax looks correct

- [ ] **Step 3: Commit styles.css changes**

```bash
git add src/styles.css
git commit -m "feat: add styling for country flag element"
```

---

## Task 9: Add host permission to manifest.json

**Files:**
- Modify: `manifest.json:7-10`

- [ ] **Step 1: Update manifest.json host_permissions**

In `manifest.json`, find the current `host_permissions` array:

```json
"host_permissions": [
  "https://dns.google/*",
  "https://*.gstatic.com/*"
],
```

Add `https://ip-api.com/*` to make it:

```json
"host_permissions": [
  "https://dns.google/*",
  "https://*.gstatic.com/*",
  "https://ip-api.com/*"
],
```

- [ ] **Step 2: Verify JSON syntax**

Run: `node --eval "console.log(JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')))" && echo "JSON valid"`
Expected: JSON valid (no error)

- [ ] **Step 3: Commit manifest.json changes**

```bash
git add manifest.json
git commit -m "feat: add host_permissions for ip-api.com"
```

---

## Task 10: Manual testing — happy path

**Files:**
- Test: Load extension, visit Gmail, send test email

- [ ] **Step 1: Rebuild extension and load in Chrome**

1. Open Chrome DevTools (`chrome://extensions/`)
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked" and select the `gmail-sender-info` directory
4. If extension already loaded: click the refresh icon on the card

- [ ] **Step 2: Test happy path — valid domain**

1. Go to `https://mail.google.com`
2. Open any email with a sender domain (e.g., from google.com, example.com, etc.)
3. Look for the country flag emoji in the banner strip, positioned after the domain name
4. **Expected:** 🇺🇸 for google.com (US-hosted), flag shows for domains with resolvable A records
5. Hover over the flag → tooltip shows country name (e.g., "United States")

- [ ] **Step 3: Test inbox tooltip**

1. In Gmail inbox, hover over a sender name in a row
2. After 200ms, tooltip appears
3. **Expected:** Country flag emoji + country name shown below domain info

- [ ] **Step 4: Test debug section**

1. Open an email
2. Click expand arrow on banner to show details panel
3. Scroll to "Debug" section at bottom, click to expand
4. **Expected:** "GeoIP Resolution" section shows country code, name, method, resolved IP

- [ ] **Step 5: Check Chrome storage cache**

1. Open Chrome DevTools (F12)
2. Go to "Application" tab → "Storage" → "Local Storage" → select the Gmail domain
3. Look for entries with sender emails as keys
4. **Expected:** Each entry contains `countryCode`, `countryName`, `countryMethod`, `resolvedIp` fields in the cached data

---

## Task 11: Manual testing — error cases

**Files:**
- Test: Extension behavior under network failure, timeouts

- [ ] **Step 1: Test timeout — block ip-api.com and verify graceful degradation**

1. Open Chrome DevTools (F12)
2. Go to "Network" tab
3. Click settings (gear icon) → "Throttling" → "Request blocking"
4. Right-click ip-api.com and select "Block request URL" (or add `ip-api.com`)
5. Open an email in Gmail
6. **Expected:** Banner renders without country flag (no error, no broken UI)
7. Check debug section: "GeoIP Resolution" shows "Status: timeout"

- [ ] **Step 2: Test cache hit — verify no duplicate API calls**

1. Clear the block from Network settings
2. Open the same email twice (or two emails from the same sender)
3. Open Chrome DevTools → "Network" tab
4. Filter for "ip-api.com"
5. **Expected:** Only ONE ip-api.com request for the first email; second email uses cached result (no new request)

- [ ] **Step 3: Test domain with no A record**

*(Optional: requires a domain that has no IPv4 address, uncommon)*

If you have access to such a domain, send an email from it and verify:
- Banner renders without flag
- Debug section shows "Status: (not resolved)"

---

## Task 12: Final commit and prepare for release

**Files:**
- Create: Feature branch commit summary

- [ ] **Step 1: Verify all changes are committed**

Run: `git status`
Expected: "On branch main / nothing to commit, working tree clean"

- [ ] **Step 2: View commit history**

Run: `git log --oneline -5`
Expected: Shows the 5 commits from this feature:
- "feat: add host_permissions for ip-api.com"
- "feat: add styling for country flag element"
- "feat: render country flag on banner strip and tooltip"
- "feat: add GeoIP country lookup to resolveLogo()"
- (previous commit)

- [ ] **Step 3: Document the feature in release notes** *(optional for this task, main work is done)*

The feature is now complete. Release notes should mention:
- New feature: Country flag emoji on banner showing sender domain geographic location
- New permission: `https://ip-api.com/*` for GeoIP lookups
- Cached results prevent repeated API calls (24h TTL)
- Graceful degradation: flag omitted if lookup fails

---

## Testing Checklist

Before marking complete, verify:

- [ ] Extension loads without errors
- [ ] Happy path: Country flag renders for valid domains (google.com → 🇺🇸)
- [ ] Flag positioned correctly: after domain, before profile image
- [ ] Hover tooltip shows country name
- [ ] Debug section shows country code, name, method, resolved IP
- [ ] Graceful degradation: no flag, no error, when ip-api.com is blocked
- [ ] Cache works: second request to same email uses cached result
- [ ] Existing features unaffected: BIMI, favicon, SPF/DKIM/DMARC, AI analysis still work
- [ ] All commits created successfully

