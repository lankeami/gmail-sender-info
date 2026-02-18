# Chrome Web Store Listing

## Summary (132 chars max)

See who's really emailing you. Shows sender logos, domain info, and SPF/DKIM/DMARC authentication results directly in Gmail.

## Detailed Description

Know who's behind every email — before you click.

Gmail Sender Info adds sender identity and email authentication details directly into Gmail's interface. Hover over any inbox row to see the sender's domain and logo, or open an email to get a full security breakdown with SPF, DKIM, and DMARC results.

Open source and transparent:

This extension is fully open source. You can inspect every line of code, report issues, or contribute:

• Source code: https://github.com/lankeami/gmail-sender-info
• Privacy Policy: https://lankeami.github.io/gmail-sender-info/privacy-policy.html
• Terms of Service: https://lankeami.github.io/gmail-sender-info/terms-of-service.html
• Support & FAQ: https://lankeami.github.io/gmail-sender-info/support.html

What you get:

• Sender logos via BIMI (Brand Indicators for Message Identification) — the same verified brand logos used by major email providers
• Automatic favicon fallback when BIMI isn't available, so you always see a visual identifier
• SPF, DKIM, and DMARC authentication results parsed from real email headers — not just Gmail's simplified view
• Clear trust verdicts: Trusted, Use Caution, or Not Trusted — at a glance
• Mailing list and Google Groups detection that reveals the original sender behind group addresses
• Inbox row tooltips on hover for quick identification without opening the email
• Detailed expandable banner in email view with full authentication breakdown and debug info

Privacy-first design:

• Only two permissions: local storage for caching and DNS lookups for BIMI
• No data sent to third-party services — all lookups use Google's own DNS and favicon services
• Email headers are read using Gmail's existing session — no extra cookie or host permissions needed
• No analytics, no tracking, no account creation
• Results cached locally for 24 hours, cleared on every update

How it works:

When you open an email, the extension fetches the raw message headers directly from Gmail and parses the Authentication-Results header for SPF, DKIM, and DMARC status. Simultaneously, it resolves the sender's brand logo through BIMI DNS records or falls back to the domain's favicon. The results are combined into a simple trust verdict displayed in a banner above the email.

For inbox rows, hovering shows a tooltip with the sender's domain and logo — useful for spotting suspicious senders before you even open the message.

Who it's for:

• Security-conscious users who want to verify sender authenticity
• Anyone tired of phishing emails that impersonate trusted brands
• IT professionals and email admins who need quick access to authentication results
• Curious users who want to understand what's happening behind the scenes in email delivery

Works with all Gmail accounts. Zero configuration required — install and go.
