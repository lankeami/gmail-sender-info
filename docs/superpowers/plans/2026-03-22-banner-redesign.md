# Banner Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large lavender banner with a compact horizontal strip (~55px) that surfaces security pills inline and adds an AI summary line.

**Architecture:** Two files change: `src/styles.css` (replace banner styles) and `src/content.js` (rewrite `insertBanner()` and restructure accordion). No changes to background.js, message protocol, or permissions. The logo resolution chain, verdict logic, and original sender swap are preserved — only the DOM structure and styling change.

**Tech Stack:** Vanilla JS, CSS, Chrome Extension Manifest V3

**Spec:** `docs/superpowers/specs/2026-03-22-banner-redesign-design.md`

---

### Task 1: Replace banner CSS with compact strip styles

**Files:**
- Modify: `src/styles.css:39-163` (banner + accordion styles)

- [ ] **Step 1: Replace `#gsi-banner` base styles**

Replace lines 39-51 with:

```css
/* --- Banner (email view) — compact strip --- */

#gsi-banner {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-size: 13px;
  color: #1a1a1a;
  box-sizing: border-box;
  margin-bottom: 10px;
  overflow: hidden;
}
```

- [ ] **Step 2: Replace banner top row and text styles**

Replace `.gsi-banner-top` (lines 75-79) and `.gsi-banner-text` (lines 109-114) and `.gsi-banner-domain` (lines 116-122) and `.gsi-banner-root` (lines 124-127) with:

```css
.gsi-strip-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
}

.gsi-strip-domain {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
}

.gsi-strip-root {
  font-size: 11px;
  color: #9aa0a6;
  white-space: nowrap;
}

.gsi-strip-divider {
  color: #dadce0;
  font-size: 13px;
  user-select: none;
}
```

- [ ] **Step 3: Add security pill styles**

Add new styles for the inline security pills:

```css
/* --- Security pills (inline in strip) --- */

.gsi-pill {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.gsi-pill-pass {
  color: #1b5e20;
  background: #e8f5e9;
}

.gsi-pill-fail {
  color: #c62828;
  background: #ffebee;
}

.gsi-pill-loading {
  color: #5f6368;
  background: #f1f3f4;
}

/* Verdict pill (slightly larger) */
.gsi-pill-verdict {
  font-size: 11px;
  padding: 2px 8px;
}

.gsi-pill-trusted {
  color: #1b5e20;
  background: #e8f5e9;
}

.gsi-pill-caution {
  color: #e65100;
  background: #fff3e0;
}

.gsi-pill-dangerous {
  color: #c62828;
  background: #ffebee;
}
```

- [ ] **Step 4: Add AI summary line styles**

```css
/* --- AI summary line (below strip) --- */

.gsi-ai-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-top: 1px solid #ebebeb;
}

.gsi-ai-line-text {
  font-size: 12px;
  color: #5f6368;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.gsi-ai-line-loading {
  font-style: italic;
  color: #9aa0a6;
}
```

- [ ] **Step 5: Replace accordion styles with details panel styles**

Replace `.gsi-accordion` block (lines 129-163) with:

```css
/* --- Details panel (expandable) --- */

.gsi-details-panel {
  display: none;
  padding: 10px 14px;
  border-top: 1px solid #ebebeb;
  font-size: 12px;
}

.gsi-details-section {
  margin-bottom: 8px;
}

.gsi-details-section:last-child {
  margin-bottom: 0;
}

.gsi-details-label {
  font-size: 10px;
  font-weight: 600;
  color: #5f6368;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.gsi-details-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
  color: #3c4043;
}

.gsi-details-source {
  font-size: 12px;
  color: #5f6368;
}
```

- [ ] **Step 6: Update Gemini sparkle, expand arrow, logo, profile, and via badge styles**

Replace `.gsi-gemini-icon` (lines 82-94) and update `.gsi-logo` override (lines 53-57) and `.gsi-profile-img` (lines 59-67):

