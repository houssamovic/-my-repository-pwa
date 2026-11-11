/**
 * Cloudflare Pages Function: GET /api/metadata?url=https://...
 * Extracts publicly accessible HTML metadata. No AI inference or social login.
 * Input is untrusted: reject local and IP literal destinations, validate redirects,
 * cap response bytes, and return only sanitized title/description fields.
 */
const MAX_BYTES = 450_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6500;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

function validateUrl(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 2500) throw new Error('Invalid URL');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Unsupported port');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.length > 240 || /\s/.test(host)) throw new Error('Invalid hostname');
  // Disallow DNS-less hosts, IPv4/IPv6 literals, and private-domain conventions.
  if (/^\[|\]$/.test(host) || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) throw new Error('Private hostname');
  if (host === 'metadata.google.internal' || host.endsWith('.localhost')) throw new Error('Private hostname');
  return url;
}

function decodeEntities(value = '') {
  const names = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”'};
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return names[code.toLowerCase()] ?? m;
  });
}
function cleanText(value = '') {
  return decodeEntities(String(value).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).replace(/\s+/g,' ').trim();
}
function parseAttributes(markup) {
  const result = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of markup.matchAll(re)) result[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return result;
}
function genuine(value) {
  let v = cleanText(value);
  if (v.length < 5) return '';
  if (/^(?:instagram|youtube|facebook|twitter|tiktok|x|log in|sign in|access denied|just a moment|attention required)$/i.test(v)) return '';
  if (/^(?:instagram photos and videos|see instagram photos and videos|this content isn't available|login to instagram|instagram post|instagram reel|x post|join facebook|log into facebook|log in to facebook|sign in to x)/i.test(v)) return '';
  if (/^(?:create an account|log in to see|sign in to see|watch videos on tiktok|from breaking news and entertainment)/i.test(v)) return '';
  // Strip attribution only at the end. Don't remove meaningful subject words.
  v = v.replace(/\s+(?:[-|·]|—)\s+(?:YouTube|Instagram|Facebook|TikTok|X(?:\.com)?|Twitter)\s*$/i,'').trim();
  return v.length >= 5 ? v : '';
}
// Public pages frequently publish structured data rather than a descriptive
// Open Graph tag. Extract a *single* relevant Article/Recipe/HowTo/Video object.
// No media or private/social content is downloaded or inferred.
export function parseStructuredData(html) {
  const accepted = new Set(['article','newsarticle','blogposting','techarticle','recipe','howto','videoobject','product','review','creativework']);
  let scanned = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (++scanned > 50) break;
    if ((parseAttributes(match[1]).type || '').toLowerCase() !== 'application/ld+json') continue;
    if (match[2].length > 60000) continue;
    let data;
    try {data=JSON.parse(match[2].trim().replace(/^<!--|-->$/g,'').trim());} catch {continue;}
    const queue=Array.isArray(data)?data.slice(0,30):[data];
    let inspected=0;
    while(queue.length && ++inspected <= 45) {
      const obj=queue.shift();
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      if(Array.isArray(obj['@graph'])) queue.push(...obj['@graph'].slice(0,30));
      const types=[obj['@type']].flat().filter(t=>typeof t==='string').map(t=>t.toLowerCase().split('/').pop());
      if (!types.some(t=>accepted.has(t))) continue;
      const title=genuine(typeof obj.headline==='string'?obj.headline:typeof obj.name==='string'?obj.name:'');
      const description=genuine(typeof obj.description==='string'?obj.description:'');
      if (title || description) return {title:title.slice(0,250),description:description.slice(0,1200)};
    }
  }
  return {title:'',description:''};
}
export function parseMetadata(html) {
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].slice(0,200).map(m => parseAttributes(m[0]));
  const get = key => metaTags.find(t => (t.property || t.name || t.itemprop || '').toLowerCase() === key)?.content || '';
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const structured = parseStructuredData(html);
  const title = genuine(get('og:title')) || genuine(get('twitter:title')) || genuine(get('title')) || structured.title || genuine(titleMatch?.[1] || '');
  const description = genuine(get('og:description')) || genuine(get('twitter:description')) || genuine(get('description')) || structured.description || '';
  return {title:title.slice(0,250), description:description.slice(0,1200)};
}

