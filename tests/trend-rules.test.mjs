import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTagRule,describeRule,mountRules} from '../lib/trend-rules.js';
import {JSDOM} from 'jsdom';
test('reviewable tag parser preserves AND, OR, exclusions and rejects ambiguity',()=>{
 const r=parseTagRule('同时包含 吹风机、红光，但不包含配件');
 assert.deepEqual(r.include,['吹风机','红光']);assert.deepEqual(r.exclude,['配件']);assert.equal(r.mode,'all');
 assert.match(describeRule(r),/同时包含「吹风机、红光」/);
 assert.equal(parseTagRule('任一包含次抛精华、精华液，不含水光').mode,'any');
 assert.throws(()=>parseTagRule('包含红光，不含红光'));
 assert.throws(()=>parseTagRule('价格大于500的红光吹风机'));
});
test('rule edits remain drafts until confirmation and can be cleared',()=>{
 const dom=new JSDOM('<div id="rules"></div>');const host=dom.window.document.getElementById('rules'),state={};let changes=0;
 mountRules(host,state,()=>changes++);const input=host.querySelector('textarea');
 input.value='同时包含吹风机、红光，但不包含配件';input.dispatchEvent(new dom.window.Event('input'));
 assert.equal(state.confirmedRule,undefined);host.querySelector('#tag-confirm').click();assert.equal(state.confirmedRule.mode,'all');assert.match(host.textContent,/按商品名称筛选/);
 input.value='包含红光';input.dispatchEvent(new dom.window.Event('input'));assert.notEqual(state.ruleDraft,state.confirmedRule.text);
 host.querySelector('#tag-clear').click();assert.equal(state.confirmedRule,null);assert.equal(state.ruleDraft,'');assert.equal(changes,4);dom.window.close();
});