```css
#gsi-banner .gsi-logo {
  width: 24px;
  height: 24px;
  border-radius: 4px;
}

#gsi-banner .gsi-profile-img {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid #e8eaed;
}

.gsi-gemini-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e8eaed;
  color: #9aa0a6;
  flex-shrink: 0;
  transition: color 0.3s ease, background 0.3s ease;
}

.gsi-strip-expand {
  font-size: 11px;
  color: #9aa0a6;
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s;
  flex-shrink: 0;
  padding: 4px;
}

.gsi-strip-expand:hover {
  color: #3c4043;
}

.gsi-via-badge {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  color: #5f6368;
  background: #f1f3f4;
  border-radius: 4px;
  white-space: nowrap;
}
```

- [ ] **Step 7: Update debug section styles**

Replace inline debug styles with CSS class:

```css
/* --- Debug section (nested collapsible inside details panel) --- */

.gsi-debug-section {
  margin-top: 6px;
  border-top: 1px solid #ebebeb;
  padding-top: 4px;
}

.gsi-debug-header {
  font-size: 10px;
  color: #80868b;
  cursor: pointer;
  user-select: none;
}

.gsi-debug-content {
  display: none;
  font-size: 11px;
  color: #5f6368;
  margin-top: 4px;
  padding: 4px 8px;
  background: #f8f9fa;
  border-radius: 4px;
  font-family: monospace;
  word-break: break-all;
  white-space: pre-wrap;
}
```

- [ ] **Step 8: Remove old styles that are no longer needed**

Remove these style blocks entirely (they are replaced by the new strip layout):
- `.gsi-banner-top` (old top row)
- `.gsi-banner-text`, `.gsi-banner-domain`, `.gsi-banner-root` (old text sizing)
- `.gsi-accordion`, `.gsi-accordion-header`, `.gsi-chevron`, `.gsi-accordion-content` (old accordion)
- `.gsi-details-table`, `.gsi-details-col`, `.gsi-col-header` (old three-column layout)
- `.gsi-detail-row`, `.gsi-detail-icon`, `.gsi-detail-label`, `.gsi-detail-domain` (old favicon rows)
- `.gsi-security-row`, `.gsi-security-label`, `.gsi-security-result`, `.gsi-result-pass`, `.gsi-result-fail`, `.gsi-result-neutral` (replaced by pills)
- `.gsi-security-loading`, `.gsi-security-error` (replaced by pill loading state)
- `.gsi-summary`, `.gsi-summary-icon`, `.gsi-summary-label`, `.gsi-verdict-*` (old verdict column)
- `.gsi-banner-verdict`, `.gsi-banner-verdict-icon`, `.gsi-banner-verdict-caution`, `.gsi-banner-verdict-dangerous` (old inline verdict badge)
- `.gsi-ai-scan-text` (replaced by AI summary line loading state)
- `.gsi-ai-section`, `.gsi-ai-loading` (replaced by `.gsi-ai-line`)
- `.gsi-profile-name` (dropped from new strip — profile image only, no name text)
- `.gsi-source-badge`, `.gsi-badge-bimi`, `.gsi-badge-favicon`, `.gsi-badge-unknown`, `.gsi-source-verdict-*` (source badge replaced by inline pills)

Keep these unchanged:
- `#gsi-tooltip` and tooltip styles (lines 5-37)
- `.gsi-logo` shared styles (line 364-370)
- `.gsi-gemini-ok`, `.gsi-gemini-caution`, `.gsi-gemini-reject`, `.gsi-gemini-neutral` (sparkle color classes)
- `.gsi-ai-verdict`, `.gsi-ai-verdict-ok`, `.gsi-ai-verdict-caution`, `.gsi-ai-verdict-reject` (reused in AI line + details)
- `.gsi-ai-reasons`, `.gsi-ai-reason-item` (reused in details panel)
- `.gsi-ai-refresh-btn` (reused for retry button)

- [ ] **Step 9: Commit CSS changes**

```bash
git add src/styles.css
git commit -m "style: replace banner with compact strip layout"
```

---

### Task 2: Rewrite insertBanner() — main strip row

