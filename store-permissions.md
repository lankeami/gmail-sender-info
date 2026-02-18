# Chrome Web Store — Permission Justifications

Copy each justification into the corresponding field on the Developer Dashboard.

## Permissions

### storage

Caches sender logo and favicon lookup results locally with a 24-hour TTL to avoid redundant DNS and network requests. Cache is automatically cleared on extension install or update. No user data is stored — only domain-level logo URLs and favicon references.

## Host Permissions

### https://dns.google/*

Performs DNS-over-HTTPS queries to resolve BIMI (Brand Indicators for Message Identification) TXT records for sender domains. These records contain URLs to verified brand logos (e.g. default._bimi.example.com). This is the only way to retrieve BIMI data from a Chrome extension without requiring broad host access.

### https://*.gstatic.com/*

Used to detect whether Google's favicon service returned a generic globe icon (meaning the sender's domain has no real favicon). The extension fetches the favicon from gstatic.com and compares it to the known generic icon so it can fall back to a warning indicator instead of showing a misleading placeholder.

## Content Scripts

### https://mail.google.com/* (content.js, styles.css — ISOLATED world)

Runs in Gmail to observe the page DOM for inbox rows and email views. Adds hover tooltips showing sender domain and logo on inbox rows, and a security banner with SPF/DKIM/DMARC authentication results when viewing an email. Operates in the isolated world so it cannot access page JavaScript or cookies.

### https://mail.google.com/* (page-fetch.js — MAIN world)

Runs in Gmail's page context to fetch raw email headers from Gmail's own view=om endpoint using the page's existing session cookies. This is a same-origin request that requires no additional permissions (no cookies or broad host access). The fetched headers are used solely to parse Authentication-Results for SPF, DKIM, and DMARC status. The script communicates results back to the isolated content script via window.postMessage.

## Web Accessible Resources

### images/caution.svg (restricted to https://mail.google.com/*)

A static warning triangle icon displayed as a fallback when no BIMI logo or favicon can be resolved for a sender's domain. Restricted to Gmail only — not accessible from other sites.
