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
  aiSession = null;
  aiAvailable = null;
  aiResultCache.clear();
});

// --- AI Spam/Phishing Analysis via Chrome Prompt API ---

const AI_SYSTEM_PROMPT = `You are a cybersecurity expert analyzing email metadata for spam and phishing indicators.

Given the email data below, evaluate these criteria:
1. SENDER MISMATCH: Does the display name impersonate a known brand/entity but the email address doesn't match? (e.g., display name "Bank of America" but sender is random-user@gmail.com). A personal name like "John" or "Mom" from a consumer email provider is NOT a mismatch — only flag brand impersonation.
2. URGENCY/THREAT LANGUAGE: Does the subject or body contain urgent threats, scare tactics, or pressure to act immediately? (e.g., "Account Suspended", "Unauthorized Login", "Act Now"). Casual urgency in personal conversation (e.g., "call me ASAP", "need this today") is NOT suspicious.
3. LINK DISCREPANCIES: Do any links point to domains different from the sender's domain? Note: link shorteners (bit.ly, t.co, goo.gl, tinyurl.com, etc.) and subdomained links (e.g., sender.example.com linking to example.com) are generally acceptable and should NOT be flagged. Personal emails often share links to various sites — this is normal and should NOT be flagged unless the links appear to mimic login pages or financial sites.

AUTHENTICATION CONTEXT: The email data may include SPF, DKIM, and DMARC results. When all three pass, the sender is cryptographically verified — strongly favor "Ok" unless there are clear phishing indicators. Authenticated personal correspondence should almost always be "Ok".

Respond with ONLY a JSON object, no markdown fences. Follow these examples EXACTLY:

Safe email: {"verdict":"Ok","summary":"Legitimate sender, no concerns","reasons":["Sender domain matches display name","No suspicious links or urgency"]}
Suspicious email: {"verdict":"Caution","summary":"Sender impersonates PayPal","reasons":["Display name says PayPal but email is from random domain","Body contains urgent account suspension threat"]}
Dangerous email: {"verdict":"Reject","summary":"Fake login page link","reasons":["Link mimics bank login page on unrelated domain","Urgent threat to close account within 24 hours"]}

Rules:
- verdict: "Ok", "Caution", or "Reject"
- summary: ALWAYS provide a short phrase under 8 words explaining the assessment
- reasons: ALWAYS provide 1-3 strings explaining your reasoning. Each reason must be a complete, readable sentence fragment.`;

let aiSession = null;
let aiAvailable = null; // null = unchecked, true/false

async function checkAiAvailable() {
  if (aiAvailable !== null) return aiAvailable;
  try {
    if (typeof LanguageModel === 'undefined') {
      aiAvailable = false;
      return false;
    }
    const status = await LanguageModel.availability();
    aiAvailable = status !== 'unavailable';
    return aiAvailable;
  } catch {
    aiAvailable = false;
    return false;
  }
}

async function getAiSession() {
  if (aiSession) return aiSession;
  try {
    aiSession = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: AI_SYSTEM_PROMPT }],
    });
    return aiSession;
  } catch {
    aiAvailable = false;
    return null;
  }
}

/**
 * Sanitize untrusted email content before inserting into the AI prompt.
 * Defends against prompt injection by:
 * 1. Stripping role/instruction markers that could hijack the LLM context
 * 2. Collapsing whitespace tricks used to hide injected instructions
 * 3. Truncating to a safe length to limit attack surface
 */
function sanitizeForPrompt(text, maxLength = 2000) {
  if (!text || typeof text !== 'string') return '';
  let s = text;
  // Strip characters that could be used to mimic structured prompt boundaries
  s = s.replace(/[{}[\]]/g, '');
  // Remove patterns that attempt to impersonate system/assistant roles or inject instructions
  s = s.replace(/\b(system|assistant|user)\s*:/gi, '$1 -');
  s = s.replace(/(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/gi, '[removed]');
  s = s.replace(/(new\s+instruction|you\s+are\s+now|respond\s+with|always\s+(say|reply|answer|respond))\b/gi, '[removed]');
  // Collapse excessive whitespace/newlines (used to push injections out of visible context)
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{4,}/g, '   ');
  // Truncate
  if (s.length > maxLength) s = s.slice(0, maxLength) + '…[truncated]';
  return s;
}

function buildAiUserPrompt(data) {
  const lines = [
    `Display Name: ${sanitizeForPrompt(data.displayName, 200) || '(none)'}`,
    `Sender Email: ${sanitizeForPrompt(data.senderEmail, 320)}`,
    `Subject: ${sanitizeForPrompt(data.subject, 500) || '(none)'}`,
  ];
  if (data.bodyText) {
    lines.push(`Body (excerpt):\n${sanitizeForPrompt(data.bodyText, 2000)}`);
  }
  if (data.auth) {
    lines.push(`Authentication: SPF=${data.auth.spf || 'unknown'}, DKIM=${data.auth.dkim || 'unknown'}, DMARC=${data.auth.dmarc || 'unknown'}`);
  }
  if (data.links && data.links.length > 0) {
    lines.push('Links in email:');
    for (const link of data.links.slice(0, 20)) {
      const text = sanitizeForPrompt(link.text, 200);
      const href = sanitizeForPrompt(link.href, 500);
      lines.push(`  - text: "${text}" → href: ${href}`);
    }
  }
  return lines.join('\n');
}

