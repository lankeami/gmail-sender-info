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

const CCTLD_COUNTRIES = {
  ac: { code: 'AC', name: 'Ascension Island' },
  ad: { code: 'AD', name: 'Andorra' },
  ae: { code: 'AE', name: 'United Arab Emirates' },
  af: { code: 'AF', name: 'Afghanistan' },
  ag: { code: 'AG', name: 'Antigua and Barbuda' },
  al: { code: 'AL', name: 'Albania' },
  am: { code: 'AM', name: 'Armenia' },
  ao: { code: 'AO', name: 'Angola' },
  ar: { code: 'AR', name: 'Argentina' },
  at: { code: 'AT', name: 'Austria' },
  au: { code: 'AU', name: 'Australia' },
  az: { code: 'AZ', name: 'Azerbaijan' },
  ba: { code: 'BA', name: 'Bosnia and Herzegovina' },
  bd: { code: 'BD', name: 'Bangladesh' },
  be: { code: 'BE', name: 'Belgium' },
  bg: { code: 'BG', name: 'Bulgaria' },
  bh: { code: 'BH', name: 'Bahrain' },
  bn: { code: 'BN', name: 'Brunei' },
  bo: { code: 'BO', name: 'Bolivia' },
  br: { code: 'BR', name: 'Brazil' },
  by: { code: 'BY', name: 'Belarus' },
  ca: { code: 'CA', name: 'Canada' },
  ch: { code: 'CH', name: 'Switzerland' },
  cl: { code: 'CL', name: 'Chile' },
  cn: { code: 'CN', name: 'China' },
  cr: { code: 'CR', name: 'Costa Rica' },
  cu: { code: 'CU', name: 'Cuba' },
  cy: { code: 'CY', name: 'Cyprus' },
  cz: { code: 'CZ', name: 'Czech Republic' },
  de: { code: 'DE', name: 'Germany' },
  dk: { code: 'DK', name: 'Denmark' },
  do: { code: 'DO', name: 'Dominican Republic' },
  dz: { code: 'DZ', name: 'Algeria' },
  ec: { code: 'EC', name: 'Ecuador' },
  ee: { code: 'EE', name: 'Estonia' },
  eg: { code: 'EG', name: 'Egypt' },
  es: { code: 'ES', name: 'Spain' },
  et: { code: 'ET', name: 'Ethiopia' },
  fi: { code: 'FI', name: 'Finland' },
  fr: { code: 'FR', name: 'France' },
  ge: { code: 'GE', name: 'Georgia' },
  gh: { code: 'GH', name: 'Ghana' },
  gr: { code: 'GR', name: 'Greece' },
  gt: { code: 'GT', name: 'Guatemala' },
  hk: { code: 'HK', name: 'Hong Kong' },
  hn: { code: 'HN', name: 'Honduras' },
  hr: { code: 'HR', name: 'Croatia' },
  hu: { code: 'HU', name: 'Hungary' },
  id: { code: 'ID', name: 'Indonesia' },
  ie: { code: 'IE', name: 'Ireland' },
  il: { code: 'IL', name: 'Israel' },
  in: { code: 'IN', name: 'India' },
  iq: { code: 'IQ', name: 'Iraq' },
  ir: { code: 'IR', name: 'Iran' },
  is: { code: 'IS', name: 'Iceland' },
  it: { code: 'IT', name: 'Italy' },
  jm: { code: 'JM', name: 'Jamaica' },
  jo: { code: 'JO', name: 'Jordan' },
  jp: { code: 'JP', name: 'Japan' },
  ke: { code: 'KE', name: 'Kenya' },
  kg: { code: 'KG', name: 'Kyrgyzstan' },
  kh: { code: 'KH', name: 'Cambodia' },
  kr: { code: 'KR', name: 'South Korea' },
  kw: { code: 'KW', name: 'Kuwait' },
  kz: { code: 'KZ', name: 'Kazakhstan' },
  lb: { code: 'LB', name: 'Lebanon' },
  lk: { code: 'LK', name: 'Sri Lanka' },
  lt: { code: 'LT', name: 'Lithuania' },
  lu: { code: 'LU', name: 'Luxembourg' },
  lv: { code: 'LV', name: 'Latvia' },
  ma: { code: 'MA', name: 'Morocco' },
  mk: { code: 'MK', name: 'North Macedonia' },
  mm: { code: 'MM', name: 'Myanmar' },
  mn: { code: 'MN', name: 'Mongolia' },
  mo: { code: 'MO', name: 'Macau' },
  mt: { code: 'MT', name: 'Malta' },
  mu: { code: 'MU', name: 'Mauritius' },
  mx: { code: 'MX', name: 'Mexico' },
  my: { code: 'MY', name: 'Malaysia' },
  mz: { code: 'MZ', name: 'Mozambique' },
  ng: { code: 'NG', name: 'Nigeria' },
  ni: { code: 'NI', name: 'Nicaragua' },
  nl: { code: 'NL', name: 'Netherlands' },
  no: { code: 'NO', name: 'Norway' },
  np: { code: 'NP', name: 'Nepal' },
  nz: { code: 'NZ', name: 'New Zealand' },
  om: { code: 'OM', name: 'Oman' },
  pa: { code: 'PA', name: 'Panama' },
  pe: { code: 'PE', name: 'Peru' },
  ph: { code: 'PH', name: 'Philippines' },
  pk: { code: 'PK', name: 'Pakistan' },
  pl: { code: 'PL', name: 'Poland' },
  pr: { code: 'PR', name: 'Puerto Rico' },
  pt: { code: 'PT', name: 'Portugal' },
  py: { code: 'PY', name: 'Paraguay' },
  qa: { code: 'QA', name: 'Qatar' },
  ro: { code: 'RO', name: 'Romania' },
  rs: { code: 'RS', name: 'Serbia' },
  ru: { code: 'RU', name: 'Russia' },
  rw: { code: 'RW', name: 'Rwanda' },
  sa: { code: 'SA', name: 'Saudi Arabia' },
  se: { code: 'SE', name: 'Sweden' },
  sg: { code: 'SG', name: 'Singapore' },
  si: { code: 'SI', name: 'Slovenia' },
  sk: { code: 'SK', name: 'Slovakia' },
  sn: { code: 'SN', name: 'Senegal' },
  sv: { code: 'SV', name: 'El Salvador' },
  th: { code: 'TH', name: 'Thailand' },
  tn: { code: 'TN', name: 'Tunisia' },
  tr: { code: 'TR', name: 'Turkey' },
  tw: { code: 'TW', name: 'Taiwan' },
  tz: { code: 'TZ', name: 'Tanzania' },
  ua: { code: 'UA', name: 'Ukraine' },
  ug: { code: 'UG', name: 'Uganda' },
  uk: { code: 'GB', name: 'United Kingdom' },
  us: { code: 'US', name: 'United States' },
  uy: { code: 'UY', name: 'Uruguay' },
  uz: { code: 'UZ', name: 'Uzbekistan' },
  ve: { code: 'VE', name: 'Venezuela' },
  vn: { code: 'VN', name: 'Vietnam' },
  za: { code: 'ZA', name: 'South Africa' },
  zw: { code: 'ZW', name: 'Zimbabwe' },
};

