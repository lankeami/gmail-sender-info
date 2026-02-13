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

    const sourceBadge = document.createElement('span');
    sourceBadge.classList.add('gsi-source-badge');

    const logo = createLogoImg(info, (sourceKey) => updateBadge(sourceBadge, sourceKey));
    banner.appendChild(logo);

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

    banner.appendChild(textWrap);

    // Insert before the subject line
    subjectEl.parentElement.insertBefore(banner, subjectEl);
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
