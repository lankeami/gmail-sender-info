/**
 * Drives the real content-script banner for the review prompt.
 * Documents once-per-tab behavior. Seeing the prompt consumes the tab.
 * A later warning does not give that showing back, and a warning on the
 * banner that is currently showing the prompt removes the row while leaving
 * the tab consumed. A warning before any showing leaves the tab unused.
 * Run: node tests/review-prompt-flow.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const contentPath = path.join(__dirname, '..', 'src', 'content.js');
const contentSource = fs.readFileSync(contentPath, 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS: ' + name); }
  else { failed++; console.log('  FAIL: ' + name); }
}

const DAY = 86400000;

function eligibleStore() {
  const now = Date.now();
  return {
    gsi_first_use_time: now - 40 * DAY,
    gsi_email_view_count: 30,
    gsi_warned_at: now - 10 * DAY,
  };
}

function installImageOnload(window) {
  const proto = window.HTMLImageElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'src');
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: desc ? desc.enumerable : true,
    get() {
      return desc && desc.get ? desc.get.call(this) : (this.getAttribute('src') || '');
    },
    set(value) {
      if (desc && desc.set) desc.set.call(this, value);
      else this.setAttribute('src', value);
      const img = this;
      const url = String(value || '');
      queueMicrotask(() => {
        if (url.indexOf('caution.svg') !== -1) {
          if (typeof img.onerror === 'function') img.onerror();
        } else if (typeof img.onload === 'function') {
          img.onload();
        }
      });
    },
  });
}

function boot(store) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://mail.google.com/mail/u/0/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const window = dom.window;
  const skips = [];
  window.console.debug = (...args) => {
    const line = args.map(String).join(' ');
    if (line.indexOf('[GSI review]') === 0) skips.push(line);
  };

  const scripted = { auth: null, ai: 'Ok' };
  function reply(data) {
    // jsdom's postMessage does not set event.source, and the content script
    // ignores messages whose source is not this window.
    const ev = new window.MessageEvent('message', {
      data,
      source: window,
      origin: window.location.origin,
    });
    window.dispatchEvent(ev);
  }
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'gsi-fetch-headers') {
      reply({
        type: 'gsi-headers-result',
        requestId: data.requestId,
        authData: scripted.auth,
      });
    } else if (data.type === 'gsi-check-ai') {
      reply({
        type: 'gsi-ai-available-result',
        requestId: data.requestId,
        available: true,
        hasApi: true,
        status: 'available',
      });
    } else if (data.type === 'gsi-analyze-email') {
      reply({
        type: 'gsi-ai-analysis-result',
        requestId: data.requestId,
        verdict: scripted.ai,
        summary: scripted.ai === 'Ok' ? 'No concerns detected' : 'Looks risky',
        reasons: [scripted.ai === 'Ok' ? 'No concerns detected' : 'Urgent tone'],
      });
    }
  });

  window.chrome = {
    runtime: {
      id: 'gsi-test',
      lastError: undefined,
      getURL: (p) => 'chrome-extension://gsi-test/' + p,
      getManifest: () => ({ version: 'test' }),
      sendMessage: (msg, cb) => {
        if (!msg || msg.action !== 'getSenderInfo') {
          if (cb) cb(undefined);
          return;
        }
        const domain = String(msg.email || '').split('@')[1] || 'example.test';
        setTimeout(() => {
          cb({
            fullDomain: domain,
            rootDomain: domain,
            logoUrl: 'https://example.com/logo.svg',
            logoSource: 'bimi',
          });
        }, 0);
      },
      onMessage: { addListener: () => {} },
    },
    storage: {
      local: {
        get(keys, cb) {
          const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
          const out = {};
          for (const key of list) if (key in store) out[key] = store[key];
          const deliver = () => { if (typeof cb === 'function') cb(out); };
          setTimeout(deliver, 0);
          return Promise.resolve(out);
        },
        set(obj, cb) {
          Object.assign(store, obj);
          setTimeout(() => { if (typeof cb === 'function') cb(); }, 0);
          return Promise.resolve();
        },
        remove() {},
        clear() {},
      },
    },
  };

  installImageOnload(window);
  const context = dom.getInternalVMContext();
  context.chrome = window.chrome;
  context.CSS = {
    escape(value) {
      return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
    },
  };
  vm.runInContext(contentSource, context);
  return { window, skips, scripted };
}

function waitFor(fn, ms) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function tick() {
      let value = false;
      try { value = fn(); } catch (err) { return resolve(null); }
      if (value) return resolve(value);
      if (Date.now() - start > ms) return resolve(null);
      setTimeout(tick, 15);
    })();
  });
}

async function openEmail(session, { email, messageId, auth, ai }) {
  const { window, skips, scripted } = session;
  const before = skips.length;
  scripted.auth = auth;
  scripted.ai = ai;
  const doc = window.document;
  doc.body.textContent = '';
  const subject = doc.createElement('div');
  subject.className = 'hP';
  subject.textContent = 'Subject';
  const sender = doc.createElement('span');
  sender.className = 'gD';
  sender.setAttribute('email', email);
  const msg = doc.createElement('div');
  msg.setAttribute('data-legacy-message-id', messageId);
  doc.body.append(subject, sender, msg);

  const settled = await waitFor(() => {
    const banner = doc.getElementById('gsi-banner');
    if (!banner) return false;
    const pill = banner.querySelector('.gsi-pill-verdict');
    if (!pill || pill.textContent === 'Checking') return false;
    const aiLine = banner.querySelector('.gsi-ai-line-text');
    const aiText = aiLine ? aiLine.textContent : '';
    if (!aiText || /Analyz|Retrying/.test(aiText)) return false;
    const prompt = banner.querySelector('.gsi-review-prompt');
    const fresh = skips.slice(before);
    const decisive = fresh.some((line) => line.indexOf('ai-pending') === -1 && line.indexOf('auth-pending') === -1);
    if (prompt || decisive) return { prompt: !!prompt, skips: fresh, banner };
    return false;
  }, 4000);
  return settled || { prompt: false, skips: skips.slice(before), banner: doc.getElementById('gsi-banner') };
}

(async () => {
  console.log('same tab: show once, then not again');
  {
    const store = eligibleStore();
    const session = boot(store);
    const trusted = { spf: 'pass', dkim: 'pass', dmarc: 'pass' };
    const caution = { spf: 'neutral', dkim: 'neutral', dmarc: 'none' };

    const a = await openEmail(session, {
      email: 'a@alpha.test', messageId: 'aaa111', auth: trusted, ai: 'Ok',
    });
    check('A Trusted+OK shows the prompt', a.prompt === true);

    const b = await openEmail(session, {
      email: 'b@beta.test', messageId: 'bbb222', auth: caution, ai: 'Caution',
    });
    check('B with a warning shows nothing', b.prompt === false);

    const c = await openEmail(session, {
      email: 'c@gamma.test', messageId: 'ccc333', auth: trusted, ai: 'Ok',
    });
    check('C Trusted+OK in the same tab does not show', c.prompt === false);
    check('C was skipped because it was already shown this tab',
      c.skips.some((line) => line.indexOf('shown-this-tab') !== -1));

    const reloaded = boot(store);
    const again = await openEmail(reloaded, {
      email: 'd@delta.test', messageId: 'ddd444', auth: trusted, ai: 'Ok',
    });
    check('fresh tab shows the prompt again', again.prompt === true);

    const unseen = boot(eligibleStore());
    const onlyBad = await openEmail(unseen, {
      email: 'b@beta.test', messageId: 'bbb222', auth: caution, ai: 'Caution',
    });
    check('a warning before any showing shows nothing', onlyBad.prompt === false);
    const afterUnseen = await openEmail(unseen, {
      email: 'a@alpha.test', messageId: 'aaa111', auth: trusted, ai: 'Ok',
    });
    check('Trusted+OK shows when this tab has not shown the prompt yet', afterUnseen.prompt === true);
  }

  console.log('warning on the visible prompt leaves the tab consumed');
  {
    const store = eligibleStore();
    const session = boot(store);
    const trusted = { spf: 'pass', dkim: 'pass', dmarc: 'pass' };
    const shown = await openEmail(session, {
      email: 'a@alpha.test', messageId: 'aaa111', auth: trusted, ai: 'Ok',
    });
    check('prompt is up before the warning', shown.prompt === true);
    const snoozeBefore = store.gsi_review_snoozed_at;
    const dismissBefore = store.gsi_review_dismiss_count;

    session.scripted.ai = 'Caution';
    const refresh = shown.banner.querySelector('.gsi-ai-refresh-btn');
    check('AI refresh control is present', !!refresh);
    const skipsBefore = session.skips.length;
    refresh.click();

    const removed = await waitFor(() => {
      const banner = session.window.document.getElementById('gsi-banner');
      if (!banner) return false;
      if (banner.querySelector('.gsi-review-prompt')) return false;
      const logged = session.skips.slice(skipsBefore).some((line) => line.indexOf('warning') !== -1);
      return logged ? true : false;
    }, 4000);
    check('warning removes the prompt', removed === true);
    check('warning writes no snooze or dismiss count',
      store.gsi_review_snoozed_at === snoozeBefore && store.gsi_review_dismiss_count === dismissBefore);

    const next = await openEmail(session, {
      email: 'e@epsilon.test', messageId: 'eee555', auth: trusted, ai: 'Ok',
    });
    check('next Trusted+OK stays hidden after the warning removed the prompt', next.prompt === false);
    check('that next email is skipped as already shown this tab',
      next.skips.some((line) => line.indexOf('shown-this-tab') !== -1));
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
