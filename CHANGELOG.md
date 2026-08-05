# Changelog

## 2026-08-05

- [e40f61a](https://github.com/lankeami/gmail-sender-info/commit/e40f61aa8be9b4a4fd9d21b810dc6f91da6e8b2b) chore: release v20260805.1201
- [2d0e279](https://github.com/lankeami/gmail-sender-info/commit/2d0e27925478ae07644e9b67cb0689fc1818459f) Fix AI summaries by moving LanguageModel from service worker to MAIN world (#37)
  Chrome Prompt API is no longer available in service workers (removed when API moved from origin trial to stable in Chrome 148+). Moved all AI analysis to page-fetch.js (MAIN world) where LanguageModel is available, using the existing postMessage pattern.

## 2026-08-01

- [0983cfc](https://github.com/lankeami/gmail-sender-info/commit/0983cfc23687cbc8fdfea369ff02d841c5c8d270) chore: release v20260801.1037
- [e0155f4](https://github.com/lankeami/gmail-sender-info/commit/e0155f42421cac124f131a07de184950f9026aed) Fix review nag store URL and update copy
