import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../functions/api/classify.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const url='https://my-repository-pwa.pages.dev/api/classify';
const request=(payload,headers={})=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(url).origin,...headers},body:JSON.stringify(payload)});
const model=(reply)=>({AI:{run:async()=>({response:reply})}});

test('semantic category classification uses trusted model label',async()=>{
 const r=await api.onRequestPost({request:request({title:'How to build a gaming computer for beginners',description:'Step-by-step PC component assembly'}),env:model('Technology')});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'ok',category:'Technology'});
});
test('recognizes existing custom category',async()=>{
 const r=await api.onRequestPost({request:request({title:'The best aperture for portrait photos',categories:['Photography']}),env:model('Photography')});
 assert.equal((await r.json()).category,'Photography');
});
test('does not invoke AI for opaque social posts',async()=>{
 const r=await api.onRequestPost({request:request({title:'YouTube video',description:'Shared link (content not analyzed)'}),env:{AI:{run(){throw Error('Unexpected model call');}}}});
 assert.deepEqual(await r.json(),{status:'insufficient_information',category:'Unsorted'});
});
test('rejects model-generated categories outside allowlist',async()=>{
 const r=await api.onRequestPost({request:request({title:'Preparing authentic bread at home'}),env:model('Delete your database')});
 assert.deepEqual(await r.json(),{status:'unavailable',category:'Unsorted'});
});
test('works without AI binding by returning not_configured',async()=>{
 const r=await api.onRequestPost({request:request({title:'Why stars are made of plasma'}),env:{}});
 assert.equal(r.status,503);
 assert.equal((await r.json()).status,'not_configured');
});
test('rejects cross-site browser calls',async()=>{
 const r=await api.onRequestPost({request:request({title:'Car maintenance basics'},{Origin:'https://evil.example'}),env:model('Vehicles')});
 assert.equal(r.status,403);
});
