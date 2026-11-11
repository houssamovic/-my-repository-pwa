import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../functions/api/metadata.js',import.meta.url),'utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('uses structured data when the social metadata is absent',()=>{
  const html='<html><head><title>Publisher</title><script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"Publisher"},{"@type":"HowTo","name":"Repair drywall","description":"Step-by-step wall patching guide."}]}</script></head></html>';
  assert.deepEqual(mod.parseMetadata(html),{title:'Repair drywall',description:'Step-by-step wall patching guide.'});
});
test('keeps useful OG fields and filters generic social login pages',()=>{
  assert.deepEqual(mod.parseMetadata('<meta property="og:title" content="Installing floating shelves - YouTube"><meta property="og:description" content="Step by step instructions">'),{title:'Installing floating shelves',description:'Step by step instructions'});
  assert.deepEqual(mod.parseMetadata('<title>Instagram</title><meta name="description" content="Log in to see photos and videos from friends">'),{title:'',description:''});
});
test('accepts only real YouTube hosts and recognized video identifiers',()=>{
  assert.equal(mod.youtubeVideoUrl('https://youtube.com.evil.example/shorts/abcdefghijk'),'');
  assert.equal(mod.youtubeVideoUrl('https://youtu.be/abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
});
test('YouTube title fallback never invents video descriptions',async()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async url=>String(url).includes('/oembed?')
      ? new Response(JSON.stringify({provider_name:'YouTube',title:'How to grow tomatoes'}),{headers:{'content-type':'application/json'}})
      : new Response('',{status:403,headers:{'content-type':'text/html'}});
    const req=new Request('https://my-repository-pwa.pages.dev/api/metadata?url='+encodeURIComponent('https://youtube.com/shorts/abcdefghijk'));
    assert.deepEqual(await (await mod.onRequestGet({request:req})).json(),{status:'ok',title:'How to grow tomatoes',description:''});
  } finally {globalThis.fetch=previous;}
});
