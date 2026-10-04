# Changelog

## 2026-10-04

- [409b67e](https://github.com/lankeami/gmail-sender-info/commit/409b67e726d68a2ff85ef2e6d0c696bcea1490a5) Fix quoted reason text misparsing and gateway matcher word boundary
  - Strip RFC 7601 quoted strings from segments before matching methods, preventing reason="policy says spf=pass" from producing false passes - Add trailing \b to gateway.spf regex to prevent prefix matches like gateway.spf=passive matching as pass - Add test cases for both issues (34 total, all passing)
- [6f0f14a](https://github.com/lankeami/gmail-sender-info/commit/6f0f14a2cb48d4913c1e08dcdd5edfcbdb1c24a0) Address Copilot review feedback on auth-results parsing
  - Add trailing \b word boundary to all value regexes (prevents "PASSIVE" matching as "PASS") - Fix Gateway SPF lookbehind for variable whitespace by splicing out the gateway match before running the plain SPF regex - Remove whole-segment `continue` for arc/i prefixes that dropped valid dkim/dmarc in space-separated fallback - Use (?:^|\s) anchor on spf= to prevent matching inside reason strings like reason="spf=pass" - Update README with gateway SPF docs in auth checks and AI signals - Add test cases: PASSIVE prefix, multi-space gateway, reason string spf, space-separated i.spf fallback (28 total)
- [02e20ad](https://github.com/lankeami/gmail-sender-info/commit/02e20ad84d3dd771e8f99b54ded2cb11e0a16737) Add edge case tests for auth-results parsing
  Covers: no-semicolons with gateway.spf, i.spf prefix exclusion, softfail/bestguesspass values, case insensitivity, gateway-only results, and folded multiline headers.
- [03dc22d](https://github.com/lankeami/gmail-sender-info/commit/03dc22def67898d8a7daadfdb9f8f6b3fb59bb05) Refactor Authentication-Results parsing to use RFC 7601 semicolon splitting
  Split on semicolons per RFC 7601 instead of matching bare substrings against the full header line. This prevents gateway.spf=pass (a Google Workspace relay result) from being misread as a genuine spf=pass.

## 2026-10-01

- [9e9d4be](https://github.com/lankeami/gmail-sender-info/commit/9e9d4beee8850267f786b50dec4e1057bd17acca) Keep exact from:@ search for full domain; wildcard only for root domain
- [8400b3e](https://github.com/lankeami/gmail-sender-info/commit/8400b3ed535674336f82684e4d7048c6691f4250) Use from:*domain in Gmail search links to match subdomains and prefixes

## 2026-09-28

- [93dc51e](https://github.com/lankeami/gmail-sender-info/commit/93dc51e3899820d6481374cb1fcdeff8e31d4b4a) Add clickable domain links and external site icon to banner strip
  Full domain and root domain text now link to Gmail searches for from:@domain, and a small external-link icon opens the root domain website in a new tab. Mailing-list domain restore logic updated to preserve link hrefs.

## 2026-08-05

- [d30563a](https://github.com/lankeami/gmail-sender-info/commit/d30563af0ad6678b5d99f129cf5f240e4ce963eb) chore: release v20260805.1956
- [55cf219](https://github.com/lankeami/gmail-sender-info/commit/55cf219447895d0c2e18d791bbaf8ffe6c9d2b21) Fix AI availability: handle model download, crash recovery, and timeouts
  - Only treat status "available" as ready (not "downloading"/"downloadable") - Add "Set up AI safety check" button to trigger model download with user gesture (Chrome requires a click to start the ~2GB Gemini Nano download) - Add withTimeout wrapper to prevent LanguageModel.create/clone/prompt from hanging indefinitely (60s create, 30s clone, 60s prompt) - Show user-friendly messages for each unavailable state: downloading, needs restart, timed out - Try LanguageModel.create() directly when availability() returns "unavailable" to get a more specific error message - Check window.ai.languageModel as fallback API path - Bump version to 2026.0805.2012
- [e40f61a](https://github.com/lankeami/gmail-sender-info/commit/e40f61aa8be9b4a4fd9d21b810dc6f91da6e8b2b) chore: release v20260805.1201
- [2d0e279](https://github.com/lankeami/gmail-sender-info/commit/2d0e27925478ae07644e9b67cb0689fc1818459f) Fix AI summaries by moving LanguageModel from service worker to MAIN world (#37)
  Chrome Prompt API is no longer available in service workers (removed when API moved from origin trial to stable in Chrome 148+). Moved all AI analysis to page-fetch.js (MAIN world) where LanguageModel is available, using the existing postMessage pattern.

## 2026-08-01

- [0983cfc](https://github.com/lankeami/gmail-sender-info/commit/0983cfc23687cbc8fdfea369ff02d841c5c8d270) chore: release v20260801.1037
- [e0155f4](https://github.com/lankeami/gmail-sender-info/commit/e0155f42421cac124f131a07de184950f9026aed) Fix review nag store URL and update copy
