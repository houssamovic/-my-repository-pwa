import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../functions/api/metadata.js',import.meta.url),'utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=url=>({request:new Request('https://my-repository-pwa.pages.dev/api/metadata?url='+encodeURIComponent(url))});

test('YouTube Shorts official API enriches title and description without leaking secret in response',async()=>{
  const savedFetch=globalThis.fetch;
  const savedCaches=globalThis.caches;
  const calls=[];
  try{
    globalThis.caches=undefined;
    globalThis.fetch=async(url)=>{
      calls.push(String(url));
      if(String(url).startsWith('https://www.googleapis.com/youtube/v3/videos'))return new Response(JSON.stringify({
        items:[{id:'abcdefghijk',snippet:{title:'How to install floating shelves',description:'Use a level and a stud finder to mount strong brackets.'}}]
      }),{headers:{'content-type':'application/json'}});
      throw Error('Watch HTML should not be fetched when API returns data');
    };
    const output=await mod.onRequestGet({...request('https://www.youtube.com/shorts/abcdefghijk?feature=share'),env:{YOUTUBE_API_KEY:'private-test-api-key'}});
    assert.equal(output.status,200);
    assert.deepEqual(await output.json(),{status:'ok',title:'How to install floating shelves',description:'Use a level and a stud finder to mount strong brackets.'});
    assert.equal(calls.length,1);
    assert.match(calls[0],/part=snippet/);
    assert.match(calls[0],/key=private-test-api-key/);
  }finally{globalThis.fetch=savedFetch;globalThis.caches=savedCaches;}
});
test('API errors fall back to public YouTube oEmbed title without inventing a description',async()=>{
  const savedFetch=globalThis.fetch;
  const savedCaches=globalThis.caches;
  try{
    globalThis.caches=undefined;
    globalThis.fetch=async(url)=>{
      if(String(url).includes('googleapis.com'))return new Response('',{status:429});
      if(String(url).includes('/oembed?'))return new Response(JSON.stringify({provider_name:'YouTube',title:'How to care for orchids'}),{headers:{'content-type':'application/json'}});
      return new Response('',{status:403,headers:{'content-type':'text/html'}});
    };
    const out=await mod.onRequestGet({...request('https://youtu.be/abcdefghijk'),env:{YOUTUBE_API_KEY:'private-test-api-key'}});
    assert.deepEqual(await out.json(),{status:'ok',title:'How to care for orchids',description:''});
  }finally{globalThis.fetch=savedFetch;globalThis.caches=savedCaches;}
});
test('Without a configured key Repository never contacts YouTube Data API',async()=>{
  const savedFetch=globalThis.fetch;const savedCaches=globalThis.caches;
  const calls=[];
  try{
    globalThis.caches=undefined;
    globalThis.fetch=async(url)=>{
      calls.push(String(url));
      if(String(url).includes('/oembed?'))return new Response(JSON.stringify({provider_name:'YouTube',title:'Repair a leaky kitchen faucet'}),{headers:{'content-type':'application/json'}});
      return new Response('',{status:403,headers:{'content-type':'text/html'}});
    };
    const out=await mod.onRequestGet({...request('https://youtube.com/watch?v=abcdefghijk'),env:{}});
    assert.deepEqual(await out.json(),{status:'ok',title:'Repair a leaky kitchen faucet',description:''});
    assert.equal(calls.some(x=>x.includes('googleapis.com')),false);
  }finally{globalThis.fetch=savedFetch;globalThis.caches=savedCaches;}
});
test('Does not send arbitrary or malicious hosts to YouTube API',async()=>{
  assert.equal(mod.youtubeVideoUrl('https://youtube.com.evil.example/shorts/abcdefghijk'),'');
  assert.equal(mod.youtubeVideoUrl('https://www.youtube.com/shorts/abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(mod.youtubeVideoUrl('https://m.youtube.com/watch?v=abcdefghijk'),'https://www.youtube.com/watch?v=abcdefghijk');
});
