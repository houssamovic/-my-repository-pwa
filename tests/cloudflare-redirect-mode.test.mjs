import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../functions/api/metadata.js',import.meta.url),'utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const req=url=>({request:new Request('https://my-repository-pwa.pages.dev/api/metadata?url='+encodeURIComponent(url))});

test('Cloudflare supports only manual/follow redirects for public YouTube metadata requests',async()=>{
  const origFetch=globalThis.fetch,origCaches=globalThis.caches;
  try {
    globalThis.caches=undefined;
    const options=[];
    globalThis.fetch=async(url,init={})=>{
      options.push({url:String(url),redirect:init.redirect});
      // Mimic Cloudflare Workers: redirect:"error" is not implemented.
      if(init.redirect==='error')throw new TypeError('Invalid redirect mode');
      if(String(url).includes('googleapis.com')){
        return new Response(JSON.stringify({items:[{id:'abcdefghijk',snippet:{
          title:'How to build a wood planter',
          description:'Use basic tools and timber to create a planter.'
        }}]}),{headers:{'Content-Type':'application/json'}});
      }
      throw new Error('Unexpected remote request');
    };
    const result=await (await mod.onRequestGet({
      ...req('https://www.youtube.com/shorts/abcdefghijk'),
      env:{YOUTUBE_API_KEY:'dummy-test-key'}
    })).json();
    assert.equal(result.status,'ok');
    assert.equal(result.description,'Use basic tools and timber to create a planter.');
    assert.equal(options.length,1);
    assert.equal(options[0].redirect,'manual');
  } finally {globalThis.fetch=origFetch;globalThis.caches=origCaches;}
});

test('oEmbed title fallback uses supported Cloudflare redirect mode too',async()=>{
  const origFetch=globalThis.fetch;
  try {
    const calls=[];
    globalThis.fetch=async(url,init={})=>{
      calls.push({url:String(url),redirect:init.redirect});
      if(init.redirect==='error')throw new TypeError('Invalid redirect mode');
      if(String(url).includes('/oembed?')) {
        return new Response(JSON.stringify({provider_name:'YouTube',title:'How to care for a cactus'}),{
          headers:{'Content-Type':'application/json'}
        });
      }
      return new Response('Forbidden',{status:403,headers:{'Content-Type':'text/html'}});
    };
    const result=await (await mod.onRequestGet({...req('https://youtu.be/abcdefghijk'),env:{}})).json();
    assert.equal(result.title,'How to care for a cactus');
    assert.equal(result.description,'');
    assert.ok(calls.some(c=>c.url.includes('/oembed?')&&c.redirect==='manual'));
  } finally {globalThis.fetch=origFetch;}
});
