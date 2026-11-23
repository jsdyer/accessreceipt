import {parseReceipt, normalizeReceipt, findings, compareReceipts, receiptSummary, findingsCSV, MAX_IMPORT_BYTES} from './model.mjs';
const $ = id => document.getElementById(id);
const store = new Map();
let current = null, baseline = null, view = 'violations', visible = 60, selection = 0, currentId = '', baselineId = '';
const date = value => new Intl.DateTimeFormat('en-CA', {dateStyle:'medium', timeStyle:'short', timeZone:'UTC'}).format(new Date(value)) + ' UTC';
const el = (tag, content = '', className = '') => { const node = document.createElement(tag); node.textContent = content; if (className) node.className = className; return node; };
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function option(value, label) { const node = el('option', label); node.value = value; return node; }
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = el('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function captureOptions(selected = $('capture').value) {
  const entries = [...store.entries()].sort((a, b) => Date.parse(b[1].capturedAt) - Date.parse(a[1].capturedAt));
  $('capture').replaceChildren(...entries.map(([id, value]) => option(id, `${date(value.capturedAt)}${value.imported ? ' · imported' : ''}`)));
  if (store.has(selected)) $('capture').value = selected;
  baselineOptions();
}
function baselineOptions() {
  const previous = $('baseline').value;
  const chosen = store.get($('capture').value);
  $('baseline').replaceChildren(option('', 'No comparison'), ...[...store.entries()]
    .filter(([id, entry]) => id !== $('capture').value && Date.parse(entry.capturedAt) < Date.parse(chosen?.capturedAt || 0))
    .sort((a,b) => Date.parse(b[1].capturedAt) - Date.parse(a[1].capturedAt))
    .map(([id, entry]) => option(id, `${date(entry.capturedAt)}${entry.imported ? ' · imported' : ''}`)));
  if ([...$('baseline').options].some(item => item.value === previous)) $('baseline').value = previous;
}
async function load(id) {
  if (!id) return null;
  const entry = store.get(id);
  if (!entry) throw new Error('Capture was not found.');
  if (!entry.receipt) {
    const response = await fetch(`./data/${entry.path}`, {cache:'no-store'});
    if (!response.ok) throw new Error('The capture file is unavailable. Your previous view is unchanged.');
    const data = await response.text();
    entry.receipt = parseReceipt(data);
  }
  return entry.receipt;
}
async function selectCapture() {
  const token = ++selection;
  try {
    const next = await load($('capture').value);
    const previous = await load($('baseline').value);
    if (token !== selection) return;
    current = next; baseline = previous; visible = 60;
    currentId = $('capture').value; baselineId = $('baseline').value;
    render();
    if (current) status(`${store.get($('capture').value)?.imported ? 'Imported locally.' : 'Published capture loaded.'} ${receiptSummary(current).checked} of ${current.pages.length} pages checked. Imports are never uploaded.`);
  } catch (error) {
    if (token !== selection) return;
    if (currentId) { $('capture').value = currentId; baselineOptions(); $('baseline').value = baselineId; }
    status(error.message, true);
  }
}
function renderScope() {
  const filter = $('page-filter').value;
  $('page-filter').replaceChildren(option('', 'All pages'), ...current.pages.map(page => option(page.requestedURL, page.label)));
  if (current.pages.some(page => page.requestedURL === filter)) $('page-filter').value = filter;
  $('page-list').replaceChildren(...current.pages.map(page => {
    const card = el('div', '', 'page-card'); card.append(el('strong', page.label));
    const link = el('a', new URL(page.requestedURL).host + new URL(page.requestedURL).pathname); link.href = page.requestedURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
    card.append(el('span', page.status === 'success' ? '✓ Checked' : '— Unassessed', `page-state ${page.status === 'error' ? 'error' : ''}`));
    if (page.status === 'success') card.append(el('p', `${page.violations.length} rules with findings · ${page.incomplete.length} need review${page.passedRules !== null ? ` · ${page.passedRules} passed` : ''}`));
    else card.append(el('p', page.error));
    if (page.network?.blocked || page.network?.failed) card.append(el('p', `${page.network.blocked} blocked requests · ${page.network.failed} failed or HTTP-error responses. Some content may not have loaded.`));
    if (page.finalURL && page.finalURL !== page.requestedURL) card.append(el('p', `Final URL: ${page.finalURL}`));
    return card;
  }));
  const profile = current.profile;
  $('profile').textContent = profile ? `${profile.browser} · ${profile.viewport.width} × ${profile.viewport.height}px · rendered document · ${profile.settleMilliseconds}ms settle time · up to ${profile.requestLimit} read requests. Rule tags: ${profile.tags.join(', ')}.` : 'This imported report has no complete capture profile. Findings can be inspected, but introduced/resolved comparisons are unavailable.';
}
function render() {
  $('loaded').hidden = !current; $('empty').hidden = Boolean(current);
  $('save-json').disabled = !current; $('save-csv').disabled = !current;
  if (!current) return;
  const total = receiptSummary(current);
  $('checked').textContent = `${total.checked}/${total.pages}`; $('violations').textContent = total.violations;
  $('review').textContent = total.review; $('rules').textContent = total.rules;
  $('capture-meta').textContent = `Captured ${date(current.capturedAt)} · axe-core ${current.engine.version}`;
  renderScope(); renderFindings();
}
function getRows() {
  if (!current) return [];
  let rows;
  if (view === 'changes') {
    const comparison = compareReceipts(current, baseline);
    rows = [...comparison.introduced.map(r => ({...r, change:'Introduced'})), ...comparison.resolved.map(r => ({...r, change:'No longer observed'})), ...comparison.review.map(r => ({...r, change:'Now needs review'}))];
  } else rows = findings(current, view);
  const query = $('search').value.trim().toLowerCase(), page = $('page-filter').value, impact = $('impact-filter').value;
  return rows.filter(row => (!page || row.page === page) && (!impact || row.impact === impact) && (!query || [row.help,row.rule,row.description,JSON.stringify(row.target),row.label,...row.tags].join(' ').toLowerCase().includes(query)));
}
function rowCard(row) {
  const card = el('article', '', 'finding-card');
  if (row.change) card.append(el('span', row.change, `change-state ${row.change === 'Introduced' ? 'introduced' : ''}`));
  const top = el('div', '', 'finding-top'); top.append(el('h3', row.help || row.rule), el('span', row.impact, `impact ${row.impact}`)); card.append(top);
  card.append(el('p', `${row.label} · ${row.rule}`, 'location'));
  const selector = row.target.length ? row.target.map(part => Array.isArray(part) ? part.join(' → ') : part).join(' → ') : 'No element target supplied in this report.';
  card.append(el('code', selector));
  if (row.description) card.append(el('p', row.description, 'description'));
  const foot = el('div', '', 'finding-footer'), tags = el('div', '', 'tags');
  const relevant = row.tags.filter(tag => /^(wcag|best-practice|section508|EN-)/i.test(tag));
  for (const tag of relevant) tags.append(el('span', tag, 'tag'));
  foot.append(tags);
  if (row.helpUrl) { const help = el('a', 'Rule guidance ↗'); help.href = row.helpUrl; help.target = '_blank'; help.rel = 'noopener noreferrer'; foot.append(help); }
  card.append(foot); return card;
}
function renderFindings() {
  if (!current) return;
  for (const button of document.querySelectorAll('[data-view]')) { const active = button.dataset.view === view; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); }
  $('results-title').textContent = {violations:'What needs attention', incomplete:'A human should check', changes:'What changed between checks'}[view];
  const note = $('comparison-note'); note.hidden = view !== 'changes';
  if (view === 'changes') {
    const comparison = compareReceipts(current, baseline);
    note.textContent = comparison.reason || `${comparison.comparablePages.length} comparable pages · ${comparison.introduced.length} introduced · ${comparison.resolved.length} no longer observed · ${comparison.unchanged.length} still observed · ${comparison.review.length} now need review. ${comparison.unassessed.length ? `${comparison.unassessed.length} changed, missing or failed pages are unassessed. ` : ''}“No longer observed” means the earlier rule/selector pair was not found again, not that the page is accessible.`;
  }
  const rows = getRows();
  $('result-count').textContent = `${rows.length} locations`;
  $('finding-list').replaceChildren(...rows.slice(0, visible).map(rowCard));
  if (!rows.length) {
    const message = view === 'changes' ? 'No changes to show for this selection. Check the comparison explanation above.' : view === 'incomplete' ? 'No manual-review locations in this selection. Human testing is still needed to find barriers automated checks cannot detect.' : 'No automated findings in this selection. This is not a claim of accessibility conformance.';
    $('finding-list').append(el('p', message, 'none'));
  }
  $('show-more').hidden = rows.length <= visible;
  $('show-more').textContent = `Show more findings (${rows.length - visible} remaining)`;
}
$('capture').addEventListener('change', () => { baselineOptions(); selectCapture(); });
$('baseline').addEventListener('change', selectCapture);
for (const id of ['page-filter','impact-filter','search']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { visible = 60; renderFindings(); });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => { view = button.dataset.view; visible = 60; renderFindings(); });
$('show-more').addEventListener('click', () => { visible += 60; renderFindings(); });
$('save-json').addEventListener('click', () => { if (current) download(JSON.stringify(current,null,2), `access-receipt-${current.capturedAt.slice(0,10)}.json`, 'application/json'); });
$('save-csv').addEventListener('click', () => download(findingsCSV(getRows()), `access-receipt-${view}.csv`, 'text/csv;charset=utf-8'));
$('import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a JSON report smaller than 8 MB.');
    const receipt = parseReceipt(await file.text());
    const id = `import-${Date.now()}-${store.size}`;
    store.set(id, {capturedAt:receipt.capturedAt, receipt, imported:true});
    captureOptions(id); await selectCapture();
  } catch (error) { status(`${error.message} Your previous capture is unchanged.`, true); }
  finally { event.target.value = ''; }
});
async function init() {
  try {
    const response = await fetch('./data/index.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Published captures could not be loaded. You can still import your own JSON report.');
    const index = await response.json();
    if (!Array.isArray(index.captures)) throw new Error('The capture index could not be read. Import remains available.');
    for (const item of index.captures.slice(0,500)) if (/^captures\/[a-zA-Z0-9T._-]+\.json$/.test(item.path) && Number.isFinite(Date.parse(item.capturedAt))) store.set(item.path,item);
    if (store.size) { captureOptions(); await selectCapture(); }
    else { render(); status('No published capture yet. Import a report to start, or run the owner’s check.'); }
  } catch (error) { render(); status(error.message, true); }
}
init();
