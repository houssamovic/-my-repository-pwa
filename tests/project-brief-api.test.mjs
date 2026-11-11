import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../functions/api/project-brief.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const example={mode:'brief',title:'Repair drywall',purpose:'Fix a small hole on Saturday',
  date:'2026-11-14',links:[{title:'How to repair drywall holes',description:'A patch, putty knife and sanding are discussed.',note:'I have never tried this',rating:9}]};
const makeRequest=(body=example,headers={})=>new Request('https://my-repository-pwa.pages.dev/api/project-brief',{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)
});

test('preparation brief grounded in a selected source, no URL transfer',async()=>{
  let sent='';
  const env={AI:{run:async(model,payload)=>{
    sent=JSON.stringify(payload);
    assert.equal(model,'@cf/google/gemma-4-26b-a4b-it');
    return {choices:[{message:{content:JSON.stringify({
      summary:'Check the hole size before choosing a patch.',
      tools:['Putty knife (mentioned by source)'],
      steps:['Examine the wall'],
      questions:['What is the hole diameter?'],
      limitations:['Source excerpt may omit important steps']
    })}}]};
  }}};
  const response=await api.onRequestPost({request:makeRequest(example),env});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.status,'ok');
  assert.equal(result.summary,'Check the hole size before choosing a patch.');
  assert.equal(result.sourceCount,1);
  assert.match(sent,/do not claim to have watched/i);
  assert.ok(!sent.includes('https://'));
});
test('relevance mode uses a single source and returns a brief statement',async()=>{
  const env={AI:{run:async()=>({choices:[{message:{content:JSON.stringify({relevance:'This source explains a possible mesh-patch technique, but size requirements need checking.'})}}]})}};
  const response=await api.onRequestPost({request:makeRequest({...example,mode:'relevance'}),env});
  const result=await response.json();
  assert.equal(result.status,'ok');
  assert.match(result.relevance,/size requirements/);
  assert.equal(result.summary,undefined);
});
test('reject cross-origin requests and unsupported model binding',async()=>{
  const forbidden=await api.onRequestPost({request:makeRequest(example,{origin:'https://malicious.example'}),env:{AI:{run:async()=>({})}}});
  assert.equal(forbidden.status,403);
  const missing=await api.onRequestPost({request:makeRequest(example),env:{}});
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).status,'not_configured');
});
test('enforce input limits and reject unsupported AI output',async()=>{
  const tooBig={...example,purpose:'a'.repeat(15000)};
  const tooBigResponse=await api.onRequestPost({request:makeRequest(tooBig),env:{AI:{run:async()=>({})}}});
  assert.equal(tooBigResponse.status,413);
  const invalid=await api.onRequestPost({request:makeRequest(example),env:{AI:{run:async()=>({response:'I cannot format this'})}}});
  assert.equal(invalid.status,502);
  assert.equal((await invalid.json()).status,'invalid_ai_response');
});
test('only twelve public source excerpts sent to AI, trims lengths and strips unknown fields',()=>{
  const prepared=api.__test.prepare({...example,links:Array.from({length:20},(_,i)=>({
    title:'Title '+i,description:'z'.repeat(1000),note:'n'.repeat(1000),
    url:'https://secret.example/private',recoveryCode:'private'
  }))});
  assert.equal(prepared.links.length,12);
  assert.equal(prepared.links[0].description.length,420);
  assert.equal(prepared.links[0].note.length,100);
  assert.equal(prepared.links[0].url,undefined);
  assert.equal(prepared.links[0].recoveryCode,undefined);
});
