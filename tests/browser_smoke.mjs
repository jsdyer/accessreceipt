// CI-only browser verification. Synthetic inputs are never published in web/data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {receipt,rule} from './fixtures.mjs';
if (!process.env.CI) throw new Error('Browser checks run in GitHub Actions only.');
const root=path.resolve('dist');
const require=createRequire(import.meta.url);
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if (!target.startsWith(root+path.sep)) throw new Error('Invalid path');
    const body=await fs.readFile(target);
    res.setHeader('Content-Type',target.endsWith('.mjs')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.json')?'application/json':'text/html');res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
await fs.mkdir('browser-checks',{recursive:true});
const browser=await chromium.launch();
try {
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const page=await browser.newPage({viewport:{width,height}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const previous=receipt({date:'2026-01-01',violations:[rule('color-contrast','#old'),rule('label','#field')]});
    const latest=receipt({date:'2026-01-02',violations:[rule('label','#field'),rule('button-name','#new')],incomplete:[rule('landmark-one-main','main','moderate')]});
    await page.route('**/data/index.json',route=>route.fulfill({json:{captures:[{path:'captures/current.json',capturedAt:latest.capturedAt},{path:'captures/previous.json',capturedAt:previous.capturedAt}]}}));
    await page.route('**/data/captures/current.json',route=>route.fulfill({json:latest}));
    await page.route('**/data/captures/previous.json',route=>route.fulfill({json:previous}));
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#loaded').waitFor({state:'visible'});
    assert.equal(await page.locator('#violations').textContent(),'2');
    assert.equal(await page.locator('#capture').inputValue(),'captures/current.json');
    assert.ok((await page.locator('#capture').boundingBox()).y < height);
    assert.ok((await page.locator('#violations').boundingBox()).y < height);
    assert.match(await page.locator('#summary-explanation').textContent(), /2 flagged element locations across 2 rule types/);
    assert.match(await page.locator('#summary-explanation').textContent(), /not confirmed failures/);
    await page.locator('#baseline').selectOption('captures/previous.json');
    await page.waitForFunction(()=>document.getElementById('tab-changes').getAttribute('aria-pressed')==='true');
    await page.getByText('Introduced',{exact:true}).waitFor();
    assert.equal(await page.locator('#finding-list .finding-card').count(),2);
    await page.locator('#search').fill('button');assert.equal(await page.locator('#finding-list .finding-card').count(),1);
    await page.locator('#search').fill('');
    await page.getByRole('button',{name:'Needs review',exact:true}).click();assert.equal(await page.locator('#finding-list .finding-card').count(),1);
    await page.getByRole('button',{name:'Findings',exact:true}).click();
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const accessibility=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}));
    assert.deepEqual(accessibility.violations.map(finding=>({id:finding.id,impact:finding.impact,targets:finding.nodes.map(node=>node.target)})),[],`The ${name} viewer has no automated WCAG A/AA findings`);
    await page.screenshot({path:`browser-checks/${name}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    const download=page.waitForEvent('download');await page.locator('#save-json').click();assert.match((await download).suggestedFilename(),/access-receipt/);
    const hostile=receipt({date:'2026-01-03',violations:[{...rule(),help:'<img src=x onerror=alert(1)>',helpUrl:'javascript:alert(1)'}]});
    await page.locator('#import-file').setInputFiles({name:'receipt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(hostile))});
    await page.getByRole('heading',{name:'<img src=x onerror=alert(1)>'}).waitFor();assert.equal(await page.locator('.finding-card img').count(),0);
    await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});
    await page.getByText(/not valid JSON/).waitFor();assert.equal(await page.locator('#violations').textContent(),'1');
    assert.deepEqual(errors,[]);await page.close();
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
