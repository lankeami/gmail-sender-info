# Chrome Web Store — Permission Justifications

Copy each justification into the corresponding field on the Developer Dashboard.

## Permissions

### storage

Caches sender logo and favicon lookup results locally with a 24-hour TTL to avoid redundant DNS and network requests. Each cached entry (domain names, logo and favicon URLs, derived country) is stored under the sender's domain, not the full email address. The cache is cleared on extension install or update. Also stores a few small values that are kept across updates to decide when to show an occasional review request: first-use time, a count of emails viewed, and whether the request was dismissed or clicked. Nothing is stored outside the browser.

## Host Permissions

### https://dns.google/*

Performs DNS-over-HTTPS queries to resolve BIMI (Brand Indicators for Message Identification) TXT records for sender domains. These records contain URLs to verified brand logos (e.g. default._bimi.example.com). This is the only way to retrieve BIMI data from a Chrome extension without requiring broad host access.

### https://*.gstatic.com/*

Used to detect whether Google's favicon service returned a generic globe icon (meaning the sender's domain has no real favicon). The extension fetches the favicon from gstatic.com and compares it to the known generic icon so it can fall back to a warning indicator instead of showing a misleading placeholder.

## Content Scripts

### https://mail.google.com/* (content.js, styles.css — ISOLATED world)

Runs in Gmail to observe the page DOM for inbox rows and email views. Adds hover tooltips showing sender domain and logo on inbox rows, and a security banner with SPF/DKIM/DMARC authentication results when viewing an email. For the optional AI check, it reads the open email's subject, up to the first 2,000 characters of the body, and up to 20 body links, and hands them to page-fetch.js via window.postMessage. Operates in the isolated world so it cannot access page JavaScript or cookies.

### https://mail.google.com/* (page-fetch.js — MAIN world)

Runs in Gmail's page context to fetch raw email headers from Gmail's own view=om endpoint using the page's existing session cookies. This is a same-origin request that requires no additional permissions (no cookies or broad host access). The fetched headers are used to parse Authentication-Results for SPF, DKIM, and DMARC status, and to read the To, Cc, Bcc, Delivered-To, and Reply-To headers to detect BCC delivery and Reply-To mismatches. The script communicates results back to the isolated content script via window.postMessage.

This script also runs the optional on-device AI check using Chrome's built-in Prompt API (Gemini Nano, `LanguageModel`), which is only available in the page context. The prompt contains the sender display name and address, the subject, up to the first 2,000 characters of the open email's body text, up to 20 links from the body, BCC/empty-body/Reply-To flags, and the SPF/DKIM/DMARC results. It is processed by Chrome on the user's device and is not sent to the developer or any server.

## Web Accessible Resources

### images/caution.svg (restricted to https://mail.google.com/*)

A static warning triangle icon displayed as a fallback when no BIMI logo or favicon can be resolved for a sender's domain. Restricted to Gmail only — not accessible from other sites.

## Remote Content Loaded by the Page

The extension displays sender logos as ordinary images in the Gmail page: the BIMI logo URL published in the sender domain's DNS, Google's favicon service, and `https://<sender-domain>/favicon.ico`. The browser loads these images directly, so the host serving an image can see that it was requested. These loads use no extension permission and no extension-initiated fetch.