**Files:**
- Modify: `src/content.js:1043-1175` (insertBanner top row construction)

- [ ] **Step 1: Rewrite the top row construction**

Replace the `insertBanner` function's top row section (lines 1049-1175) with the new compact strip structure. The banner element keeps `id='gsi-banner'`. Build the main strip row:

```javascript
const banner = document.createElement('div');
banner.id = 'gsi-banner';

// --- Main strip row ---
const stripRow = document.createElement('div');
stripRow.classList.add('gsi-strip-row');

// Shared state for async logo/security coordination (unchanged logic)
const bannerState = { resolvedLogoSource: null, authVerdict: null };

// Logo (24x24)
const logo = createLogoImg(info, (sourceKey) => {
  bannerState.resolvedLogoSource = sourceKey;
  if (sourceKey === SOURCE_UNKNOWN && bannerState.authVerdict === 'trusted') {
    updateVerdictPill(verdictPill, 'caution');
    updateGeminiColor(geminiIcon, 'caution');
  }
});
stripRow.appendChild(logo);

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

// Profile image (20x20, conditional)
const textWrap = stripRow; // Profile attaches to strip row now
function tryAddProfileImage() {
  const result = extractProfileImageUrl(envelopeEmail);
  banner.__gsiProfileDebug = result.debug;
  if (result.url) {
    const old = stripRow.querySelector('.gsi-profile-img');
    if (old) old.remove();
    const profileImg = document.createElement('img');
    profileImg.classList.add('gsi-profile-img');
    profileImg.src = result.url;
    profileImg.width = 20;
    profileImg.height = 20;
    profileImg.alt = result.debug.dataName || 'Sender profile';
    profileImg.onerror = () => profileImg.remove();
    // Insert after domain/root spans, before divider
    const firstDivider = stripRow.querySelector('.gsi-strip-divider');
    if (firstDivider) {
      stripRow.insertBefore(profileImg, firstDivider);
    } else {
      stripRow.appendChild(profileImg);
    }
    return true;
  }
  return false;
}

// Divider
const div1 = document.createElement('span');
div1.classList.add('gsi-strip-divider');
div1.textContent = '|';
stripRow.appendChild(div1);

// Security pills (loading state)
const spfPill = createPill('SPF', 'loading');
const dkimPill = createPill('DKIM', 'loading');
const dmarcPill = createPill('DMARC', 'loading');
stripRow.appendChild(spfPill);
stripRow.appendChild(dkimPill);
stripRow.appendChild(dmarcPill);

// Divider
const div2 = document.createElement('span');
div2.classList.add('gsi-strip-divider');
div2.textContent = '|';
stripRow.appendChild(div2);

// Verdict pill (loading state)
const verdictPill = createPill('Checking', 'loading', true);
stripRow.appendChild(verdictPill);

// Spacer
const spacer = document.createElement('div');
spacer.style.flex = '1';
stripRow.appendChild(spacer);

// Gemini sparkle (hidden until AI check confirms available)
const geminiIcon = createGeminiIcon();
geminiIcon.style.display = 'none';
stripRow.appendChild(geminiIcon);

// Expand arrow
const expandArrow = document.createElement('span');
expandArrow.classList.add('gsi-strip-expand');
expandArrow.textContent = '▼';
stripRow.appendChild(expandArrow);

banner.appendChild(stripRow);

// Profile image retry
if (!tryAddProfileImage()) {
  setTimeout(() => { if (banner.isConnected) tryAddProfileImage(); }, 500);
  setTimeout(() => { if (banner.isConnected && !stripRow.querySelector('.gsi-profile-img')) tryAddProfileImage(); }, 1500);
}
```

- [ ] **Step 2: Add helper functions `createPill`, `updatePill`, `updateVerdictPill`, `updateGeminiColor`**

Add these before `insertBanner`:

