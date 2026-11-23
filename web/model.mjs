export const FORMAT = 'coolcode-accessreceipt-v1';
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const impacts = new Set(['critical', 'serious', 'moderate', 'minor']);
const text = (value, length = 2000) => typeof value === 'string' ? value.slice(0, length) : '';
export function safeURL(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}
const strings = (value, limit = 100) => Array.isArray(value) ? value.slice(0, limit).filter(v => typeof v === 'string').map(v => text(v, 500)) : [];
function cleanCoverage(value) {
  if (!value || typeof value.budgetExhausted !== 'boolean'
      || !Number.isSafeInteger(value.criticalFailures) || value.criticalFailures < 0
      || !Number.isSafeInteger(value.pendingCritical) || value.pendingCritical < 0) return {status: 'unknown'};
  return {status: value.budgetExhausted || value.criticalFailures || value.pendingCritical ? 'degraded' : 'complete',
    budgetExhausted: value.budgetExhausted, criticalFailures: value.criticalFailures, pendingCritical: value.pendingCritical};
}
function target(value, depth = 0) {
  if (!Array.isArray(value)) return [];
  if (depth > 8 || value.length > 100 || value.some(v => typeof v === 'string' && v.length > 10000)) throw new Error('An element target exceeds the report size limits.');
  return value.flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) ? [target(v, depth + 1)] : []);
}
function cleanRules(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 1000) throw new Error('This report contains too many rule records.');
  if (value.some(rule => typeof rule?.id !== 'string' || !rule.id || rule.id.length > 200 || !Array.isArray(rule.nodes) || rule.nodes.length > 5000)) throw new Error('Rule IDs or element records are missing or exceed the report limits.');
  return value.map(rule => ({
    id: text(rule.id, 200), impact: impacts.has(rule.impact) ? rule.impact : null,
    description: text(rule.description), help: text(rule.help), helpUrl: safeURL(rule.helpUrl), tags: strings(rule.tags),
    nodes: rule.nodes.map(node => ({
      target: target(node?.target), impact: impacts.has(node?.impact) ? node.impact : null
    }))
  }));
}
function cleanProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const {width, height} = value.viewport || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || height < 240) return null;
  if (!Array.isArray(value.tags) || !value.tags.length || value.scope !== 'document' || !text(value.browser, 100)
      || !Number.isFinite(value.settleMilliseconds) || value.settleMilliseconds < 0
      || value.policy !== 'public-read-v1' || !Number.isInteger(value.requestLimit) || value.requestLimit < 1) return null;
  return {viewport: {width, height}, tags: [...new Set(strings(value.tags))].sort(), scope: 'document',
    settleMilliseconds: value.settleMilliseconds, browser: text(value.browser, 100), policy: value.policy, requestLimit: value.requestLimit};
}
export function normalizeReceipt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose an Access Receipt or standard axe-core JSON report.');
  let raw = input;
  if (input.format !== FORMAT) {
    if (!Array.isArray(input.violations) || !Array.isArray(input.incomplete) || input.testEngine?.name !== 'axe-core' || !safeURL(input.url)) {
      throw new Error('Unrecognized report. Expected an Access Receipt or axe-core results with violations, incomplete, testEngine and url.');
    }
    raw = {format: FORMAT, capturedAt: input.timestamp, engine: input.testEngine, profile: null, importedRaw: true,
      pages: [{requestedURL: input.url, finalURL: input.url, label: 'Imported axe report', status: 'success',
        scannedAt: input.timestamp, violations: input.violations, incomplete: input.incomplete,
        passedRules: Array.isArray(input.passes) ? input.passes.length : null,
        inapplicableRules: Array.isArray(input.inapplicable) ? input.inapplicable.length : null}]};
  }
  if (!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > 100) throw new Error('A receipt needs between 1 and 100 page records.');
  if (!raw.capturedAt || !Number.isFinite(Date.parse(raw.capturedAt))) throw new Error('The receipt is missing a valid capture date.');
  if (raw.engine?.name !== 'axe-core' || !text(raw.engine.version, 100)) throw new Error('The axe-core engine version is missing.');
  const urls = new Set();
  const pages = raw.pages.map(page => {
    const requestedURL = safeURL(page?.requestedURL);
    if (!requestedURL || urls.has(requestedURL)) throw new Error('Page URLs must be valid, unique public HTTP(S) URLs.');
    urls.add(requestedURL);
    const status = page.status === 'success' ? 'success' : 'error';
    if (status === 'success' && (!Array.isArray(page.violations) || !Array.isArray(page.incomplete) || !safeURL(page.finalURL))) throw new Error('A successful page needs a final URL and both violations and incomplete arrays.');
    return {requestedURL, finalURL: safeURL(page.finalURL), label: text(page.label || requestedURL, 250),
      status, scannedAt: text(page.scannedAt, 100), error: status === 'error' ? text(page.error || 'The page could not be checked.', 500) : '',
      network: page.network && typeof page.network === 'object' ? Object.fromEntries(['requests','blocked','failed'].map(key => [key, Number.isSafeInteger(page.network[key]) && page.network[key] >= 0 ? page.network[key] : 0])) : null,
      coverage: cleanCoverage(page.coverage),
      violations: status === 'success' ? cleanRules(page.violations) : [], incomplete: status === 'success' ? cleanRules(page.incomplete) : [],
      passedRules: Number.isInteger(page.passedRules) && page.passedRules >= 0 ? page.passedRules : null,
      inapplicableRules: Number.isInteger(page.inapplicableRules) && page.inapplicableRules >= 0 ? page.inapplicableRules : null};
  });
  return {format: FORMAT, capturedAt: new Date(raw.capturedAt).toISOString(),
    engine: {name: 'axe-core', version: text(raw.engine.version, 100)}, profile: cleanProfile(raw.profile),
    importedRaw: Boolean(raw.importedRaw), pages};
}
export function parseReceipt(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES) throw new Error('Choose a JSON report smaller than 8 MB.');
  let input;
  try { input = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  return normalizeReceipt(input);
}
export function findings(receipt, category = 'violations') {
  const rows = (receipt?.pages || []).filter(page => page.status === 'success').flatMap(page => page[category].flatMap(rule => {
    const nodes = rule.nodes.length ? rule.nodes : [{target: [], impact: rule.impact}];
    return nodes.map(node => ({page: page.requestedURL, label: page.label, rule: rule.id, help: rule.help,
      description: rule.description, helpUrl: rule.helpUrl, tags: rule.tags, impact: node.impact || rule.impact || 'unknown',
      target: node.target, category, key: JSON.stringify([page.requestedURL, rule.id, node.target])}));
  }));
  return [...new Map(rows.map(row => [row.key, row])).values()];
}
const uniqueRows = rows => [...new Map(rows.map(row => [row.key, row])).values()];
export function compareReceipts(current, previous) {
  const result = {introduced: [], resolved: [], unchanged: [], review: [], unassessed: [], comparablePages: []};
  if (!current || !previous) return {...result, reason: 'Choose two captures to compare.'};
  if (!current.profile || !previous.profile) return {...result, reason: 'A report is missing its complete check profile. View its findings individually; changes cannot be established.'};
  if (current.engine.version !== previous.engine.version || JSON.stringify(current.profile) !== JSON.stringify(previous.profile)) return {...result, reason: 'Engine version or check profile differs. These captures cannot establish introduced or resolved findings.'};
  const older = new Map(previous.pages.map(page => [page.requestedURL, page]));
  const newer = new Map(current.pages.map(page => [page.requestedURL, page]));
  for (const url of new Set([...older.keys(), ...newer.keys()])) {
    const a = newer.get(url), b = older.get(url);
    if (!a || !b || a.status !== 'success' || b.status !== 'success' || a.finalURL !== b.finalURL
        || a.coverage?.status !== 'complete' || b.coverage?.status !== 'complete') {
      result.unassessed.push(url); continue;
    }
    result.comparablePages.push(url);
  }
  const scope = new Set(result.comparablePages);
  const a = new Map(uniqueRows(findings(current)).filter(row => scope.has(row.page)).map(row => [row.key, row]));
  const b = new Map(uniqueRows(findings(previous)).filter(row => scope.has(row.page)).map(row => [row.key, row]));
  const unsure = new Set(findings(current, 'incomplete').map(row => row.key));
  for (const [key, row] of a) (b.has(key) ? result.unchanged : result.introduced).push(row);
  for (const [key, row] of b) if (!a.has(key)) (unsure.has(key) ? result.review : result.resolved).push(row);
  result.reason = result.comparablePages.length ? '' : 'No page has matching requested/final URLs and confirmed read-resource coverage in both captures. Failed, degraded or older unknown-coverage pages cannot establish changes.';
  return result;
}
export function receiptSummary(receipt) {
  return {pages: receipt.pages.length, checked: receipt.pages.filter(p => p.status === 'success').length,
    violations: uniqueRows(findings(receipt)).length, review: uniqueRows(findings(receipt, 'incomplete')).length,
    rules: new Set(findings(receipt).map(row => row.rule)).size};
}
export function findingsCSV(rows) {
  const cell = value => {
    let v = String(value ?? '');
    if (/^[\s]*[=+@\-\t\r]/.test(v)) v = `'${v}`;
    return `"${v.replaceAll('"', '""')}"`;
  };
  return [['Page','Rule','Impact','Finding','Target','Tags','Guidance','Comparison'], ...rows.map(r => [r.page,r.rule,r.impact,r.help,JSON.stringify(r.target),r.tags.join(' '),r.helpUrl,r.change || ''])].map(row => row.map(cell).join(',')).join('\r\n');
}
