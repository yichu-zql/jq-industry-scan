import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {parseTagRule} from '../lib/trend-rules.js';
import {createProductAggregation} from '../lib/trend-products.js';
const manifest=JSON.parse(fs.readFileSync('data/manifest.json'));
const industry=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/'+manifest.industry)));
const ids=industry.categories.filter(c=>c.path[1]==='美容仪器'||['美容修剪','医学美容','美容店设备'].includes(c.path[2])).map(c=>c.id);
const url=new URL('../lib/trend-worker.js',import.meta.url);
const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self=global;global.location={hostname:'127.0.0.1'};global.postMessage=m=>parentPort.postMessage(m);const nativeFetch=fetch;global.fetch=(u,o)=>nativeFetch(new URL(u,'http://127.0.0.1:8765'),o);import(${JSON.stringify(url.href)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
worker.postMessage({type:'init',industry,manifest});
let seq=0;
const run=f=>new Promise((resolve,reject)=>{
 const id=++seq,out={};const listener=m=>{if(m.id!==id)return;if(m.error){worker.off('message',listener);reject(Error(m.error));}for(const k of ['market','brands','prices'])if(m[k])out[k]=m[k];if(m.prices){worker.off('message',listener);resolve(out);}};
 worker.on('message',listener);worker.postMessage({type:'generate',id,filter:f});
});
const index=JSON.parse(fs.readFileSync('.cache/product-public/index.json'));
function direct(f){const a=createProductAggregation(industry.categories,f);for(const id of f.ids)for(const p of index.files[id]){const lo=(f.startYear-1)*100+1,hi=f.endYear*100+f.cutoff;if(p.last<lo||p.first>hi)continue;const d=JSON.parse(zlib.gunzipSync(fs.readFileSync('.cache/product-public/'+p.path)));const groups=new Map();for(const r of d.rows){if(r[0]<lo||r[0]>hi)continue;if(!groups.has(r[0]))groups.set(r[0],[]);groups.get(r[0]).push([r[1],...d.items[r[2]],...r.slice(3)]);}for(const [month,rows]of groups)a.add(id,month,rows);}return a.finish()[0].market;}
try {
 for(const [year,text,scope] of [[2024,'包含光子嫩肤',ids],[2025,'包含光子嫩肤',ids],[2026,'包含光子嫩肤',ids],[2026,'包含光子或嫩肤，不包含配件',ids],[2026,'包含不存在的测试商品xyz987',ids],[2026,'包含光子嫩肤',ids.slice(0,1)]]){
  const f={ids:scope,plats:[0,1,2],startYear:Math.max(2023,year-2),endYear:year,cutoff:9,rule:parseTagRule(text)};
  const t=Date.now(),r=await run(f),expected=direct(f);
  assert.ok(Math.abs(r.market.kpi.g-expected.kpi.g)<.01);assert.ok(Math.abs(r.brands.total-r.market.kpi.g)<.01);assert.ok(Math.abs(r.prices.total.g-r.market.kpi.g)<.01);assert.equal(r.prices.total.y,r.market.kpi.y);assert.equal(r.market.productInfo.products,expected.productInfo.products);
  if(year===2026 && text==='包含光子嫩肤' && scope.length===18) fs.writeFileSync('.cache/local-verified-model.json',JSON.stringify({filter:f,result:r}));
  console.log(JSON.stringify({year,rule:text,categories:scope.length,gmv:r.market.kpi.g,products:r.market.productInfo.products,ms:Date.now()-t}));
 }
}finally{await worker.terminate();}
