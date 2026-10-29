/**
 * Tests for the background service worker's result cache.
 * Loads src/background.js into a vm sandbox with a mocked chrome.storage and
 * fetch, so the shipped code is exercised. Verifies the cache is keyed by
 * sender domain (not full email), keeps the 24h TTL, and that the install /
 * update handler clears old entries (including legacy email-keyed ones) while
 * preserving the review-nag keys.
 * Run: node tests/cache-key-domain.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

function makeSandbox() {
  const store = {};
  const fetchedUrls = [];
  let onMessage = null;
  let onInstalled = null;
  const storageLocal = {
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
      const out = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(obj) { Object.assign(store, obj); },
    async remove(k) { delete store[k]; },
    async clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
  // The first-use bookkeeping in background.js uses the callback form of get/set.
  const origGet = storageLocal.get;
  storageLocal.get = function (keys, cb) {
    const p = origGet.call(this, keys);
    if (typeof cb === 'function') { p.then(cb); return undefined; }
    return p;
  };
  const sandbox = {
    chrome: {
      storage: { local: storageLocal },
      runtime: {
        onInstalled: { addListener: (fn) => { onInstalled = fn; } },
        onMessage: { addListener: (fn) => { onMessage = fn; } },
      },
    },
    fetch: async (url) => {
      fetchedUrls.push(String(url));
      return { ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(4) };
    },
    console, Date, URL, Promise, Uint8Array, encodeURIComponent, setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8'),
    sandbox
  );
  function send(email) {
    return new Promise((resolve) => {
      const async = onMessage({ action: 'getSenderInfo', email }, {}, resolve);
      if (!async) return; // responded synchronously (invalid input)
    });
  }
  return { store, fetchedUrls, send, getOnInstalled: () => onInstalled };
}

(async () => {
  console.log('cache keyed by domain');
  {
    const sb = makeSandbox();
    const a = await sb.send('alice@Mail.Example.com');
    const callsAfterFirst = sb.fetchedUrls.length;
    check('first lookup hits the network', callsAfterFirst > 0);

    const cacheKeys = Object.keys(sb.store).filter((k) => k.startsWith('gsi_cache:'));
    check('exactly one cache entry written', cacheKeys.length === 1);
    check('cache key is the lowercased domain', cacheKeys[0] === 'gsi_cache:mail.example.com');
    check('no storage key contains the email address', !Object.keys(sb.store).some((k) => k.includes('alice')));
    check('no stored value contains the local part', !JSON.stringify(sb.store).includes('alice'));

    const b = await sb.send('bob@mail.example.com');
    check('different address, same domain: served from cache (no new fetches)', sb.fetchedUrls.length === callsAfterFirst);
    check('cached response matches', JSON.stringify(a) === JSON.stringify(b));

    await sb.send('carol@other.example.org');
    check('different domain: new network lookup', sb.fetchedUrls.length > callsAfterFirst);
    check('different domain: second cache entry', Object.keys(sb.store).filter((k) => k.startsWith('gsi_cache:')).length === 2);
  }

  console.log('24h TTL');
  {
    const sb = makeSandbox();
    await sb.send('a@example.com');
    const key = 'gsi_cache:example.com';
    const n = sb.fetchedUrls.length;

    sb.store[key].ts = Date.now() - (24 * 60 * 60 * 1000 - 60 * 1000);
    await sb.send('a@example.com');
    check('entry just under 24h old is still served from cache', sb.fetchedUrls.length === n);

    sb.store[key].ts = Date.now() - (24 * 60 * 60 * 1000 + 1000);
    await sb.send('a@example.com');
    check('entry older than 24h is refreshed over the network', sb.fetchedUrls.length > n);
    check('refreshed entry has a fresh timestamp', Date.now() - sb.store[key].ts < 60 * 1000);
  }

  console.log('invalid input');
  {
    const sb = makeSandbox();
    const r1 = await sb.send('no-at-sign');
    const r2 = await sb.send('user@');
    check('missing @ rejected', r1 && r1.error === 'Invalid email');
    check('empty domain rejected', r2 && r2.error === 'Invalid email');
    check('nothing fetched or cached for invalid input', sb.fetchedUrls.length === 0 && Object.keys(sb.store).length === 0);
  }

  console.log('install/update cleanup');
  {
    const sb = makeSandbox();
    sb.store['alice@example.com'] = { data: { fullDomain: 'example.com' }, ts: Date.now() }; // legacy email-keyed entry
    sb.store['gsi_cache:example.com'] = { data: {}, ts: Date.now() };
    sb.store.gsi_first_use_time = 123;
    sb.store.gsi_email_view_count = 7;
    sb.store.gsi_review_snoozed_at = 456;
    sb.store.gsi_review_clicked_at = 789;
    await sb.getOnInstalled()({ reason: 'update' });
    check('legacy email-keyed entry removed', !('alice@example.com' in sb.store));
    check('domain-keyed entry removed', !('gsi_cache:example.com' in sb.store));
    check('review-nag keys preserved', sb.store.gsi_first_use_time === 123 && sb.store.gsi_email_view_count === 7
      && sb.store.gsi_review_snoozed_at === 456 && sb.store.gsi_review_clicked_at === 789);
    check('only the four review keys remain', Object.keys(sb.store).length === 4);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
