# Country Flag Feature Design

**Date:** 2026-06-13  
**Issue:** #29  
**Feature:** Display sender domain country origin via emoji flag on banner strip  

## Overview

Add a country-of-origin indicator (emoji flag) to the Gmail Sender Info banner strip, showing the geographic location of the sender's domain via GeoIP lookup. Users hover over the flag to see the full country name.

## Problem Statement

Users currently see sender domain, logo, and security info but have no quick visual indicator of where the domain is geographically registered. For phishing detection (e.g., "Bank of America email from a `.ru` domain"), knowing the hosting location is valuable context. Users must manually look up domain registration info.

## Solution: Country Flag via GeoIP

### 1. Data Flow & Architecture

#### Background Service Worker (`background.js`)

**New function: `lookupCountry(ip)`**
- Calls `ip-api.com/json/{ip}` to resolve IP to country
- Extracts `country` (name) and `countryCode` (ISO 2-letter code) from response
- Timeout: 5 seconds per request
- Returns: `{ countryCode, countryName }` or `{ countryCode: null }` on failure/timeout

**Modified function: `resolveLogo(fullDomain)`**
- Existing behavior unchanged: BIMI lookup → Google favicon → direct favicon
- **New step:** After BIMI lookups, add DNS A-record resolution for country lookup:
  1. Resolve domain to IP via `dns.google/resolve?name=<domain>&type=A` (same pattern as existing BIMI lookups)
  2. If A record found: Call `lookupCountry(ip)` with resolved IP
  3. Return extended response: `{ countryCode, countryName, countryMethod: 'geoip', resolvedIp, ...logoFields }`
- **Error handling within resolveLogo:**
  - DNS lookup fails (exception or no A record): skip country lookup, return `{ countryCode: null }`
  - ip-api.com times out (5s): return `{ countryCode: null, countryMethod: 'geoip-timeout' }` (still cache to avoid repeated API hits)

**Caching:**
- Country results stored in `chrome.storage.local` alongside existing BIMI/favicon cache
- 24-hour TTL (consistent with current cache strategy)
- Cache key: email address (reuse existing cache structure)
- Cache entry: `{ email: { data: { countryCode, countryName, countryMethod, resolvedIp, ...logo }, ts: Date.now() } }`

#### Rate Limiting & Resilience

- **ip-api.com limit:** 45 requests per minute (free tier, no API key)
- **Strategy:** Graceful degradation — if rate limited or timeout, omit flag (no error shown)
- **Caching prevents hammering:** Same domain queried multiple times reuses cached result; different users of extension share chrome.storage.local cache

### 2. Message Protocol

**Extend `getSenderInfo` response:**

Before:
```js
{
  fullDomain,
  rootDomain,
  logoUrl,
  logoSource,
  faviconRootUrl,
  faviconRootIsGlobe,
  faviconDirectUrl,
  favicons: { sub, root, www },
  homograph: { isHomograph, scripts }
}
```

After:
```js
{
  fullDomain,
  rootDomain,
  logoUrl,
  logoSource,
  faviconRootUrl,
  faviconRootIsGlobe,
  faviconDirectUrl,
  favicons: { sub, root, www },
  homograph: { isHomograph, scripts },
  countryCode,       // ISO 2-letter code or null
  countryName,       // Full country name or null
  countryMethod,     // 'geoip', 'geoip-timeout', null
  resolvedIp         // IP address resolved for GeoIP or null
}
```

**No new message types.** Content script receives country data in the existing `getSenderInfo` response.

### 3. UI Changes: Banner Strip

**New element: `.gsi-country-flag`**

Inserted in the strip row after domain/root spans, before profile image:

```
| Logo | Domain (Root) | Country Flag | Profile | Divider | SPF/DKIM/DMARC | Verdict | ...
```

**Flag rendering:**
- Emoji flag using Unicode regional indicator pairs: `US` → 🇺🇸, `GB` → 🇬🇧, `RU` → 🇷🇺
- Inline text size (~16px, matches surrounding text)
- `title` attribute: full country name (hover tooltip)
- Display: `none` if `countryCode` is null
- No CSS styling needed — emoji renders natively

**Tooltip (inbox hover):**
- Add country flag emoji + country name below domain info in existing tooltip

### 4. Error Handling

**Silent degradation (no error messages shown to user):**

