import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const {filter:f,result:r}=JSON.parse(fs.readFileSync('.cache/local-verified-model.json'));
const manifest=JSON.parse(fs.readFileSync('data/manifest.json'));
const industry=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/'+manifest.industry)));
const dom=new JSDOM('<main></main>',{url:'http://127.0.0.1:8765/#trends'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location});
let blob;URL.createObjectURL=b=>(blob=b,'blob:test');dom.window.HTMLAnchorElement.prototype.click=()=>{};
globalThis.Worker=class{postMessage(m){if(m.type==='generate')queueMicrotask(()=>{for(const k of ['market','brands','prices'])this.onmessage({data:{id:m.id,[k]:r[k]}});});}terminate(){}};
const {mountTrends,cancelTrends}=await import('../lib/trend-view.js');
mountTrends({element:document.querySelector('main'),industry,manifest,ids:f.ids,plats:f.plats,isCurrent:()=>true});
const input=document.querySelector('#tag-description');input.value=f.rule.text;input.dispatchEvent(new dom.window.Event('input'));
document.querySelector('#tag-confirm').click();document.querySelector('#trend-generate').click();await new Promise(r=>setTimeout(r,10));
assert.equal(document.querySelector('#trend-status').dataset.ready,'true');
const checks={kpis:r.market.kpi.g,prices:r.prices.total.g,competition:r.brands.top[0].g,products:r.market.productInfo.top[0].g};
for(const [key,value] of Object.entries(checks)){
 document.querySelector(`[data-trend-download="${key}"][data-format="csv"]`).click();
 const csv=await blob.text();assert.ok(csv.includes(String(value)),key+' raw number');assert.ok(csv.includes(r.market.productInfo.queryVersion),'same query version');fs.writeFileSync('.cache/local-'+key+'.csv',csv);
}
document.querySelector('[data-trend-download="channels"][data-format="xlsx"]').click();
const excel=Buffer.from(await blob.arrayBuffer());fs.writeFileSync('.cache/local-channels.xlsx',excel);assert.ok(excel.includes(Buffer.from('<c:barChart>')));assert.ok(excel.includes(Buffer.from('<c:lineChart>')));
document.querySelector('#trend-end').value='2025';document.querySelector('#trend-end').dispatchEvent(new dom.window.Event('change'));
assert.equal(document.querySelector('#trend-start').value,'2023');assert.equal(document.querySelector('#trend-status').dataset.ready,'false');assert.equal(document.querySelector('#trend-results').children.length,0);
console.log('Real SQL result -> rendered market/brands/prices/products -> numeric CSV + native-chart XLSX verified; year change clears stale results.');cancelTrends();dom.window.close();
