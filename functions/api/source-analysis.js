import {cleanText, parseMetadata, readPage, validateUrl, youtubeSnippet, youtubeTitle, youtubeVideoUrl} from './metadata.js';

const AGENT = 'repositorylinkpreview';
const MAX_ROBOTS_BYTES = 512000;
const RESTRICTED_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com|instagram\.com|facebook\.com|fb\.watch|tiktok\.com|x\.com|twitter\.com|threads\.net|threads\.com|vimeo\.com|dailymotion\.com|twitch\.tv|reddit\.com|linkedin\.com|pinterest\.com|snapchat\.com|onion)$/i;
const unavailable = {kind:'saved', title:'', description:'', excerpt:''};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff'
  }});
}

function matchesRule(path, rule) {
  const anchored = rule.endsWith('$');
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const parts = pattern.split('*');
  const first = parts.shift();
  if (!path.startsWith(first)) return false;
  if (!parts.length) return !anchored || first === path;
  const last = anchored ? parts.pop() : '';
  if (!path.endsWith(last)) return false;
  const end = path.length - last.length;
  let offset = first.length;
  for (const part of parts) {
    const index = path.indexOf(part, offset);
    if (index === -1) return false;
    offset = index + part.length;
  }
  return offset <= end;
}

export function robotsAllows(robots, path) {
  const groups = [];
  let group;
  for (const raw of robots.split(/\r?\n/)) {
    const field = raw.split('#', 1)[0].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!field) continue;
    const name = field[1].toLowerCase();
    const value = field[2];
    if (name === 'user-agent') {
      if (!group || group.hasRules) {
        group = {agents:[], rules:[], hasRules:false};
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (name === 'allow' || name === 'disallow')) {
      group.hasRules = true;
      if (value.startsWith('/')) group.rules.push({allow:name === 'allow', path:value});
    }
  }
  const specific = groups.filter(g => g.agents.includes(AGENT));
  const applicable = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let best;
  for (const group of applicable) {
    for (const rule of group.rules) {
      // Skip ambiguous encodings conservatively.
      if (!rule.allow && /%|[^\x20-\x7e]/.test(rule.path)) return false;
      if (!matchesRule(path, rule.path)) continue;
      if (!best || rule.path.length > best.path.length ||
          (rule.path.length === best.path.length && rule.allow)) best = rule;
    }
  }
  return best?.allow ?? true;
}

async function canReadArticle(target, signal) {
  if (target.protocol !== 'https:' || target.port || target.search ||
      /%|\/(?:login|signin|account|private|embed|video|videos)(?:\/|$)/i.test(target.pathname) ||
      RESTRICTED_HOST.test(target.hostname)) throw new Error('Unsupported article URL');
  const response = await fetch(new URL('/robots.txt', target), {
    signal, redirect:'manual', headers:{'User-Agent':'RepositoryLinkPreview/1.0', Accept:'text/plain'}
  });
  try {
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok || !/^text\/plain\b/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Robots access uncertain');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing robots body');
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_ROBOTS_BYTES) throw new Error('Robots file too large');
        text += decoder.decode(value, {stream:true});
      }
      if (!robotsAllows(text + decoder.decode(), target.pathname)) throw new Error('Robots access denied');
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    if (!response.body?.locked) await response.body?.cancel().catch(() => {});
  }
}

export function articleEvidence(html) {
  if (/<meta\b[^>]*(?:robots|repositorylinkpreview)[^>]*(?:noai|noindex|nosnippet|noarchive|none|max-snippet)|<meta\b[^>]*(?:noai|noindex|nosnippet|noarchive|none|max-snippet)[^>]*(?:robots|repositorylinkpreview)/i.test(html) ||
      /"isAccessibleForFree"\s*:\s*(?:false|"false")|data-nosnippet|data-paywall|subscribe to (?:continue|read)|sign in to (?:continue|read)/i.test(html) ||
      /<meta\b[^>]*og:type[^>]*video|<title\b[^>]*>\s*(?:just a moment|access denied|log in|sign in)/i.test(html)) return unavailable;
  const metadata = parseMetadata(html);
  const article = html.replace(/<!--[\s\S]*?-->/g, '').match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || '';
  const visible = article.replace(/<(script|style|template|noscript|nav|aside|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Leave CSS-hidden or otherwise ambiguous article containers to the original site.
  const paragraphs = /\bhidden\b|display\s*:\s*none|visibility\s*:\s*hidden|<article\b/i.test(visible) ||
    /<article\b[^>]*(?:\bhidden\b|display\s*:\s*none|visibility\s*:\s*hidden)/i.test(html) ? [] :
    Array.from(visible.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), match => cleanText(match[1]))
      .filter(paragraph => paragraph.length >= 40);
  const excerpt = [...new Set(paragraphs)].join(' ').slice(0, 1600);
  if (excerpt.length >= 100) return {kind:'article', ...metadata, excerpt};
  if (metadata.title || metadata.description) return {kind:'page_metadata', ...metadata, excerpt:''};
  return unavailable;
}

export async function onRequestPost({request, env}) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) ||
      (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return json(unavailable, 403);
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json(unavailable, 415);
  let target;
  try {
    if (Number(request.headers.get('content-length')) > 4096) return json(unavailable, 413);
    const raw = await request.text();
    if (raw.length > 4096) return json(unavailable, 413);
    target = validateUrl(JSON.parse(raw)?.url);
    target.hash = '';
  } catch {
    return json(unavailable, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const watch = youtubeVideoUrl(target.href);
    if (watch) {
      const snippet = await youtubeSnippet(watch, env, controller.signal).catch(() => null);
      if (snippet?.title || snippet?.description) return json({kind:'youtube_metadata', ...snippet, excerpt:''});
      const title = await youtubeTitle(watch, controller.signal);
      return json(title ? {kind:'youtube_title', title, description:'', excerpt:''} : unavailable);
    }
    const html = await readPage(target.href, controller.signal, url => canReadArticle(url, controller.signal));
    return json(articleEvidence(html));
  } catch {
    return json(unavailable);
  } finally {
    clearTimeout(timeout);
  }
}
