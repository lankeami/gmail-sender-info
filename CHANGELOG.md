# Changelog

## 2026-08-05

- [55cf219](https://github.com/lankeami/gmail-sender-info/commit/55cf219447895d0c2e18d791bbaf8ffe6c9d2b21) Fix AI availability: handle model download, crash recovery, and timeouts
  - Only treat status "available" as ready (not "downloading"/"downloadable") - Add "Set up AI safety check" button to trigger model download with user gesture (Chrome requires a click to start the ~2GB Gemini Nano download) - Add withTimeout wrapper to prevent LanguageModel.create/clone/prompt from hanging indefinitely (60s create, 30s clone, 60s prompt) - Show user-friendly messages for each unavailable state: downloading, needs restart, timed out - Try LanguageModel.create() directly when availability() returns "unavailable" to get a more specific error message - Check window.ai.languageModel as fallback API path - Bump version to 2026.0805.2012
- [e40f61a](https://github.com/lankeami/gmail-sender-info/commit/e40f61aa8be9b4a4fd9d21b810dc6f91da6e8b2b) chore: release v20260805.1201
- [2d0e279](https://github.com/lankeami/gmail-sender-info/commit/2d0e27925478ae07644e9b67cb0689fc1818459f) Fix AI summaries by moving LanguageModel from service worker to MAIN world (#37)
  Chrome Prompt API is no longer available in service workers (removed when API moved from origin trial to stable in Chrome 148+). Moved all AI analysis to page-fetch.js (MAIN world) where LanguageModel is available, using the existing postMessage pattern.

## 2026-08-01

- [0983cfc](https://github.com/lankeami/gmail-sender-info/commit/0983cfc23687cbc8fdfea369ff02d841c5c8d270) chore: release v20260801.1037
- [e0155f4](https://github.com/lankeami/gmail-sender-info/commit/e0155f42421cac124f131a07de184950f9026aed) Fix review nag store URL and update copy
