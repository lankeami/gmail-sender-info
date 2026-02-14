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
      const stripped = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      const authData = {};

      const spfMatch = stripped.match(/\bSPF:\s*'?(PASS|FAIL|SOFTFAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (spfMatch) authData.spf = spfMatch[1].toLowerCase();

      const dkimMatch = stripped.match(/\bDKIM:\s*'?(PASS|FAIL|NEUTRAL|NONE|TEMPERROR|PERMERROR)\b/i);
      if (dkimMatch) authData.dkim = dkimMatch[1].toLowerCase();

      const dmarcMatch = stripped.match(/\bDMARC:\s*'?(PASS|FAIL|BESTGUESSPASS|NONE|TEMPERROR|PERMERROR)\b/i);
      if (dmarcMatch) authData.dmarc = dmarcMatch[1].toLowerCase();

      const origSenderMatch = stripped.match(/X-Original-Sender[:\s]+([^\s<]+@[^\s>]+)/i);
      if (origSenderMatch) authData.originalSender = origSenderMatch[1].toLowerCase().trim();

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