```javascript
function createPill(label, state, isVerdict = false) {
  const pill = document.createElement('span');
  pill.classList.add('gsi-pill');
  if (isVerdict) pill.classList.add('gsi-pill-verdict');
  pill.textContent = state === 'loading' ? (isVerdict ? 'Checking' : label) : label;
  pill.dataset.check = label;
  updatePillState(pill, state, label, isVerdict);
  return pill;
}

function updatePillState(pill, state, label, isVerdict = false) {
  pill.classList.remove('gsi-pill-pass', 'gsi-pill-fail', 'gsi-pill-loading',
    'gsi-pill-trusted', 'gsi-pill-caution', 'gsi-pill-dangerous');
  if (isVerdict) {
    const cls = { trusted: 'gsi-pill-trusted', caution: 'gsi-pill-caution', dangerous: 'gsi-pill-dangerous' };
    pill.classList.add(cls[state] || 'gsi-pill-loading');
    pill.textContent = state === 'loading' ? 'Checking' : state.charAt(0).toUpperCase() + state.slice(1);
  } else {
    if (state === 'pass') {
      pill.classList.add('gsi-pill-pass');
      pill.textContent = label + ' ✓';
    } else if (state === 'fail' || state === 'softfail') {
      pill.classList.add('gsi-pill-fail');
      pill.textContent = label + ' ✗';
    } else {
      pill.classList.add('gsi-pill-loading');
      pill.textContent = label;
    }
  }
}

function updateVerdictPill(pill, verdict) {
  updatePillState(pill, verdict, '', true);
}

function updateGeminiColor(icon, verdict) {
  icon.classList.remove('gsi-gemini-ok', 'gsi-gemini-caution', 'gsi-gemini-reject', 'gsi-gemini-neutral');
  const map = { trusted: 'gsi-gemini-ok', caution: 'gsi-gemini-caution', dangerous: 'gsi-gemini-reject' };
  icon.classList.add(map[verdict] || 'gsi-gemini-neutral');
}

function createSparkleSvg(size, fill) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M14 0C14 7.732 20.268 14 28 14C20.268 14 14 20.268 14 28C14 20.268 7.732 14 0 14C7.732 14 14 7.732 14 0Z');
  path.setAttribute('fill', fill);
  svg.appendChild(path);
  svg.style.flexShrink = '0';
  return svg;
}

function createGeminiIcon() {
  const geminiIcon = document.createElement('span');
  geminiIcon.classList.add('gsi-gemini-icon');
  geminiIcon.title = 'AI analysis by Gemini Nano';
  geminiIcon.appendChild(createSparkleSvg(14, 'currentColor'));
  return geminiIcon;
}
```

- [ ] **Step 3: Rewrite `createSecuritySection` to update strip pills + populate details panel**

Replace the current `createSecuritySection(container, summaryEl, info, envelopeEmail, bannerBadgeEl, sourceBadgeEl, bannerState)` with a new signature and implementation:

