import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {FORMAT, MAX_IMPORT_BYTES, normalizeReceipt} from '../web/model.mjs';
import {createPublicProxy, validatePublicURL} from './network.mjs';
import {createCoverageTracker} from './coverage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const axeVersion = require('axe-core/package.json').version;
const config = JSON.parse(await fs.readFile(path.join(root, 'web/config.json'), 'utf8'));
const manual = (process.env.ACCESSRECEIPT_URLS || '').trim();
// Manual labels fall back to the validated URL below, never the raw input (which
// may contain a discarded fragment such as an OAuth token).
const pages = manual ? manual.split(/[\n,]+/).map(url => ({url: url.trim()})).filter(p => p.url) : config.pages;
if (!Array.isArray(pages) || !pages.length || pages.length > Math.min(config.maxPagesPerRun || 20, 20)) throw new Error('Configure between 1 and 20 public pages per run.');
const urls = new Set();
for (const page of pages) {
  page.url = validatePublicURL(page.url).href;
  if (urls.has(page.url)) throw new Error('The page list contains duplicate URLs.');
  urls.add(page.url);
}
if (!Number.isInteger(config.viewport?.width) || !Number.isInteger(config.viewport?.height) || config.viewport.width < 240 || config.viewport.height < 240 || config.viewport.width > 2560 || config.viewport.height > 2560) throw new Error('Use a viewport between 240 and 2560 pixels.');
if (!Array.isArray(config.tags) || !config.tags.length || config.tags.some(tag => typeof tag !== 'string' || !/^[a-z0-9-]+$/.test(tag))) throw new Error('Configure valid axe rule tags.');
const settle = Math.min(Math.max(Number(config.settleMilliseconds) || 0, 0), 5000);
const timeout = Math.min(Math.max(Number(config.navigationTimeoutMilliseconds) || 25000, 5000), 45000);
const requestLimit = Math.floor(Math.min(Math.max(Number(config.maxNetworkRequestsPerPage) || 600, 1), 1000));
const proxy = await createPublicProxy();
let browser;
const receipt = {format: FORMAT, capturedAt: new Date().toISOString(), engine: {name: 'axe-core', version: axeVersion},
  profile: {viewport: config.viewport, tags: config.tags, scope: 'document', settleMilliseconds: settle, browser: '', policy: 'public-read-v1', requestLimit}, pages: []};
