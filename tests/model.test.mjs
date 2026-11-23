import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT,normalizeReceipt,parseReceipt,compareReceipts,findings,findingsCSV,safeURL,receiptSummary} from '../web/model.mjs';
import {receipt,rule} from './fixtures.mjs';

test('only compatible successful scopes establish introduced and resolved findings', () => {
  const before = receipt({date:'2026-01-01',violations:[rule('a','#old'),rule('b','#same')]});
  const after = receipt({violations:[rule('b','#same'),rule('c','#new')]});
  const diff = compareReceipts(after,before);
  assert.deepEqual(diff.introduced.map(r=>r.rule),['c']);
  assert.deepEqual(diff.resolved.map(r=>r.rule),['a']);
  assert.equal(diff.unchanged.length,1); assert.equal(diff.comparablePages.length,1);
});
test('engine, viewport, rules, browser and unknown profile changes block comparisons', () => {
  const before=receipt();
  for (const after of [receipt({engine:'4.15.0'}),receipt({profile:null}),
    receipt({profile:{...before.profile,viewport:{width:390,height:900}}}),receipt({profile:{...before.profile,tags:['wcag2a']}}),
    receipt({profile:{...before.profile,browser:'Chromium another'}})]) {
    assert.ok(compareReceipts(after,before).reason); assert.equal(compareReceipts(after,before).resolved.length,0);
  }
});
test('missing, failed and redirected pages never imply resolution', () => {
  const before=receipt();
  for (const patch of [{status:'error'}, {finalURL:'https://example.com/other'}, {requestedURL:'https://other.example.com/'}]) {
    const after=receipt({pages:[{...before.pages[0],violations:[],...patch}]});
    const diff=compareReceipts(after,before); assert.equal(diff.resolved.length,0); assert.ok(diff.unassessed.length);
  }
});
test('previous violation becoming incomplete needs review, not resolved', () => {
  const before=receipt(); const after=receipt({violations:[],incomplete:[rule()]});
  const diff=compareReceipts(after,before); assert.equal(diff.review.length,1); assert.equal(diff.resolved.length,0);
});
test('a partial capture compares only successful common pages', () => {
  const good=receipt().pages[0]; const second={...good,requestedURL:'https://example.org/',finalURL:'https://example.org/'};
  const before=receipt({pages:[good,second]}); const after=receipt({pages:[{...good,violations:[]},{...second,status:'error'}]});
  const diff=compareReceipts(after,before); assert.equal(diff.resolved.length,1); assert.equal(diff.unassessed.length,1);
});
test('sanitization strips HTML, check data and unknown top-level fields', () => {
  const clean=normalizeReceipt({...receipt(),pages:[{...receipt().pages[0],violations:[rule()]}],secret:'sensitive'});
  const json=JSON.stringify(clean); assert.ok(!json.includes('private')); assert.ok(!json.includes('secret')); assert.ok(!json.includes('"html"')); assert.ok(!json.includes('"any"'));
});
test('raw axe reports retain findings but do not invent a comparison profile', () => {
  const raw={testEngine:{name:'axe-core',version:'4.14.1'},timestamp:'2026-01-01',url:'https://example.com/',violations:[rule()],incomplete:[],passes:[],inapplicable:[]};
  const imported=parseReceipt(JSON.stringify(raw)); assert.equal(imported.format,FORMAT); assert.equal(imported.profile,null);
  assert.equal(findings(imported).length,1); assert.ok(compareReceipts(receipt(),imported).reason);
});
test('malformed imports are rejected before replacing a current report', () => {
  for (const raw of ['{','null','[]','{}',JSON.stringify({...receipt(),capturedAt:'not-a-date'}),JSON.stringify({...receipt(),pages:[]}),JSON.stringify({...receipt(),pages:[...receipt().pages,...receipt().pages]})]) assert.throws(()=>parseReceipt(raw));
  const invalid=receipt(); invalid.pages[0].violations=null; assert.throws(()=>normalizeReceipt(invalid));
});
test('unsafe source URLs cannot become clickable report links', () => {
  assert.equal(safeURL('javascript:alert(1)'), ''); assert.equal(safeURL('https://user:pass@example.com/'), '');
  const raw=receipt();raw.pages[0].violations[0].helpUrl='javascript:alert(1)';assert.equal(normalizeReceipt(raw).pages[0].violations[0].helpUrl,'');
});
test('findings use stable target identities, counts deduplicate and CSV blocks spreadsheet formulas', () => {
  const value=receipt({violations:[rule(),rule()]});assert.equal(receiptSummary(value).violations,1);
  const rows=findings(value); rows[0].help='=HYPERLINK("https://example.com")';
  assert.ok(findingsCSV(rows).includes('"\'=HYPERLINK'));assert.ok(findingsCSV(rows).includes('""https://example.com""'));
});
test('raw successful reports cannot omit incomplete results', () => {
  assert.throws(()=>normalizeReceipt({testEngine:{name:'axe-core',version:'4.14.1'},timestamp:'2026-01-01',url:'https://example.com/',violations:[]}));
});
