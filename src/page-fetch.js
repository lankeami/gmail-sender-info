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

      // Plain "SPF:" only — excludes "Gateway SPF:", which Gmail shows when a
      // message only passed an admin-configured relay/IP allow-list rather
      // than real authentication of the sender's own domain.
      const spfMatch = stripped.match(/(?<!Gateway )\bSPF:\s*'?(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (spfMatch) authData.spf = spfMatch[1].toLowerCase();

      const gatewaySpfMatch = stripped.match(/Gateway SPF:\s*'?(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (gatewaySpfMatch) authData.gatewaySpf = gatewaySpfMatch[1].toLowerCase();

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