```javascript
/**
 * Fetch auth results and update strip pills + details panel.
 * @param {Object} pills - { spf, dkim, dmarc, verdict } pill elements in the strip
 * @param {HTMLElement} geminiIcon - sparkle icon to color by verdict
 * @param {HTMLElement} detailsSecSection - security section in details panel to populate
 * @param {Object} info - sender info from background
 * @param {string} envelopeEmail - envelope sender email
 * @param {Object} bannerState - shared state for logo/auth coordination
 */
function createSecuritySection(pills, geminiIcon, detailsSecSection, info, envelopeEmail, bannerState) {
  (async () => {
    const msgResult = getMessageId();
    if (!msgResult) {
      updateVerdictPill(pills.verdict, 'caution');
      updateGeminiColor(geminiIcon, 'caution');
      const errRow = document.createElement('div');
      errRow.classList.add('gsi-details-row');
      errRow.textContent = 'Unable to find message ID';
      errRow.style.color = '#c62828';
      detailsSecSection.appendChild(errRow);
      return;
    }

    const { id: messageId } = msgResult;
    let authResults = securityCache.get(messageId);
    if (!authResults) {
      const result = await fetchEmailHeaders(messageId);
      if (result.error) {
        updateVerdictPill(pills.verdict, 'caution');
        updateGeminiColor(geminiIcon, 'caution');
        const errRow = document.createElement('div');
        errRow.classList.add('gsi-details-row');
        errRow.textContent = `Unable to check (${result.error})`;
        errRow.style.color = '#c62828';
        detailsSecSection.appendChild(errRow);
        return;
      }
      authResults = result.authData || parseAuthResults(result.headers);
      if (authResults) securityCache.set(messageId, authResults);
    }

    if (!authResults) {
      updateVerdictPill(pills.verdict, 'caution');
      updateGeminiColor(geminiIcon, 'caution');
      return;
    }

    // Update strip pills
    const checks = [
      { key: 'spf', pill: pills.spf, label: 'SPF' },
      { key: 'dkim', pill: pills.dkim, label: 'DKIM' },
      { key: 'dmarc', pill: pills.dmarc, label: 'DMARC' },
    ];
    for (const { key, pill, label } of checks) {
      const value = authResults[key];
      if (value === 'pass') updatePillState(pill, 'pass', label);
      else if (value === 'fail' || value === 'softfail') updatePillState(pill, 'fail', label);
      else updatePillState(pill, 'loading', label); // n/a

      // Populate details panel row with full value
      const row = document.createElement('div');
      row.classList.add('gsi-details-row');
      row.textContent = `${label}: ${value || 'n/a'}`;
      detailsSecSection.appendChild(row);
    }

    // BIMI row in details (not in strip pills)
    const bimiRow = document.createElement('div');
    bimiRow.classList.add('gsi-details-row');
    bimiRow.textContent = `BIMI: ${info.logoSource === 'bimi' ? 'pass (DNS)' : 'none'}`;
    detailsSecSection.appendChild(bimiRow);

    // Compute verdict (same logic as before)
    let verdictKey = getVerdict(authResults, info);
    if (bannerState && bannerState.resolvedLogoSource === SOURCE_UNKNOWN && verdictKey === 'trusted') {
      verdictKey = 'caution';
    }
    if (bannerState) bannerState.authVerdict = verdictKey;

    // Update strip verdict pill and gemini icon
    updateVerdictPill(pills.verdict, verdictKey);
    updateGeminiColor(geminiIcon, verdictKey);
  })();
}
```

Call site in `insertBanner` (after creating pills and details panel):

```javascript
createSecuritySection(
  { spf: spfPill, dkim: dkimPill, dmarc: dmarcPill, verdict: verdictPill },
  geminiIcon,
  secSection,  // the security .gsi-details-section in the details panel
  info,
  envelopeEmail,
  bannerState
);
```

Note: The old `setVerdict()`, `VERDICTS`, `VERDICTS_SM`, `VERDICT_CAUTION_SVG_SM`, `VERDICT_DANGER_SVG_SM` constants, and `sourceBadgeEl` parameter are no longer needed — these are replaced by `updateVerdictPill` and `updateGeminiColor`.

- [ ] **Step 4: Commit main strip rewrite**

```bash
git add src/content.js
git commit -m "feat: rewrite banner main strip with inline security pills"
```

---

### Task 3: Add AI summary line

**Files:**
- Modify: `src/content.js` (AI section in insertBanner)

- [ ] **Step 1: Build the AI summary line element**

After appending `stripRow` to banner, add the AI summary line. This replaces the old `gsi-ai-scan-text` cycling messages and the AI section inside the accordion.

```javascript
// --- AI summary line (below strip, always visible) ---
const aiLine = document.createElement('div');
aiLine.classList.add('gsi-ai-line');
aiLine.style.display = 'none'; // hidden until AI availability confirmed

// Reuse createSparkleSvg from Task 2 Step 2 helper functions
const aiSparkle = createSparkleSvg(14, '#9aa0a6');
aiLine.appendChild(aiSparkle);

const aiLineText = document.createElement('span');
aiLineText.classList.add('gsi-ai-line-text', 'gsi-ai-line-loading');
aiLineText.textContent = 'Analyzing...';
aiLine.appendChild(aiLineText);

banner.appendChild(aiLine);
```

