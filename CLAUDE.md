# Gmail Sender Info

Chrome extension that displays sender domain information in Gmail.

## Architecture

```
gmail-sender-info/
├── manifest.json           # Manifest V3
├── src/
│   ├── content.js          # MutationObserver, tooltip, banner, logo fallback chain
│   ├── background.js       # Service worker: BIMI DNS lookup, caching
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

## Development

1. Load unpacked at `chrome://extensions/` pointing to this directory
2. Reload after changes
3. Test on Gmail inbox (hover rows) and email view (banner above subject)