function lookupCcTLD(rootDomain) {
  const parts = rootDomain.split('.');
  let tld = parts[parts.length - 1].toLowerCase();
  // Handle second-level ccTLDs like .co.uk, .com.au
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(parts[parts.length - 2].toLowerCase())) {
    tld = parts[parts.length - 1].toLowerCase();
  }
  const entry = CCTLD_COUNTRIES[tld];
  if (!entry) return { countryCode: null };
  return { countryCode: entry.code, countryName: entry.name };
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

function detectHomograph(domain) {
  if (domain.includes('xn--')) {
    return { isHomograph: true, scripts: ['Punycode'] };
  }

  const ascii = /^[a-z0-9.-]+$/;
  if (ascii.test(domain)) return { isHomograph: false };

  const hasLatin = /[a-z]/i.test(domain);
  const hasCyrillic = /[Ѐ-ӿ]/.test(domain);
  const hasGreek = /[Ͱ-Ͽ]/.test(domain);

  if (hasLatin && (hasCyrillic || hasGreek)) {
    return { isHomograph: true, scripts: [hasCyrillic && 'Cyrillic', hasGreek && 'Greek'].filter(Boolean) };
  }

  return { isHomograph: false };
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

  // Country lookup via ccTLD (no external API, no new permissions)
  const ccTLD = lookupCcTLD(rootDomain);
  const countryCode = ccTLD.countryCode;
  const countryName = ccTLD.countryName || null;
  const countryMethod = countryCode ? 'cctld' : null;

  return {
    fullDomain,
    rootDomain,
    homograph: detectHomograph(fullDomain),
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
    countryCode,
    countryName,
    countryMethod,
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

chrome.runtime.onInstalled.addListener(async () => {
  const reviewKeys = ['gsi_first_use_time', 'gsi_email_view_count', 'gsi_review_snoozed_at', 'gsi_review_clicked_at'];
  const saved = await chrome.storage.local.get(reviewKeys);
  await chrome.storage.local.clear();
  if (Object.keys(saved).length > 0) {
    await chrome.storage.local.set(saved);
  }
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getSenderInfo') {
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
      chrome.storage.local.get('gsi_first_use_time', (r) => {
        if (!r.gsi_first_use_time) chrome.storage.local.set({ gsi_first_use_time: Date.now() });
      });
      sendResponse(info);
    })();

    return true;
  }

  return false;
});
