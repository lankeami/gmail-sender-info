# Banner Redesign: Compact Strip

**Date:** 2026-03-22
**Status:** Draft

## Problem

The current email-view banner is a large lavender block (~120px tall) with a gold border, oversized domain text (22px), 40px logo, and a three-column expandable details layout. It takes too much vertical space and the styling feels dated.

## Design

Replace the banner with a compact horizontal strip (~55px total) that surfaces all key information inline, with a clean Notion/Linear-inspired aesthetic.

### Structure

The banner is a single rounded container with up to three horizontal sections stacked vertically:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [logo] domain.com │ SPF ✓ │ DKIM ✓ │ DMARC ✗ │ Caution │ ✦  ▼ │  ← Main strip
├──────────────────────────────────────────────────────────────────────┤
│ ✦ Caution · Sender impersonates Redfin                             │  ← AI summary line
├──────────────────────────────────────────────────────────────────────┤
│ (expanded details — hidden by default)                              │  ← Details panel
└──────────────────────────────────────────────────────────────────────┘
```

### 1. Main Strip (~40px)

A single horizontal row containing, left to right:

| Element | Size | Description |
|---------|------|-------------|
| Logo | 24×24px, 4px border-radius | BIMI/favicon logo from existing resolution chain |
| Domain | 13px, font-weight 600 | `fullDomain` text. If `rootDomain` differs, show `(rootDomain)` in 11px `#9aa0a6` after it |
| Profile image | 20×20px circle | Gmail avatar (conditional — only real photos, same detection logic as current). Appears after domain text. Retry at 500ms/1500ms if not yet loaded. `onerror` removes silently |
| Via badge | 11px, `#5f6368` bg `#f1f3f4` | "via googlegroups.com" — shown when mailing list detected. Appears after domain/profile |
| Divider | `\|` in `#dadce0` | Visual separator |
| SPF pill | 10px uppercase | Pass (green `#e8f5e9`/`#1b5e20`) or fail (red `#ffebee`/`#c62828`). Shows neutral grey `#f1f3f4`/`#5f6368` while loading |
| DKIM pill | 10px uppercase | Same color scheme as SPF |
| DMARC pill | 10px uppercase | Same color scheme as SPF |
| Divider | `\|` in `#dadce0` | Visual separator |
| Verdict pill | 11px uppercase | Trusted (green), Caution (orange `#fff3e0`/`#e65100`), Dangerous (red). Shows "Checking" in neutral grey while loading |
| Spacer | `flex: 1` | Pushes remaining items right |
| Gemini sparkle | 24×24px circle | Color matches verdict; grey while loading |
| Expand arrow | 11px `▼` / `▲` | Toggles details panel. Rotates on open/close |

**Security pills** show ✓ (pass) or ✗ (fail/softfail) with colored backgrounds. While the async security check is in progress, pills show a neutral grey "..." state. These replace the need to expand the accordion to see security results.

**Verdict pill** logic is unchanged from current implementation (trusted/caution/dangerous based on SPF+DKIM+DMARC results, with unknown-logo override to cap at caution).

### Original Sender (mailing list emails)

When a mailing list email is detected (existing `detectOriginalSender` logic), the strip updates:

1. **Main strip** — Logo, domain, and profile image swap to the original sender's info. The via badge shows the mailing list domain (e.g., "via googlegroups.com").
2. **Expanded details** — An "Original Sender" section is added above the security details, showing the original sender's favicon and domain info.
3. Security pills and verdict reflect the envelope sender's auth results (unchanged behavior).

### 2. AI Summary Line (~25px)

Sits below the main strip, separated by a thin `1px solid #ebebeb` border.

| State | Content |
|-------|---------|
| Loading | Grey sparkle icon + "Analyzing..." in italic `#9aa0a6` |
| Result | Colored sparkle + AI verdict pill (Ok/Caution/Reject) + first reason as one-line text in `#5f6368` |
| Error/Timeout | Grey sparkle + italic "Analysis unavailable" in `#9aa0a6` + 🔄 retry button (20×20px, same as current `.gsi-ai-refresh-btn`) |
| Unavailable | Line is removed entirely (Prompt API not available) |

The AI summary line is always visible (not inside the expandable area). It appears on banner insert with the loading state and updates in-place when the AI result arrives.

### 3. Expanded Details Panel (hidden by default)

Toggled by the ▼ arrow. Single-column stacked layout inside the same container.

**Content (top to bottom):**

1. **Security details** — One row per check (SPF, DKIM, DMARC) showing the full result value (e.g., "pass (sender IP is 209.85.220.41)"). Uses the same pill color scheme but with more detail text.

2. **Favicon/BIMI source** — Single line showing which logo source resolved (e.g., "BIMI (full domain)", "Favicon (root)", "Unknown"). Simplified from current multi-row favicon comparison table.

3. **AI analysis details** — If AI returned multiple reasons, show the full bulleted list here (currently only the first reason shows in the summary line).

4. **Debug section** — Nested collapsible (`▶ Debug`). Contains:
   - Envelope email, X-Original-Sender, fetch path (HTML vs raw)
   - Raw header lines when available (Authentication-Results, Received-SPF, DKIM-Signature)
   - Parsed values fallback when only HTML path data available
   - BIMI DNS status

### Styling

| Property | Value |
|----------|-------|
| Background | `#fafafa` |
| Border | `1px solid #e0e0e0` |
| Border radius | `8px` |
| Font family | `'Google Sans', Roboto, Arial, sans-serif` |
| Main strip padding | `8px 14px` |
| AI line padding | `6px 14px` |
| Details padding | `10px 14px` |

No colored background tints on the container. Verdict colors appear only on pills and icons.

**Width:** Banner dynamically matches the email body width (existing logic preserved from current implementation).

### State Variants

**Trusted email (all checks pass, BIMI logo):**
- All three security pills green
- Verdict pill green "Trusted"
- Gemini sparkle green
- AI line: green "Ok" + "No concerns detected"

**Caution email (mixed results or unknown logo):**
- Mixed green/red security pills
- Verdict pill orange "Caution"
- Gemini sparkle orange
- AI line: orange "Caution" + reason text

**Dangerous email (multiple failures):**
- Red security pills
- Verdict pill red "Dangerous"
- Gemini sparkle red
- AI line: red "Reject" + reason text

**No AI available:**
- AI summary line removed entirely
- Main strip stands alone (~40px total height)

## Files Changed

| File | Changes |
|------|---------|
| `src/styles.css` | Replace `#gsi-banner` styles with new strip layout; update accordion to single-column; keep tooltip styles unchanged |
| `src/content.js` | Rewrite `insertBanner()` to build new strip structure; move security pills into main row; restructure accordion content to single-column with nested debug collapsible |

## Migration Notes

- No new permissions required
- No changes to background.js or message protocol
- Logo resolution chain unchanged
- Tooltip (inbox hover) unchanged
- All existing CSS class names will be replaced with new ones matching the new structure
