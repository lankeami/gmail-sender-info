# Gmail Sender Info

Chrome extension that displays sender domain information and email authentication results directly in Gmail. Shows a tooltip on inbox row hover and a detailed banner when viewing an email.

## External Services

| Service | URL | Purpose |
|---------|-----|---------|
| Google DNS-over-HTTPS | `https://dns.google/resolve` | BIMI TXT record lookups to find verified brand logos |
| Google Favicon Service | `https://www.google.com/s2/favicons` | Fetches website favicons for sender domains |
| gstatic Favicon V2 | `https://t0.gstatic.com/faviconV2` | Detects generic globe icons (no real favicon exists) |
| Gmail `view=om` endpoint | `https://mail.google.com/mail/u/{n}/?view=om` | Fetches raw email headers for authentication checks |

No data is sent to any third-party analytics, tracking, or non-Google service.

## Security Measures

### Permissions (Minimal)

The extension requests only two permissions:

- **`storage`** -- Caches BIMI/favicon results locally with a 24-hour TTL. Cache is cleared on extension install/update.
- **`host_permissions`** for `dns.google` and `*.gstatic.com` -- Required for BIMI DNS lookups and globe-icon detection. No broad host access.

### Header Fetching Without Extra Permissions

Email headers are fetched using a MAIN-world content script (`page-fetch.js`) that runs in Gmail's own page context. This means `fetch()` calls to Gmail's `view=om` endpoint are same-origin and use the existing session cookies -- no additional permissions (like `cookies` or broad host access) are needed.

### Content Security

- All DOM elements (tooltips, banners, badges) are created with `document.createElement` -- no `innerHTML` from untrusted input.
- The only use of `innerHTML` is for hardcoded SVG verdict icons defined as string constants in the source code.
- Input emails are lowercased and trimmed; invalid addresses (missing `@`) are rejected before processing.

### Caching

- Results are stored in `chrome.storage.local` keyed by email address with a 24-hour TTL.
- Stale entries are evicted on read. All cache is cleared on extension install or update.
- In-memory request deduplication prevents redundant concurrent lookups for the same email.

## How Sender Safety Is Determined

The extension evaluates sender trustworthiness using two independent signals: **logo resolution** (brand identity) and **email authentication** (SPF/DKIM/DMARC).

### 1. Logo Resolution Chain

When a sender email is encountered, the background service worker resolves a logo through this fallback chain:

1. **BIMI lookup on full domain** -- Queries `default._bimi.{full-domain}` via DNS-over-HTTPS for a `v=BIMI1` TXT record containing an `l=` SVG logo URL.
2. **BIMI lookup on root domain** -- If the full domain (e.g. `newsletter.stripe.com`) has no BIMI record, tries the root domain (`stripe.com`).
3. **Google favicon (root domain)** -- Uses Google's favicon service. The background script also checks the gstatic endpoint to detect if the returned icon is the generic gray globe (meaning no real favicon exists).
4. **Direct `/favicon.ico`** -- Falls back to `https://{root-domain}/favicon.ico`.
5. **Caution icon** -- If all above fail, displays a yellow warning triangle (`caution.svg`).

The resolved logo source determines the badge behavior:
- **BIMI** -- If all auth checks pass, the source badge is hidden (no warning needed). If any check fails or softfails, the badge shows the failures (e.g. "SPF: softfail") colored to match the verdict (orange for caution, red for dangerous).
- **Favicon** -- Badge is hidden. Logo came from the favicon service, not a verified BIMI record.
- **Unknown** (red) -- No logo could be resolved; caution icon is displayed, badge shows "unknown".

### 2. Email Authentication Checks

When viewing an email, the extension fetches the raw message headers from Gmail's `view=om` endpoint and parses the `Authentication-Results` header for three checks:

| Check | What It Verifies |
|-------|-----------------|
| **SPF** (Sender Policy Framework) | The sending server's IP is authorized by the domain's DNS records |
| **DKIM** (DomainKeys Identified Mail) | The email's cryptographic signature matches the domain's public key |
| **DMARC** (Domain-based Message Authentication) | The domain's policy for handling SPF/DKIM failures was satisfied |

Each check is displayed with a pass/fail/neutral badge in the banner's details accordion.

### 3. Mailing List / Google Groups Resolution

When an email arrives via a Google Groups address or mailing list, Gmail's DOM shows the **group address** as the sender. The extension detects the real sender using the `X-Original-Sender` header:

