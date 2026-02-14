# Gmail Sender Info

Chrome extension that displays sender domain information in Gmail.

## Architecture

```
gmail-sender-info/
├── manifest.json           # Manifest V3
├── src/
│   ├── content.js          # MutationObserver, tooltip, banner, logo fallback chain
│   ├── background.js       # Service worker: BIMI DNS lookup, caching
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

### Banner Layout (email view)

The banner (`#gsi-banner`) top row contains, in order:

| Element | Class | Description |
|---------|-------|-------------|
| Logo | `.gsi-logo` | 40×40 sender logo from BIMI/favicon chain |
| Verdict badge | `.gsi-banner-verdict` | 18×18 SVG icon (caution triangle or danger circle). Hidden when trusted. |
| Domain text | `.gsi-banner-text` | Full domain, root domain (if different), source badge, and via badge |
| Source badge | `.gsi-source-badge` | Context-dependent text next to domain (see below) |

### Source Badge Behavior

The source badge (`.gsi-source-badge`) changes based on logo source and auth results:

| Logo Source | Auth Result | Display |
|-------------|-------------|---------|
| BIMI | All pass | Hidden |
| BIMI | Any fail/softfail | Failure text, e.g. "SPF: softfail" — colored by verdict (orange for caution, red for dangerous) |
| Favicon | Any | Hidden |
| Unknown | Any | "unknown" in red |

Verdict-colored classes: `.gsi-source-verdict-caution` (orange `#e65100`), `.gsi-source-verdict-dangerous` (red `#c62828`).

### Verdict Badge (inline)

The inline verdict badge (`.gsi-banner-verdict`) in the top row mirrors the accordion summary verdict:

| Verdict | Class | Display |
|---------|-------|---------|
| Trusted | — | Hidden (`display: none`) |
| Caution | `.gsi-banner-verdict-caution` | 18×18 amber triangle, orange background |
| Dangerous | `.gsi-banner-verdict-dangerous` | 18×18 red circle with X, red background |

### Debug Section

Collapsible section inside the details accordion. Shows:
- Envelope email, X-Original-Sender, fetch path (HTML vs raw)
- Raw header lines: `Authentication-Results`, `Received-SPF`, `DKIM-Signature` (when raw headers available)
- Parsed values fallback when only HTML path data is available
- BIMI DNS status

## Development

1. Load unpacked at `chrome://extensions/` pointing to this directory
2. Reload after changes
3. Test on Gmail inbox (hover rows) and email view (banner above subject)