function normalizeVerdict(v) {
  if (!v || typeof v !== 'string') return null;
  const lower = v.trim().toLowerCase();
  if (lower === 'ok' || lower === 'safe') return 'Ok';
  if (lower === 'caution' || lower === 'warning' || lower === 'suspicious') return 'Caution';
  if (lower === 'reject' || lower === 'danger' || lower === 'dangerous' || lower === 'phishing') return 'Reject';
  return null;
}

function parseAiResult(text) {
  // Strip markdown fences if model wraps response
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Try full JSON parse first
  try {
    const obj = JSON.parse(cleaned);
    const verdict = normalizeVerdict(obj.verdict) || 'Caution';
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.map(String).filter(r => r && r !== 'undefined') : [];
    return { verdict, summary, reasons, parseError: null };
  } catch { /* fall through to recovery */ }

  // Recover from truncated/malformed JSON via regex extraction
  const verdictMatch = cleaned.match(/"verdict"\s*:\s*"([^"]+)"/i);
  const verdict = verdictMatch ? normalizeVerdict(verdictMatch[1]) : null;

  const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const summary = summaryMatch ? summaryMatch[1] : '';

  const reasons = [];
  const reasonsBlock = cleaned.match(/"reasons"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (reasonsBlock) {
    const stringMatches = reasonsBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g);
    for (const m of stringMatches) {
      reasons.push(m[1]);
    }
  }

  if (verdict) {
    return { verdict, summary, reasons, parseError: null };
  }

  // Last resort: no verdict found at all
  return { verdict: null, summary: '', reasons: [], parseError: 'no verdict found: ' + cleaned.substring(0, 200) };
}

// In-memory cache for AI results keyed by message content hash
const aiResultCache = new Map();

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
      sendResponse(info);
    })();

    return true;
  }

  if (msg.action === 'checkAiAvailable') {
    (async () => {
      const hasApi = typeof LanguageModel !== 'undefined';
      let status = null;
      if (hasApi) {
        try { status = await LanguageModel.availability(); } catch { /* ignore */ }
      }
      const available = hasApi && status !== 'unavailable' && status !== null;
      sendResponse({ available, hasApi, status });
    })();
    return true;
  }

  if (msg.action === 'analyzeEmail') {
    const data = msg.data;
    if (!data || !data.senderEmail) {
      sendResponse({ error: 'Missing email data' });
      return false;
    }

    const cacheKey = data.messageId
      ? `ai:${data.messageId}`
      : `ai:${data.senderEmail}:${(data.subject || '').substring(0, 80)}`;
    if (msg.skipCache) aiResultCache.delete(cacheKey);
    const cached = aiResultCache.get(cacheKey);
    if (cached) {
      sendResponse({ ...cached, debug: { ...cached.debug, cached: true } });
      return false;
    }

    (async () => {
      try {
        const available = await checkAiAvailable();
        if (!available) {
          sendResponse({ unavailable: true });
          return;
        }

        const session = await getAiSession();
        if (!session) {
          sendResponse({ unavailable: true });
          return;
        }

        const clone = await session.clone();
        const userPrompt = buildAiUserPrompt(data);
        const t0 = Date.now();
        const rawResponse = await clone.prompt(userPrompt);
        const durationMs = Date.now() - t0;
        clone.destroy();

        const result = parseAiResult(rawResponse);
        const response = { ...result, debug: { rawResponse, userPrompt, durationMs, cached: false } };
        aiResultCache.set(cacheKey, response);
        sendResponse(response);
      } catch (e) {
        // Session may have been garbage collected — reset and retry once
        if (aiSession) {
          aiSession = null;
          try {
            const session = await getAiSession();
            if (session) {
              const clone = await session.clone();
              const userPrompt = buildAiUserPrompt(data);
              const t0 = Date.now();
              const rawResponse = await clone.prompt(userPrompt);
              const durationMs = Date.now() - t0;
              clone.destroy();
              const result = parseAiResult(rawResponse);
              const response = { ...result, debug: { rawResponse, userPrompt, durationMs, cached: false, retried: true } };
              aiResultCache.set(cacheKey, response);
              sendResponse(response);
              return;
            }
          } catch { /* fall through */ }
        }
        sendResponse({ verdict: 'Caution', reasons: ['AI analysis failed'], debug: { error: e.message || 'unknown error' } });
      }
    })();

    return true;
  }

  return false;
});