| Condition | Behavior |
|-----------|----------|
| No A record found for domain | Skip country lookup, render without flag |
| GeoIP API timeout (5s) | Log silently, cache failure, render without flag |
| GeoIP API returns no country field | Render without flag |
| ip-api.com rate limit (45 req/min) | Gracefully degrade, cache attempt, omit flag |
| DNS lookup fails | Skip country lookup, render without flag |

Banner renders completely in all cases. Country flag is purely additive — missing flag doesn't degrade security or UX.

### 5. Caching Strategy

**Scope:** Per-email caching (email address as key)

**TTL:** 24 hours (consistent with BIMI/favicon cache)

**What's cached:**
- Successful country lookup: `{ countryCode: 'US', countryName: 'United States', countryMethod: 'geoip', resolvedIp: '93.184.216.34' }`
- Failed/timeout lookup: `{ countryCode: null, countryMethod: 'geoip-timeout', resolvedIp: null }`
- Cache prevents repeated API calls for same domain within 24h window

**Cleanup:** Existing `chrome.runtime.onInstalled` listener clears all cache on extension update/install.

### 6. Debug Panel

**New section in details panel: "GeoIP Resolution"**

Displayed below the favicon section, shows:

```
GeoIP Resolution
  Country Code: US
  Country Name: United States
  Method: geoip
  Resolved IP: 93.184.216.34
```

If lookup was skipped or failed:

```
GeoIP Resolution
  Status: (not resolved) | (timeout) | (no A record)
```

## Implementation Details

### Files to Modify

1. **`src/background.js`**
   - Add `lookupCountry(ip)` function
   - Modify `resolveLogo(fullDomain)` to call `lookupCountry()`
   - Extend `getSenderInfo` response with country fields

2. **`src/content.js`**
   - Destructure `countryCode`, `countryName` from `getSenderInfo` response
   - Add `.gsi-country-flag` element creation in `insertBanner()`
   - Insert flag after domain/root spans
   - Hide flag if `countryCode` is null
   - Update tooltip to include country flag
   - Add GeoIP debug lines to debug section

3. **`src/styles.css`**
   - Optional: `.gsi-country-flag { /* positioning/sizing if needed */ }`
   - Emoji renders natively, minimal CSS needed

4. **`manifest.json`**
   - Add `host_permissions`: `https://ip-api.com/*`
   - This will cause Chrome to prompt user to re-approve extension on next update

### Permissions & Impact

**New permission:** `https://ip-api.com/*`

- **User impact:** Chrome will show "This extension now needs permission to access ip-api.com" prompt on first load after update
- **Mitigation:** Bundle with version bump and document in release notes why permission is needed
- **No privacy risk:** Only resolves IPs to country codes (public GeoIP data), no PII sent

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| ip-api.com goes offline | Low | Country flag missing | Graceful degradation — flag omitted, banner still renders |
| Rate limit (45 req/min) | Low (caching + per-domain lookup) | Flag missing for some emails | Cache prevents repeated hits; subsequent emails work |
| GeoIP data inaccuracy | Medium | Misleading country flag | GeoIP shows *server location*, not registrant country — documented in debug section |
| Timeout delays banner render | Low (5s timeout) | Slight UX delay | Falls back to no flag, render completes |

## Testing Strategy

1. **Happy path:** Email from .com domain hosted in unexpected country (e.g., fake PayPal from RU-hosted IP) → flag shows correctly
2. **No A record:** Domains with no IPv4 address → flag omitted gracefully
3. **Timeout:** Manually block ip-api.com in network tab → banner renders without flag
4. **Rate limiting:** Send 50 getSenderInfo requests in quick succession → verify graceful degradation
5. **Cache hit:** Same email queried twice within 24h → verify no duplicate API calls (check Storage > Local)
6. **Tooltip:** Hover inbox row → country flag shown in tooltip

## Success Criteria

- ✅ Country flag emoji rendered on banner strip for valid domains
- ✅ Hover tooltip shows country name
- ✅ GeoIP lookup cached for 24h (no repeated API calls)
- ✅ Missing flag doesn't break banner render
- ✅ Debug section shows country code, name, method, resolved IP
- ✅ No new Chrome permission warnings (bundled with version bump)
- ✅ All existing features (BIMI, favicon, SPF/DKIM/DMARC, AI analysis) unaffected

## Future Considerations

- **ccTLD fallback:** If GeoIP becomes unreliable, could add ccTLD-based country detection (.uk → GB) as a fallback or validation signal
- **Analytics:** Could track which countries are represented in user's email volume
- **Confidence score:** GeoIP APIs sometimes return confidence/accuracy — could use to show/hide flag based on confidence threshold