- [ ] **Step 2: Update the AI async block to use AI summary line**

Replace the AI async IIFE (lines 1279-1386) to:
1. Show `aiLine` when AI is available (instead of showing gemini icon + scan text)
2. Show gemini icon in strip simultaneously
3. On result: update `aiLine` with verdict pill + reason text (instead of updating the accordion AI section)
4. On error/timeout: show "Analysis unavailable" + retry button in the AI line
5. Remove the old `scanText` cycling messages entirely
6. Still insert full AI reasons into the details panel (not the AI line)

- [ ] **Step 3: Commit AI summary line**

```bash
git add src/content.js
git commit -m "feat: add AI summary line below strip"
```

---

### Task 4: Rewrite expanded details panel

**Files:**
- Modify: `src/content.js` (accordion section in insertBanner, lines 1177-1261)

- [ ] **Step 1: Replace three-column accordion with single-column details panel**

Replace the accordion construction with a details panel that is toggled by the expand arrow:

```javascript
// --- Details panel (hidden by default) ---
const detailsPanel = document.createElement('div');
detailsPanel.classList.add('gsi-details-panel');

// Toggle via expand arrow
expandArrow.addEventListener('click', () => {
  const isOpen = detailsPanel.style.display === 'block';
  detailsPanel.style.display = isOpen ? 'none' : 'block';
  expandArrow.textContent = isOpen ? '▼' : '▲';
});

// 1. Security details section
const secSection = document.createElement('div');
secSection.classList.add('gsi-details-section');
const secLabel = document.createElement('div');
secLabel.classList.add('gsi-details-label');
secLabel.textContent = 'Security';
secSection.appendChild(secLabel);
// Security detail rows populated by createSecuritySection callback
detailsPanel.appendChild(secSection);

// 2. Logo source section
const srcSection = document.createElement('div');
srcSection.classList.add('gsi-details-section');
const srcLabel = document.createElement('div');
srcLabel.classList.add('gsi-details-label');
srcLabel.textContent = 'Logo Source';
srcSection.appendChild(srcLabel);
const srcText = document.createElement('div');
srcText.classList.add('gsi-details-source');
srcText.textContent = 'Resolving...';
srcSection.appendChild(srcText);
detailsPanel.appendChild(srcSection);

// 3. AI analysis details (populated after AI result)
const aiDetailsSection = document.createElement('div');
aiDetailsSection.classList.add('gsi-details-section');
aiDetailsSection.style.display = 'none'; // hidden until AI result
detailsPanel.appendChild(aiDetailsSection);

// 4. Debug section (nested collapsible)
// Built by the original sender / debug async block — same as current

banner.appendChild(detailsPanel);
```

- [ ] **Step 2: Update logo resolution callback to set source text**

In the `createLogoImg` callback, update `srcText.textContent` with the resolved source:

```javascript
const sourceLabels = {
  bimi_full: 'BIMI (full domain)',
  bimi_root: 'BIMI (root domain)',
  favicon_sub: 'Favicon (subdomain)',
  favicon_root: 'Favicon (root domain)',
  unknown: 'Unknown (fallback)',
};
// In callback: srcText.textContent = sourceLabels[sourceKey] || sourceKey;
```

- [ ] **Step 3: Populate AI details section when result arrives**

When the AI result is received, if there are multiple reasons, populate `aiDetailsSection` with the full bulleted list (reuse existing `.gsi-ai-reasons` / `.gsi-ai-reason-item` classes).

- [ ] **Step 4: Commit details panel**

```bash
git add src/content.js
git commit -m "feat: replace three-column accordion with single-column details panel"
```

---

### Task 5: Update original sender swap logic

**Files:**
- Modify: `src/content.js:1388-1641` (original sender async block)

- [ ] **Step 1: Update DOM queries for new class names**

The original sender block queries `.gsi-banner-text`, `.gsi-banner-domain`, `.gsi-banner-root`, `.gsi-source-badge`, etc. Update all selectors to the new strip classes:

