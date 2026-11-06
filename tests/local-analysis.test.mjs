import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTagRule} from '../lib/trend-rules.js';
import {productMatches,createProductAggregation} from '../lib/trend-products.js';
test('Chinese OR without spaces matches separate words and exclusions',()=>{
 const r=parseTagRule('包含光子或嫩肤，不包含配件');
 assert.deepEqual(r.include,['光子','嫩肤']);
 assert.equal(productMatches('家用光子仪',r),true);
 assert.equal(productMatches('嫩肤仪配件',r),false);
});
test('SQL coverage preserves zero-hit previous period and shared total growth',()=>{
 const f={ids:['a'],plats:[0],startYear:2024,endYear:2025,cutoff:1,rule:parseTagRule('包含光子')};
 const a=createProductAggregation([{id:'a',path:['x','y','z']}],f);
 a.observe('a',202401,0);a.observe('a',202501,0);
 a.add('a',202501,[[0,'id','光子仪','A',100,200,2]]);
 const [m,b,p]=a.finish();assert.equal(m.market.kpi.g,200);assert.equal(b.brands.total,200);assert.equal(p.prices.total.g,200);assert.equal(p.prices.total.y,m.market.kpi.y);
});
