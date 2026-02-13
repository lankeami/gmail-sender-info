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

  // --- Message passing with dedup ---

  function requestSenderInfo(email) {
    if (pendingRequests.has(email)) return pendingRequests.get(email);

    const promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSenderInfo', email }, (resp) => {
        pendingRequests.delete(email);
        if (chrome.runtime.lastError || !resp || resp.error) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
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
    if (info.faviconRootUrl) chain.push({ url: info.faviconRootUrl, source: SOURCE_FAVICON });
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
    badge.className = 'gsi-source-badge gsi-badge-' + sourceKey;
    badge.textContent = SOURCE_LABELS[sourceKey] || sourceKey;
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

  function setVerdict(summaryEl, verdictKey) {
    if (verdictKey === 'trusted') {
      // All checks pass — hide the summary column entirely
      summaryEl.style.display = 'none';
      return;
    }
    const v = VERDICTS[verdictKey] || VERDICTS.caution;
    summaryEl.className = 'gsi-summary ' + v.cls;
    summaryEl.style.display = '';
    // Safe: SVGs are hardcoded constants above, not user input
    summaryEl.querySelector('.gsi-summary-icon').innerHTML = v.svg;
    summaryEl.querySelector('.gsi-summary-label').textContent = v.label;
  }

  /**
   * Build the security checks column and update the summary verdict.
   * Fetches headers async and updates the DOM when results arrive.
   */
  function createSecuritySection(container, summaryEl, info) {
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
        setVerdict(summaryEl, 'caution');
        return;
      }

      const { id: messageId } = msgResult;

      let authResults = securityCache.get(messageId);
      if (!authResults) {
        const result = await fetchEmailHeaders(messageId);
        if (result.error) {
          loadingRow.textContent = `Unable to check (${result.error})`;
          loadingRow.classList.add('gsi-security-error');
          setVerdict(summaryEl, 'caution');
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
        setVerdict(summaryEl, 'caution');
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

      // Update summary verdict
      setVerdict(summaryEl, getVerdict(authResults, info));
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

  function showTooltip(row, info) {
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

  // --- Banner (email view) ---

  let currentBannerEmail = null;

  function removeBanner() {
    const existing = document.getElementById('gsi-banner');
    if (existing) existing.remove();
    currentBannerEmail = null;
  }

  function insertBanner(info) {
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

    const logo = createLogoImg(info, (sourceKey) => updateBadge(sourceBadge, sourceKey));
    topRow.appendChild(logo);

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
      const summaryIcon = document.createElement('div');
      summaryIcon.classList.add('gsi-summary-icon');
      const summaryLabel = document.createElement('div');
      summaryLabel.classList.add('gsi-summary-label');
      summaryLabel.textContent = 'Checking\u2026';
      summaryEl.appendChild(summaryIcon);
      summaryEl.appendChild(summaryLabel);

      createSecuritySection(secCol, summaryEl, info);

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
  }

  async function processEmailView() {
    const email = getEmailFromView();
    if (!email) return;

    const domain = email.split('@')[1];
    // Don't re-insert if already showing for this domain
    if (currentBannerEmail === domain) return;

    const info = await requestSenderInfo(email);
    if (!info) return;
    insertBanner(info);
  }

  // --- MutationObserver ---

  let observerActive = false;

  function scan() {
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

    const observer = new MutationObserver(() => {
      scan();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Wait for Gmail to load, then start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
