// Gmail Sender Info — Background Service Worker
// Handles BIMI DNS lookups, favicon resolution, and caching.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Multi-part TLDs for correct root domain extraction
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  'co.za', 'org.za', 'web.za',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br',
  'com.mx', 'org.mx', 'net.mx',
  'com.cn', 'net.cn', 'org.cn',
  'co.kr', 'or.kr', 'ne.kr',
  'com.sg', 'org.sg', 'net.sg',
  'com.hk', 'org.hk', 'net.hk',
  'co.il', 'org.il', 'net.il',
  'com.tw', 'org.tw', 'net.tw',
  'com.ar', 'org.ar', 'net.ar',
  'co.th', 'or.th', 'in.th',
  'com.tr', 'org.tr', 'net.tr',
]);

/**
 * Extract root domain from a full domain.
 * e.g. "mail.example.co.uk" → "example.co.uk"
 *      "newsletter.stripe.com" → "stripe.com"
 */
function getRootDomain(domain) {
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return domain.toLowerCase();

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    // Need 3 parts minimum for multi-part TLD: example.co.uk
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * Lookup BIMI TXT record for a domain via DNS-over-HTTPS.
 * Returns the logo URL (l= tag) or null.
 */
async function lookupBimi(domain) {
  const bimiHost = `default._bimi.${domain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(bimiHost)}&type=TXT`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.Answer) return null;

    for (const answer of data.Answer) {
      const txt = (answer.data || '').replace(/"/g, '');
      if (!txt.startsWith('v=BIMI1')) continue;

      const match = txt.match(/l=(\S+)/i);
      if (match && match[1]) {
        const logoUrl = match[1].replace(/;$/, '');
        // BIMI logos should be SVG
        if (logoUrl.endsWith('.svg')) return logoUrl;
      }
    }
  } catch (e) {
    // DNS lookup failed — not an error, just no BIMI
  }
  return null;
}

/**
 * Check if Google's favicon service has a real favicon for a domain.
 * Returns the URL if the service responds 200, null if 404/error.
 * On CORS or network failure, returns the URL anyway (let <img> try).
 */
async function checkFavicon(domain) {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return url;
  } catch {
    // CORS or network error — return URL and let <img> handle it
    return url;
  }
}

/**
 * Resolve logo for a sender domain.
 * Chain: BIMI full domain → BIMI root domain → validated root favicon → null (unknown).
 */
async function resolveLogo(fullDomain) {
  const rootDomain = getRootDomain(fullDomain);

  // Try BIMI on full domain
  let bimiUrl = await lookupBimi(fullDomain);

  // Try BIMI on root domain if different
  if (!bimiUrl && rootDomain !== fullDomain) {
    bimiUrl = await lookupBimi(rootDomain);
  }

  // Only check favicon if no BIMI
  let faviconRootUrl = null;
  if (!bimiUrl) {
    faviconRootUrl = await checkFavicon(rootDomain);
  }

  let logoSource;
  if (bimiUrl) logoSource = 'bimi';
  else if (faviconRootUrl) logoSource = 'favicon';
  else logoSource = 'unknown';

  return {
    fullDomain,
    rootDomain,
    logoUrl: bimiUrl,
    logoSource,
    faviconRootUrl,
  };
}

// --- Cache helpers ---

async function getCached(email) {
  try {
    const result = await chrome.storage.local.get(email);
    const entry = result[email];
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      chrome.storage.local.remove(email);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

async function setCache(email, data) {
  try {
    await chrome.storage.local.set({ [email]: { data, ts: Date.now() } });
  } catch {
    // Storage full or unavailable — continue without caching
  }
}

// --- Clear stale cache on install/update ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.clear();
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'getSenderInfo') return false;

  const email = (msg.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    sendResponse({ error: 'Invalid email' });
    return false;
  }

  const domain = email.split('@')[1];

  (async () => {
    // Check cache first
    const cached = await getCached(email);
    if (cached) {
      sendResponse(cached);
      return;
    }

    const info = await resolveLogo(domain);
    await setCache(email, info);
    sendResponse(info);
  })();

  return true; // Keep message channel open for async response
});
