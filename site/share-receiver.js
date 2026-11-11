(() => {
  'use strict';
  const ITEMS_KEY = 'repository-v1-items';
  const CATEGORIES_KEY = 'repository-v1-categories';
  const SHARE_LOG_KEY = 'repository-v12-share-log';
  const CLOUD_DIRTY = 'repository-cloud-dirty-v1';
  let cloudTimer;
  let manualCategoryTimer;
  const META_ENDPOINT = '/api/metadata';
  const AI_ENDPOINT = '/api/classify';
  const DEFAULT_CATEGORIES = ['DIY', 'Food & Recipes', 'Travel', 'Technology', 'Reading', 'Unsorted'];
  const $ = (id) => document.getElementById(id);
  const ui = {
    heading: $('capture-heading'), detail: $('capture-status-detail'), content: $('capture-content'),
    error: $('capture-error'), errorMessage: $('capture-error-message'),
    title: $('capture-title'), description: $('capture-description'), url: $('capture-url'),
    open: $('capture-open-link'), category: $('capture-category'), note: $('capture-note'),
    descriptionHint: $('capture-description-hint'),
    done: $('capture-done'), hint: $('capture-exit-hint')
  };
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch {return fallback;}
  }
  function cleanUrl(raw) {
    if (typeof raw !== 'string') return null;
    try {const url = new URL(raw.trim()); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return null; return url.href;}
    catch {return null;}
  }
  function extractUrl(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!match) return null;
    return cleanUrl(match[0].replace(/[.,;!?)\]}]+$/g, ''));
  }
  function canonicalUrl(href) {
    try {
      const u = new URL(href); u.hash = ''; u.hostname = u.hostname.toLowerCase();
      u.pathname = u.pathname.replace(/\/$/, '') || '/';
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','igsh','igshid'].forEach(k => u.searchParams.delete(k));
      u.searchParams.sort(); return u.toString();
    } catch {return href;}
  }
  function sourceKind(href) {
    try {
      const u = new URL(href); const host = u.hostname.toLowerCase().replace(/^www\./,''); const p=u.pathname.toLowerCase();
      if (host.includes('instagram.com')) return p.includes('/reel/')?'Instagram reel':'Instagram post';
      if (host === 'x.com' || host === 'twitter.com') return 'X post';
      if (host.includes('youtube.com') || host === 'youtu.be') return p.includes('/shorts/')?'YouTube short':'YouTube video';
      if (host.includes('facebook.com') || host === 'fb.watch') return 'Facebook post';
      if (host.includes('tiktok.com')) return 'TikTok video';
      return 'Website';
    } catch{return 'Link';}
  }
  function fallbackTitle(href) {
    const kind = sourceKind(href);
    if (kind !== 'Website') return kind;
    try {const url = new URL(href); return url.hostname.replace(/^www\./,'');}catch{return 'Saved link';}
  }
  function parseShare(params) {
    const shareTitle = (params.get('title')||'').trim(); const shareText = (params.get('text')||'').trim();
    const href = cleanUrl(params.get('url')||'') || extractUrl(params.get('url')||'') || extractUrl(shareText) || extractUrl(shareTitle);
    if (!href) return null;
    const text = shareText.replace(/https?:\/\/[^\s<>"']+/gi,'').trim().replace(/[\s\-–—|:]+$/,'').trim().slice(0,450);
    const generic = /^(?:youtube(?: (?:short|video))?|instagram(?: (?:reel|post))?|facebook(?: post)?|x post|tiktok(?: video)?|watch this video|shared from (?:youtube|instagram|tiktok))$/i;
    const sourceTitle = shareTitle && !extractUrl(shareTitle) && shareTitle.length<250 && !generic.test(shareTitle) ? shareTitle : '';
    const title = sourceTitle || (text && text.length<=120 && !generic.test(text) ? text : '') || fallbackTitle(href);
    return {url:href, title:title.slice(0,250), description:(text && text!==title ? text : `${sourceKind(href)} · Shared link (content not analyzed)`).slice(0,1200)};
  }
  function inferCategory(title,description,url) {
    const decision=globalThis.RepositoryClassifier.classify({title,description,url,existingCategories:categories});
    if(decision.category!=='Unsorted' && !categories.includes(decision.category)) categories.splice(categories.length-1,0,decision.category);
    return decision.category;
  }
  let items=readJSON(ITEMS_KEY, []);if(!Array.isArray(items))items=[];
  let categories=readJSON(CATEGORIES_KEY, DEFAULT_CATEGORIES);if(!Array.isArray(categories))categories=[...DEFAULT_CATEGORIES];
  categories=[...new Set([...DEFAULT_CATEGORIES.filter(c=>c!=='Unsorted'),...categories.filter(c=>typeof c==='string'&&c!=='Unsorted'&&c.trim()&&c.length<=45),'Unsorted'])];
  let active=null;let edited = {title:false,description:false,category:false,note:false};
  function persist() {
    try {
      localStorage.setItem(ITEMS_KEY,JSON.stringify(items));localStorage.setItem(CATEGORIES_KEY,JSON.stringify(categories));
      if(globalThis.RepositoryVault?.recovery()) {
        localStorage.setItem(CLOUD_DIRTY,crypto.randomUUID());
        clearTimeout(cloudTimer);
        cloudTimer=setTimeout(async()=>{
          if(!navigator.onLine)return;
          try {
            const token=localStorage.getItem(CLOUD_DIRTY);
            await globalThis.RepositoryVault.backUp({version:1,exported:new Date().toISOString(),categories,items});
            if(localStorage.getItem(CLOUD_DIRTY)===token)localStorage.removeItem(CLOUD_DIRTY);
          } catch { /* Retry when the main app is opened. */ }
        },800);
      }
      return true;
    }
    catch {return false;}
  }
  function logShare(params,status,detail) {
    const raw=readJSON(SHARE_LOG_KEY,[]);const arr=Array.isArray(raw)?raw:[];
    arr.unshift({at:new Date().toISOString(),status,detail,route:'/share.html',fields:['title','text','url'].filter(k=>params.has(k)).map(k=>`${k} (${(params.get(k)||'').length} chars)`).join(', ')||'none'});
    try{localStorage.setItem(SHARE_LOG_KEY,JSON.stringify(arr.slice(0,5)));}catch{}
  }
  function renderFields(item) {
    active=item;ui.content.hidden=false;
    ui.title.value=item.title;ui.description.value=publicDescription(item.description);
    showDescriptionHint();
    ui.url.value=item.url;ui.open.href=item.url;
    ui.category.replaceChildren();
    categories.forEach(cat=>{const opt=document.createElement('option');opt.value=cat;opt.textContent=cat;ui.category.append(opt);});
    ui.category.value=categories.includes(item.category)?item.category:'Unsorted';
    ui.note.value=item.note||'';ui.done.disabled=false;
  }
  function showDescriptionHint() {
    if(!ui.descriptionHint)return;
    const kind=active?sourceKind(active.url):'';
    ui.descriptionHint.hidden=!/(?:YouTube|Instagram|TikTok|Facebook)/.test(kind)||!!ui.description.value.trim();
  }
  function publicDescription(value) {
    // Don't display internal placeholder language as if it were source content.
    return /shared link \(content not analyzed\)|details unavailable from source|description not provided by source/i.test(value||'') ? '' : (value||'');
  }
  function status(text,detail) {ui.heading.textContent=text;ui.detail.textContent=detail;}
  function fail(message) {ui.error.hidden=false;ui.errorMessage.textContent=message;status('Link not saved','Please share a valid webpage link');ui.done.textContent='Done · Return';ui.done.disabled=false;}
  function storeField(field) {
    if (!active) return;
    const contentChanged=field==='title'||field==='description';
    if (field === 'title') {active.title=ui.title.value.slice(0,250);edited.title=true;active.manual=true;active.metaStatus='manual';}
    else if (field === 'description') {active.description=ui.description.value.slice(0,1200);edited.description=true;active.manual=true;active.metaStatus='manual';}
    else if (field === 'category') {active.category=ui.category.value;active.manualCategory=true;edited.category=true;}
    else if (field === 'note') {active.note=ui.note.value.slice(0,1200);edited.note=true;}
    if(contentChanged) {active.aiChecked=false;showDescriptionHint();}
    if (!persist()) {status('Could not save changes','Device storage may be full');return;}
    status('Link saved',`Saved to ${active.category} · Changes saved`);
    if(contentChanged && !active.manualCategory) {
      clearTimeout(manualCategoryTimer);
      const id=active.id;
      manualCategoryTimer=setTimeout(()=>{
        if(!active||active.id!==id||active.manualCategory)return;
        const chosen=inferCategory(active.title,active.description,active.url);
        if(chosen!=='Unsorted' && chosen!==active.category) {
          active.category=chosen; persist();renderFields(active);
          status('Link saved','Sorted under '+chosen);
        } else if(active.category==='Unsorted') void classifyUnsorted(active);
      },750);
    }
  }
  ['title','description','category','note'].forEach(field=>ui[field].addEventListener(field==='category'?'change':'input',()=>storeField(field)));
  async function classifyUnsorted(item) {
    if(!item || item.category!=='Unsorted' || item.manualCategory || item.aiChecked || !navigator.onLine) return;
    const title=String(item.title||'').trim(), description=String(item.description||'').trim();
    const usefulTitle=title.length>=8&&!/^(?:youtube|youtube (?:short|video)|instagram (?:post|reel)|x post|facebook post|saved link|link|youtu\.be|(?:www\.|m\.)?youtube\.com|(?:www\.)?instagram\.com|(?:www\.)?(?:x|twitter)\.com)$/i.test(title);
    const usefulDesc=description.length>=15&&!/^(?:shared link|saved link|details unavailable|description not provided|youtube ·|instagram ·)/i.test(description);
    if(!usefulTitle&&!usefulDesc)return;
    const originalText=title+'\n'+description;
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
    try {
      const response=await fetch(AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({title:usefulTitle?title:'',description:usefulDesc?description:'',categories:categories.filter(c=>c!=='Unsorted')}),
        signal:ctrl.signal,cache:'no-store'});
      if(!response.ok){status('Link saved','Automatic sorting unavailable · Saved in Unsorted');return;} // Optional AI binding is not configured or unavailable.
      const result=await response.json();
      if(item.manualCategory || item.category!=='Unsorted'||result.status!=='ok'||(item.title+'\n'+item.description)!==originalText)return;
      const category=String(result.category||'').trim();
      if(category==='Unsorted'){item.aiChecked=true;persist();status('Link saved','No clear topic detected · Saved in Unsorted');return;}
      if(!/^[\p{L}\p{N} &+'(),.-]{2,45}$/u.test(category))return;
      if(!categories.includes(category))categories.splice(categories.length-1,0,category);
      item.category=category;item.aiChecked=true;persist();
      ui.category.replaceChildren();
      categories.forEach(cat=>{const opt=document.createElement('option');opt.value=cat;opt.textContent=cat;ui.category.append(opt);});
      ui.category.value=category;
      status('Link saved','Sorted under '+category);
    } catch { /* main repository will retry after opening */ } finally {clearTimeout(timer);}
  }
  async function enrichMetadata(item) {
    // The share is saved first, so users can exit instantly.
    if (!navigator.onLine || item.manual || item.metaStatus!=='pending') return;
    item.metaAttempts=(item.metaAttempts||0)+1;persist();
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
    try {
      const response=await fetch(`${META_ENDPOINT}?url=${encodeURIComponent(item.url)}`,{signal:controller.signal,cache:'no-store'});
      if (!response.ok) return;
      const metadata=await response.json();
      if (metadata.status === 'ok') {
        const newTitle=String(metadata.title||'').trim().slice(0,250);
        const newDesc=String(metadata.description||'').trim().slice(0,1200);
        if (!item.manual && !edited.title && newTitle && !/^(instagram (reel|post)|x post|youtube (short|video))$/i.test(newTitle)) {item.title=newTitle;ui.title.value=newTitle;}
        if (!item.manual && !edited.description && newDesc) {item.description=newDesc;ui.description.value=newDesc;showDescriptionHint();}
        if (!item.manualCategory && !edited.category) {item.category=inferCategory(item.title,item.description,item.url);ui.category.value=item.category;}
        item.metaStatus='done';
      } else if (metadata.status === 'unavailable') {
        item.metaStatus='unavailable';
        if (/content not analyzed/i.test(item.description)) item.description='Details unavailable from source';
      }
      persist();status('Link saved',item.category==='Unsorted'?'Checking the category…':'Saved to '+item.category);
      if(item.category==='Unsorted')void classifyUnsorted(item);
    } catch {} finally {clearTimeout(timer);}
  }
  function start() {
    const params=new URL(location.href).searchParams;
    const data=parseShare(params);
    // Remove text/URL from the visible address bar and browser history.
    history.replaceState(null,'','/share.html');
    if (!data) {logShare(params,'Not saved','No valid URL received.');fail('No valid link was received. Please try sharing again.');return;}
    const existing=items.find(item=>item && typeof item.url==='string' && canonicalUrl(item.url)===canonicalUrl(data.url));
    if (existing) {
      renderFields(existing);status('Already saved',`Stored in ${existing.category}`);
      logShare(params,'Already saved',`${sourceKind(existing.url)} → ${existing.category}`);
      if(existing.category==='Unsorted' && existing.metaStatus!=='pending')void classifyUnsorted(existing);
      return;
    }
    if(items.length>=20000){fail('Repository is full. Export a backup and free some space.');return;}
    const item={id:(crypto.randomUUID?.()||`id-${Date.now()}-${Math.random()}`),url:data.url,
      title:data.title,description:data.description,category:inferCategory(data.title,data.description,data.url),note:'',
      created:new Date().toISOString(),metaStatus:'pending',metaAttempts:0,manual:false,manualCategory:false};
    items.unshift(item);
    if(!persist()) {items.shift();fail('Could not save the link to device storage.');return;}
    renderFields(item);status('Link saved',item.category==='Unsorted'?'Saved · Categorization pending':`Saved to ${item.category} · Edit anything below`);
    logShare(params,'Saved',`${sourceKind(item.url)} → ${item.category}`);
    void enrichMetadata(item);
  }
  ui.done.addEventListener('click',()=>{
    // Never claim that a PWA can reliably close the Android share activity.
    if(active){if(!persist()){status('Could not save changes','Check device storage');return;}}
    try{window.close();}catch{}
    // On many Android PWA launches closing is blocked; leave the system Back control available.
    setTimeout(()=>{if(!document.hidden){ui.hint.textContent='Saved. Press Android Back (◁) or use the back gesture to return.';ui.hint.classList.add('capture-hint-emphasis');}},250);
  });
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{}));
  start();
})();