try {
  browser = await chromium.launch({proxy: {server: proxy.url, bypass: '<-loopback>'}, args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  receipt.profile.browser = `Chromium ${browser.version()}`;
  for (const item of pages) {
    const record = {requestedURL: item.url, finalURL: '', label: item.label || item.url, status: 'error', scannedAt: new Date().toISOString(), error: '', violations: [], incomplete: []};
    const context = await browser.newContext({viewport: config.viewport, serviceWorkers: 'block', acceptDownloads: false,
      ignoreHTTPSErrors: false, bypassCSP: true, permissions: [], locale: 'en-CA', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce'});
    let requests = 0;
    let policyBlocked = 0;
    let failedRequests = 0;
    let observing = true;
    const coverage = createCoverageTracker();
    context.on('request', request => coverage.started(request));
    context.on('requestfinished', request => coverage.finished(request));
    context.on('requestfailed', request => { if (observing) failedRequests++; coverage.failed(request); });
    context.on('response', response => { if (observing && response.status() >= 400) { failedRequests++; coverage.httpError(response.request()); } });
    await context.route('**/*', async route => {
      const request = route.request();
      let reason = 'policy';
      try {
        if (++requests > requestLimit) { reason = 'budget'; throw new Error('Request budget exceeded.'); }
        if (!['GET', 'HEAD'].includes(request.method())) { reason = 'non-read'; throw new Error('Only public read requests are permitted.'); }
        validatePublicURL(request.url());
        let predecessor = request.redirectedFrom(), redirects = 0;
        while (predecessor) { if (++redirects > 10) throw new Error('Too many redirects.'); predecessor = predecessor.redirectedFrom(); }
        await route.continue();
      } catch { if (observing) policyBlocked++; coverage.blocked(request, reason); await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    try {
      const page = await context.newPage();
      const response = await page.goto(item.url, {waitUntil: 'domcontentloaded', timeout});
      if (!response || response.status() >= 400) throw new Error(`The page returned HTTP ${response?.status() || 'no response'}.`);
      await page.waitForTimeout(settle);
      record.finalURL = validatePublicURL(page.url()).href;
      await page.addScriptTag({path: axePath});
      const results = await Promise.race([
        page.evaluate(tags => window.axe.run(document, {runOnly: {type: 'tag', values: tags},
          resultTypes: ['violations', 'incomplete', 'passes', 'inapplicable']}), config.tags),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Accessibility check exceeded 45 seconds.')), 45000); timer.unref(); })
      ]);
      record.violations = results.violations;
      record.incomplete = results.incomplete;
      record.passedRules = results.passes.length;
      record.inapplicableRules = results.inapplicable.length;
      record.status = 'success';
      console.log(`Page ${receipt.pages.length + 1} (${new URL(item.url).hostname}): ${results.violations.length} rule findings; ${results.incomplete.length} rules need review; ${policyBlocked} non-read/blocked requests.`);
    } catch (error) {
      // Avoid publishing browser traces, response bodies or request parameters.
      record.error = error.message.startsWith('The page returned HTTP') ? error.message : 'The public page could not be checked (network, policy, timeout or browser error). Run the workflow again or inspect the page directly.';
      console.log(`Page ${receipt.pages.length + 1} (${new URL(item.url).hostname}): check unavailable.`);
    } finally {
      record.coverage = coverage.finish();
      observing = false;
      await context.close();
    }
    record.network = {requests, blocked: policyBlocked, failed: failedRequests};
    receipt.pages.push(record);
  }
} finally {
  if (browser) await browser.close();
  await proxy.close();
}
const cleaned = normalizeReceipt(receipt);
const successful = cleaned.pages.filter(page => page.status === 'success').length;
const directory = path.join(root, 'web/data');
if (!successful) throw new Error('All checks failed. Existing captures and the published site remain unchanged.');
const serialized = JSON.stringify(cleaned, null, 2) + '\n';
if (Buffer.byteLength(serialized) > MAX_IMPORT_BYTES) throw new Error('Capture exceeds 8 MB. Use fewer pages per capture. Earlier captures remain unchanged.');
const indexPath = path.join(directory, 'index.json');
let index;
try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch { index = {format: 'coolcode-accessreceipt-index-v1', captures: []}; }
const filename = `${cleaned.capturedAt.replace(/[:.]/g, '-')}.json`;
const relative = `captures/${filename}`;
await fs.mkdir(path.join(directory, 'captures'), {recursive: true});
await fs.writeFile(path.join(directory, relative), serialized);
const newEntry = {path: relative, capturedAt: cleaned.capturedAt, pages: cleaned.pages.length, checked: successful};
const limit = Math.min(Math.max(Number(config.historyLimit) || 104, 2), 500);
index.captures = [newEntry, ...(index.captures || [])].slice(0, limit);
await fs.writeFile(indexPath + '.tmp', JSON.stringify(index, null, 2) + '\n');
await fs.rename(indexPath + '.tmp', indexPath);
// Retain files beyond the visible index in Git history and on disk. Never delete
// a previous capture merely because a configured page was removed.
console.log(`Saved ${relative}; ${successful}/${cleaned.pages.length} pages checked. Earlier captures retained.`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
  `## Access Receipt\n\nCaptured ${successful} of ${cleaned.pages.length} public pages with axe-core ${axeVersion}.\n\n[Open Access Receipt](https://coolcode.ca/accessreceipt/) after deployment.\n\nAutomated findings are evidence for review, not an accessibility certification.\n`);
