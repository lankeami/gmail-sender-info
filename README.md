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

The resolved logo source is shown as a badge:
- **"BIMI verified"** (green) -- Domain publishes a BIMI record with a verified SVG logo
- **"favicon"** (orange) -- Logo came from the favicon service, not a verified BIMI record
- **"unknown"** (red) -- No logo could be resolved; caution icon is displayed

### 2. Email Authentication Checks

When viewing an email, the extension fetches the raw message headers from Gmail's `view=om` endpoint and parses the `Authentication-Results` header for three checks:

| Check | What It Verifies |
|-------|-----------------|
| **SPF** (Sender Policy Framework) | The sending server's IP is authorized by the domain's DNS records |
| **DKIM** (DomainKeys Identified Mail) | The email's cryptographic signature matches the domain's public key |
| **DMARC** (Domain-based Message Authentication) | The domain's policy for handling SPF/DKIM failures was satisfied |

Each check is displayed with a pass/fail/neutral badge in the banner's details accordion.

### 3. Verdict Logic

The extension combines the authentication results into a single verdict:

| Verdict | Condition | Display |
|---------|-----------|---------|
| **Trusted** | SPF pass AND DKIM pass AND DMARC pass | Banner hides the verdict column (no warning needed) |
| **Not Trusted** | DMARC fail, OR DKIM fail, OR (SPF fail AND DKIM not pass) | Red X icon with "Not Trusted" label |
| **Use Caution** | Everything else (partial passes, missing results, errors) | Yellow triangle with "Use Caution" label |

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
│   ├── icon{16,48,128}.png # Extension icons
│   └── caution.svg         # Fallback warning icon
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

## Development

1. Go to `chrome://extensions/` with Developer Mode enabled
2. Click "Load unpacked" and select this directory
3. Open Gmail -- hover inbox rows for tooltips, open emails for the full banner
4. After code changes, click the refresh icon on the extension card and reload Gmail
