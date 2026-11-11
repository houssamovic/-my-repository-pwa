import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../functions/api/metadata.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const link='https://www.youtube.com/shorts/abcdefghijk';
const req=(diagnostic=false)=>({request:new Request('https://my-repository-pwa.pages.dev/api/metadata?'+new URLSearchParams({url:link,...(diagnostic?{diagnostic:'1'}:{})}))});
const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
test.after(()=>{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;});
test('returns public creator-written description, and only adds diagnostics when requested',async()=>{
  globalThis.caches=undefined;
  globalThis.fetch=async()=>new Response(JSON.stringify({items:[{id:'abcdefghijk',snippet:{title:'Refinishing a wooden table',description:'Step-by-step refinishing instructions with sanding and sealing.'}}]}),{headers:{'Content-Type':'application/json'}});
  const result=await (await api.onRequestGet({...req(true),env:{YOUTUBE_API_KEY:'dummy-test-key'}})).json();
  assert.deepEqual(result,{status:'ok',title:'Refinishing a wooden table',description:'Step-by-step refinishing instructions with sanding and sealing.',diagnostic:{youtubeApi:'ok',source:'youtube_data_api'}});
  const standard=await (await api.onRequestGet({...req(false),env:{YOUTUBE_API_KEY:'dummy-test-key'}})).json();
  assert.deepEqual(standard,{status:'ok',title:'Refinishing a wooden table',description:'Step-by-step refinishing instructions with sanding and sealing.'});
});
test('diagnoses missing production API secret without revealing credentials',async()=>{
  globalThis.caches=undefined;
  globalThis.fetch=async(url)=>String(url).includes('oembed?')?
    new Response(JSON.stringify({provider_name:'YouTube',title:'Fitting cabinet hinges'}),{headers:{'content-type':'application/json'}}):
    new Response('',{status:403});
  const result=await (await api.onRequestGet({...req(true),env:{}})).json();
  assert.equal(result.diagnostic.youtubeApi,'not_configured');
  assert.equal(result.diagnostic.source,'youtube_oembed');
  assert.equal(result.description,'');
});
test('diagnoses Google 403 rejection without returning raw Google errors or key',async()=>{
  globalThis.caches=undefined;
  globalThis.fetch=async(url)=>String(url).includes('googleapis.com')?
    new Response(JSON.stringify({error:{message:'Blocked dummy-test-key'}}),{status:403,headers:{'content-type':'application/json'}}):
    new Response('',{status:403});
  const response=await api.onRequestGet({...req(true),env:{YOUTUBE_API_KEY:'dummy-test-key'}});
  const result=await response.json();
  assert.equal(result.diagnostic.youtubeApi,'rejected_or_quota');
  assert.equal(JSON.stringify(result).includes('dummy-test-key'),false);
});
test('distinguishes missing creator description from API connectivity failure',async()=>{
  globalThis.caches=undefined;
  globalThis.fetch=async()=>new Response(JSON.stringify({items:[{id:'abcdefghijk',snippet:{title:'A brief musical performance',description:''}}]}),{headers:{'content-type':'application/json'}});
  const result=await (await api.onRequestGet({...req(true),env:{YOUTUBE_API_KEY:'dummy-test-key'}})).json();
  assert.equal(result.status,'ok');
  assert.equal(result.description,'');
  assert.equal(result.diagnostic.youtubeApi,'creator_description_empty');
});
test('client exposes refresh for categorized links and preserves original categories',()=>{
  const js=fs.readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  assert.match(html,/id="refresh-descriptions-button"/);
  assert.match(js,/pendingYouTubeDescriptions\(currentCategory\)/);
  assert.match(js,/e\.category===category && youtubeLink\(e\.url\)/);
  assert.match(js,/latest\.description=received/);
  assert.match(js,/if\(latest\.category==='Unsorted'&&!latest\.manualCategory\)/);
});
