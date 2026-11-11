import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {onRequestPost,onRequestGet,onRequestPut} from '../functions/api/vault/[id].js';
const crypto=webcrypto;
class FakeDb {
  rows=new Map();
  prepare(query){const db=this;return {bind(...args){return {
    async run(){
      if(query.startsWith('INSERT')){
        if(db.rows.has(args[0]))throw Error('duplicate');
        db.rows.set(args[0],{auth_hash:args[1],iv:args[2],ciphertext:args[3],revision:1,updated_at:'today'});
        return {meta:{changes:1}};
      }
      if(query.startsWith('UPDATE')){
        const r=db.rows.get(args[2]);if(!r||r.revision!==args[3])return {meta:{changes:0}};
        Object.assign(r,{iv:args[0],ciphertext:args[1],revision:r.revision+1});return {meta:{changes:1}};
      }
    },
    async first(){return db.rows.get(args[0])||null;}
  };}};}
}
function code(size){return Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString('base64url');}
function req(method,endpoint,id,token,body){return new Request(`https://example.org/api/vault/${id}`,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
test('encrypted vault requires bearer token, blocks overwrites and never exposes plaintext',async()=>{
  const db=new FakeDb(),env={REPOSITORY_DB:db},id=code(16),token=code(32),iv=code(12),ciphertext=code(180);
  const context=(r)=>({request:r,params:{id},env});
  let r=await onRequestPost(context(req('POST','',id,token,{iv,ciphertext})));
  assert.equal(r.status,201);
  const row=db.rows.get(id);
  assert.ok(!JSON.stringify(row).includes(token));
  r=await onRequestGet(context(req('GET','',id,code(32))));assert.equal(r.status,401);
  r=await onRequestGet(context(req('GET','',id,token)));assert.equal(r.status,200);
  assert.deepEqual((await r.json()).revision,1);
  r=await onRequestPut(context(req('PUT','',id,token,{iv,ciphertext,revision:0})));assert.equal(r.status,400);
  r=await onRequestPut(context(req('PUT','',id,token,{iv,ciphertext,revision:1})));assert.equal(r.status,200);
  r=await onRequestPut(context(req('PUT','',id,token,{iv,ciphertext,revision:1})));assert.equal(r.status,409);
  r=await onRequestPost(context(req('POST','',id,token,{iv,ciphertext})));assert.equal(r.status,409);
});
test('fails closed if Cloudflare D1 is not configured',async()=>{
  const id=code(16),token=code(32);
  const r=await onRequestGet({request:req('GET','',id,token),params:{id},env:{}});
  assert.equal(r.status,503);
});
test('client-side encrypt and decrypt restore only with correct key',async()=>{
  const memory=new Map();const localStorage={getItem(k){return memory.get(k)||null;},setItem(k,v){memory.set(k,v);},removeItem(k){memory.delete(k);}};
  const db=new FakeDb(),env={REPOSITORY_DB:db};
  async function fetcher(url,options={}){
    if(url==='/api/vault/status')return new Response(JSON.stringify({available:true}),{status:200});
    const id=url.split('/').pop();const r=new Request('https://example.org'+url,options);const c={request:r,params:{id},env};
    if(options.method==='POST')return onRequestPost(c);
    if(options.method==='PUT')return onRequestPut(c);
    return onRequestGet(c);
  }
  const context=vm.createContext({localStorage,crypto,URL,TextEncoder,TextDecoder,fetch:fetcher,Uint8Array,atob,btoa,console});context.globalThis=context;
  vm.runInContext(fs.readFileSync(new URL('../site/cloud-vault.js',import.meta.url),'utf8'),context);
  const api=context.RepositoryVault;
  assert.equal(await api.status(),true);
  const data={version:1,items:[{url:'https://example.com/secret',title:'Private note',category:'DIY'}],categories:['DIY']};
  const recovery=await api.create(data);
  assert.match(recovery,/^rep1\.[\w-]{22}\.[\w-]{43}\.[\w-]{43}$/);
  assert.ok(!JSON.stringify([...db.rows.values()]).includes('Private note'));
  const loaded=await api.load(recovery);assert.equal(loaded.snapshot.items[0].title,'Private note');
  await api.backUp(data);assert.equal(api.currentRevision(),2);
  api.forget();assert.equal(api.recovery(),'');
  const again=await api.load(recovery);assert.equal(again.snapshot.items[0].category,'DIY');
});