// YouTube exposes public embed metadata for some videos even when its watch
// page isn't readable from a server. This is a best-effort title fallback;
// oEmbed does not provide the video transcript or a reliable description.
export function youtubeVideoUrl(raw) {
  try {
    const url = validateUrl(raw);
    const host=url.hostname.toLowerCase();
    let id='';
    if (host==='youtu.be' || host==='www.youtu.be') id=url.pathname.split('/')[1] || '';
    else if (['youtube.com','www.youtube.com','m.youtube.com'].includes(host)) {
      if (url.pathname==='/watch') id=url.searchParams.get('v') || '';
      else if (/^\/(shorts|live|embed)\//.test(url.pathname)) id=url.pathname.split('/')[2] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? 'https://www.youtube.com/watch?v=' + id : '';
  } catch {return '';}
}
async function youtubeTitle(raw, signal) {
  const watch=youtubeVideoUrl(raw);
  if(!watch) return '';
  const api=new URL('https://www.youtube.com/oembed');
  api.searchParams.set('url',watch);api.searchParams.set('format','json');
  const response=await fetch(api.href,{signal,redirect:'error',headers:{'Accept':'application/json'}});
  if(!response.ok || !/application\/json/i.test(response.headers.get('content-type') || '')) return '';
  if(Number(response.headers.get('content-length') || 0) > 15000) return '';
  const payload=await response.text();
  if(payload.length > 15000) return '';
  const result=JSON.parse(payload);
  if(result.provider_name !== 'YouTube') return '';
  return genuine(result.title).slice(0,250);
}

// Optional YouTube Data API v3 enrichment for public videos and Shorts.
// The key lives only in Cloudflare Pages environment secrets, never in the PWA.
// This returns the creator-provided description, not a generated transcript.
// Cache successful responses per video for 6 hours to preserve API quota.
// Map only recognized Google error codes to safe statuses. Never expose the
// response body, key or Google error message to a browser client.
function youtubeApiError(status, body) {
  let reasons=[];
  try {
    const parsed=JSON.parse(body);
    reasons=[
      ...(Array.isArray(parsed?.error?.details)?parsed.error.details.map(x=>x?.reason):[]),
      ...(Array.isArray(parsed?.error?.errors)?parsed.error.errors.map(x=>x?.reason):[])
    ].filter(x=>typeof x==='string');
  } catch { /* Non-JSON error from Google */ }
  if(reasons.some(r=>/^(API_KEY_INVALID|keyInvalid)$/i.test(r)))return 'invalid_key';
  if(reasons.some(r=>/^(API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|ipRefererBlocked|API_KEY_ANDROID_APP_BLOCKED)$/i.test(r)))return 'key_restricted';
  if(reasons.some(r=>/^(SERVICE_DISABLED|accessNotConfigured)$/i.test(r)))return 'api_not_enabled';
  if(reasons.some(r=>/^(QUOTA_EXCEEDED|quotaExceeded|dailyLimitExceeded|rateLimitExceeded)$/i.test(r)))return 'quota_exceeded';
  if(status===401)return 'unauthorized';
  if(status===429)return 'rate_limited';
  if(status===403)return 'rejected_or_quota';
  if(status===400)return 'bad_request';
  return 'http_error';
}
export async function youtubeSnippet(raw, env, signal, diagnostics) {
  const watch=youtubeVideoUrl(raw);
  const key=env?.YOUTUBE_API_KEY;
  if(!watch || typeof key!=='string' || !key.trim()) return null;
  const id=new URL(watch).searchParams.get('v');
  const cache=globalThis.caches?.default;
  const cacheRequest=new Request('https://repository-cache.example.org/youtube/'+id);
  if(cache) {
    try {
      const hit=await cache.match(cacheRequest);
      if(hit?.ok) {
        const saved=await hit.json();
        if(typeof saved?.title==='string' && typeof saved?.description==='string') {if(diagnostics)diagnostics.youtubeApi='cached';return saved;}
      }
    } catch { /* cache may be unavailable in local tests or previews */ }
  }
  const api=new URL('https://www.googleapis.com/youtube/v3/videos');
  api.searchParams.set('part','snippet');
  api.searchParams.set('id',id);
  api.searchParams.set('key',key);
  const response=await fetch(api.href,{
    signal,redirect:'error',headers:{Accept:'application/json'}
  });
  if(!response.ok) {
    let errorBody='';
    try {
      if(Number(response.headers.get('content-length')||0)<=12000) {
        errorBody=(await response.text()).slice(0,12000);
      }
    } catch { /* report safe HTTP status regardless */ }
    if(diagnostics) {
      diagnostics.youtubeApi=youtubeApiError(response.status,errorBody);
      diagnostics.youtubeHttpStatus=response.status;
    }
    return null;
  }
  if(!/application\/json/i.test(response.headers.get('content-type')||''))return null;
  if(Number(response.headers.get('content-length')||0)>50000)return null;
  const body=await response.text();
  if(body.length>50000)return null;
  const data=JSON.parse(body);
  const snippet=data?.items?.find(item=>item?.id===id)?.snippet;
  if(!snippet || typeof snippet.title!=='string'){if(diagnostics)diagnostics.youtubeApi='video_not_available';return null;}
  const fields={
    title:genuine(snippet.title).slice(0,250),
    description:genuine(typeof snippet.description==='string'?snippet.description:'').slice(0,1200)
  };
  if(!fields.title && !fields.description)return null;
  if(cache) {
    try {
      await cache.put(cacheRequest,new Response(JSON.stringify(fields),{
        headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=21600'}
      }));
    } catch { /* cache is best effort */ }
  }
  if(diagnostics)diagnostics.youtubeApi=fields.description?'ok':'creator_description_empty';
  return fields;
}

async function readPage(start, signal) {
  let current = start;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const target = validateUrl(current);
    const response = await fetch(target.href, {
      redirect: 'manual',
      signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; RepositoryLinkPreview/1.0)',
      },
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing redirect location');
      current = new URL(location, target).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('Not HTML');
    const announced = Number(response.headers.get('content-length') || 0);
    if (announced > MAX_BYTES) throw new Error('Response too large');
    if (!response.body) throw new Error('Empty response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let html = '', total = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) throw new Error('Response too large');
        html += decoder.decode(value, {stream:true});
      }
      html += decoder.decode();
      return html;
    } finally {
      try {await reader.cancel();} catch {}
    }
  }
  throw new Error('Too many redirects');
}