| Old selector | New selector |
|-------------|-------------|
| `.gsi-banner-text` | `.gsi-strip-row` |
| `.gsi-banner-domain` | `.gsi-strip-domain` |
| `.gsi-banner-root` | `.gsi-strip-root` |
| `.gsi-source-badge` | (removed — no replacement needed) |
| `.gsi-profile-name` | (removed — no name text in strip) |
| `.gsi-accordion-content` | `.gsi-details-panel` |
| `.gsi-details-table` | (removed — use `.gsi-details-section` for original sender info) |

- [ ] **Step 2: Simplify original sender accordion section**

Replace the two-column (favicons + security) original sender section with a single-column section matching the new details panel style. Use `.gsi-details-section` with a "Original Sender" label, and a simple line showing the original sender domain + favicon source.

- [ ] **Step 3: Update debug section construction**

Update the debug section to use CSS classes instead of inline styles (use `.gsi-debug-section`, `.gsi-debug-header`, `.gsi-debug-content` from the new CSS). Change the debug content background from `#fff3cd` to `#f8f9fa` to match the neutral strip aesthetic.

- [ ] **Step 4: Commit original sender updates**

```bash
git add src/content.js
git commit -m "feat: update original sender swap for compact strip layout"
```

---

### Task 6: Clean up removed code and update CLAUDE.md

**Files:**
- Modify: `src/content.js` (remove dead helpers)
- Modify: `CLAUDE.md` (update design elements documentation)

- [ ] **Step 1: Remove dead helper functions**

Remove or update functions and constants that are no longer used:
- `updateBadge()` — source badge no longer exists in strip
- `setVerdict()` — old verdict column no longer exists (replaced by `updateVerdictPill`)
- `createAiSection()` — old accordion AI section replaced by AI summary line
- `updateAiSection()` — same, replaced by inline AI line updates
- `VERDICTS`, `VERDICTS_SM`, `VERDICT_CAUTION_SVG_SM`, `VERDICT_DANGER_SVG_SM` constants — replaced by pill-based verdict
- `AI_SCAN_MESSAGES` constant — cycling scan text replaced by static "Analyzing..." in AI line
- `SOURCE_LABELS` / `updateBadge` — source badge removed from strip

Preserve:
- `appendAiDebugLines()` — still used to write AI debug data to the debug section
- `securityCache` — caching behavior unchanged in the rewritten `createSecuritySection`

Check each function for remaining callers before removing.

- [ ] **Step 2: Update CLAUDE.md banner layout documentation**

Update the "Banner Layout" section in CLAUDE.md to document the new strip structure, element classes, and behavior. Remove references to the old three-column layout, source badge behavior table, and verdict badge section. Add the new strip element table, pill states, and AI summary line states.

- [ ] **Step 3: Commit cleanup**

```bash
git add src/content.js CLAUDE.md
git commit -m "chore: remove dead banner code, update CLAUDE.md for strip layout"
```

---

### Task 7: Manual testing

- [ ] **Step 1: Load extension and test trusted email**

Load unpacked at `chrome://extensions/`, open a Gmail email from a known trusted sender (e.g., google.com). Verify:
- Strip shows with green SPF/DKIM/DMARC pills
- Verdict shows "Trusted" in green
- AI line shows "No concerns detected" after analysis
- Expand arrow toggles details panel
- Debug section is collapsible inside details

- [ ] **Step 2: Test caution email**

Open an email with mixed auth results or unknown logo. Verify:
- Mixed pill colors (green/red)
- Orange "Caution" verdict
- AI line shows caution reason
- Gemini sparkle turns orange

- [ ] **Step 3: Test mailing list email**

Open a Google Groups or mailing list email. Verify:
- Strip swaps to original sender logo/domain
- Via badge shows "via googlegroups.com"
- Details panel has "Original Sender" section

- [ ] **Step 4: Test inbox tooltip**

Hover over inbox rows. Verify tooltips still work unchanged.

- [ ] **Step 5: Test without AI**

If possible, test on Chrome < 138 or with Prompt API disabled. Verify:
- AI summary line is not shown
- Strip works standalone at ~40px height
