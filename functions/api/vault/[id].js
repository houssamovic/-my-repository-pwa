/**
 * Encrypted, accountless backup vault. A 128-bit random ID selects the vault;
 * a separate 256-bit bearer secret authorizes access, stored only as SHA-256.
 * The AES-GCM key never reaches this server. Without the recovery code, there
 * is no way to recover the collection. This is opt-in backup, not account sync.
 * The API does NOT expose plain links or accept credentials in URL parameters.
 */
const NO_CACHE = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const respond = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:NO_CACHE});
const valid = (s,len) => typeof s==='string' && s.length===len && /^[A-Za-z0-9_-]+$/.test(s);
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
async function hashSecret(s){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
function equals(a,b) {if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function encrypted(body){
  return body && valid(body.iv,16) && typeof body.ciphertext==='string' && body.ciphertext.length>=22 && body.ciphertext.length<=900000 && /^[A-Za-z0-9_-]+$/.test(body.ciphertext);
}
async function safeBody(request) {
  if(Number(request.headers.get('content-length')||0)>1_050_000)return null;
  const text=await request.text();
  if(text.length>1_050_000)return null;
  try{return JSON.parse(text);}catch{return null;}
}
function getToken(request){const h=request.headers.get('authorization')||'';const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(h);return m?.[1]||null;}
async function route({request,params,env}) {
  if(!env.REPOSITORY_DB)return respond({error:'Cloud backup has not been configured'},503);
  const id=params.id;
  const secret=getToken(request);
  if(!valid(id,22)||!secret)return respond({error:'Unauthorized'},401);
  const auth=await hashSecret(secret);
  if(request.method==='POST'){
    const body=await safeBody(request);
    if(!encrypted(body))return respond({error:'Invalid encrypted backup'},400);
    try{
      await env.REPOSITORY_DB.prepare('INSERT INTO vaults (id,auth_hash,iv,ciphertext) VALUES (?,?,?,?)')
        .bind(id,auth,body.iv,body.ciphertext).run();
      return respond({revision:1},201);
    }catch{return respond({error:'Vault already exists or database unavailable'},409);}
  }
  const vault=await env.REPOSITORY_DB.prepare('SELECT auth_hash,iv,ciphertext,revision,updated_at FROM vaults WHERE id=?').bind(id).first();
  // Don't expose whether the vault ID exists.
  if(!vault||!equals(String(vault.auth_hash),auth))return respond({error:'Unauthorized'},401);
  if(request.method==='GET') return respond({iv:vault.iv,ciphertext:vault.ciphertext,revision:vault.revision,updated_at:vault.updated_at});
  if(request.method==='PUT') {
    const body=await safeBody(request);
    if(!encrypted(body)||!Number.isSafeInteger(body.revision)||body.revision<1)return respond({error:'Invalid encrypted backup'},400);
    if(body.revision!==vault.revision)return respond({error:'Backup changed on another device. Restore or merge before uploading.'},409);
    const result=await env.REPOSITORY_DB.prepare("UPDATE vaults SET iv=?,ciphertext=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?")
      .bind(body.iv,body.ciphertext,id,body.revision).run();
    if(!result.meta?.changes)return respond({error:'Concurrent backup update'},409);
    return respond({revision:body.revision+1});
  }
  return respond({error:'Method not allowed'},405);
}
export const onRequestGet=route;
export const onRequestPost=route;
export const onRequestPut=route;