export async function onRequestGet({request,env}) {
  const input=new URL(request.url);
  const raw=input.searchParams.get('url') || '';
  try {validateUrl(raw);} catch {return json({status:'unavailable',title:'',description:''}, 400);}
  const debug=input.searchParams.get('diagnostic')==='1';
  const youtube=Boolean(youtubeVideoUrl(raw));
  // This optional status never includes API keys, Google responses, or
  // account identifiers. Ordinary callers receive the original JSON format.
  const diagnostics={youtubeApi:youtube?(env?.YOUTUBE_API_KEY?'request_failed':'not_configured'):'not_youtube',source:'none'};
  const response=(fields)=>json({...fields,...(debug?{diagnostic:diagnostics}:{})});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if(youtube && env?.YOUTUBE_API_KEY) {
      try {
        const snippet=await youtubeSnippet(raw,env,controller.signal,diagnostics);
        if(snippet?.title || snippet?.description) {
          diagnostics.source='youtube_data_api';
          return response({status:'ok',title:snippet.title||'',description:snippet.description||''});
        }
      } catch { diagnostics.youtubeApi=controller.signal.aborted?'timed_out':'network_error'; }
    }
    let fields = {title:'',description:''};
    try {
      fields=parseMetadata(await readPage(raw,controller.signal));
      if(fields.title||fields.description)diagnostics.source='public_html';
    } catch { /* public page may disallow bots */ }
    if (!fields.title && youtube) {
      try {
        fields.title=await youtubeTitle(raw,controller.signal);
        if(fields.title && diagnostics.source==='none')diagnostics.source='youtube_oembed';
      } catch { /* optional provider fallback */ }
    }
    return response({status:fields.title || fields.description ? 'ok':'unavailable', ...fields});
  } finally {clearTimeout(timer);}
}

export function onRequest() {
  return json({status:'error',error:'Method not allowed'},405);
}
