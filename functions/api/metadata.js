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
  const v = cleanText(value);
  if (v.length < 5) return '';
  if (/^(instagram|x|twitter|youtube|facebook|log in|sign in|access denied|just a moment|attention required)(?:\s*[-|:.·]\s*.*)?$/i.test(v) && v.length < 65) return '';
  if (/^(instagram photos and videos|see instagram photos and videos|this content isn't available|login to instagram|instagram post|instagram reel|x post)$/i.test(v)) return '';
  return v;
}
export function parseMetadata(html) {
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => parseAttributes(m[0]));
  const get = key => metaTags.find(t => (t.property || t.name || t.itemprop || '').toLowerCase() === key)?.content || '';
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = genuine(get('og:title')) || genuine(get('twitter:title')) || genuine(get('title')) || genuine(titleMatch?.[1] || '');
  const description = genuine(get('og:description')) || genuine(get('twitter:description')) || genuine(get('description')) || '';
  return {title:title.slice(0,250), description:description.slice(0,1200)};
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

export async function onRequestGet({request}) {
  const raw = new URL(request.url).searchParams.get('url') || '';
  try {validateUrl(raw);} catch {return json({status:'unavailable',title:'',description:''}, 400);}
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const html = await readPage(raw, controller.signal);
    const fields = parseMetadata(html);
    return json({status:fields.title || fields.description ? 'ok':'unavailable', ...fields});
  } catch {
    return json({status:'unavailable',title:'',description:''});
  } finally {
    clearTimeout(timer);
  }
}

export function onRequest() {
  return json({status:'error',error:'Method not allowed'},405);
}
