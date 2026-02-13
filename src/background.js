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
 * Build a Google favicon service URL for a domain.
 */
function googleFaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

// --- Globe favicon detection ---
// Google's favicon service (www.google.com/s2/favicons) always returns 200,
// even for unknown domains — it just serves a generic gray globe icon.
// The google.com URL redirects to t0.gstatic.com/faviconV2, and MV3 service
// workers can't bypass CORS on redirected requests. So we fetch the gstatic
// faviconV2 URL directly (no redirect) with host_permissions for *.gstatic.com.

function gstaticFaviconV2Url(domain) {
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${encodeURIComponent(domain)}&size=32`;
}

let globeRefBytes = null;

async function getGlobeRefBytes() {
  if (globeRefBytes) return globeRefBytes;
  try {
    const resp = await fetch(gstaticFaviconV2Url('xyznotarealdomain12345.invalid'));
    if (resp.ok) {
      globeRefBytes = new Uint8Array(await resp.arrayBuffer());
    }
  } catch { /* fetch failed */ }
  return globeRefBytes;
}

/**
 * Check if a domain's Google favicon is the generic gray globe.
 * Fetches the gstatic faviconV2 URL directly to avoid redirect CORS issues.
 */
async function checkIsGlobe(domain) {
  try {
    const [ref, resp] = await Promise.all([
      getGlobeRefBytes(),
      fetch(gstaticFaviconV2Url(domain)),
    ]);
    if (!ref || !resp.ok) return false;

    const actual = new Uint8Array(await resp.arrayBuffer());
    if (ref.length !== actual.length) return false;
    return ref.every((b, i) => b === actual[i]);
  } catch {
    return false;
  }
}

/**
 * Resolve logo for a sender domain.
 * Chain: BIMI → Google root favicon → direct /favicon.ico → caution.
 * No fetch() validation — <img> on Gmail's page loads Google favicons
 * fine (has cookies/referer), but fetch() from the service worker gets
 * different responses due to missing credentials.
 */
async function resolveLogo(fullDomain) {
  const rootDomain = getRootDomain(fullDomain);
  const wwwDomain = `www.${rootDomain}`;

  // Try BIMI on full domain
  let bimiUrl = await lookupBimi(fullDomain);

  // Try BIMI on root domain if different
  if (!bimiUrl && rootDomain !== fullDomain) {
    bimiUrl = await lookupBimi(rootDomain);
  }

  // Check if Google favicons are the generic gray globe
  const subGoogleUrl = googleFaviconUrl(fullDomain);
  const rootGoogleUrl = googleFaviconUrl(rootDomain);
  const wwwGoogleUrl = googleFaviconUrl(wwwDomain);

  // Check root favicon for globe (used for the main logo fallback)
  const rootIsGlobe = await checkIsGlobe(rootDomain);

  return {
    fullDomain,
    rootDomain,
    logoUrl: bimiUrl,
    logoSource: bimiUrl ? 'bimi' : 'favicon',
    faviconRootUrl: rootGoogleUrl,
    faviconRootIsGlobe: rootIsGlobe,
    faviconDirectUrl: `https://${rootDomain}/favicon.ico`,
    favicons: {
      sub: {
        domain: fullDomain,
        googleUrl: subGoogleUrl,
        directUrl: `https://${fullDomain}/favicon.ico`,
      },
      root: {
        domain: rootDomain,
        googleUrl: rootGoogleUrl,
        directUrl: `https://${rootDomain}/favicon.ico`,
      },
      www: {
        domain: wwwDomain,
        googleUrl: wwwGoogleUrl,
        directUrl: `https://${wwwDomain}/favicon.ico`,
      },
    },
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
