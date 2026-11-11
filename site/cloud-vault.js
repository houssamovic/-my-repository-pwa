/** Opt-in encrypted backup. The server receives only ciphertext, IV and bearer
 * token, never a decryption key or plaintext links. Recovery code is private. */
((root)=>{
  'use strict';
  const STORE='repository-cloud-recovery-v1';
  const REV='repository-cloud-revision-v1';
  function bytes(count){const b=new Uint8Array(count);crypto.getRandomValues(b);return b;}
  function encode(b){let text='';for(let i=0;i<b.length;i+=8192)text+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
  function decode(text){const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  function parse(code){
    const parts=String(code||'').trim().split('.');
    if(parts.length!==4||parts[0]!=='rep1'||!/^[-_A-Za-z0-9]{22}$/.test(parts[1])||!/^[-_A-Za-z0-9]{43}$/.test(parts[2])||!/^[-_A-Za-z0-9]{43}$/.test(parts[3])) throw new Error('Invalid recovery code');
    const [id,token,key]=parts.slice(1);
    if(decode(id).length!==16||decode(token).length!==32||decode(key).length!==32)throw new Error('Invalid recovery code');
    return {id,token,key};
  }
  function recovery(){return localStorage.getItem(STORE)||'';}
  function forget(){localStorage.removeItem(STORE);localStorage.removeItem(REV);}
  function currentRevision(){const v=Number(localStorage.getItem(REV));return Number.isSafeInteger(v)&&v>0?v:null;}
  function remember(code,revision){parse(code);localStorage.setItem(STORE,code);localStorage.setItem(REV,String(revision));}
  async function seal(data,key){
    const iv=bytes(12);
    const cryptoKey=await crypto.subtle.importKey('raw',decode(key),{name:'AES-GCM'},false,['encrypt']);
    const serialized=new TextEncoder().encode(JSON.stringify(data));
    if(serialized.length>550000)throw new Error('Collection is too large for this prototype backup');
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,serialized);
    return {iv:encode(iv),ciphertext:encode(new Uint8Array(cipher))};
  }
  async function unseal(payload,key){
    const cryptoKey=await crypto.subtle.importKey('raw',decode(key),{name:'AES-GCM'},false,['decrypt']);
    let decoded;
    try{decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(payload.iv)},cryptoKey,decode(payload.ciphertext));}
    catch{throw new Error('Unable to decrypt backup. Check the recovery code.');}
    try{return JSON.parse(new TextDecoder().decode(decoded));}catch{throw new Error('Backup is not valid JSON');}
  }
  async function call(method,code,body){
    const {id,token}=parse(code);
    const response=await fetch('/api/vault/'+encodeURIComponent(id),{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    let result;try{result=await response.json();}catch{throw new Error('Cloud backup service is unavailable');}
    if(!response.ok)throw new Error(result.error||'Cloud backup request failed');
    return result;
  }
  async function status(){try{const r=await fetch('/api/vault/status',{cache:'no-store'});return r.ok&&(await r.json()).available===true;}catch{return false;}}
  async function create(snapshot){
    if(recovery())throw new Error('Disconnect the existing vault before creating another');
    const id=encode(bytes(16)),token=encode(bytes(32)),key=encode(bytes(32));
    const code=['rep1',id,token,key].join('.');
    const encrypted=await seal(snapshot,key);
    const result=await call('POST',code,encrypted);
    remember(code,result.revision);
    return code;
  }
  async function load(code){
    const provided=code||recovery();const data=await call('GET',provided);
    const {key}=parse(provided);
    return {snapshot:await unseal(data,key),revision:data.revision,code:provided};
  }
  async function backUp(snapshot){
    const code=recovery();if(!code)throw new Error('Create or connect a cloud vault first');
    const rev=currentRevision();if(!rev)throw new Error('Restore this vault before backing up');
    const encrypted=await seal(snapshot,parse(code).key);
    const response=await call('PUT',code,{...encrypted,revision:rev});
    remember(code,response.revision);
    return response.revision;
  }
  root.RepositoryVault=Object.freeze({status,create,load,backUp,remember,recovery,forget,currentRevision});
})(typeof globalThis==='undefined'?self:globalThis);
