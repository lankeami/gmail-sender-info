// Gmail Sender Info — MAIN world script
// Runs in Gmail's page context (not the extension's isolated world)
// so fetch() is same-origin and includes session cookies.

/**
 * Extract Gmail's "ik" identity key from the page.
 * Required by many Gmail endpoints including view=om.
 */
function getGmailIk() {
  // GLOBALS array — ik is typically a short hex string at an early index
  if (window.GLOBALS && Array.isArray(window.GLOBALS)) {
    for (let i = 0; i < Math.min(window.GLOBALS.length, 20); i++) {
      const val = window.GLOBALS[i];
      if (typeof val === 'string' && /^[0-9a-f]{8,14}$/.test(val)) {
        return val;
      }
    }
  }

  // GM_ID_KEY global
  if (typeof window.GM_ID_KEY === 'string') return window.GM_ID_KEY;

  // Search existing links for ik= parameter
  const link = document.querySelector('a[href*="ik="]');
  if (link) {
    try {
      const ik = new URL(link.href).searchParams.get('ik');
      if (ik) return ik;
    } catch { /* ignore */ }
  }

  return null;
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'gsi-fetch-headers') return;

  const { messageId, requestId } = event.data;
  try {
    const acct = window.location.pathname.match(/\/mail\/u\/(\d+)/)?.[1] || '0';
    const ik = getGmailIk();

    let url = `https://mail.google.com/mail/u/${acct}/?view=om&th=${encodeURIComponent(messageId)}`;
    if (ik) url += `&ik=${encodeURIComponent(ik)}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      window.postMessage({
        type: 'gsi-headers-result', requestId,
        error: `HTTP ${resp.status}${ik ? '' : ', no ik found'}`,
      }, '*');
      return;
    }

    const text = await resp.text();

    // Extract just the headers (everything before first blank line)
    let headers = text;
    const end = text.indexOf('\r\n\r\n');
    if (end !== -1) {
      headers = text.substring(0, end);
    } else {
      const altEnd = text.indexOf('\n\n');
      if (altEnd !== -1) headers = text.substring(0, altEnd);
      else headers = text.substring(0, 8000);
    }

    // If HTML (modern Gmail wraps "Show Original" in an HTML page),
    // strip all tags then extract SPF/DKIM/DMARC from the plain text.
    if (headers.trimStart().startsWith('<')) {
      const stripped = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
      const authData = {};

      const spfMatch = stripped.match(/\bSPF:\s*'?(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (spfMatch) authData.spf = spfMatch[1].toLowerCase();

      const dkimMatch = stripped.match(/\bDKIM:\s*'?(PASS|FAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (dkimMatch) authData.dkim = dkimMatch[1].toLowerCase();

      const dmarcMatch = stripped.match(/\bDMARC:\s*'?(PASS|FAIL|BESTGUESSPASS|NONE|TEMPERROR|PERMERROR)\b/i);
      if (dmarcMatch) authData.dmarc = dmarcMatch[1].toLowerCase();

      const origSenderMatch = stripped.match(/X-Original-Sender[:\s]+([^\s<]+@[^\s>]+)/i);
      if (origSenderMatch) authData.originalSender = origSenderMatch[1].toLowerCase().trim();

      // Extract To, Cc, Bcc, Delivered-To, and mailing list headers for BCC detection
      // Recipient lists can span multiple lines in the HTML source; capture
      // continuation lines that don't start with a header name (Word:).
      const hdrVal = '[^\\n]*(?:\\n(?![A-Za-z][\\w-]*\\s*:)[^\\n]*)*';
      const toMatch = stripped.match(new RegExp('(?<![\\w-])To[:\\s]+(' + hdrVal + ')', 'i'));
      if (toMatch) authData.toHeader = toMatch[1].replace(/\n/g, ' ').trim();
      const ccMatch = stripped.match(new RegExp('(?<=\\s)Cc[:\\s]+(' + hdrVal + ')', 'i'));
      if (ccMatch) authData.ccHeader = ccMatch[1].replace(/\n/g, ' ').trim();
      const bccMatch = stripped.match(new RegExp('(?<=\\s)Bcc[:\\s]+(' + hdrVal + ')', 'i'));
      if (bccMatch) authData.bccHeader = bccMatch[1].replace(/\n/g, ' ').trim();
      const deliveredToMatch = stripped.match(/Delivered-To[:\s]+([^\s<]+@[^\s>]+)/i);
      if (deliveredToMatch) authData.deliveredTo = deliveredToMatch[1].toLowerCase().trim();
      const replyToMatch = stripped.match(/\bReply-To\s*:\s*([^\n]*@[^\n]*)/i);
      if (replyToMatch) authData.replyTo = replyToMatch[1].trim();
      if (/\b(List-Id|X-Google-Group-Id|Mailing-List)\s*:/i.test(stripped)) {
        authData.isMailingList = true;
      }

      // Extract raw header lines from the stripped HTML text
      // The full email headers are embedded in the HTML page
      const headerNames = ['Authentication-Results', 'Received-SPF', 'DKIM-Signature', 'ARC-Authentication-Results', 'Reply-To'];
      const rawHeaderLines = {};
      for (const name of headerNames) {
        const re = new RegExp(name + '\\s*:[^\\n]+', 'gi');
        const matches = stripped.match(re);
        if (matches) rawHeaderLines[name] = matches.map(m => m.replace(/\s+/g, ' ').trim());
      }
      if (Object.keys(rawHeaderLines).length > 0) {
        authData.rawHeaderLines = rawHeaderLines;
      }

      if (Object.keys(authData).length > 0) {
        window.postMessage({ type: 'gsi-headers-result', requestId, authData }, '*');
      } else {
        // Send a debug snippet so we can see the actual format
        const snippet = stripped.substring(0, 3000).replace(/\s+/g, ' ');
        window.postMessage({ type: 'gsi-headers-result', requestId, error: 'no auth data in HTML', debug: snippet }, '*');
      }
      return;
    }

    window.postMessage({ type: 'gsi-headers-result', requestId, headers }, '*');
  } catch (e) {
    window.postMessage({ type: 'gsi-headers-result', requestId, error: e.message || 'fetch failed' }, '*');
  }
});

// --- AI Spam/Phishing Analysis via Chrome Prompt API (Gemini Nano) ---
// Runs in MAIN world because LanguageModel is not available in service workers.

const AI_SYSTEM_PROMPT = `You are a cybersecurity expert analyzing email metadata for spam and phishing indicators.

Given the email data below, evaluate these criteria:
1. SENDER MISMATCH: Does the display name impersonate a known brand but the email DOMAIN doesn't belong to that brand? (e.g., display name "Bank of America" but sender is random-user@gmail.com). IMPORTANT: Only the domain matters — the local part before @ (noreply, no-reply, receipts, support, info, hello, team, billing, notifications, alerts, etc.) is irrelevant. Example: "Uber Receipts <noreply@uber.com>" is legitimate because uber.com IS Uber's domain. A personal name like "John" or "Mom" from a consumer email provider is NOT a mismatch — only flag when the domain itself doesn't belong to the brand in the display name.
2. URGENCY/THREAT LANGUAGE: Does the subject or body contain urgent threats, scare tactics, or pressure to act immediately? (e.g., "Account Suspended", "Unauthorized Login", "Act Now"). Casual urgency in personal conversation (e.g., "call me ASAP", "need this today") is NOT suspicious.
3. LINK DISCREPANCIES: Do any links point to domains different from the sender's domain? Note: link shorteners (bit.ly, t.co, goo.gl, tinyurl.com, etc.) and subdomained links (e.g., sender.example.com linking to example.com) are generally acceptable and should NOT be flagged. Personal emails often share links to various sites — this is normal and should NOT be flagged unless the links appear to mimic login pages or financial sites.
4. BCC RECIPIENT: If "Recipient: BCC" is present, the recipient was blind-copied — they are not in the To or Cc fields. BCC from an unknown sender with no body or a generic subject is highly suspicious (likely spam or phishing probe). BCC alone is not dangerous (newsletters, internal forwards), but combined with other signals (empty body, unknown sender, urgency) it should escalate the verdict.
5. EMPTY BODY: If "Body: (empty)" is noted, the email has no meaningful content. An empty or near-empty body from an unknown sender is suspicious — legitimate emails almost always contain content. Combined with BCC, this is a strong spam/phishing indicator.
6. REPLY-TO MISMATCH: If "Reply-To mismatch" data is present, the Reply-To header routes replies to a different domain than the sender's From address. This is the #1 phishing technique — the From address looks legitimate but replies go to an attacker-controlled mailbox. This is a HIGH severity signal that should significantly escalate the verdict toward Caution or Reject, especially combined with urgency language, link discrepancies, or sender mismatch.

AUTHENTICATION CONTEXT: The email data may include SPF, DKIM, and DMARC results. When all three pass, the sender is cryptographically verified — strongly favor "Ok" unless there are clear phishing indicators. However, passing authentication alone does NOT make a BCC'd empty-body email safe — spammers can have valid SPF/DKIM/DMARC. Weigh authentication together with behavioral signals (BCC status, empty body, unknown sender).

Respond with ONLY a JSON object, no markdown fences. Follow these examples EXACTLY:

Safe email (e.g. "Uber Receipts <noreply@uber.com>"): {"verdict":"Ok","summary":"Legitimate sender, no concerns","reasons":["Sender domain uber.com matches Uber brand","noreply@ local part is normal for automated emails"]}
Suspicious email: {"verdict":"Caution","summary":"Sender impersonates PayPal","reasons":["Display name says PayPal but email is from random domain","Body contains urgent account suspension threat"]}
Dangerous email: {"verdict":"Reject","summary":"Fake login page link","reasons":["Link mimics bank login page on unrelated domain","Urgent threat to close account within 24 hours"]}

Rules:
- verdict: "Ok", "Caution", or "Reject"
- summary: ALWAYS provide a short phrase under 8 words explaining the assessment
- reasons: ALWAYS provide 1-3 strings explaining your reasoning. Each reason must be a complete, readable sentence fragment.`;

let aiSession = null;
let aiSessionPromise = null;
let aiAvailable = null;
let aiAvailableCheckedAt = 0;
const AI_AVAILABLE_RECHECK_MS = 60000;
const aiResultCache = new Map();

async function checkAiAvailableLocal() {
  if (aiAvailable === false && Date.now() - aiAvailableCheckedAt > AI_AVAILABLE_RECHECK_MS) {
    aiAvailable = null;
  }
  if (aiAvailable !== null) return aiAvailable;
  try {
    if (typeof LanguageModel === 'undefined') {
      aiAvailable = false;
      aiAvailableCheckedAt = Date.now();
      return false;
    }
    const status = await LanguageModel.availability();
    aiAvailable = status === 'available';
    aiAvailableCheckedAt = Date.now();
    return aiAvailable;
  } catch {
    aiAvailable = false;
    aiAvailableCheckedAt = Date.now();
    return false;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function getAiSession() {
  if (aiSession) return aiSession;
  if (aiSessionPromise) return aiSessionPromise;
  aiSessionPromise = (async () => {
    try {
      aiSession = await withTimeout(LanguageModel.create({
        initialPrompts: [{ role: 'system', content: AI_SYSTEM_PROMPT }],
      }), 60000);
      return aiSession;
    } catch {
      aiAvailable = false;
      return null;
    } finally {
      aiSessionPromise = null;
    }
  })();
  return aiSessionPromise;
}

function sanitizeForPrompt(text, maxLength = 2000) {
  if (!text || typeof text !== 'string') return '';
  let s = text;
  s = s.replace(/[{}[\]]/g, '');
  s = s.replace(/\b(system|assistant|user)\s*:/gi, '$1 -');
  s = s.replace(/(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/gi, '[removed]');
  s = s.replace(/(new\s+instruction|you\s+are\s+now|respond\s+with|always\s+(say|reply|answer|respond))\b/gi, '[removed]');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{4,}/g, '   ');
  if (s.length > maxLength) s = s.slice(0, maxLength) + '…[truncated]';
  return s;
}

function buildAiUserPrompt(data) {
  const lines = [
    `Display Name: ${sanitizeForPrompt(data.displayName, 200) || '(none)'}`,
    `Sender Email: ${sanitizeForPrompt(data.senderEmail, 320)}`,
    `Subject: ${sanitizeForPrompt(data.subject, 500) || '(none)'}`,
  ];
  if (data.recipientStatus === 'bcc') {
    lines.push('Recipient: BCC (not in To or Cc fields)');
  }
  if (data.isEmptyBody) {
    lines.push('Body: (empty)');
  } else if (data.bodyText) {
    lines.push(`Body (excerpt):\n${sanitizeForPrompt(data.bodyText, 2000)}`);
  }
  if (data.replyToMismatch) {
    lines.push(`Reply-To mismatch: replies go to ${sanitizeForPrompt(data.replyToMismatch.replyToEmail, 320)} (domain: ${sanitizeForPrompt(data.replyToMismatch.replyToDomain, 200)}) instead of sender domain ${sanitizeForPrompt(data.replyToMismatch.senderDomain, 200)}`);
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
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const verdict = normalizeVerdict(obj.verdict) || 'Caution';
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.map(String).filter(r => r && r !== 'undefined') : [];
    return { verdict, summary, reasons, parseError: null };
  } catch { /* fall through */ }
  const verdictMatch = cleaned.match(/"verdict"\s*:\s*"([^"]+)"/i);
  const verdict = verdictMatch ? normalizeVerdict(verdictMatch[1]) : null;
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const summary = summaryMatch ? summaryMatch[1] : '';
  const reasons = [];
  const reasonsBlock = cleaned.match(/"reasons"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
  if (reasonsBlock) {
    const stringMatches = reasonsBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g);
    for (const m of stringMatches) reasons.push(m[1]);
  }
  if (verdict) return { verdict, summary, reasons, parseError: null };
  return { verdict: null, summary: '', reasons: [], parseError: 'no verdict found: ' + cleaned.substring(0, 200) };
}

// --- AI message handlers ---

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'gsi-check-ai') return;
  const { requestId } = event.data;
  const hasGlobal = typeof LanguageModel !== 'undefined';
  const hasWindowAi = typeof window.ai?.languageModel !== 'undefined';
  let status = null;
  let statusError = null;
  let createError = null;
  if (hasGlobal) {
    try { status = await LanguageModel.availability(); } catch (e) { statusError = e.message; }
  } else if (hasWindowAi) {
    try { status = await window.ai.languageModel.availability(); } catch (e) { statusError = e.message; }
  }
  // If availability says unavailable, try create() directly — it can trigger download
  // and sometimes works when availability is stale
  let available = (hasGlobal || hasWindowAi) && status === 'available';
  if (!available && (hasGlobal || hasWindowAi) && status !== 'downloading' && status !== 'downloadable') {
    try {
      const testSession = hasGlobal
        ? await LanguageModel.create({ initialPrompts: [{ role: 'system', content: 'test' }] })
        : await window.ai.languageModel.create({ initialPrompts: [{ role: 'system', content: 'test' }] });
      if (testSession) {
        testSession.destroy();
        available = true;
        aiAvailable = true;
        status = 'available (via create)';
      }
    } catch (e) { createError = e.message; }
  }
  const hasApi = hasGlobal || hasWindowAi;
  console.log('[GSI] AI check:', { hasGlobal, hasWindowAi, status, statusError, createError, available });
  window.postMessage({ type: 'gsi-ai-available-result', requestId, available, hasApi, status, statusError, createError }, '*');
});

// User-gesture-triggered download — Chrome requires a click to start the model download
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'gsi-download-ai') return;
  const { requestId } = event.data;
  try {
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          console.log('[GSI] AI model download:', Math.round(e.loaded / e.total * 100) + '%');
        });
      },
      initialPrompts: [{ role: 'system', content: 'test' }],
    });
    if (session) {
      session.destroy();
      aiAvailable = true;
    }
    window.postMessage({ type: 'gsi-ai-download-result', requestId, ready: true }, '*');
  } catch (e) {
    window.postMessage({ type: 'gsi-ai-download-result', requestId, ready: false, error: e.message }, '*');
  }
});

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'gsi-analyze-email') return;
  const { requestId, data, skipCache } = event.data;

  if (!data || !data.senderEmail) {
    window.postMessage({ type: 'gsi-ai-analysis-result', requestId, error: 'Missing email data' }, '*');
    return;
  }

  const cacheKey = data.messageId
    ? `ai:${data.messageId}`
    : `ai:${data.senderEmail}:${(data.subject || '').substring(0, 80)}`;
  if (skipCache) aiResultCache.delete(cacheKey);
  const cached = aiResultCache.get(cacheKey);
  if (cached) {
    window.postMessage({ type: 'gsi-ai-analysis-result', requestId, ...cached, debug: { ...cached.debug, cached: true } }, '*');
    return;
  }

  async function runPrompt(session, retried) {
    const clone = await withTimeout(session.clone(), 30000);
    try {
      const userPrompt = buildAiUserPrompt(data);
      const t0 = Date.now();
      const rawResponse = await withTimeout(clone.prompt(userPrompt), 60000);
      const durationMs = Date.now() - t0;
      const result = parseAiResult(rawResponse);
      const response = { ...result, debug: { rawResponse, userPrompt, durationMs, cached: false, retried } };
      aiResultCache.set(cacheKey, response);
      return response;
    } finally {
      clone.destroy();
    }
  }

  try {
    const available = await checkAiAvailableLocal();
    if (!available) {
      window.postMessage({ type: 'gsi-ai-analysis-result', requestId, unavailable: true }, '*');
      return;
    }
    const session = await getAiSession();
    if (!session) {
      window.postMessage({ type: 'gsi-ai-analysis-result', requestId, unavailable: true }, '*');
      return;
    }
    const response = await runPrompt(session, false);
    window.postMessage({ type: 'gsi-ai-analysis-result', requestId, ...response }, '*');
  } catch (e) {
    if (aiSession) {
      aiSession = null;
      try {
        const session = await getAiSession();
        if (session) {
          const response = await runPrompt(session, true);
          window.postMessage({ type: 'gsi-ai-analysis-result', requestId, ...response }, '*');
          return;
        }
      } catch { /* fall through */ }
    }
    window.postMessage({
      type: 'gsi-ai-analysis-result', requestId,
      verdict: null, summary: '', reasons: [], parseError: e.message || 'unknown error',
      debug: { error: e.message || 'unknown error' },
    }, '*');
  }
});
