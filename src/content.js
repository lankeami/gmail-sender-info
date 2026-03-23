// Gmail Sender Info — Content Script
// Adds hover tooltips on inbox rows and a banner in email view.

(() => {
  'use strict';

  // --- In-memory dedup for concurrent requests ---
  const pendingRequests = new Map(); // email → Promise<info>
  const CAUTION_URL = chrome.runtime.getURL('images/caution.svg');

  // --- Sender extraction ---

  /**
   * Extract sender email from an inbox row (.zA element).
   * Tries multiple selectors that Gmail uses across layouts.
   */
  function getEmailFromRow(row) {
    // Try participant spans with email attribute
    const selectors = [
      '.yW span[email]',
      '[email]',
      '.yX .yW span[email]',
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      if (el) {
        const email = el.getAttribute('email');
        if (email && email.includes('@')) return email.toLowerCase().trim();
      }
    }
    return null;
  }

  /**
   * Extract sender email from the currently open email view.
   */
  function getEmailFromView() {
    const el = document.querySelector('.gD[email]');
    if (el) {
      const email = el.getAttribute('email');
      if (email && email.includes('@')) return email.toLowerCase().trim();
    }
    return null;
  }

  // --- Context validity check ---
  // After extension reload/update, the old content script is orphaned.
  // All chrome.runtime calls will throw "Extension context invalidated".
  // Detect this and stop the observer so the stale script goes quiet.

  let contextValid = true;

  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function invalidateContext() {
    contextValid = false;
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    removeBanner();
    hideTooltip();
  }

  // --- Message passing with dedup ---

  function requestSenderInfo(email) {
    if (!contextValid) return Promise.resolve(null);
    if (pendingRequests.has(email)) return pendingRequests.get(email);

    const promise = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getSenderInfo', email }, (resp) => {
          pendingRequests.delete(email);
          if (chrome.runtime.lastError || !resp || resp.error) {
            // Check if context died during the call
            if (!isContextValid()) invalidateContext();
            resolve(null);
          } else {
            resolve(resp);
          }
        });
      } catch {
        pendingRequests.delete(email);
        invalidateContext();
        resolve(null);
      }
    });

    pendingRequests.set(email, promise);
    return promise;
  }

  // --- Logo source labels ---
  const SOURCE_BIMI = 'bimi';
  const SOURCE_FAVICON = 'favicon';
  const SOURCE_UNKNOWN = 'unknown';

  const SOURCE_LABELS = {
    [SOURCE_BIMI]: 'BIMI verified',
    [SOURCE_FAVICON]: 'favicon',
    [SOURCE_UNKNOWN]: 'unknown',
  };

  // --- Logo image with onerror fallback chain ---

  /**
   * Create an <img> that walks the fallback chain:
   * BIMI logo → root domain favicon → caution SVG
   *
   * Skips subdomain favicons — Google's favicon service returns a generic
   * gray globe for missing favicons (no error), so onerror never fires.
   * Root domain is almost always the correct favicon anyway.
   *
   * Calls onSourceResolved(sourceKey) once the image loads, so the
   * caller can update the badge with the correct color/label.
   */
  function createLogoImg(info, onSourceResolved) {
    const img = document.createElement('img');
    img.classList.add('gsi-logo');
    img.width = 20;
    img.height = 20;
    img.alt = info.rootDomain;

    // Build fallback chain as [{url, source}, ...]
    const chain = [];
    if (info.logoUrl) chain.push({ url: info.logoUrl, source: SOURCE_BIMI });

    // Skip Google favicon if background detected it's the generic gray globe
    if (info.faviconRootUrl && !info.faviconRootIsGlobe) {
      chain.push({ url: info.faviconRootUrl, source: SOURCE_FAVICON });
    }
    if (info.faviconDirectUrl) chain.push({ url: info.faviconDirectUrl, source: SOURCE_FAVICON });
    chain.push({ url: CAUTION_URL, source: SOURCE_UNKNOWN });

    let idx = 0;
    img.onload = () => {
      if (onSourceResolved) onSourceResolved(chain[idx].source);
    };
    img.onerror = () => {
      idx++;
      if (idx < chain.length) {
        img.src = chain[idx].url;
      }
    };
    img.src = chain[0].url;
    return img;
  }

  /**
   * Apply the correct class and label to a badge element based on resolved source.
   */
  function updateBadge(badge, sourceKey) {
    if (sourceKey === SOURCE_FAVICON) {
      badge.style.display = 'none';
      return;
    }
    badge.className = 'gsi-source-badge gsi-badge-' + sourceKey;
    if (sourceKey === SOURCE_BIMI) {
      // For BIMI: hide by default, security section will show with failures if any
      badge.textContent = '';
      badge.style.display = 'none';
    } else {
      badge.style.display = '';
      badge.textContent = SOURCE_LABELS[sourceKey] || sourceKey;
    }
  }

  /**
   * Create a favicon <img> for the detail accordion.
   * Chain: Google URL (if 200) → direct /favicon.ico → caution SVG.
   */
  function createDetailFaviconImg(faviconInfo) {
    const img = document.createElement('img');
    img.classList.add('gsi-detail-icon');
    img.width = 16;
    img.height = 16;

    const chain = [];
    if (faviconInfo.googleUrl) chain.push(faviconInfo.googleUrl);
    chain.push(faviconInfo.directUrl);
    chain.push(CAUTION_URL);

    let idx = 0;
    img.onerror = () => {
      idx++;
      if (idx < chain.length) {
        img.src = chain[idx];
      }
    };
    img.src = chain[0];
    return img;
  }

  // --- Email security header checks ---

  const securityCache = new Map(); // messageId → authResults

  function getAccountNumber() {
    const match = window.location.pathname.match(/\/mail\/u\/(\d+)/);
    return match ? match[1] : '0';
  }

  /**
   * Extract the message ID for the currently viewed email.
   * Gmail's view=om endpoint needs a hex message ID.
   *
   * Strategies:
   * 1. data-legacy-message-id — hex format, works directly
   * 2. data-message-id — may be #msg-f:DECIMAL, convert to hex via BigInt
   * 3. URL hash — thread ID, may not work with view=om
   */
  function getMessageId() {
    // Strategy 1: data-legacy-message-id (broad search — hex format)
    const legacyEl = document.querySelector('[data-legacy-message-id]');
    if (legacyEl) {
      const id = legacyEl.getAttribute('data-legacy-message-id');
      if (id) return { id, source: 'legacy' };
    }

    // Strategy 2: Walk up from sender to find data-message-id
    const senderEl = document.querySelector('.gD[email]');
    if (senderEl) {
      let el = senderEl;
      while (el && el !== document.body) {
        const msgId = el.getAttribute('data-message-id');
        if (msgId) {
          // May be "#msg-f:1234567890" or "#msg-a:r1234567890" — extract decimal → hex
          const decMatch = msgId.match(/(\d{10,})/);
          if (decMatch) {
            try {
              return { id: BigInt(decMatch[1]).toString(16), source: 'data-msg-id' };
            } catch { /* fall through */ }
          }
          // If already hex-looking
          if (/^[0-9a-f]{10,}$/i.test(msgId)) return { id: msgId, source: 'data-msg-id-hex' };
        }
        el = el.parentElement;
      }
    }

    // Strategy 2b: Broad search for data-message-id
    const allMsgEls = document.querySelectorAll('[data-message-id]');
    for (const el of allMsgEls) {
      const msgId = el.getAttribute('data-message-id');
      if (!msgId) continue;
      const decMatch = msgId.match(/(\d{10,})/);
      if (decMatch) {
        try {
          return { id: BigInt(decMatch[1]).toString(16), source: 'data-msg-id-broad' };
        } catch { /* fall through */ }
      }
      if (/^[0-9a-f]{10,}$/i.test(msgId)) return { id: msgId, source: 'data-msg-id-hex-broad' };
    }

    // Strategy 3: URL hash (last resort — thread ID, often doesn't work)
    const hash = window.location.hash;
    const hashMatch = hash.match(/[/#]([A-Za-z0-9_-]{10,})$/);
    if (hashMatch) return { id: hashMatch[1], source: 'hash' };

    return null;
  }

  // --- Header fetch via MAIN world page-fetch.js (postMessage) ---

  let headerRequestId = 0;
  const pendingHeaderRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'gsi-headers-result') return;
    const { requestId, headers, authData, error } = event.data;
    const resolve = pendingHeaderRequests.get(requestId);
    if (resolve) {
      pendingHeaderRequests.delete(requestId);
      if (error) resolve({ error });
      else if (authData) resolve({ authData });
      else resolve({ headers });
    }
  });

  /**
   * Fetch raw email headers via the MAIN world script.
   * The MAIN world script runs in Gmail's page context, so its fetch()
   * is same-origin with session cookies — no extra permissions needed.
   */
  function fetchEmailHeaders(messageId) {
    return new Promise((resolve) => {
      const requestId = ++headerRequestId;
      pendingHeaderRequests.set(requestId, resolve);
      window.postMessage({ type: 'gsi-fetch-headers', messageId, requestId }, '*');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingHeaderRequests.has(requestId)) {
          pendingHeaderRequests.delete(requestId);
          resolve({ error: 'timeout' });
        }
      }, 10000);
    });
  }

  /**
   * Parse Authentication-Results header from raw email headers.
   * Returns { spf, dkim, dmarc } with string result values, or null.
   */
  function parseAuthResults(headerText) {
    // Unfold continuation lines (lines starting with whitespace)
    const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
    const lines = unfolded.split(/\r?\n/);

    let authLine = '';
    for (const line of lines) {
      if (line.toLowerCase().startsWith('authentication-results:')) {
        authLine = line.substring('authentication-results:'.length).trim();
        break;
      }
    }
    if (!authLine) return null;

    const results = {};

    const spfMatch = authLine.match(/spf=(pass|fail|softfail|neutral|none|temperror|permerror)/i);
    if (spfMatch) results.spf = spfMatch[1].toLowerCase();

    const dkimMatch = authLine.match(/dkim=(pass|fail|neutral|none|temperror|permerror)/i);
    if (dkimMatch) results.dkim = dkimMatch[1].toLowerCase();

    const dmarcMatch = authLine.match(/dmarc=(pass|fail|bestguesspass|none|temperror|permerror)/i);
    if (dmarcMatch) results.dmarc = dmarcMatch[1].toLowerCase();

    return Object.keys(results).length > 0 ? results : null;
  }

  /**
   * Parse X-Original-Sender from raw email headers (non-HTML path).
   * Returns { originalSender } or null.
   */
  function parseMailingListHeaders(headerText) {
    const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
    const lines = unfolded.split(/\r?\n/);
    for (const line of lines) {
      if (line.toLowerCase().startsWith('x-original-sender:')) {
        const value = line.substring('x-original-sender:'.length).trim().toLowerCase();
        if (value && value.includes('@')) return { originalSender: value };
      }
    }
    return null;
  }

  /**
   * Extract full raw header lines by name from email header text.
   * Returns an object mapping header names to their full unfolded line(s).
   * Collects all occurrences for headers that may appear multiple times.
   */
  function extractRawHeaderLines(headerText, names) {
    const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
    const lines = unfolded.split(/\r?\n/);
    const result = {};
    const lowerNames = names.map(n => n.toLowerCase());

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const name = line.substring(0, colonIdx).trim().toLowerCase();
      const idx = lowerNames.indexOf(name);
      if (idx !== -1) {
        const key = names[idx];
        if (!result[key]) result[key] = [];
        result[key].push(line);
      }
    }
    return result;
  }

  // --- Verdict logic ---

  function getVerdict(authResults, info) {
    if (!authResults) return 'caution';
    const spf = authResults.spf;
    const dkim = authResults.dkim;
    const dmarc = authResults.dmarc;

    if (spf === 'pass' && dkim === 'pass' && dmarc === 'pass') return 'trusted';
    if (dmarc === 'fail' || dkim === 'fail') return 'dangerous';
    if (spf === 'fail' && dkim !== 'pass') return 'dangerous';
    return 'caution';
  }

  // --- Strip pill helpers ---

  function createPill(label, state, isVerdict = false) {
    const pill = document.createElement('span');
    pill.classList.add('gsi-pill');
    if (isVerdict) pill.classList.add('gsi-pill-verdict');
    pill.textContent = state === 'loading' ? (isVerdict ? 'Checking' : label) : label;
    pill.dataset.check = label;
    updatePillState(pill, state, label, isVerdict);
    return pill;
  }

  function updatePillState(pill, state, label, isVerdict = false) {
    pill.classList.remove('gsi-pill-pass', 'gsi-pill-fail', 'gsi-pill-loading',
      'gsi-pill-trusted', 'gsi-pill-caution', 'gsi-pill-dangerous');
    if (isVerdict) {
      const cls = { trusted: 'gsi-pill-trusted', caution: 'gsi-pill-caution', dangerous: 'gsi-pill-dangerous' };
      pill.classList.add(cls[state] || 'gsi-pill-loading');
      pill.textContent = state === 'loading' ? 'Checking' : state.charAt(0).toUpperCase() + state.slice(1);
    } else {
      if (state === 'pass') {
        pill.classList.add('gsi-pill-pass');
        pill.textContent = label + ' \u2713';
      } else if (state === 'fail' || state === 'softfail') {
        pill.classList.add('gsi-pill-fail');
        pill.textContent = label + ' \u2717';
      } else {
        pill.classList.add('gsi-pill-loading');
        pill.textContent = label;
      }
    }
  }

  function updateVerdictPill(pill, verdict) {
    updatePillState(pill, verdict, '', true);
  }

  function updateGeminiColor(icon, verdict) {
    icon.classList.remove('gsi-gemini-ok', 'gsi-gemini-caution', 'gsi-gemini-reject', 'gsi-gemini-neutral');
    const map = { trusted: 'gsi-gemini-ok', caution: 'gsi-gemini-caution', dangerous: 'gsi-gemini-reject' };
    icon.classList.add(map[verdict] || 'gsi-gemini-neutral');
  }

  function createSparkleSvg(size, fill) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('fill', 'none');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M14 0C14 7.732 20.268 14 28 14C20.268 14 14 20.268 14 28C14 20.268 7.732 14 0 14C7.732 14 14 7.732 14 0Z');
    path.setAttribute('fill', fill);
    svg.appendChild(path);
    svg.style.flexShrink = '0';
    return svg;
  }

  function createGeminiIcon() {
    const geminiIcon = document.createElement('span');
    geminiIcon.classList.add('gsi-gemini-icon');
    geminiIcon.title = 'AI analysis by Gemini Nano';
    geminiIcon.appendChild(createSparkleSvg(14, 'currentColor'));
    return geminiIcon;
  }

  // --- Logo source labels for details panel ---
  const SOURCE_DETAIL_LABELS = {
    bimi_full: 'BIMI (full domain)',
    bimi_root: 'BIMI (root domain)',
    bimi: 'BIMI',
    favicon_sub: 'Favicon (subdomain)',
    favicon_root: 'Favicon (root domain)',
    favicon: 'Favicon',
    unknown: 'Unknown (fallback)',
  };

  /**
   * Fetch auth results and update strip pills + details panel.
   * @param {Object} pills - { spf, dkim, dmarc, verdict } pill elements in the strip
   * @param {HTMLElement} geminiIcon - sparkle icon to color by verdict
   * @param {HTMLElement} detailsSecSection - security section in details panel to populate
   * @param {Object} info - sender info from background
   * @param {string} envelopeEmail - envelope sender email
   * @param {Object} bannerState - shared state for logo/auth coordination
   */
  function createSecuritySection(pills, geminiIcon, detailsSecSection, info, envelopeEmail, bannerState) {
    (async () => {
      const msgResult = getMessageId();
      if (!msgResult) {
        updateVerdictPill(pills.verdict, 'caution');
        updateGeminiColor(geminiIcon, 'caution');
        const errRow = document.createElement('div');
        errRow.classList.add('gsi-details-row');
        errRow.textContent = 'Unable to find message ID';
        errRow.style.color = '#c62828';
        detailsSecSection.appendChild(errRow);
        return;
      }

      const { id: messageId } = msgResult;
      let authResults = securityCache.get(messageId);
      if (!authResults) {
        const result = await fetchEmailHeaders(messageId);
        if (result.error) {
          updateVerdictPill(pills.verdict, 'caution');
          updateGeminiColor(geminiIcon, 'caution');
          const errRow = document.createElement('div');
          errRow.classList.add('gsi-details-row');
          errRow.textContent = `Unable to check (${result.error})`;
          errRow.style.color = '#c62828';
          detailsSecSection.appendChild(errRow);
          return;
        }
        authResults = result.authData || parseAuthResults(result.headers);
        if (authResults) securityCache.set(messageId, authResults);
      }

      if (!authResults) {
        updateVerdictPill(pills.verdict, 'caution');
        updateGeminiColor(geminiIcon, 'caution');
        return;
      }

      // Update strip pills
      const checks = [
        { key: 'spf', pill: pills.spf, label: 'SPF' },
        { key: 'dkim', pill: pills.dkim, label: 'DKIM' },
        { key: 'dmarc', pill: pills.dmarc, label: 'DMARC' },
      ];
      for (const { key, pill, label } of checks) {
        const value = authResults[key];
        if (value === 'pass') updatePillState(pill, 'pass', label);
        else if (value === 'fail' || value === 'softfail') updatePillState(pill, 'fail', label);
        else updatePillState(pill, 'loading', label); // n/a

        // Populate details panel row with full value
        const row = document.createElement('div');
        row.classList.add('gsi-details-row');
        row.textContent = `${label}: ${value || 'n/a'}`;
        detailsSecSection.appendChild(row);
      }

      // BIMI row in details (not in strip pills)
      const bimiRow = document.createElement('div');
      bimiRow.classList.add('gsi-details-row');
      bimiRow.textContent = `BIMI: ${info.logoSource === 'bimi' ? 'pass (DNS)' : 'none'}`;
      detailsSecSection.appendChild(bimiRow);

      // Compute verdict (same logic as before)
      let verdictKey = getVerdict(authResults, info);
      if (bannerState && bannerState.resolvedLogoSource === SOURCE_UNKNOWN && verdictKey === 'trusted') {
        verdictKey = 'caution';
      }
      if (bannerState) bannerState.authVerdict = verdictKey;

      // Update strip verdict pill and gemini icon
      updateVerdictPill(pills.verdict, verdictKey);
      updateGeminiColor(geminiIcon, verdictKey);
    })();
  }

  // --- Tooltip (inbox hover) ---

  let tooltipEl = null;
  let hoverTimeout = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'gsi-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(row, info, viaEmail) {
    const tip = ensureTooltip();

    // Clear previous content safely
    while (tip.firstChild) tip.removeChild(tip.firstChild);

    // Badge created early so the onload callback can update it
    const sourceBadge = document.createElement('div');
    sourceBadge.classList.add('gsi-source-badge');

    const logo = createLogoImg(info, (sourceKey) => updateBadge(sourceBadge, sourceKey));

    // Row 1: logo + full domain
    const topRow = document.createElement('div');
    topRow.classList.add('gsi-tooltip-row');
    topRow.appendChild(logo);
    const domainSpan = document.createElement('span');
    domainSpan.classList.add('gsi-domain-full');
    domainSpan.textContent = info.fullDomain;
    topRow.appendChild(domainSpan);
    tip.appendChild(topRow);

    // Row 2: root domain (subtitle)
    const rootLine = document.createElement('div');
    rootLine.classList.add('gsi-domain-root');
    rootLine.textContent = info.rootDomain;
    tip.appendChild(rootLine);

    // Row 3: source badge (colored by onload callback)
    tip.appendChild(sourceBadge);

    // Row 4: "via" badge from original sender cache or Gmail row text
    if (viaEmail) {
      const viaBadge = document.createElement('div');
      viaBadge.classList.add('gsi-via-badge');
      viaBadge.textContent = `via ${viaEmail.split('@')[1]}`;
      viaBadge.style.marginTop = '4px';
      tip.appendChild(viaBadge);
    } else {
      const ywEl = row.querySelector('.yW');
      if (ywEl) {
        const rowText = ywEl.textContent || '';
        const viaMatch = rowText.match(/via\s+(\S+)/i);
        if (viaMatch) {
          const viaBadge = document.createElement('div');
          viaBadge.classList.add('gsi-via-badge');
          viaBadge.textContent = `via ${viaMatch[1]}`;
          viaBadge.style.marginTop = '4px';
          tip.appendChild(viaBadge);
        }
      }
    }

    // Position below the row
    const rect = row.getBoundingClientRect();
    tip.style.top = `${rect.bottom + window.scrollY + 4}px`;
    tip.style.left = `${rect.left + window.scrollX + 40}px`;
    tip.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // --- Inbox row processing ---

  function processInboxRow(row) {
    if (row.dataset.gsiProcessed) return;
    row.dataset.gsiProcessed = '1';

    row.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(async () => {
        const email = getEmailFromRow(row);
        if (!email) return;
        const info = await requestSenderInfo(email);
        if (!info) return;
        showTooltip(row, info);
      }, 200);
    });

    row.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      hideTooltip();
    });
  }

  // --- AI Spam/Phishing Analysis ---

  /**
   * Extract structured email data from the DOM for AI analysis.
   * Returns { displayName, senderEmail, subject, bodyText, links }.
   */
  function extractEmailData(envelopeEmail) {
    // Scope selectors to the specific message container (conversation view safety)
    const senderSelector = envelopeEmail ? `.gD[email="${envelopeEmail}"]` : '.gD[email]';
    let senderEl = document.querySelector(senderSelector);
    if (!senderEl) senderEl = document.querySelector('.gD[email]');
    const displayName = senderEl ? senderEl.textContent.trim() : '';

    const msgContainer = (senderEl && (senderEl.closest('.adn') || senderEl.closest('.gs'))) || document;

    // Subject line
    const subjectEl = msgContainer.querySelector('.hP') || document.querySelector('.hP');
    const subject = subjectEl ? subjectEl.textContent.trim() : '';

    // Body text (truncated to ~2000 chars to fit token limits)
    const bodyEl = msgContainer.querySelector('.ii .a3s') || document.querySelector('.ii .a3s');
    const bodyText = bodyEl ? bodyEl.innerText.substring(0, 2000) : '';

    // Links in the body
    const links = [];
    if (bodyEl) {
      const anchors = bodyEl.querySelectorAll('a[href]');
      for (const a of anchors) {
        if (links.length >= 20) break;
        const href = a.getAttribute('href');
        const text = a.textContent.trim();
        if (href && !href.startsWith('mailto:')) {
          // Gmail rewrites links through google.com/url?q= — extract actual URL
          let actualUrl = href;
          try {
            const parsed = new URL(href);
            if (parsed.hostname.includes('google.com') && parsed.pathname === '/url') {
              actualUrl = parsed.searchParams.get('q') || href;
            }
          } catch { /* invalid URL, use as-is */ }
          links.push({ href: actualUrl, text: text.substring(0, 100) });
        }
      }
    }

    return { displayName, senderEmail: envelopeEmail, subject, bodyText, links };
  }

  const AI_MIN_CHROME_VERSION = 138;

  function getChromeVersion() {
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Check if Chrome's Prompt API (Gemini Nano) is available.
   * Returns { available, hasApi, status, chromeVersion } for diagnostics.
   */
  function checkAiAvailable() {
    if (!contextValid) return Promise.resolve({ available: false });
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'checkAiAvailable' }, (resp) => {
          if (chrome.runtime.lastError || !resp) resolve({ available: false });
          else resolve({ ...resp, chromeVersion: getChromeVersion() });
        });
      } catch {
        resolve({ available: false });
      }
    });
  }

  /**
   * Send email data to background for AI analysis.
   * Resolves with result, { timeout: true }, or null.
   */
  function requestAiAnalysis(emailData, { skipCache = false } = {}) {
    if (!contextValid) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve({ timeout: true }); }
      }, 30000);
      try {
        chrome.runtime.sendMessage({ action: 'analyzeEmail', data: emailData, skipCache }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp || resp.unavailable) resolve(null);
          else resolve(resp);
        });
      } catch {
        if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
      }
    });
  }

  // AI verdict config
  const AI_VERDICTS = {
    Ok:      { cls: 'gsi-ai-verdict-ok',      label: 'Ok' },
    Caution: { cls: 'gsi-ai-verdict-caution',  label: 'Caution' },
    Reject:  { cls: 'gsi-ai-verdict-reject',   label: 'Reject' },
  };

  /**
   * Append AI diagnostic lines to the debug section.
   * If the debug section exists, appends immediately.
   * Otherwise stores on the banner for the debug builder to pick up.
   */
  function appendAiDebugLines(banner, result) {
    const lines = buildAiDebugLines(result);
    const debugContent = banner.querySelector('.gsi-debug-content');
    if (debugContent) {
      // Debug section already exists — append
      const existing = debugContent.textContent;
      debugContent.textContent = existing + (existing ? '\n' : '') + lines.join('\n');
    } else {
      // Debug section not built yet — store for later
      banner.__gsiAiDebug = lines;
    }
  }

  /**
   * Build debug text lines from AI analysis result.
   */
  function buildAiDebugLines(result) {
    const lines = ['--- AI Analysis ---'];
    const d = result.debug || {};
    if (d.cached) {
      lines.push('AI: cache hit');
    } else if (d.durationMs != null) {
      lines.push(`AI: ${d.durationMs}ms${d.retried ? ' (retried)' : ''}`);
    }
    lines.push(`AI verdict: ${result.verdict || '(none)'}`);
    if (result.reasons && result.reasons.length > 0) {
      lines.push(`AI reasons: ${result.reasons.join('; ')}`);
    }
    if (d.parseError) {
      lines.push(`AI parse error: ${d.parseError}`);
    }
    if (d.error) {
      lines.push(`AI error: ${d.error}`);
    }
    if (d.rawResponse != null) {
      // Truncate raw response for display
      const raw = String(d.rawResponse);
      lines.push(`AI raw: ${raw.length > 500 ? raw.substring(0, 500) + '\u2026' : raw}`);
    }
    if (d.userPrompt != null) {
      const prompt = String(d.userPrompt);
      lines.push(`AI prompt (${prompt.length} chars): ${prompt.length > 300 ? prompt.substring(0, 300) + '\u2026' : prompt}`);
    }
    return lines;
  }

  // --- Banner (email view) ---

  let currentBannerEmail = null;

  function removeBanner() {
    const existing = document.getElementById('gsi-banner');
    if (existing) existing.remove();
    currentBannerEmail = null;
  }

  /**
   * Extract Gmail profile image URL for a sender.
   * Gmail renders the avatar on an element with data-hovercard-id matching the
   * sender email, often outside the message container. The avatar may be an <img>
   * with a googleusercontent URL, or a background-image, or have a child <img>.
   * Returns { url, debug } where debug contains diagnostic info for the debug section.
   */
  function extractProfileImageUrl(envelopeEmail) {
    const debug = { senderFound: false, hovercardFound: false, hovercardTag: null, hovercardClass: null, matchedUrl: null, matchSource: null, dataName: null, candidates: [] };

    if (!envelopeEmail) return { url: null, debug };
    debug.senderFound = true;

    // Strategy 1: Find the avatar mask <img> with data-hovercard-id matching the sender.
    // Must target img.ajn specifically — other elements like .yP spans also carry this attribute.
    const hovercardEl = document.querySelector(`img.ajn[data-hovercard-id="${CSS.escape(envelopeEmail)}"]`);

    if (hovercardEl) {
      debug.dataName = hovercardEl.getAttribute('data-name') || null;
      debug.hovercardFound = true;
      debug.hovercardTag = hovercardEl.tagName;
      debug.hovercardClass = hovercardEl.className?.substring(0, 60) || '';

      // Gmail lazy-loads the real photo src onto the mask <img> after initial render.
      // Check if the src has already been updated to a googleusercontent URL.
      // Skip default/placeholder avatars (e.g. "default-user" in the URL).
      if (hovercardEl.src && hovercardEl.src.includes('googleusercontent.com')
          && !hovercardEl.src.includes('default-user')) {
        debug.matchedUrl = hovercardEl.src;
        debug.matchSource = 'hovercard-src';
        debug.candidates.push(`hovercard-src: ${hovercardEl.src.substring(0, 150)}`);
        return { url: debug.matchedUrl, debug };
      }
      debug.candidates.push(`hovercard-src: ${(hovercardEl.src || '(none)').substring(0, 150)}`);

      if (debug.matchedUrl) return { url: debug.matchedUrl, debug };
    }

    // Strategy 2: Broader search — find any img near .gD[email] with googleusercontent src
    const senderEl = document.querySelector(`.gD[email="${CSS.escape(envelopeEmail)}"]`) || document.querySelector('.gD[email]');
    if (senderEl) {
      const container = senderEl.closest('[data-message-id]')
        || senderEl.closest('.gE') || senderEl.closest('.gs')
        || senderEl.closest('.adn');
      if (container) {
        for (const img of container.querySelectorAll('img')) {
          if (img.src && img.src.includes('googleusercontent.com/a')
              && !img.src.includes('default-user')) {
            debug.candidates.push(`container-img: ${img.src.substring(0, 120)}`);
            debug.matchedUrl = img.src;
            debug.matchSource = 'container-img';
            return { url: debug.matchedUrl, debug };
          }
        }
      }
    }

    return { url: null, debug };
  }

  function insertBanner(info, envelopeEmail) {
    removeBanner();

    const subjectEl = document.querySelector('.hP');
    if (!subjectEl) return;

    const banner = document.createElement('div');
    banner.id = 'gsi-banner';

    // --- Main strip row ---
    const stripRow = document.createElement('div');
    stripRow.classList.add('gsi-strip-row');

    // Shared state for async logo/security coordination (unchanged logic)
    const bannerState = { resolvedLogoSource: null, authVerdict: null };

    // Logo source text element (in details panel, created later but referenced in callback)
    let srcTextEl = null;

    // Logo (24x24)
    const logo = createLogoImg(info, (sourceKey) => {
      bannerState.resolvedLogoSource = sourceKey;
      if (srcTextEl) {
        srcTextEl.textContent = SOURCE_DETAIL_LABELS[sourceKey] || sourceKey;
      }
      if (sourceKey === SOURCE_UNKNOWN && bannerState.authVerdict === 'trusted') {
        updateVerdictPill(verdictPill, 'caution');
        updateGeminiColor(geminiIcon, 'caution');
      }
    });
    stripRow.appendChild(logo);

    // Domain
    const domainSpan = document.createElement('span');
    domainSpan.classList.add('gsi-strip-domain');
    domainSpan.textContent = info.fullDomain;
    stripRow.appendChild(domainSpan);

    // Root domain (if different)
    if (info.rootDomain !== info.fullDomain) {
      const rootSpan = document.createElement('span');
      rootSpan.classList.add('gsi-strip-root');
      rootSpan.textContent = `(${info.rootDomain})`;
      stripRow.appendChild(rootSpan);
    }

    // Profile image (20x20, conditional)
    function tryAddProfileImage() {
      const result = extractProfileImageUrl(envelopeEmail);
      banner.__gsiProfileDebug = result.debug;
      if (result.url) {
        const old = stripRow.querySelector('.gsi-profile-img');
        if (old) old.remove();
        const profileImg = document.createElement('img');
        profileImg.classList.add('gsi-profile-img');
        profileImg.src = result.url;
        profileImg.width = 20;
        profileImg.height = 20;
        profileImg.alt = result.debug.dataName || 'Sender profile';
        profileImg.onerror = () => profileImg.remove();
        // Insert after domain/root spans, before divider
        const firstDivider = stripRow.querySelector('.gsi-strip-divider');
        if (firstDivider) {
          stripRow.insertBefore(profileImg, firstDivider);
        } else {
          stripRow.appendChild(profileImg);
        }
        return true;
      }
      return false;
    }

    // Divider
    const div1 = document.createElement('span');
    div1.classList.add('gsi-strip-divider');
    div1.textContent = '|';
    stripRow.appendChild(div1);

    // Security pills (loading state)
    const spfPill = createPill('SPF', 'loading');
    const dkimPill = createPill('DKIM', 'loading');
    const dmarcPill = createPill('DMARC', 'loading');
    stripRow.appendChild(spfPill);
    stripRow.appendChild(dkimPill);
    stripRow.appendChild(dmarcPill);

    // Divider
    const div2 = document.createElement('span');
    div2.classList.add('gsi-strip-divider');
    div2.textContent = '|';
    stripRow.appendChild(div2);

    // Verdict pill (loading state)
    const verdictPill = createPill('Checking', 'loading', true);
    stripRow.appendChild(verdictPill);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    stripRow.appendChild(spacer);

    // Gemini sparkle (hidden until AI check confirms available)
    const geminiIcon = createGeminiIcon();
    geminiIcon.style.display = 'none';
    stripRow.appendChild(geminiIcon);

    // Expand arrow
    const expandArrow = document.createElement('span');
    expandArrow.classList.add('gsi-strip-expand');
    expandArrow.textContent = '\u25BC';
    stripRow.appendChild(expandArrow);

    banner.appendChild(stripRow);

    // Profile image retry
    if (!tryAddProfileImage()) {
      setTimeout(() => { if (banner.isConnected) tryAddProfileImage(); }, 500);
      setTimeout(() => { if (banner.isConnected && !stripRow.querySelector('.gsi-profile-img')) tryAddProfileImage(); }, 1500);
    }

    // --- AI summary line (below strip, always visible) ---
    const aiLine = document.createElement('div');
    aiLine.classList.add('gsi-ai-line');
    aiLine.style.display = 'none'; // hidden until AI availability confirmed

    const aiSparkle = createSparkleSvg(14, '#9aa0a6');
    aiLine.appendChild(aiSparkle);

    const aiLineText = document.createElement('span');
    aiLineText.classList.add('gsi-ai-line-text', 'gsi-ai-line-loading');
    aiLineText.textContent = 'Analyzing\u2026';
    aiLine.appendChild(aiLineText);

    banner.appendChild(aiLine);

    // --- Details panel (hidden by default) ---
    const detailsPanel = document.createElement('div');
    detailsPanel.classList.add('gsi-details-panel');

    // Toggle via expand arrow
    expandArrow.addEventListener('click', () => {
      const isOpen = detailsPanel.style.display === 'block';
      detailsPanel.style.display = isOpen ? 'none' : 'block';
      expandArrow.textContent = isOpen ? '\u25BC' : '\u25B2';
    });

    // 1. Security details section
    const secSection = document.createElement('div');
    secSection.classList.add('gsi-details-section');
    const secLabel = document.createElement('div');
    secLabel.classList.add('gsi-details-label');
    secLabel.textContent = 'Security';
    secSection.appendChild(secLabel);
    // Security detail rows populated by createSecuritySection callback
    detailsPanel.appendChild(secSection);

    // 2. Logo source section
    const srcSection = document.createElement('div');
    srcSection.classList.add('gsi-details-section');
    const srcLabel = document.createElement('div');
    srcLabel.classList.add('gsi-details-label');
    srcLabel.textContent = 'Logo Source';
    srcSection.appendChild(srcLabel);
    const srcText = document.createElement('div');
    srcText.classList.add('gsi-details-source');
    srcText.textContent = 'Resolving\u2026';
    srcSection.appendChild(srcText);
    srcTextEl = srcText; // wire up to logo callback
    detailsPanel.appendChild(srcSection);

    // 3. AI analysis details (populated after AI result)
    const aiDetailsSection = document.createElement('div');
    aiDetailsSection.classList.add('gsi-details-section');
    aiDetailsSection.style.display = 'none'; // hidden until AI result
    detailsPanel.appendChild(aiDetailsSection);

    // 4. Debug section (nested collapsible) — built by original sender / debug async block

    banner.appendChild(detailsPanel);

    // Wire up security section to update pills + populate details
    createSecuritySection(
      { spf: spfPill, dkim: dkimPill, dmarc: dmarcPill, verdict: verdictPill },
      geminiIcon,
      secSection,
      info,
      envelopeEmail,
      bannerState
    );

    // Insert before the subject line, but match the width of the email
    // body table below (.ii .a3s = message body, or the parent .gs container).
    subjectEl.parentElement.insertBefore(banner, subjectEl);

    // Size to the email body area rather than the narrow subject wrapper
    const bodyEl = document.querySelector('.ii .a3s') || document.querySelector('.gs');
    if (bodyEl) {
      const bodyWidth = bodyEl.offsetWidth;
      if (bodyWidth > banner.offsetWidth) {
        banner.style.width = bodyWidth + 'px';
      }
    }

    currentBannerEmail = info.fullDomain;

    // AI spam/phishing analysis (async, won't block banner render)
    (async () => {
      const aiStatus = await checkAiAvailable();

      if (!aiStatus.available) return;

      // Show Gemini icon in strip and AI summary line
      geminiIcon.style.display = '';
      aiLine.style.display = '';

      const emailData = extractEmailData(envelopeEmail);
      const msgResult = getMessageId();
      if (msgResult) {
        emailData.messageId = msgResult.id;
        const cached = securityCache.get(msgResult.id);
        if (cached) {
          emailData.auth = { spf: cached.spf, dkim: cached.dkim, dmarc: cached.dmarc };
        }
      }

      // Use X-Original-Sender for AI scoring when it points to a different domain
      if (msgResult) {
        const headerResult = await fetchEmailHeaders(msgResult.id);
        if (!headerResult.error) {
          let origSender = null;
          if (headerResult.authData?.originalSender) {
            origSender = headerResult.authData.originalSender;
          } else if (headerResult.headers) {
            const ml = parseMailingListHeaders(headerResult.headers);
            if (ml) origSender = ml.originalSender;
          }
          if (origSender && origSender !== envelopeEmail) {
            const origDomain = origSender.split('@')[1];
            const envDomain = envelopeEmail.split('@')[1];
            if (origDomain && origDomain !== envDomain) {
              emailData.senderEmail = origSender;
            }
          }
        }
      }

      function applyAiResult(result) {
        // Reset gemini icon classes
        geminiIcon.classList.remove('gsi-gemini-ok', 'gsi-gemini-caution', 'gsi-gemini-reject', 'gsi-gemini-neutral');

        const failed = !result || result.timeout || result.parseError;

        if (failed) {
          geminiIcon.classList.add('gsi-gemini-neutral');
          // Update AI line with failure message
          aiLineText.classList.remove('gsi-ai-line-loading');
          aiLineText.textContent = result && result.timeout
            ? 'AI analysis timed out'
            : 'AI analysis unavailable';

          // Add retry button to AI line
          const refreshBtn = document.createElement('button');
          refreshBtn.classList.add('gsi-ai-refresh-btn');
          refreshBtn.type = 'button';
          refreshBtn.title = 'Re-run AI analysis';
          refreshBtn.setAttribute('aria-label', 'Re-run AI analysis');
          refreshBtn.textContent = '\u21BB';
          refreshBtn.addEventListener('click', () => {
            aiLineText.classList.add('gsi-ai-line-loading');
            aiLineText.textContent = 'Retrying\u2026';
            const oldBtn = aiLine.querySelector('.gsi-ai-refresh-btn');
            if (oldBtn) oldBtn.remove();
            // Clear previous AI details
            aiDetailsSection.style.display = 'none';
            while (aiDetailsSection.firstChild) aiDetailsSection.removeChild(aiDetailsSection.firstChild);
            requestAiAnalysis(emailData, { skipCache: true }).then((retryResult) => {
              applyAiResult(retryResult);
            });
          });
          aiLine.appendChild(refreshBtn);
        } else {
          const colorMap = { Ok: 'gsi-gemini-ok', Caution: 'gsi-gemini-caution', Reject: 'gsi-gemini-reject' };
          geminiIcon.classList.add(colorMap[result.verdict] || 'gsi-gemini-caution');

          // Update AI line with verdict pill + summary
          aiLineText.classList.remove('gsi-ai-line-loading');
          const verdictConfig = AI_VERDICTS[result.verdict] || AI_VERDICTS.Caution;
          const aiPill = document.createElement('span');
          aiPill.classList.add('gsi-ai-verdict', verdictConfig.cls);
          aiPill.textContent = verdictConfig.label;

          // Replace loading text with pill + summary
          aiLineText.textContent = '';
          aiLineText.appendChild(aiPill);
          if (result.summary) {
            aiLineText.appendChild(document.createTextNode(' ' + result.summary));
          } else if (result.reasons && result.reasons.length > 0) {
            aiLineText.appendChild(document.createTextNode(' ' + result.reasons[0]));
          } else if (result.verdict === 'Ok') {
            aiLineText.appendChild(document.createTextNode(' No concerns detected'));
          }

          // Add retry button
          const refreshBtn = document.createElement('button');
          refreshBtn.classList.add('gsi-ai-refresh-btn');
          refreshBtn.type = 'button';
          refreshBtn.title = 'Re-run AI analysis';
          refreshBtn.setAttribute('aria-label', 'Re-run AI analysis');
          refreshBtn.textContent = '\u21BB';
          refreshBtn.addEventListener('click', () => {
            aiLineText.classList.add('gsi-ai-line-loading');
            aiLineText.textContent = 'Retrying\u2026';
            const oldBtn = aiLine.querySelector('.gsi-ai-refresh-btn');
            if (oldBtn) oldBtn.remove();
            aiDetailsSection.style.display = 'none';
            while (aiDetailsSection.firstChild) aiDetailsSection.removeChild(aiDetailsSection.firstChild);
            requestAiAnalysis(emailData, { skipCache: true }).then((retryResult) => {
              applyAiResult(retryResult);
            });
          });
          aiLine.appendChild(refreshBtn);

          // Populate AI details section with full reasons
          if (result.reasons && result.reasons.length > 0) {
            aiDetailsSection.style.display = '';
            const aiLabel = document.createElement('div');
            aiLabel.classList.add('gsi-details-label');
            aiLabel.textContent = 'AI Analysis';
            aiDetailsSection.appendChild(aiLabel);

            const detailPill = document.createElement('span');
            detailPill.classList.add('gsi-ai-verdict', verdictConfig.cls);
            detailPill.textContent = verdictConfig.label;
            aiDetailsSection.appendChild(detailPill);

            const list = document.createElement('ul');
            list.classList.add('gsi-ai-reasons');
            for (const reason of result.reasons) {
              const li = document.createElement('li');
              li.classList.add('gsi-ai-reason-item');
              li.textContent = reason;
              list.appendChild(li);
            }
            aiDetailsSection.appendChild(list);
          }
        }

        if (result && result.debug) {
          appendAiDebugLines(banner, result);
        }
      }

      const result = await requestAiAnalysis(emailData);
      if (!banner.isConnected) return; // banner was removed while waiting
      applyAiResult(result);
    })();

    // Detect original sender for Google Groups / mailing list emails
    (async () => {
      const msgResult = getMessageId();
      if (!msgResult) return;

      const result = await fetchEmailHeaders(msgResult.id);
      if (result.error) return;

      let originalSender = null;
      if (result.authData?.originalSender) {
        originalSender = result.authData.originalSender;
      } else if (result.headers) {
        const ml = parseMailingListHeaders(result.headers);
        if (ml) originalSender = ml.originalSender;
      }

      // Find details panel for debug + original sender rows
      let detailsPanelEl = banner.querySelector('.gsi-details-panel');
      if (!detailsPanelEl) return; // should always exist in new layout

      // DEBUG: collapsible section in details panel (collapsed by default)
      const debugWrap = document.createElement('div');
      debugWrap.classList.add('gsi-debug-section');
      const debugHeader = document.createElement('div');
      debugHeader.classList.add('gsi-debug-header');
      const debugChevron = document.createElement('span');
      debugChevron.style.cssText = 'font-size:9px;display:inline-block;transition:transform 0.15s';
      debugChevron.textContent = '\u25B6';
      debugHeader.appendChild(debugChevron);
      debugHeader.appendChild(document.createTextNode(' Debug'));
      const debugContent = document.createElement('div');
      debugContent.classList.add('gsi-debug-content');
      // Build debug lines
      const debugLines = [
        `envelope: ${envelopeEmail || '(none)'} | X-Original-Sender: ${originalSender || '(not found)'} | path: ${result.authData ? 'HTML' : 'raw'}`,
      ];

      if (result.headers) {
        // Raw headers available — show actual header lines
        const rawHeaders = extractRawHeaderLines(result.headers, [
          'Authentication-Results',
          'Received-SPF',
          'DKIM-Signature',
        ]);
        if (rawHeaders['Authentication-Results']) {
          for (const line of rawHeaders['Authentication-Results']) {
            debugLines.push(line);
          }
        }
        if (rawHeaders['Received-SPF']) {
          for (const line of rawHeaders['Received-SPF']) {
            debugLines.push(line);
          }
        }
        if (rawHeaders['DKIM-Signature']) {
          for (const line of rawHeaders['DKIM-Signature']) {
            debugLines.push(line);
          }
        }
      } else if (result.authData) {
        // HTML path — show raw header lines if extracted, otherwise parsed values
        const raw = result.authData.rawHeaderLines;
        if (raw && Object.keys(raw).length > 0) {
          for (const [name, lines] of Object.entries(raw)) {
            for (const line of lines) {
              debugLines.push(line);
            }
          }
        } else {
          debugLines.push(`SPF: ${result.authData.spf || 'n/a'} | DKIM: ${result.authData.dkim || 'n/a'} | DMARC: ${result.authData.dmarc || 'n/a'} (raw headers not available)`);
        }
      }
      debugLines.push(`BIMI: ${info.logoSource === 'bimi' ? 'pass (DNS)' : 'none'}`);

      // Profile image diagnostics
      const pd = banner.__gsiProfileDebug;
      if (pd) {
        debugLines.push('--- Profile Image ---');
        debugLines.push(`hovercard el: ${pd.hovercardFound ? `${pd.hovercardTag} .${pd.hovercardClass}` : 'not found'} | matched: ${pd.matchedUrl ? pd.matchSource : 'no'}`);
        if (pd.candidates.length > 0) {
          for (const c of pd.candidates) {
            debugLines.push(`  ${c}`);
          }
        }
        if (pd.matchedUrl) debugLines.push(`profile URL: ${pd.matchedUrl}`);
        if (pd.domSnippet) debugLines.push(`DOM near hovercard:\n${pd.domSnippet}`);
      }

      // Include AI diagnostics if the AI block finished before the debug section was built
      if (banner.__gsiAiDebug) {
        debugLines.push(...banner.__gsiAiDebug);
        delete banner.__gsiAiDebug;
      }

      debugContent.textContent = debugLines.join('\n');
      debugHeader.addEventListener('click', () => {
        const isOpen = debugContent.style.display === 'block';
        debugContent.style.display = isOpen ? 'none' : 'block';
        debugChevron.textContent = isOpen ? '\u25B6' : '\u25BC';
      });
      debugWrap.appendChild(debugHeader);
      debugWrap.appendChild(debugContent);
      detailsPanelEl.appendChild(debugWrap);

      if (!originalSender || !envelopeEmail || originalSender === envelopeEmail) return;

      const origInfo = await requestSenderInfo(originalSender);
      if (!origInfo) return;

      // Update strip row with original sender info
      const oldLogo = banner.querySelector('.gsi-logo');
      const stripRowEl = banner.querySelector('.gsi-strip-row');
      if (oldLogo && stripRowEl) {
        const newLogo = createLogoImg(origInfo, (sourceKey) => {
          if (srcTextEl) {
            srcTextEl.textContent = SOURCE_DETAIL_LABELS[sourceKey] || sourceKey;
          }
        });
        oldLogo.replaceWith(newLogo);

        // Update profile image to original sender's photo
        const oldProfile = stripRowEl.querySelector('.gsi-profile-img');
        const origProfileResult = extractProfileImageUrl(originalSender);
        if (origProfileResult.url) {
          const profileImg = document.createElement('img');
          profileImg.classList.add('gsi-profile-img');
          profileImg.src = origProfileResult.url;
          profileImg.width = 20;
          profileImg.height = 20;
          profileImg.alt = origProfileResult.debug?.dataName || 'Sender profile';
          profileImg.onerror = () => profileImg.remove();
          if (oldProfile) oldProfile.replaceWith(profileImg);
          else {
            const firstDivider = stripRowEl.querySelector('.gsi-strip-divider');
            if (firstDivider) {
              stripRowEl.insertBefore(profileImg, firstDivider);
            } else {
              stripRowEl.appendChild(profileImg);
            }
          }
        } else if (oldProfile) {
          oldProfile.remove();
        }

        const domainEl = stripRowEl.querySelector('.gsi-strip-domain');
        if (domainEl) domainEl.textContent = origInfo.fullDomain;

        const rootEl = stripRowEl.querySelector('.gsi-strip-root');
        if (origInfo.rootDomain !== origInfo.fullDomain) {
          if (rootEl) {
            rootEl.textContent = `(${origInfo.rootDomain})`;
          } else {
            const newRoot = document.createElement('span');
            newRoot.classList.add('gsi-strip-root');
            newRoot.textContent = `(${origInfo.rootDomain})`;
            // Insert after domain span
            if (domainEl && domainEl.nextSibling) {
              stripRowEl.insertBefore(newRoot, domainEl.nextSibling);
            } else {
              stripRowEl.appendChild(newRoot);
            }
          }
        } else if (rootEl) {
          rootEl.remove();
        }

        const groupDomain = envelopeEmail.split('@')[1];
        const viaBadge = document.createElement('span');
        viaBadge.classList.add('gsi-via-badge');
        viaBadge.textContent = `via ${groupDomain}`;
        // Insert before the first divider
        const firstDivider = stripRowEl.querySelector('.gsi-strip-divider');
        if (firstDivider) {
          stripRowEl.insertBefore(viaBadge, firstDivider);
        } else {
          stripRowEl.appendChild(viaBadge);
        }
      }

      // Add original sender section to details panel
      const origSection = document.createElement('div');
      origSection.classList.add('gsi-details-section');

      const origLabel = document.createElement('div');
      origLabel.classList.add('gsi-details-label');
      origLabel.textContent = `Original Sender \u2014 ${origInfo.fullDomain}`;
      origSection.appendChild(origLabel);

      // Original sender security info
      let origAuth = result.authData || null;
      if (!origAuth && result.headers) origAuth = parseAuthResults(result.headers);

      const checks = [
        { key: 'spf', label: 'SPF' },
        { key: 'dkim', label: 'DKIM' },
        { key: 'dmarc', label: 'DMARC' },
      ];
      for (const check of checks) {
        const row = document.createElement('div');
        row.classList.add('gsi-details-row');
        const value = origAuth?.[check.key];
        row.textContent = `${check.label}: ${value || 'n/a'}`;
        origSection.appendChild(row);
      }

      // BIMI for original sender
      const bRow = document.createElement('div');
      bRow.classList.add('gsi-details-row');
      bRow.textContent = `BIMI: ${origInfo.logoSource === 'bimi' ? 'pass (DNS)' : 'none'}`;
      origSection.appendChild(bRow);

      // Insert before debug section
      const existingDebug = detailsPanelEl.querySelector('.gsi-debug-section');
      if (existingDebug) {
        detailsPanelEl.insertBefore(origSection, existingDebug);
      } else {
        detailsPanelEl.appendChild(origSection);
      }
    })();
  }

  async function processEmailView() {
    const email = getEmailFromView();
    if (!email) return;

    const domain = email.split('@')[1];
    // If Gmail keyboard navigation destroyed the banner DOM, reset tracking
    if (currentBannerEmail && !document.getElementById('gsi-banner')) {
      currentBannerEmail = null;
    }
    // Don't re-insert if already showing for this domain
    if (currentBannerEmail === domain) return;

    const info = await requestSenderInfo(email);
    if (!info) return;
    insertBanner(info, email);
  }

  // --- MutationObserver ---

  let observerActive = false;
  let activeObserver = null;

  function scan() {
    if (!contextValid) return;

    // Process inbox rows
    const rows = document.querySelectorAll('.zA:not([data-gsi-processed])');
    rows.forEach(processInboxRow);

    // Process email view if subject line is present
    const subjectEl = document.querySelector('.hP');
    if (subjectEl) {
      processEmailView();
    } else {
      // Navigated away from email view — clean up banner
      if (currentBannerEmail) removeBanner();
    }
  }

  function startObserver() {
    if (observerActive) return;
    observerActive = true;

    // Initial scan
    scan();

    activeObserver = new MutationObserver(() => {
      scan();
    });

    activeObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Wait for Gmail to load, then start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
