# Gmail Sender Info

Chrome extension that displays sender domain information in Gmail.

## Architecture

```
gmail-sender-info/
├── manifest.json           # Manifest V3
├── src/
│   ├── content.js          # MutationObserver, tooltip, banner, logo fallback chain
│   ├── background.js       # Service worker: BIMI DNS lookup, caching, AI analysis
│   ├── page-fetch.js       # MAIN world: fetches raw headers using Gmail's session
│   └── styles.css          # Styles for tooltip (#gsi-tooltip) and banner (#gsi-banner)
├── images/
│   ├── icon.svg            # Source SVG for icon (512×512)
│   ├── icon{16,48,128}.png # Extension icons (generated from icon.svg)
│   ├── promo-small.png     # Chrome Web Store small promo tile (440×280)
│   ├── promo-large.png     # Chrome Web Store large/marquee promo tile (1400×560)
│   └── caution.svg         # Amber warning triangle fallback
└── CLAUDE.md
```

## Key Selectors (Gmail DOM)

- `.zA` — Inbox row
- `.hP` — Subject line in email view
- `.gD[email]` — Sender element in email view
- `.yW span[email]` — Sender in inbox rows

## Message Protocol

**Content → Background:** `{ action: 'getSenderInfo', email: 'user@example.com' }`

**Background → Content:** `{ fullDomain, rootDomain, logoUrl, logoSource, faviconSubUrl, faviconRootUrl }`

**Content → Background:** `{ action: 'checkAiAvailable' }`

**Background → Content:** `{ available: true|false }`

**Content → Background:** `{ action: 'analyzeEmail', data: { displayName, senderEmail, subject, bodyText, links } }`

**Background → Content:** `{ verdict: 'Ok'|'Caution'|'Reject', reasons: [...] }` or `{ unavailable: true }`

## Logo Resolution Chain

1. BIMI TXT record on full domain (via dns.google)
2. BIMI TXT record on root domain
3. Google favicon service (subdomain)
4. Google favicon service (root domain)
5. `caution.svg` fallback

## Permissions

- `storage` — Cache BIMI/favicon results (24h TTL)
- `https://dns.google/*` — BIMI DNS-over-HTTPS lookups

## Documentation

When changing external services, security measures, permissions, or the sender safety evaluation process, update the corresponding section in `README.md`.

## Generated Assets

When creating or modifying generated assets (icons, images, promotional graphics):

1. **Document why** — Record the reason the asset was created or changed (e.g. Chrome Web Store requirement, design refresh).
2. **Document where** — List the file path and dimensions in both the Architecture tree above and the Chrome Web Store Assets table in `README.md`.
3. **Document what it's used for** — Note the specific context (manifest reference, store listing field, in-extension UI).
4. **Keep source files** — Always commit the editable source (SVG) alongside generated PNGs so assets can be regenerated. Include regeneration commands in `README.md`.

## Design Elements

When creating or modifying UI components (badges, banners, tooltips, icons), document:

1. **CSS class names** — List the class and what it styles.
2. **Verdict/state mapping** — Which visual states exist (colors, visibility, text).
3. **Data flow** — What triggers the element to update (e.g. auth results, logo load).

### Banner Layout (email view) — Compact Strip

The banner (`#gsi-banner`) is a compact horizontal strip with three sections stacked vertically:

#### 1. Main Strip (`.gsi-strip-row`)

| Element | Class | Description |
|---------|-------|-------------|
| Logo | `.gsi-logo` | 24×24 sender logo from BIMI/favicon chain |
| Domain | `.gsi-strip-domain` | 13px bold domain text |
| Root domain | `.gsi-strip-root` | 11px grey `(rootDomain)` shown if different from fullDomain |
| Profile image | `.gsi-profile-img` | 20×20 circular Gmail avatar (conditional — only real photos). Retries at 500ms/1500ms |
| Via badge | `.gsi-via-badge` | "via domain" for mailing list emails |
| Divider | `.gsi-strip-divider` | `\|` visual separator |
| SPF pill | `.gsi-pill` | Pass (green) / fail (red) / loading (grey) |
| DKIM pill | `.gsi-pill` | Same color scheme |
| DMARC pill | `.gsi-pill` | Same color scheme |
| Verdict pill | `.gsi-pill .gsi-pill-verdict` | Trusted (green), Caution (orange), Dangerous (red) |
| Gemini sparkle | `.gsi-gemini-icon` | 24×24 circle, color matches verdict |
| Expand arrow | `.gsi-strip-expand` | `▼`/`▲` toggles details panel |

**Security pill states:** `.gsi-pill-pass` (green), `.gsi-pill-fail` (red), `.gsi-pill-loading` (grey). Show ✓/✗ with label text.

**Verdict pill states:** `.gsi-pill-trusted` (green), `.gsi-pill-caution` (orange), `.gsi-pill-dangerous` (red).

**Logo-source override:** If the logo chain falls through to caution.svg (source = unknown), the verdict is capped at caution even if SPF/DKIM/DMARC all pass. Coordinated via a shared `bannerState` object.

#### 2. AI Summary Line (`.gsi-ai-line`)

Always visible below the main strip (not inside the expandable details). Uses Chrome's built-in Prompt API (Gemini Nano, Chrome 138+).

| State | Content |
|-------|---------|
| Loading | Grey sparkle + "Analyzing..." italic |
| Result | Colored sparkle + verdict pill (`.gsi-ai-verdict`) + one-line reason text |
| Error | Grey sparkle + "Analysis unavailable" + retry button (`.gsi-ai-refresh-btn`) |
| Unavailable | Line removed entirely |

**Data flow:** On banner insert → check AI availability → show loading → extract email data → send to background → Gemini Nano scores → update AI line with verdict + first reason. Full reasons list shown in details panel.

**Criteria evaluated:**
1. Sender display name vs email address mismatch (brand impersonation)
2. Urgency/threat language in subject and body
3. Link domain discrepancies (excluding link shorteners and subdomains)

#### 3. Details Panel (`.gsi-details-panel`)

Hidden by default, toggled by expand arrow. Single-column stacked layout:

1. **Security** (`.gsi-details-section`) — Full SPF/DKIM/DMARC/BIMI result values
2. **Logo Source** (`.gsi-details-source`) — Which source resolved (BIMI, favicon, unknown)
3. **AI Analysis** — Full bulleted reasons list (`.gsi-ai-reasons` / `.gsi-ai-reason-item`)
4. **Debug** (`.gsi-debug-section`) — Nested collapsible with envelope email, headers, BIMI DNS status

## Development

1. Load unpacked at `chrome://extensions/` pointing to this directory
2. Reload after changes
3. Test on Gmail inbox (hover rows) and email view (banner above subject)