1. Headers are fetched for the security checks (already happening).
2. If `X-Original-Sender` is present and differs from the envelope sender, the extension fetches sender info for the original sender.
3. The banner updates progressively: it initially shows the group domain, then replaces it with the original sender's domain, logo, and source badge.
4. A gray "via groupdomain.com" pill badge is appended to indicate the email was relayed through a group.

The security verdict (SPF/DKIM/DMARC) continues to reflect the **delivery path** through the group relay, which is the correct behavior -- those checks verify what actually delivered the email.

For inbox row tooltips, if Gmail displays "via GroupName" text in the row, the tooltip includes a matching "via" indicator.

### 4. Verdict Logic

The extension combines the authentication results into a single verdict:

| Verdict | Condition | Display |
|---------|-----------|---------|
| **Trusted** | SPF pass AND DKIM pass AND DMARC pass | Verdict badge and accordion summary both hidden |
| **Not Trusted** | DMARC fail, OR DKIM fail, OR (SPF fail AND DKIM not pass) | Red X icon in banner top row; red "Not Trusted" in accordion |
| **Use Caution** | Everything else (partial passes, missing results, errors) | Amber triangle in banner top row; orange "Use Caution" in accordion |

The verdict appears in two places: an **inline badge** in the banner top row (between the logo and the domain text, icon only) and the **accordion summary column** (icon + label). Both are hidden when the verdict is "Trusted".

If headers cannot be fetched (timeout, missing message ID, etc.), the verdict defaults to **Use Caution**.

## Architecture

```
gmail-sender-info/
├── manifest.json           # Manifest V3 config
├── src/
│   ├── background.js       # Service worker: BIMI DNS, favicon resolution, caching
│   ├── content.js          # Isolated world: tooltip, banner, auth header parsing
│   ├── page-fetch.js       # MAIN world: fetches raw headers using Gmail's session
│   └── styles.css          # Tooltip, banner, accordion, verdict styles
├── images/
│   ├── icon.svg            # Source SVG for icon (512×512)
│   ├── icon16.png          # Extension toolbar icon (16×16)
│   ├── icon48.png          # Extensions management page icon (48×48)
│   ├── icon128.png         # Chrome Web Store listing icon (128×128)
│   ├── promo-small.png     # Chrome Web Store small promo tile (440×280)
│   ├── promo-large.png     # Chrome Web Store large/marquee promo tile (1400×560)
│   └── caution.svg         # Fallback warning icon for unknown senders
├── CLAUDE.md               # Development notes
└── README.md               # This file
```

### Message Flow

```
[Inbox hover / Email view]
        │
   content.js ──sendMessage──▶ background.js
        │                          │
        │                     BIMI DNS lookup (dns.google)
        │                     Favicon resolution (gstatic)
        │                          │
        │◀──── sender info ────────┘
        │
   content.js ──postMessage──▶ page-fetch.js (MAIN world)
        │                          │
        │                     fetch(view=om) with session cookies
        │                     Parse Authentication-Results header
        │                          │
        │◀── auth results ─────────┘
        │
   Render tooltip/banner with logo + verdict
```

## Chrome Web Store Assets

All store assets live in `images/`. The logo is a `#d6d8ff` rounded square with "GSI" in Google brand colors: **G** (Blue `#4285F4`), **S** (Red `#EA4335`), **I** (Green `#34A853`).

| File | Dimensions | Where It's Used |
|------|-----------|-----------------|
| `icon.svg` | 512×512 | Source SVG — re-export PNGs from this if the design changes |
| `icon16.png` | 16×16 | Extension toolbar icon (referenced in `manifest.json`) |
| `icon48.png` | 48×48 | `chrome://extensions/` management page (referenced in `manifest.json`) |
| `icon128.png` | 128×128 | Chrome Web Store listing + install dialog (referenced in `manifest.json`) |
| `promo-small.png` | 440×280 | Chrome Web Store small promotional tile |
| `promo-large.png` | 1400×560 | Chrome Web Store large/marquee promotional tile |
| `caution.svg` | — | In-extension fallback icon for senders with no BIMI or favicon |

### Regenerating Icons

Edit `icon.svg`, then render and resize:

```bash
qlmanage -t -s 512 -o /tmp/ images/icon.svg
sips -z 128 128 /tmp/icon.svg.png --out images/icon128.png
sips -z 48 48 /tmp/icon.svg.png --out images/icon48.png
sips -z 16 16 /tmp/icon.svg.png --out images/icon16.png
```

## Development

1. Go to `chrome://extensions/` with Developer Mode enabled
2. Click "Load unpacked" and select this directory
3. Open Gmail -- hover inbox rows for tooltips, open emails for the full banner
4. After code changes, click the refresh icon on the extension card and reload Gmail
