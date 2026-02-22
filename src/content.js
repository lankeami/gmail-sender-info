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

  // --- Summary verdict SVGs ---

  const VERDICT_TRUSTED_SVG = '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1z" fill="#4caf50"/><path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z" fill="#fff"/></svg>';
  const VERDICT_CAUTION_SVG = '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 2L1 21h22L12 2z" fill="#F59E0B" stroke="#D97706" stroke-width=".5"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><rect x="11" y="17" width="2" height="2" rx="1" fill="#fff"/></svg>';
  const VERDICT_DANGER_SVG = '<svg viewBox="0 0 24 24" width="36" height="36"><circle cx="12" cy="12" r="11" fill="#ef4444"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';

  const VERDICTS = {
    trusted:  { svg: '', label: '', cls: 'gsi-verdict-trusted' },
    caution:  { svg: VERDICT_CAUTION_SVG, label: 'Use Caution', cls: 'gsi-verdict-caution' },
    dangerous: { svg: VERDICT_DANGER_SVG, label: 'Not Trusted', cls: 'gsi-verdict-danger' },
    loading:  { svg: '', label: 'Checking\u2026', cls: 'gsi-verdict-loading' },
  };

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

  // Smaller SVGs for the inline banner badge (18×18)
  const VERDICT_CAUTION_SVG_SM = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2L1 21h22L12 2z" fill="#F59E0B" stroke="#D97706" stroke-width=".5"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><rect x="11" y="17" width="2" height="2" rx="1" fill="#fff"/></svg>';
  const VERDICT_DANGER_SVG_SM = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="11" fill="#ef4444"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';

  const VERDICTS_SM = {
    caution:  { svg: VERDICT_CAUTION_SVG_SM, label: 'Use Caution' },
    dangerous: { svg: VERDICT_DANGER_SVG_SM, label: 'Not Trusted' },
  };

  function setVerdict(summaryEl, verdictKey, bannerBadgeEl) {
    // Update inline banner badge
    if (bannerBadgeEl) {
      if (verdictKey === 'trusted') {
        bannerBadgeEl.style.display = 'none';
      } else {
        const sm = VERDICTS_SM[verdictKey] || VERDICTS_SM.caution;
        bannerBadgeEl.style.display = '';
        bannerBadgeEl.className = 'gsi-banner-verdict gsi-banner-verdict-' + verdictKey;
        // Safe: hardcoded SVG constants, not user input
        bannerBadgeEl.querySelector('.gsi-banner-verdict-icon').innerHTML = sm.svg;
      }
    }

    // Update accordion summary column
    if (verdictKey === 'trusted') {
      summaryEl.style.display = 'none';
      return;
    }
    const v = VERDICTS[verdictKey] || VERDICTS.caution;
    summaryEl.className = 'gsi-summary ' + v.cls;
    summaryEl.style.display = '';
    // Safe: hardcoded SVG constants, not user input
    summaryEl.querySelector('.gsi-summary-icon').innerHTML = v.svg;
    summaryEl.querySelector('.gsi-summary-label').textContent = v.label;
  }

  /**
   * Build the security checks column and update the summary verdict.
   * Fetches headers async and updates the DOM when results arrive.
   */
  function createSecuritySection(container, summaryEl, info, envelopeEmail, bannerBadgeEl, sourceBadgeEl, bannerState) {
    const sectionHeader = document.createElement('div');
    sectionHeader.classList.add('gsi-col-header');
    sectionHeader.textContent = 'Security';
    container.appendChild(sectionHeader);

    const loadingRow = document.createElement('div');
    loadingRow.classList.add('gsi-security-loading');
    loadingRow.textContent = 'Checking\u2026';
    container.appendChild(loadingRow);

    (async () => {
      const msgResult = getMessageId();
      if (!msgResult) {
        loadingRow.textContent = 'Unable to find message ID';
        loadingRow.classList.add('gsi-security-error');
        setVerdict(summaryEl, 'caution', bannerBadgeEl);
        return;
      }

      const { id: messageId } = msgResult;

      let authResults = securityCache.get(messageId);
      if (!authResults) {
        const result = await fetchEmailHeaders(messageId);
        if (result.error) {
          loadingRow.textContent = `Unable to check (${result.error})`;
          loadingRow.classList.add('gsi-security-error');
          setVerdict(summaryEl, 'caution', bannerBadgeEl);
          return;
        }
        authResults = result.authData || parseAuthResults(result.headers);
        if (authResults) securityCache.set(messageId, authResults);
      }

      loadingRow.remove();

      if (!authResults) {
        const noResults = document.createElement('div');
        noResults.classList.add('gsi-security-loading');
        noResults.textContent = 'No auth results found';
        container.appendChild(noResults);
        setVerdict(summaryEl, 'caution', bannerBadgeEl);
        return;
      }

      const checks = [
        { key: 'spf', label: 'SPF' },
        { key: 'dkim', label: 'DKIM' },
        { key: 'dmarc', label: 'DMARC' },
      ];

      for (const check of checks) {
        const row = document.createElement('div');
        row.classList.add('gsi-security-row');

        const label = document.createElement('span');
        label.classList.add('gsi-security-label');
        label.textContent = check.label;
        row.appendChild(label);

        const result = document.createElement('span');
        result.classList.add('gsi-security-result');
        const value = authResults[check.key];
        if (value) {
          result.textContent = value;
          if (value === 'pass') result.classList.add('gsi-result-pass');
          else if (value === 'fail' || value === 'softfail') result.classList.add('gsi-result-fail');
          else result.classList.add('gsi-result-neutral');
        } else {
          result.textContent = 'n/a';
          result.classList.add('gsi-result-neutral');
        }
        row.appendChild(result);
        container.appendChild(row);
      }

      // BIMI row
      const bimiRow = document.createElement('div');
      bimiRow.classList.add('gsi-security-row');
      const bimiLabel = document.createElement('span');
      bimiLabel.classList.add('gsi-security-label');
      bimiLabel.textContent = 'BIMI';
      bimiRow.appendChild(bimiLabel);
      const bimiResult = document.createElement('span');
      bimiResult.classList.add('gsi-security-result');
      if (info.logoSource === 'bimi') {
        bimiResult.textContent = 'pass';
        bimiResult.classList.add('gsi-result-pass');
      } else {
        bimiResult.textContent = 'none';
        bimiResult.classList.add('gsi-result-neutral');
      }
      bimiRow.appendChild(bimiResult);
      container.appendChild(bimiRow);

      let verdictKey = getVerdict(authResults, info);
      // No recognizable logo → cap verdict at caution
      if (bannerState && bannerState.resolvedLogoSource === SOURCE_UNKNOWN && verdictKey === 'trusted') {
        verdictKey = 'caution';
      }
      if (bannerState) bannerState.authVerdict = verdictKey;

      // Update source badge based on auth results
      if (sourceBadgeEl) {
        const failures = [];
        for (const { key, label } of checks) {
          const v = authResults[key];
          if (v && v !== 'pass' && v !== 'none') {
            failures.push(`${label}: ${v}`);
          }
        }
        if (failures.length > 0) {
          sourceBadgeEl.textContent = failures.join(', ');
          sourceBadgeEl.className = 'gsi-source-badge gsi-source-verdict-' + verdictKey;
          sourceBadgeEl.style.display = '';
        } else {
          sourceBadgeEl.style.display = 'none';
        }
      }

      // Update summary verdict
      setVerdict(summaryEl, verdictKey, bannerBadgeEl);
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

  const AI_SCAN_MESSAGES = [
    'Scanning email\u2026',
    'Checking sender identity\u2026',
    'Analyzing links\u2026',
    'Reviewing content\u2026',
    'Evaluating threat signals\u2026',
    'Almost done\u2026',
  ];

  // AI verdict config
  const AI_VERDICTS = {
    Ok:      { cls: 'gsi-ai-verdict-ok',      label: 'Ok' },
    Caution: { cls: 'gsi-ai-verdict-caution',  label: 'Caution' },
    Reject:  { cls: 'gsi-ai-verdict-reject',   label: 'Reject' },
  };

  /**
   * Create and populate the AI Analysis section in the accordion.
   * Returns the container element (initially shows loading state).
   * Call updateAiSection() when results arrive.
   */
  function createAiSection(aiStatus) {
    const wrap = document.createElement('div');
    wrap.classList.add('gsi-ai-section');

    const header = document.createElement('div');
    header.classList.add('gsi-col-header');
    header.textContent = 'AI Analysis';
    wrap.appendChild(header);

    // Always show version + API status so the user has context
    if (aiStatus) {
      const compat = document.createElement('div');
      compat.classList.add('gsi-ai-compat');

      const chromeVer = aiStatus.chromeVersion;
      const meetsMin = chromeVer && chromeVer >= AI_MIN_CHROME_VERSION;
      const apiLabel = !aiStatus.hasApi ? 'not found' : (aiStatus.status || 'unknown');

      compat.textContent = `Chrome ${chromeVer || '?'}`
        + (meetsMin ? '' : ` (requires ${AI_MIN_CHROME_VERSION}+)`)
        + ` · Prompt API: ${apiLabel}`;
      compat.style.color = aiStatus.available ? '#5f6368' : '#c62828';
      wrap.appendChild(compat);
    }

    const loading = document.createElement('div');
    loading.classList.add('gsi-ai-loading');
    loading.textContent = aiStatus && aiStatus.available ? 'Analyzing\u2026' : '';
    wrap.appendChild(loading);

    return wrap;
  }

  /**
   * Update the AI section with analysis results.
   */
  function updateAiSection(sectionEl, result, bannerEl, onRetry) {
    // Remove loading indicator
    const loading = sectionEl.querySelector('.gsi-ai-loading');
    if (loading) loading.remove();

    // Remove any previous banner row from a prior attempt
    if (bannerEl) {
      const oldRow = bannerEl.querySelector('.gsi-ai-banner-row');
      if (oldRow) oldRow.remove();
    }

    const failed = !result || result.timeout || result.parseError;

    // Banner row: verdict pill + summary, or apology message on failure
    if (bannerEl) {
      const accordion = bannerEl.querySelector('.gsi-accordion');

      const row = document.createElement('div');
      row.classList.add('gsi-ai-banner-row');

      if (failed) {
        const msg = document.createElement('span');
        msg.classList.add('gsi-ai-summary', 'gsi-ai-fail-text');
        msg.textContent = result && result.timeout
          ? 'AI analysis timed out. Sorry about that.'
          : 'AI analysis was inconclusive. Sorry about that.';
        row.appendChild(msg);
      } else {
        const verdictConfig = AI_VERDICTS[result.verdict] || AI_VERDICTS.Caution;

        const pill = document.createElement('span');
        pill.classList.add('gsi-ai-verdict', verdictConfig.cls);
        pill.textContent = verdictConfig.label;
        row.appendChild(pill);

        if (result.summary) {
          const summaryEl = document.createElement('span');
          summaryEl.classList.add('gsi-ai-summary');
          summaryEl.textContent = result.summary;
          row.appendChild(summaryEl);
        }
      }

      if (onRetry) {
        const refreshBtn = document.createElement('button');
        refreshBtn.classList.add('gsi-ai-refresh-btn');
        refreshBtn.type = 'button';
        refreshBtn.title = 'Re-run AI analysis';
        refreshBtn.setAttribute('aria-label', 'Re-run AI analysis');
        refreshBtn.textContent = '\u21BB';
        refreshBtn.addEventListener('click', () => {
          row.remove();
          const oldReasons = sectionEl.querySelector('.gsi-ai-reasons');
          if (oldReasons) oldReasons.remove();
          const oldPill = sectionEl.querySelector('.gsi-ai-verdict');
          if (oldPill) oldPill.remove();
          const retryLoading = document.createElement('div');
          retryLoading.classList.add('gsi-ai-loading');
          retryLoading.textContent = 'Retrying\u2026';
          sectionEl.appendChild(retryLoading);
          onRetry();
        });
        row.appendChild(refreshBtn);
      }

      if (accordion) {
        bannerEl.insertBefore(row, accordion);
      } else {
        bannerEl.appendChild(row);
      }
    }

    if (failed) return;

    // Accordion: verdict pill copy + full reasons list
    const verdictConfig = AI_VERDICTS[result.verdict] || AI_VERDICTS.Caution;
    const accordionPill = document.createElement('span');
    accordionPill.classList.add('gsi-ai-verdict', verdictConfig.cls);
    accordionPill.textContent = verdictConfig.label;
    sectionEl.appendChild(accordionPill);

    if (result.reasons && result.reasons.length > 0) {
      const list = document.createElement('ul');
      list.classList.add('gsi-ai-reasons');
      for (const reason of result.reasons) {
        const li = document.createElement('li');
        li.classList.add('gsi-ai-reason-item');
        li.textContent = reason;
        list.appendChild(li);
      }
      sectionEl.appendChild(list);
    }
  }

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
      lines.push(`AI raw: ${raw.length > 500 ? raw.substring(0, 500) + '…' : raw}`);
    }
    if (d.userPrompt != null) {
      const prompt = String(d.userPrompt);
      lines.push(`AI prompt (${prompt.length} chars): ${prompt.length > 300 ? prompt.substring(0, 300) + '…' : prompt}`);
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

  function insertBanner(info, envelopeEmail) {
    removeBanner();

    const subjectEl = document.querySelector('.hP');
    if (!subjectEl) return;

    const banner = document.createElement('div');
    banner.id = 'gsi-banner';

    // --- Top row: logo + domain + badge ---
    const topRow = document.createElement('div');
    topRow.classList.add('gsi-banner-top');

    const sourceBadge = document.createElement('span');
    sourceBadge.classList.add('gsi-source-badge');
    sourceBadge.style.display = 'none';

    // Shared state to coordinate async logo resolution and security verdict.
    // If logo resolves to unknown (no BIMI, no favicon), verdict caps at caution.
    const bannerState = { resolvedLogoSource: null, authVerdict: null };
    let summaryElRef = null;

    const logo = createLogoImg(info, (sourceKey) => {
      updateBadge(sourceBadge, sourceKey);
      bannerState.resolvedLogoSource = sourceKey;
      // No recognizable logo → override trusted verdict to caution
      if (sourceKey === SOURCE_UNKNOWN && bannerState.authVerdict === 'trusted') {
        if (summaryElRef) setVerdict(summaryElRef, 'caution', bannerBadge);
      }
    });
    topRow.appendChild(logo);

    // Inline verdict badge (between logo and domain, hidden until verdict resolves)
    const bannerBadge = document.createElement('span');
    bannerBadge.classList.add('gsi-banner-verdict');
    bannerBadge.style.display = 'none';
    const bannerBadgeIcon = document.createElement('span');
    bannerBadgeIcon.classList.add('gsi-banner-verdict-icon');
    bannerBadge.appendChild(bannerBadgeIcon);
    topRow.appendChild(bannerBadge);

    const textWrap = document.createElement('div');
    textWrap.classList.add('gsi-banner-text');

    const domainSpan = document.createElement('span');
    domainSpan.classList.add('gsi-banner-domain');
    domainSpan.textContent = info.fullDomain;
    textWrap.appendChild(domainSpan);

    if (info.rootDomain !== info.fullDomain) {
      const rootSpan = document.createElement('span');
      rootSpan.classList.add('gsi-banner-root');
      rootSpan.textContent = `(${info.rootDomain})`;
      textWrap.appendChild(rootSpan);
    }

    textWrap.appendChild(sourceBadge);
    topRow.appendChild(textWrap);

    // Gemini AI indicator (top-right, shown once Prompt API is confirmed available)
    const geminiIcon = document.createElement('span');
    geminiIcon.classList.add('gsi-gemini-icon');
    geminiIcon.style.display = 'none';
    geminiIcon.title = 'AI analysis by Gemini Nano';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('fill', 'none');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M14 0C14 7.732 20.268 14 28 14C20.268 14 14 20.268 14 28C14 20.268 7.732 14 0 14C7.732 14 14 7.732 14 0Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    geminiIcon.appendChild(svg);
    topRow.appendChild(geminiIcon);

    banner.appendChild(topRow);

    // --- Accordion: favicon details ---
    if (info.favicons) {
      const accordion = document.createElement('div');
      accordion.classList.add('gsi-accordion');

      const header = document.createElement('div');
      header.classList.add('gsi-accordion-header');
      const chevron = document.createElement('span');
      chevron.classList.add('gsi-chevron');
      chevron.textContent = '\u25B6';
      header.appendChild(chevron);
      header.appendChild(document.createTextNode(' Details'));

      const content = document.createElement('div');
      content.classList.add('gsi-accordion-content');

      const table = document.createElement('div');
      table.classList.add('gsi-details-table');

      // Column 1: Favicons
      const favCol = document.createElement('div');
      favCol.classList.add('gsi-details-col');

      const faviconHeader = document.createElement('div');
      faviconHeader.classList.add('gsi-col-header');
      faviconHeader.textContent = 'Favicons';
      favCol.appendChild(faviconHeader);

      const labels = { sub: 'subdomain', root: 'root', www: 'www' };
      for (const [key, label] of Object.entries(labels)) {
        const fav = info.favicons[key];
        if (!fav) continue;

        const row = document.createElement('div');
        row.classList.add('gsi-detail-row');

        const icon = createDetailFaviconImg(fav);
        row.appendChild(icon);

        const domainLabel = document.createElement('span');
        domainLabel.classList.add('gsi-detail-label');
        domainLabel.textContent = label;
        row.appendChild(domainLabel);

        const domainValue = document.createElement('span');
        domainValue.classList.add('gsi-detail-domain');
        domainValue.textContent = fav.domain;
        row.appendChild(domainValue);

        favCol.appendChild(row);
      }

      // Column 2: Security checks
      const secCol = document.createElement('div');
      secCol.classList.add('gsi-details-col');

      // Column 3: Summary verdict
      const summaryEl = document.createElement('div');
      summaryEl.classList.add('gsi-summary', 'gsi-verdict-loading');
      summaryElRef = summaryEl;
      const summaryIcon = document.createElement('div');
      summaryIcon.classList.add('gsi-summary-icon');
      const summaryLabel = document.createElement('div');
      summaryLabel.classList.add('gsi-summary-label');
      summaryLabel.textContent = 'Checking\u2026';
      summaryEl.appendChild(summaryIcon);
      summaryEl.appendChild(summaryLabel);

      createSecuritySection(secCol, summaryEl, info, envelopeEmail, bannerBadge, sourceBadge, bannerState);

      table.appendChild(favCol);
      table.appendChild(secCol);
      table.appendChild(summaryEl);
      content.appendChild(table);

      header.addEventListener('click', () => {
        const isOpen = content.style.display === 'block';
        content.style.display = isOpen ? 'none' : 'block';
        chevron.textContent = isOpen ? '\u25B6' : '\u25BC';
      });

      accordion.appendChild(header);
      accordion.appendChild(content);
      banner.appendChild(accordion);
    }

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

      // Show Gemini icon in gray while loading
      geminiIcon.style.display = '';

      // Cycling scan status text below the domain, where the verdict row will appear
      const scanText = document.createElement('div');
      scanText.classList.add('gsi-ai-scan-text');
      scanText.textContent = AI_SCAN_MESSAGES[0];
      const accordion = banner.querySelector('.gsi-accordion');
      if (accordion) {
        banner.insertBefore(scanText, accordion);
      } else {
        banner.appendChild(scanText);
      }
      let scanIdx = 0;
      const scanInterval = setInterval(() => {
        if (!banner.isConnected) { clearInterval(scanInterval); return; }
        scanIdx = (scanIdx + 1) % AI_SCAN_MESSAGES.length;
        scanText.textContent = AI_SCAN_MESSAGES[scanIdx];
      }, 2500);

      // Find accordion content to insert into
      const accordionContent = banner.querySelector('.gsi-accordion-content');
      if (!accordionContent) {
        clearInterval(scanInterval);
        scanText.remove();
        return;
      }

      const aiSection = createAiSection(aiStatus);

      // Insert before debug section if it exists, otherwise append
      const debugWrap = accordionContent.querySelector('.gsi-debug-section');
      if (debugWrap) {
        accordionContent.insertBefore(aiSection, debugWrap);
      } else {
        accordionContent.appendChild(aiSection);
      }

      const emailData = extractEmailData(envelopeEmail);
      const msgResult = getMessageId();
      if (msgResult) {
        emailData.messageId = msgResult.id;
        const cached = securityCache.get(msgResult.id);
        if (cached) {
          emailData.auth = { spf: cached.spf, dkim: cached.dkim, dmarc: cached.dmarc };
        }
      }

      function applyResult(result) {
        // Reset gemini icon classes
        geminiIcon.classList.remove('gsi-gemini-ok', 'gsi-gemini-caution', 'gsi-gemini-reject', 'gsi-gemini-neutral');

        if (result && result.parseError) {
          geminiIcon.classList.add('gsi-gemini-neutral');
        } else if (result && result.verdict) {
          const colorMap = { Ok: 'gsi-gemini-ok', Caution: 'gsi-gemini-caution', Reject: 'gsi-gemini-reject' };
          geminiIcon.classList.add(colorMap[result.verdict] || 'gsi-gemini-caution');
        } else if (result && result.timeout) {
          geminiIcon.classList.add('gsi-gemini-neutral');
        } else {
          geminiIcon.classList.add('gsi-gemini-neutral');
        }

        if (result && result.debug) {
          appendAiDebugLines(banner, result);
        }
      }

      function handleRetry() {
        requestAiAnalysis(emailData, { skipCache: true }).then((retryResult) => {
          updateAiSection(aiSection, retryResult, banner, handleRetry);
          applyResult(retryResult);
        });
      }

      const result = await requestAiAnalysis(emailData);
      clearInterval(scanInterval);
      scanText.remove();
      if (!banner.isConnected) return; // banner was removed while waiting
      updateAiSection(aiSection, result, banner, handleRetry);
      applyResult(result);
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

      // Find or create accordion content area for debug + original sender rows
      let accordionContent = banner.querySelector('.gsi-accordion-content');
      if (!accordionContent) {
        const accordion = document.createElement('div');
        accordion.classList.add('gsi-accordion');
        const accHeader = document.createElement('div');
        accHeader.classList.add('gsi-accordion-header');
        const chevron = document.createElement('span');
        chevron.classList.add('gsi-chevron');
        chevron.textContent = '\u25B6';
        accHeader.appendChild(chevron);
        accHeader.appendChild(document.createTextNode(' Details'));
        accordionContent = document.createElement('div');
        accordionContent.classList.add('gsi-accordion-content');
        accHeader.addEventListener('click', () => {
          const isOpen = accordionContent.style.display === 'block';
          accordionContent.style.display = isOpen ? 'none' : 'block';
          chevron.textContent = isOpen ? '\u25B6' : '\u25BC';
        });
        accordion.appendChild(accHeader);
        accordion.appendChild(accordionContent);
        banner.appendChild(accordion);
      }

      // DEBUG: collapsible section in accordion (collapsed by default)
      const debugWrap = document.createElement('div');
      debugWrap.classList.add('gsi-debug-section');
      debugWrap.style.cssText = 'margin-top:6px;border-top:1px solid #e8eaed;padding-top:4px';
      const debugHeader = document.createElement('div');
      debugHeader.style.cssText = 'font-size:10px;color:#80868b;cursor:pointer;user-select:none';
      const debugChevron = document.createElement('span');
      debugChevron.style.cssText = 'font-size:9px;display:inline-block;transition:transform 0.15s';
      debugChevron.textContent = '\u25B6';
      debugHeader.appendChild(debugChevron);
      debugHeader.appendChild(document.createTextNode(' Debug'));
      const debugContent = document.createElement('div');
      debugContent.classList.add('gsi-debug-content');
      debugContent.style.cssText = 'display:none;font-size:11px;color:#5f6368;margin-top:4px;padding:4px 8px;background:#fff3cd;border-radius:4px;font-family:monospace;word-break:break-all;white-space:pre-wrap';
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
      accordionContent.appendChild(debugWrap);

      if (!originalSender || !envelopeEmail || originalSender === envelopeEmail) return;

      const origInfo = await requestSenderInfo(originalSender);
      if (!origInfo) return;

      // Update banner top row with original sender info
      const oldLogo = banner.querySelector('.gsi-logo');
      const bannerText = banner.querySelector('.gsi-banner-text');
      const oldBadge = bannerText?.querySelector('.gsi-source-badge');
      if (oldLogo && bannerText) {
        const newBadge = document.createElement('span');
        newBadge.classList.add('gsi-source-badge');
        newBadge.style.display = 'none';
        const newLogo = createLogoImg(origInfo, (sourceKey) => updateBadge(newBadge, sourceKey));
        oldLogo.replaceWith(newLogo);
        if (oldBadge) oldBadge.replaceWith(newBadge);
        else bannerText.appendChild(newBadge);

        const domainEl = bannerText.querySelector('.gsi-banner-domain');
        if (domainEl) domainEl.textContent = origInfo.fullDomain;

        const rootEl = bannerText.querySelector('.gsi-banner-root');
        if (origInfo.rootDomain !== origInfo.fullDomain) {
          if (rootEl) {
            rootEl.textContent = `(${origInfo.rootDomain})`;
          } else {
            const newRoot = document.createElement('span');
            newRoot.classList.add('gsi-banner-root');
            newRoot.textContent = `(${origInfo.rootDomain})`;
            bannerText.appendChild(newRoot);
          }
        } else if (rootEl) {
          rootEl.remove();
        }

        const groupDomain = envelopeEmail.split('@')[1];
        const viaBadge = document.createElement('span');
        viaBadge.classList.add('gsi-via-badge');
        viaBadge.textContent = `via ${groupDomain}`;
        bannerText.appendChild(viaBadge);
      }

      // Add original sender row to accordion: favicons + security
      const origSection = document.createElement('div');
      origSection.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #e8eaed';

      const origLabel = document.createElement('div');
      origLabel.classList.add('gsi-col-header');
      origLabel.textContent = `Original Sender — ${origInfo.fullDomain}`;
      origSection.appendChild(origLabel);

      const origTable = document.createElement('div');
      origTable.classList.add('gsi-details-table');

      // Original sender favicons column
      const origFavCol = document.createElement('div');
      origFavCol.classList.add('gsi-details-col');
      const origFavHeader = document.createElement('div');
      origFavHeader.classList.add('gsi-col-header');
      origFavHeader.textContent = 'Favicons';
      origFavCol.appendChild(origFavHeader);

      if (origInfo.favicons) {
        const labels = { sub: 'subdomain', root: 'root', www: 'www' };
        for (const [key, label] of Object.entries(labels)) {
          const fav = origInfo.favicons[key];
          if (!fav) continue;
          const row = document.createElement('div');
          row.classList.add('gsi-detail-row');
          row.appendChild(createDetailFaviconImg(fav));
          const dl = document.createElement('span');
          dl.classList.add('gsi-detail-label');
          dl.textContent = label;
          row.appendChild(dl);
          const dv = document.createElement('span');
          dv.classList.add('gsi-detail-domain');
          dv.textContent = fav.domain;
          row.appendChild(dv);
          origFavCol.appendChild(row);
        }
      }

      // Original sender security column
      const origSecCol = document.createElement('div');
      origSecCol.classList.add('gsi-details-col');
      const origSecHeader = document.createElement('div');
      origSecHeader.classList.add('gsi-col-header');
      origSecHeader.textContent = 'Security';
      origSecCol.appendChild(origSecHeader);

      // Parse auth results for original sender from the same headers
      let origAuth = result.authData || null;
      if (!origAuth && result.headers) origAuth = parseAuthResults(result.headers);

      const checks = [
        { key: 'spf', label: 'SPF' },
        { key: 'dkim', label: 'DKIM' },
        { key: 'dmarc', label: 'DMARC' },
      ];
      for (const check of checks) {
        const row = document.createElement('div');
        row.classList.add('gsi-security-row');
        const lbl = document.createElement('span');
        lbl.classList.add('gsi-security-label');
        lbl.textContent = check.label;
        row.appendChild(lbl);
        const res = document.createElement('span');
        res.classList.add('gsi-security-result');
        const value = origAuth?.[check.key];
        if (value) {
          res.textContent = value;
          if (value === 'pass') res.classList.add('gsi-result-pass');
          else if (value === 'fail' || value === 'softfail') res.classList.add('gsi-result-fail');
          else res.classList.add('gsi-result-neutral');
        } else {
          res.textContent = 'n/a';
          res.classList.add('gsi-result-neutral');
        }
        row.appendChild(res);
        origSecCol.appendChild(row);
      }

      // BIMI for original sender
      const bimiRow = document.createElement('div');
      bimiRow.classList.add('gsi-security-row');
      const bimiLbl = document.createElement('span');
      bimiLbl.classList.add('gsi-security-label');
      bimiLbl.textContent = 'BIMI';
      bimiRow.appendChild(bimiLbl);
      const bimiRes = document.createElement('span');
      bimiRes.classList.add('gsi-security-result');
      if (origInfo.logoSource === 'bimi') {
        bimiRes.textContent = 'pass';
        bimiRes.classList.add('gsi-result-pass');
      } else {
        bimiRes.textContent = 'none';
        bimiRes.classList.add('gsi-result-neutral');
      }
      bimiRow.appendChild(bimiRes);
      origSecCol.appendChild(bimiRow);

      origTable.appendChild(origFavCol);
      origTable.appendChild(origSecCol);
      origSection.appendChild(origTable);
      accordionContent.appendChild(origSection);
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
