(() => {
  'use strict';

  const ITEMS_KEY = 'repository-v1-items';
  const CATEGORIES_KEY = 'repository-v1-categories';
  const SHARE_LOG_KEY = 'repository-v12-share-log';
  const CLOUD_DIRTY = 'repository-cloud-dirty-v1';
  let cloudTimer;
  const META_ENDPOINT = '/api/metadata';
  const AI_ENDPOINT = '/api/classify';
  const aiAttemptedInSession = new Set();
  const MAX_AI_ATTEMPTS_PER_SESSION = 12;
  let aiRequestsInFlight = 0;
  let aiBindingAvailable = null;
  let aiCheckInFlight = null;
  const inFlightMetadata = new Set();
  const DEFAULT_CATEGORIES = ['DIY', 'Food & Recipes', 'Travel', 'Technology', 'Reading', 'Unsorted'];
  const MAX_ITEMS = 20000;
  const $ = (id) => document.getElementById(id);
  const ui = {
    home: $('home-button'), add: $('add-button'), back: $('back-button'),
    title: $('main-title'), subtitle: $('subtitle'), eyebrow: $('eyebrow'),
    search: $('search-input'), categories: $('categories-section'), grid: $('category-grid'),
    entries: $('entries-section'), list: $('entries-list'), listHeading: $('list-heading'),
    resultCount: $('result-count'), empty: $('empty-message'),
    organizeButton: $('organize-unsorted-button'), organizeStatus: $('organize-status'),
    refreshDescriptionsButton: $('refresh-descriptions-button'), refreshDescriptionsStatus: $('refresh-descriptions-status'),
    toast: $('toast'), entryDialog: $('entry-dialog'), entryForm: $('entry-form'),
    dialogHeading: $('dialog-heading'), entryUrl: $('entry-url'), entryTitle: $('entry-title'),
    entryDescription: $('entry-description'), entryNote: $('entry-note'), entryCategory: $('entry-category'),
    deleteEntry: $('delete-entry'), retryDetails: $('retry-details'), categoryDialog: $('category-dialog'),
    shareDiagnosticsDialog: $('share-diagnostics-dialog'), shareDiagnosticsList: $('share-diagnostics-list'),
    categoryName: $('category-name'), categoryForm: $('category-form')
  };

  function readJSON(key, fallback) {
    try { const data = JSON.parse(localStorage.getItem(key)); return data ?? fallback; }
    catch { return fallback; }
  }
  let categories = readJSON(CATEGORIES_KEY, DEFAULT_CATEGORIES);
  let items = readJSON(ITEMS_KEY, []);
  if (!Array.isArray(categories)) categories = [...DEFAULT_CATEGORIES];
  if (!Array.isArray(items)) items = [];
  categories = [...new Set([...DEFAULT_CATEGORIES.filter(c => c !== 'Unsorted'), ...categories.filter(c => typeof c === 'string' && c !== 'Unsorted' && c.trim().length && c.length <= 45), 'Unsorted'])];
  items = items.filter(e => e && typeof e === 'object' && typeof e.url === 'string' && typeof e.title === 'string' && typeof e.category === 'string');
  // Non-destructive migration: retry metadata for old placeholder entries.
  for (const e of items) {
    if (!e.metaStatus && /shared link \(content not analyzed\)|saved link \(content not analyzed\)/i.test(e.description || '')) {
      e.metaStatus = 'pending'; e.metaAttempts = 0;
    }
  }
  // Revisit only auto-sorted links; do not override the user's own category.
  for(const item of items) {
    if(item.category === 'Unsorted' && !item.manualCategory) {
      const guess = inferCategory(item.title,item.description,item.url);
      if(guess!=='Unsorted') item.category=guess;
    }
  }
  let currentCategory = null;
  let editedId = null;
  let categorySelectedByUser = false;
  let toastTimer = null;

  function saveData() {
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
      if (globalThis.RepositoryVault?.recovery()) { localStorage.setItem(CLOUD_DIRTY,crypto.randomUUID()); scheduleCloudBackup(); }
      return true;
    } catch {
      showToast('Device storage is full or unavailable. Export a backup.');
      return false;
    }
  }
  function scheduleCloudBackup() {
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(async()=>{
      if(!navigator.onLine || !globalThis.RepositoryVault?.recovery())return;
      try {
        const token=localStorage.getItem(CLOUD_DIRTY);
        await globalThis.RepositoryVault.backUp({version:1,exported:new Date().toISOString(),categories,items});
        if (localStorage.getItem(CLOUD_DIRTY)===token) localStorage.removeItem(CLOUD_DIRTY);
        else scheduleCloudBackup();
      } catch { /* The local copy is safe; retry on next online launch. */ }
    },4000);
  }
  function showToast(message) {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2600);
  }
  function cleanUrl(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw.trim());
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
      if (url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }
  function extractUrl(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!match) return null;
    // Trim prose punctuation but retain URL punctuation inside the link.
    const cleaned = match[0].replace(/[.,;!?)\]}]+$/g, '');
    return cleanUrl(cleaned);
  }
  function canonicalUrl(href) {
    try {
      const u = new URL(href);
      u.hash = '';
      u.hostname = u.hostname.toLowerCase();
      u.pathname = u.pathname.replace(/\/$/, '') || '/';
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','igsh','igshid'].forEach(k => u.searchParams.delete(k));
      u.searchParams.sort();
      return u.toString();
    } catch { return href; }
  }
  function sourceKind(href) {
    let u;
    try { u = new URL(href); } catch { return 'Link'; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const p = u.pathname.toLowerCase();
    if (host.includes('instagram.com')) return p.includes('/reel/') ? 'Instagram reel' : 'Instagram post';
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'X post';
    if (host.includes('youtube.com') || host === 'youtu.be') return p.includes('/shorts/') ? 'YouTube short' : 'YouTube video';
    if (host.includes('facebook.com') || host === 'fb.watch') return 'Facebook post';
    if (host.includes('reddit.com')) return 'Reddit post';
    if (host.includes('tiktok.com')) return 'TikTok video';
    return 'Website';
  }
  function defaultTitle(href) {
    const kind = sourceKind(href);
    if (kind !== 'Website') return kind;
    try {
      const u = new URL(href);
      const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ').replace(/\.(html?|php|aspx)$/i,'').trim();
      if (slug.length >= 6 && slug.length < 85 && /[a-z]/i.test(slug) && !/^[a-z0-9]{18,}$/i.test(slug)) return slug[0].toUpperCase() + slug.slice(1);
      return u.hostname.replace(/^www\./, '');
    } catch { return 'Saved link'; }
  }
  function inferCategory(title, description, url) {
    const decision = globalThis.RepositoryClassifier.classify({title,description,url,existingCategories:categories});
    if (decision.category !== 'Unsorted' && !categories.includes(decision.category)) {
      // Create a new tile only when the actual content justifies it.
      categories.splice(categories.length-1, 0, decision.category);
    }
    return decision.category;
  }
  function parseShare(params) {
    const shareTitle = (params.get('title') || '').trim();
    const shareText = (params.get('text') || '').trim();
    const href = cleanUrl(params.get('url') || '') || extractUrl(params.get('url') || '') || extractUrl(shareText) || extractUrl(shareTitle);
    if (!href) return null;
    let plainText = shareText.replace(/https?:\/\/[^\s<>"']+/gi, '').trim().replace(/[\s\-–—|:]+$/, '').trim();
    if (plainText.length > 450) plainText = plainText.slice(0, 450);
    const generic=/^(?:youtube(?: (?:short|video))?|instagram(?: (?:reel|post))?|facebook(?: post)?|x post|tiktok(?: video)?|watch this video|shared from (?:youtube|instagram|tiktok))$/i;
    const usableTitle=shareTitle && !extractUrl(shareTitle) && shareTitle.length < 250 && !generic.test(shareTitle) ? shareTitle : '';
    const title=usableTitle || (plainText && plainText.length<=120 && !generic.test(plainText) ? plainText : '') || defaultTitle(href);
    const description = plainText && plainText !== title ? plainText : `${sourceKind(href)} · Shared link (content not analyzed)`;
    return {url: href, title: title.slice(0,250), description: description.slice(0,1200)};
  }
  function addItem(data, forcedCategory = 'Auto') {
    const url = cleanUrl(data.url);
    if (!url) return {error: 'Please enter a valid http(s) link.'};
    const existing = items.find(e => canonicalUrl(e.url) === canonicalUrl(url));
    if (existing) return {duplicate: true, item: existing};
    if (items.length >= MAX_ITEMS) return {error: 'Maximum number of saved links reached. Export your data.'};
    const title = String(data.title || defaultTitle(url)).trim().slice(0,250) || defaultTitle(url);
    const description = String(data.description || `${sourceKind(url)} · Shared link (content not analyzed)`).trim().slice(0,1200);
    const category = forcedCategory !== 'Auto' && categories.includes(forcedCategory) ? forcedCategory : inferCategory(title, description, url);
    const entry = {id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`), url, title, description, category, created: new Date().toISOString(),
      metaStatus: data.autoMetadata ? 'pending' : 'manual', metaAttempts: 0, manual: false,
      manualCategory: forcedCategory !== 'Auto' && categories.includes(forcedCategory)};
    items.unshift(entry);
    if (!saveData()) { items.shift(); return {error:'Unable to save on this device.'}; }
    return {item: entry};
  }
  function tag(name, attrs = {}, content = '') {
    const el = document.createElement(name);
    Object.entries(attrs).forEach(([key, value]) => { if(key === 'className') el.className=value; else if (key === 'textContent') el.textContent = value; else el.setAttribute(key,value); });
    if (content) el.textContent = content;
    return el;
  }
  function categoryCount(c) { return items.filter(e=>e.category === c).length; }
  function renderCategories() {
    ui.grid.replaceChildren();
    categories.forEach(category => {
      const tile = tag('button', {className:'category-tile',type:'button'});
      tile.append(tag('span',{className:'category-name'},category), tag('span',{className:'category-meta'},`${categoryCount(category)} ${categoryCount(category) === 1 ? 'saved link' : 'saved links'}`));
      tile.addEventListener('click',()=>navigate(category));
      ui.grid.append(tile);
    });
  }
  function makeEntryRow(item) {
    const row=tag('div',{className:'entry-row'});
    const titleCell=tag('div',{className:'entry-cell'});
    // The title is a real link, not an edit button. Keep the PWA in place by opening externally.
    const title=tag('a',{className:'entry-title',href:item.url,target:'_blank',rel:'noopener noreferrer',title:'Open original source'},item.title);
    titleCell.append(title);
    const descCell=tag('div',{className:'entry-cell entry-description'});
    descCell.append(tag('span',{className:'entry-kind'},sourceKind(item.url)),document.createTextNode(item.description));
    if (item.note) descCell.append(tag('div',{className:'entry-personal-note'},`Note: ${item.note}`));
    const linkCell=tag('div',{className:'entry-cell'});
    const actions=tag('div',{className:'entry-actions'});
    const link=tag('a',{className:'entry-link',target:'_blank',rel:'noopener noreferrer',href:item.url,title:'Open original source'},'Open source ↗');
    const edit=tag('button',{className:'entry-edit',type:'button',title:'Edit title, description, category, or note'},'Edit details');
    edit.addEventListener('click',()=>openEntryDialog(item));
    actions.append(link,edit);
    linkCell.append(actions);
    row.append(titleCell,descCell,linkCell);
    return row;
  }
  function renderEntries(results) {
    ui.list.replaceChildren();
    ui.resultCount.textContent = `${results.length} ${results.length === 1 ? 'item' : 'items'}`;
    if (!results.length) {
      ui.list.hidden=true;
      ui.empty.hidden=false;
      ui.empty.textContent = currentCategory ? 'Nothing here yet. Share a link or use “Save link” to add the first item.' : 'No saved links match your search.';
      return;
    }
    ui.list.hidden=false;
    ui.empty.hidden=true;
    const header=tag('div',{className:'entries-head'});
    ['TITLE','DESCRIPTION','LINK'].forEach(x=>header.append(tag('div',{},x)));
    ui.list.append(header);
    results.forEach(e=>ui.list.append(makeEntryRow(e)));
  }
  // Old YouTube links can already be in a category even though the app
  // previously saved "Details unavailable from source". Do not require
  // Unsorted or reset their category to refresh a creator-written description.
  function youtubeLink(url) {
    try {
      const host=new URL(url).hostname.toLowerCase().replace(/^(?:www\.|m\.)/,'');
      return host==='youtube.com'||host==='youtu.be';
    } catch {return false;}
  }
  function missingDescription(value) {
    const description=String(value||'').trim();
    if(!description)return true;
    return /^(?:details unavailable from source|description not provided by source|(?:(?:youtube (?:video|short))\s*[·:|-]\s*)?(?:shared link|saved link) \(content not analyzed\))$/i.test(description);
  }
  function pendingYouTubeDescriptions(category) {
    return items.filter(e=>e.category===category && youtubeLink(e.url) && missingDescription(e.description));
  }
  function render() {
    const query=ui.search.value.trim().toLowerCase();
    ui.organizeButton.hidden=currentCategory!=='Unsorted';
    ui.organizeStatus.hidden=currentCategory!=='Unsorted';
    ui.refreshDescriptionsButton.hidden=!currentCategory||pendingYouTubeDescriptions(currentCategory).length===0;
    if(!currentCategory)ui.refreshDescriptionsStatus.hidden=true;
    if (currentCategory) {
      ui.eyebrow.textContent='CATEGORY'; ui.title.textContent=currentCategory;
      ui.subtitle.textContent='Your saved material, without the clutter.';
      ui.search.placeholder=`Search within ${currentCategory}...`;
      ui.back.hidden=false; ui.categories.hidden=true; ui.entries.hidden=false;
      ui.listHeading.textContent='All saved links';
      renderEntries(items.filter(e=>e.category===currentCategory && matches(e,query)));
    } else if (query) {
      ui.eyebrow.textContent='YOUR COLLECTION'; ui.title.textContent='Everything, in its place.';
      ui.subtitle.textContent='A quiet home for everything worth keeping.';
      ui.search.placeholder="Find something you've saved...";
      ui.back.hidden=true; ui.categories.hidden=true; ui.entries.hidden=false;
      ui.listHeading.textContent='Search results';
      renderEntries(items.filter(e=>matches(e,query)));
    } else {
      ui.eyebrow.textContent='YOUR COLLECTION'; ui.title.textContent='Everything, in its place.';
      ui.subtitle.textContent='A quiet home for everything worth keeping.';
      ui.search.placeholder="Find something you've saved...";
      ui.back.hidden=true; ui.categories.hidden=false; ui.entries.hidden=true;
      renderCategories();
    }
  }
  function matches(e,q) { return !q || [e.title,e.description,e.url,e.category,e.note||''].join(' ').toLowerCase().includes(q); }
  function navigate(category=null) { currentCategory=category;ui.search.value='';ui.refreshDescriptionsStatus.hidden=true;ui.refreshDescriptionsStatus.textContent='';render();window.scrollTo({top:0,behavior:'instant'}); }
  function populateCategorySelect(selected='Auto') {
    ui.entryCategory.replaceChildren();
    ui.entryCategory.append(tag('option',{value:'Auto'},'Automatic (basic rules)'));
    categories.forEach(c=>ui.entryCategory.append(tag('option',{value:c},c)));
    ui.entryCategory.value=selected;
  }
  function openEntryDialog(entry=null) {
    editedId=entry?.id || null;
    ui.entryForm.reset();
    ui.dialogHeading.textContent=entry?'Edit saved link':'Save a link';
    ui.entryUrl.value=entry?.url || '';
    ui.entryTitle.value=entry?.title || '';
    ui.entryDescription.value=entry?.description || '';
    ui.entryNote.value=entry?.note || '';
    populateCategorySelect(entry?.category || (currentCategory || 'Auto'));
    categorySelectedByUser=false;
    ui.deleteEntry.hidden=!entry;
    ui.retryDetails.hidden=!entry;
    ui.entryDialog.showModal();
    ui.entryUrl.focus();
  }
  // Save immediately, then enrich whenever an online session is available.
  // An interrupted request leaves the entry pending for the next launch.
  async function enrichItem(id) {
    const item = items.find(e => e.id === id);
    if (!item || item.manual || item.metaStatus !== 'pending' || inFlightMetadata.has(id)) return;
    if ((item.metaAttempts || 0) >= 3) return;
    inFlightMetadata.add(id);
    item.metaAttempts = (item.metaAttempts || 0) + 1;
    saveData();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      let response;
      try { response = await fetch(`${META_ENDPOINT}?url=${encodeURIComponent(item.url)}`, {signal:controller.signal, cache:'no-store'}); }
      finally { clearTimeout(timer); }
      const payload = response.ok ? await response.json() : null;
      const found = items.find(e => e.id === id);
      if (!found || found.manual) return;
      if (payload && payload.status === 'ok') {
        const realTitle = String(payload.title || '').trim().slice(0,250);
        const realDesc = String(payload.description || '').trim().slice(0,1200);
        const previousTitle=found.title,previousDescription=found.description;
        if (realTitle && !/^instagram (post|reel)$|^x post$|^youtube (short|video)$/i.test(realTitle)) found.title = realTitle;
        if (realDesc) found.description = realDesc;
        if(found.title!==previousTitle||found.description!==previousDescription){found.aiChecked=false;aiAttemptedInSession.delete(found.id);}
        else if (/content not analyzed|shared link/i.test(found.description)) found.description = 'Description not provided by source';
        if (!found.manualCategory) found.category = inferCategory(found.title, found.description, found.url);
        found.metaStatus = 'done';
      } else if (payload?.status === 'unavailable' || response.status === 404 || response.status === 501) {
        found.metaStatus = 'unavailable';
        if (/content not analyzed|shared link/i.test(found.description)) found.description = 'Details unavailable from source';
      }
      saveData(); render();
      if(found.category==='Unsorted'&&!found.manualCategory)void classifyUnsorted(found.id);
      resumeMetadata();
    } catch {
      // A transient network failure is retried on the next online launch.
      if ((item.metaAttempts || 0) >= 3) { item.metaStatus = 'unavailable'; saveData(); render(); }
    } finally { inFlightMetadata.delete(id); }
  }
  // Semantic classification is optional and uses only the public title and
  // description, never notes, recovery codes, collections or the URL.
  // It runs after metadata retrieval and also when the repository reopens:
  // Android can terminate a Share Target before an async request completes.
  async function classifyUnsorted(id) {
    const item=items.find(e=>e.id===id);
    if(!item || item.category!=='Unsorted' || item.manualCategory ||
       item.aiChecked || aiAttemptedInSession.has(id) || !navigator.onLine) return;
    const title=String(item.title||'').trim(), description=String(item.description||'').trim();
    const usefulTitle=title.length>=8 && !/^(?:youtube|youtube (?:video|short)|instagram (?:post|reel)|x post|facebook post|saved link|link|youtu\.be|(?:www\.|m\.)?youtube\.com|(?:www\.)?instagram\.com|(?:www\.)?(?:x|twitter)\.com)$/i.test(title);
    const usefulDesc=description.length>=15 && !/^(?:(?:youtube(?: (?:video|short))?|instagram(?: (?:reel|post))?|facebook(?: post)?|tiktok(?: video)?)\s*[·|:-]\s*)?(?:shared link|saved link|details unavailable|description not provided)/i.test(description);
    if(!usefulTitle&&!usefulDesc) return;
    aiAttemptedInSession.add(id);
    aiRequestsInFlight++;
    const originalText=title+'\n'+description;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({title:usefulTitle?title:'',description:usefulDesc?description:'',categories:categories.filter(c=>c!=='Unsorted')}),
        signal:controller.signal,cache:'no-store'});
      if(!response.ok) {if(currentCategory==='Unsorted')ui.organizeStatus.textContent='Automatic sorting is unavailable. Check Cloudflare AI connection.';return;} // not connected or quota
      const result=await response.json();
      const current=items.find(e=>e.id===id);
      if(!current || current.category!=='Unsorted'||current.manualCategory||result.status!=='ok'||(current.title+'\n'+current.description)!==originalText) return;
      const category=String(result.category||'').trim();
      if(category==='Unsorted') {current.aiChecked=true;saveData();if(currentCategory==='Unsorted')ui.organizeStatus.textContent='Some titles have no clear category and remain Unsorted.';return;}
      if(!/^[\p{L}\p{N} &+'(),.-]{2,45}$/u.test(category))return;
      if(!categories.includes(category))categories.splice(categories.length-1,0,category);
      current.category=category;current.aiChecked=true;saveData();render();
      if(currentCategory==='Unsorted')ui.organizeStatus.textContent='Moved a link into '+category+'.';
    } catch { /* best effort: retry next time user opens Repository */ }
    finally {clearTimeout(timer);aiRequestsInFlight--;queueUnsorted();}
  }

  function canClassify(item) {
    if(!item || item.category!=='Unsorted'||item.manualCategory||item.aiChecked)return false;
    const title=String(item.title||'').trim(),description=String(item.description||'').trim();
    const titleUseful=title.length>=8&&!/^(?:youtube|youtube (?:video|short)|instagram (?:post|reel)|x post|facebook post|saved link|link|youtu\.be|(?:www\.|m\.)?youtube\.com|(?:www\.)?instagram\.com|(?:www\.)?(?:x|twitter)\.com)$/i.test(title);
    const descUseful=description.length>=15&&!/^(?:(?:youtube(?: (?:video|short))?|instagram(?: (?:reel|post))?|facebook(?: post)?|tiktok(?: video)?)\s*[·|:-]\s*)?(?:shared link|saved link|details unavailable|description not provided)/i.test(description);
    return titleUseful||descUseful;
  }
  async function checkAiConnection(force=false) {
    if(!navigator.onLine)return false;
    if(aiCheckInFlight)return aiCheckInFlight;
    if(!force && aiBindingAvailable!==null)return aiBindingAvailable;
    aiCheckInFlight=(async()=>{
      try{
        const response=await fetch(AI_ENDPOINT,{cache:'no-store'});
        const status=response.ok?await response.json():null;
        return status?.available===true;
      }catch{return false;}
    })();
    try {aiBindingAvailable=await aiCheckInFlight;return aiBindingAvailable;}
    finally {aiCheckInFlight=null;}
  }
  function queueUnsorted() {
    if(!navigator.onLine) return;
    if(aiBindingAvailable===null) {
      void checkAiConnection().then(available=>{
        if(available)queueUnsorted();
        else if(currentCategory==='Unsorted')
          ui.organizeStatus.textContent='AI sorting is not connected. Use Organize now to check again.';
      });
      return;
    }
    if(!aiBindingAvailable)return;
    const remaining=Math.min(2-aiRequestsInFlight,MAX_AI_ATTEMPTS_PER_SESSION-aiAttemptedInSession.size);
    if(remaining<=0)return;
    items.filter(e=>canClassify(e)&&!aiAttemptedInSession.has(e.id))
      .slice(0,remaining).forEach(e=>{void classifyUnsorted(e.id);});
  }
  function resumeMetadata() {
    if (!navigator.onLine) return;
    items.filter(e => e.metaStatus === 'pending' && (e.metaAttempts || 0) < 3 && !inFlightMetadata.has(e.id))
      .slice(0,3).forEach(e => { void enrichItem(e.id); });
    queueUnsorted();
  }
  ui.refreshDescriptionsButton.addEventListener('click',async()=>{
    if(!currentCategory || ui.refreshDescriptionsButton.disabled)return;
    const category=currentCategory;
    const targets=pendingYouTubeDescriptions(category).slice(0,10);
    if(!targets.length){render();return;}
    ui.refreshDescriptionsButton.disabled=true;
    ui.refreshDescriptionsStatus.hidden=false;
    let updated=0,completed=0;
    const diagnostics=new Set();
    ui.refreshDescriptionsStatus.textContent='Checking YouTube descriptions for '+targets.length+' saved links…';
    try {
      // Two requests at a time; explicit retries only, to protect quota.
      for(let offset=0;offset<targets.length;offset+=2) {
        await Promise.all(targets.slice(offset,offset+2).map(async item=>{
          const savedDescription=item.description;
          const savedUrl=item.url;
          const controller=new AbortController();
          const timer=setTimeout(()=>controller.abort(),10000);
          try {
            const params=new URLSearchParams({url:savedUrl,diagnostic:'1'});
            const response=await fetch(META_ENDPOINT+'?'+params.toString(),{cache:'no-store',signal:controller.signal});
            if(!response.ok){diagnostics.add('network_error');return;}
            const data=await response.json();
            if(data?.diagnostic?.youtubeApi)diagnostics.add(data.diagnostic.youtubeApi);
            const received=String(data?.description||'').trim().slice(0,1200);
            const latest=items.find(x=>x.id===item.id);
            if(!latest || latest.url!==savedUrl || latest.description!==savedDescription || !missingDescription(latest.description))return;
            if(received && !missingDescription(received)){
              latest.description=received;latest.metaStatus='done';latest.metaAttempts=0;
              if(latest.category==='Unsorted'&&!latest.manualCategory) {
                const inferred=inferCategory(latest.title,latest.description,latest.url);
                if(inferred!=='Unsorted')latest.category=inferred;
                else {latest.aiChecked=false;aiAttemptedInSession.delete(latest.id);}
              }
              updated++;
              saveData();
            }
          } catch {diagnostics.add('network_error');}
          finally {clearTimeout(timer);completed++;}
        }));
        if(currentCategory===category){
          render();
          ui.refreshDescriptionsStatus.hidden=false;
          ui.refreshDescriptionsStatus.textContent='Checked '+completed+' of '+targets.length+' links; '+updated+' descriptions retrieved.';
        }
      }
      if(currentCategory===category){
        const remaining=pendingYouTubeDescriptions(category).length;
        let explanation='';
        if(diagnostics.has('not_configured'))explanation=' YouTube API is not enabled in this Pages deployment. Check the YOUTUBE_API_KEY secret and redeploy.';
        else if(diagnostics.has('rejected_or_quota')||diagnostics.has('unauthorized'))explanation=' Google rejected the API request or quota was exceeded. Check the API key restrictions and quota in Google Cloud.';
        else if(diagnostics.has('rate_limited'))explanation=' YouTube API rate limit reached.';
        else if(diagnostics.has('creator_description_empty'))explanation=' Some videos have no creator-written description.';
        else if(diagnostics.has('video_not_available'))explanation=' Some videos are not accessible through the public YouTube API.';
        else if(diagnostics.has('network_error')||diagnostics.has('request_failed'))explanation=' YouTube metadata requests failed. Check the Cloudflare deployment and connection.';
        else if(!updated)explanation=' The source did not provide a description for these videos.';
        ui.refreshDescriptionsStatus.textContent='Retrieved '+updated+' of '+targets.length+' missing descriptions.'+explanation+(remaining>0?' '+remaining+' still need descriptions.':'');
        render();
        ui.refreshDescriptionsStatus.hidden=false;
        queueUnsorted();
      }
    }finally{ui.refreshDescriptionsButton.disabled=false;}
  });
  ui.organizeButton.addEventListener('click',async()=>{
    ui.organizeButton.disabled=true;
    ui.organizeStatus.hidden=false;
    ui.organizeStatus.textContent='Checking automatic classification…';
    try {
      const available=await checkAiConnection(true);
      // Re-fetch descriptions for a bounded batch of previously opaque videos.
      // This is especially valuable after adding the optional YouTube API key.
      const missing=items.filter(e=>{
        if(e.category!=='Unsorted'||e.manual||e.manualCategory||canClassify({...e,aiChecked:false}))return false;
        try {
          const host=new URL(e.url).hostname.toLowerCase();
          return /^(?:www\.|m\.)?(?:youtube\.com|instagram\.com)$/.test(host)||/^(?:www\.)?youtu\.be$/.test(host);
        }catch{return false;}
      }).slice(0,5);
      for(const e of missing) {
        e.metaStatus='pending';e.metaAttempts=0;e.aiChecked=false;
        aiAttemptedInSession.delete(e.id);
      }
      if(missing.length) {
        saveData();
        missing.forEach(e=>{void enrichItem(e.id);});
      }
      const eligible=items.filter(e=>e.category==='Unsorted'&&!e.manualCategory&&canClassify({...e,aiChecked:false}));
      if(available) {
        for(const e of eligible){e.aiChecked=false;aiAttemptedInSession.delete(e.id);}
        saveData();
        queueUnsorted();
        ui.organizeStatus.textContent='Checking '+eligible.length+' readable links'+(missing.length?' and refreshing '+missing.length+' video links.':'.');
      } else if(missing.length) {
        ui.organizeStatus.textContent='Refreshing '+missing.length+' videos. AI sorting is not connected, so only basic categorization is available.';
      } else {
        ui.organizeStatus.textContent='AI sorting is not connected. Add the AI binding in Cloudflare Pages; videos without descriptions cannot be classified reliably.';
      }
    } catch {
      ui.organizeStatus.textContent='Cannot reach automatic categorization. Check the connection and retry.';
    } finally {
      ui.organizeButton.disabled=false;
    }
  });
  function recordShare(params, status, detail) {
    // Store diagnostic metadata locally only. Do not persist shared text or full URLs.
    const data = {
      at: new Date().toISOString(), status, detail,
      route: window.location.pathname,
      fields: ['title','text','url'].filter(k => params.has(k)).map(k => `${k} (${(params.get(k) || '').length} chars)`).join(', ') || 'none'
    };
    let recent = readJSON(SHARE_LOG_KEY, []);
    if (!Array.isArray(recent)) recent = [];
    recent.unshift(data);
    try { localStorage.setItem(SHARE_LOG_KEY, JSON.stringify(recent.slice(0,5))); } catch { /* optional diagnostics */ }
  }
  function showShareDiagnostics() {
    const logs=readJSON(SHARE_LOG_KEY, []);
    ui.shareDiagnosticsList.replaceChildren();
    if (!Array.isArray(logs) || !logs.length) {
      ui.shareDiagnosticsList.append(tag('p',{},'No share attempts have reached the website yet. If Android opens the app but this remains empty, the browser did not deliver the share to this page.'));
    } else {
      logs.forEach(entry => {
        const e=tag('div',{className:'share-diagnostic-item'});
        e.append(tag('strong',{},entry.status || 'Unknown'), tag('small',{},`${entry.at || ''} · ${entry.route || ''}`),tag('div',{},`Received fields: ${entry.fields || 'none'}`),tag('div',{},entry.detail || ''));
        ui.shareDiagnosticsList.append(e);
      });
    }
    ui.shareDiagnosticsDialog.showModal();
  }
  function handleShare() {
    const address = new URL(window.location.href);
    const params = address.searchParams;
    const hasPayload = ['title','text','url'].some(k => params.has(k));
    const shareRoute = address.pathname === '/share.html' || params.get('incoming') === '1';
    if (!hasPayload && !shareRoute) return;
    const data = parseShare(params);
    history.replaceState(null,'','/'); // Don't retain shared text in the address.
    if (!data) {
      recordShare(params,'Not saved','No recognizable http(s) URL.');
      showToast('Could not save · No link received');
      return;
    }
    const result = addItem({...data, autoMetadata:true});
    if (result.error) {
      recordShare(params,'Save failed',result.error);
      showToast('Could not save link');
      return;
    }
    if (result.item) {
      // Remain on the minimalist homepage rather than opening the category.
      currentCategory = null;
      render();
      recordShare(params,result.duplicate ? 'Already saved' : 'Saved',`${sourceKind(result.item.url)} → ${result.item.category}`);
      showToast(result.duplicate ? 'Already saved' : '✓ Link saved');
      // Enrichment is best effort now, and will resume on a later launch if interrupted.
      if (result.item.metaStatus === 'pending') void enrichItem(result.item.id);
    }
  }
  $('show-share-diagnostics').addEventListener('click',showShareDiagnostics);
  $('close-share-diagnostics').addEventListener('click',()=>ui.shareDiagnosticsDialog.close());
  $('test-share-button').addEventListener('click',()=>{
    ui.shareDiagnosticsDialog.close();
    const params=new URLSearchParams({incoming:'1',title:'Test: drywall repair',text:'https://example.com/diy-drywall-repair'});
    window.location.href='/?'+params.toString();
  });
  ui.home.addEventListener('click',()=>navigate());
  ui.back.addEventListener('click',()=>navigate());
  ui.add.addEventListener('click',()=>openEntryDialog());
  ui.search.addEventListener('input',render);
  document.addEventListener('keydown',(e)=>{
    if (e.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) && !ui.entryDialog.open && !ui.categoryDialog.open) {e.preventDefault();ui.search.focus();}
  });
  $('close-entry-dialog').addEventListener('click',()=>ui.entryDialog.close());
  ui.entryCategory.addEventListener('change',()=>{categorySelectedByUser=true;});
  ui.entryForm.addEventListener('submit',(event)=>{
    event.preventDefault();
    const url=cleanUrl(ui.entryUrl.value);
    if (!url){ui.entryUrl.setCustomValidity('Enter a valid http(s) URL');ui.entryUrl.reportValidity();return;}
    ui.entryUrl.setCustomValidity('');
    const title=ui.entryTitle.value.trim().slice(0,250) || defaultTitle(url);
    const description=ui.entryDescription.value.trim().slice(0,1200) || `${sourceKind(url)} · Saved link (content not analyzed)`;
    const selected=ui.entryCategory.value;
    if (editedId) {
      const found=items.find(e=>e.id===editedId);
      if (!found) return;
      const dupe=items.some(e=>e.id!==editedId && canonicalUrl(e.url)===canonicalUrl(url));
      if (dupe){showToast('This URL is already in the repository.');return;}
      const detailsChanged=url!==found.url || title!==found.title || description!==found.description;
      const manualCategory=categorySelectedByUser?selected!=='Auto':Boolean(found.manualCategory);
      const nextCategory=manualCategory ? (categorySelectedByUser?selected:found.category) :
        (detailsChanged||categorySelectedByUser?inferCategory(title,description,url):found.category);
      Object.assign(found,{url,title,description,category:nextCategory,
        note:ui.entryNote.value.trim().slice(0,1200),manual:detailsChanged?true:found.manual,
        manualCategory,metaStatus:detailsChanged?'manual':found.metaStatus,
        aiChecked:detailsChanged||categorySelectedByUser?false:found.aiChecked});
      if(detailsChanged||categorySelectedByUser)aiAttemptedInSession.delete(found.id);
      if (saveData()) {
        ui.entryDialog.close();render();showToast('Saved changes');
        if(found.category==='Unsorted'&&!found.manualCategory)void classifyUnsorted(found.id);
      }
    } else {
      const result=addItem({url,title,description,autoMetadata:!ui.entryTitle.value.trim() && !ui.entryDescription.value.trim()},selected);
      if (result.error){showToast(result.error);return;}
      ui.entryDialog.close();
      if (result.item) {
        if (ui.entryNote.value.trim()) {result.item.note=ui.entryNote.value.trim().slice(0,1200);saveData();}
        navigate(result.item.category);showToast(result.duplicate?'Already saved':'Link saved');
        if (result.item.metaStatus === 'pending') void enrichItem(result.item.id);
        else if(result.item.category==='Unsorted'&&!result.item.manualCategory)void classifyUnsorted(result.item.id); }
    }
  });
  ui.entryUrl.addEventListener('input',()=>ui.entryUrl.setCustomValidity(''));
  ui.retryDetails.addEventListener('click', () => {
    const found=items.find(e=>e.id===editedId);
    if (!found) return;
    found.metaStatus='pending'; found.metaAttempts=0; found.manual=false; found.aiChecked=false; aiAttemptedInSession.delete(found.id);
    saveData(); ui.entryDialog.close(); showToast('Checking link details…');
    void enrichItem(found.id);
  });
  ui.deleteEntry.addEventListener('click',()=>{
    if (!editedId || !confirm('Delete this saved link?')) return;
    const old=items;
    items=items.filter(e=>e.id!==editedId);
    if (saveData()) {ui.entryDialog.close();render();showToast('Link removed');}
    else items=old;
  });
  $('new-category-button').addEventListener('click',()=>{ui.categoryForm.reset();ui.categoryDialog.showModal();});
  $('close-category-dialog').addEventListener('click',()=>ui.categoryDialog.close());
  ui.categoryForm.addEventListener('submit',event=>{
    event.preventDefault();
    const name=ui.categoryName.value.trim();
    if (!name) return;
    if (categories.some(c=>c.toLowerCase()===name.toLowerCase())) {showToast('This category already exists');return;}
    categories.splice(categories.length - 1,0,name); // Keep Unsorted last.
    if (saveData()) {ui.categoryDialog.close();render();showToast('Category created');}
  });
  $('export-button').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({version:1,exported:new Date().toISOString(),categories,items},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='repository-backup.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  });
  $('import-input').addEventListener('change',async event=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if (!file) return;
    if (file.size>6*1024*1024){showToast('Backup file is too large');return;}
    try {
      const data=JSON.parse(await file.text());
      if(data.version!==1 || !Array.isArray(data.items) || !Array.isArray(data.categories) || data.items.length>MAX_ITEMS) throw Error('Format');
      const safeCategories=[...new Set([...DEFAULT_CATEGORIES,...data.categories.filter(c=>typeof c==='string'&&c.length>0&&c.length<=45)])];
      const safeItems=data.items.filter(e=>e && cleanUrl(e.url) && typeof e.title==='string' && typeof e.description==='string' && typeof e.category==='string').map(e=>({id:String(e.id||crypto.randomUUID()),url:cleanUrl(e.url),title:e.title.slice(0,250),description:e.description.slice(0,1200),note:String(e.note||'').slice(0,1200),category:safeCategories.includes(e.category)?e.category:'Unsorted',created:e.created||new Date().toISOString()}));
      if(!confirm(`Import ${safeItems.length} links? This replaces the current repository on this device.`)) return;
      const oldItems=items,oldCategories=categories;
      items=safeItems;categories=safeCategories;
      if (!saveData()){items=oldItems;categories=oldCategories;return;}
      navigate();showToast('Backup imported');
    } catch {showToast('Invalid backup file');}
  });

  saveData();

  // Optional encrypted cloud backup. It never silently replaces local data.
  const cloudDialog = $('cloud-backup-dialog');
  const cloudStatus = $('cloud-status');
  const recoveryInput = $('cloud-recovery');
  const cloudCreate = $('cloud-create');
  const cloudSave = $('cloud-save');
  const cloudRestore = $('cloud-restore');
  const cloudCopy = $('cloud-copy');
  const cloudDisconnect = $('cloud-disconnect');
  const vault = globalThis.RepositoryVault;
  const backupSnapshot = () => ({version:1,exported:new Date().toISOString(),categories,items});
  const vaultMessage = (message) => {cloudStatus.textContent=message;};
  function setVaultButtons(enabled) {
    cloudCreate.disabled=!enabled;
    cloudSave.disabled=!enabled || !vault.recovery();
    cloudRestore.disabled=!enabled;
  }
  $('cloud-backup-button').addEventListener('click', async () => {
    cloudDialog.showModal();
    vaultMessage('Checking cloud backup availability…');
    setVaultButtons(false);
    const available=await vault.status();
    if (!cloudDialog.open) return;
    setVaultButtons(available);
    vaultMessage(!available ? 'Cloud backup is not configured yet. Your links remain saved on this device.' :
      vault.recovery() ? (localStorage.getItem(CLOUD_DIRTY) ? 'Cloud backup connected, with changes pending upload. Use Back up changes to retry.' : 'Encrypted cloud backup connected. Changes back up automatically while online.') :
      'Cloud backup is available. Create a backup, or paste an existing recovery code to restore.');
  });
  $('close-cloud-dialog').addEventListener('click',()=>cloudDialog.close());
  cloudCreate.addEventListener('click', async () => {
    cloudCreate.disabled=true;
    vaultMessage('Encrypting your collection…');
    try {
      const code=await vault.create(backupSnapshot());
      localStorage.removeItem(CLOUD_DIRTY);
      recoveryInput.value=code;
      vaultMessage('Encrypted backup created. Save the recovery code securely before closing this screen.');
      cloudSave.disabled=false;
    } catch(e){vaultMessage(e.message||'Could not create backup');}
    finally{cloudCreate.disabled=false;}
  });
  cloudSave.addEventListener('click',async()=>{
    cloudSave.disabled=true;vaultMessage('Encrypting and backing up…');
    try{const token=localStorage.getItem(CLOUD_DIRTY);await vault.backUp(backupSnapshot());if(localStorage.getItem(CLOUD_DIRTY)===token)localStorage.removeItem(CLOUD_DIRTY);vaultMessage('Cloud backup updated.');}
    catch(e){vaultMessage(e.message||'Backup failed. Local links are unchanged.');}
    finally{cloudSave.disabled=false;}
  });
  cloudRestore.addEventListener('click',async()=>{
    const code=recoveryInput.value.trim()||vault.recovery();
    cloudRestore.disabled=true;vaultMessage('Reading encrypted backup…');
    try {
      const result=await vault.load(code);
      const data=result.snapshot;
      if(!data||data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.categories)||data.items.length>MAX_ITEMS) throw new Error('Invalid backup format');
      const safeCategories=[...new Set([...DEFAULT_CATEGORIES,...data.categories.filter(c=>typeof c==='string'&&c.trim().length&&c.length<=45)])];
      const safeItems=data.items.filter(e=>e && cleanUrl(e.url)&&typeof e.title==='string'&&typeof e.description==='string'&&typeof e.category==='string').map(e=>({...e,id:String(e.id||crypto.randomUUID()),url:cleanUrl(e.url),title:e.title.slice(0,250),description:e.description.slice(0,1200),note:String(e.note||'').slice(0,1200),category:safeCategories.includes(e.category)?e.category:'Unsorted'}));
      if(!confirm(`Restore ${safeItems.length} links? This REPLACES your ${items.length} locally saved links on this device. Export a local backup first if you want to preserve them.`)) {vaultMessage('Restore cancelled.');return;}
      const originalItems=items,originalCategories=categories;
      items=safeItems;categories=safeCategories;
      if(!saveData()){items=originalItems;categories=originalCategories;throw new Error('Not enough device storage');}
      vault.remember(code,result.revision);
      localStorage.removeItem(CLOUD_DIRTY);
      recoveryInput.value='';
      setVaultButtons(true);
      navigate();vaultMessage(`Restored ${items.length} links. Cloud backup connected.`);
    } catch(e){vaultMessage(e.message||'Could not restore. Local links are unchanged.');}
    finally{cloudRestore.disabled=false;}
  });
  cloudCopy.addEventListener('click',async()=>{
    const code=vault.recovery();
    if(!code){vaultMessage('Create or restore a backup first.');return;}
    try{await navigator.clipboard.writeText(code);vaultMessage('Recovery code copied. Keep it private.');}
    catch{recoveryInput.value=code;recoveryInput.focus();recoveryInput.select();vaultMessage('Select and copy the recovery code shown here.');}
  });
  cloudDisconnect.addEventListener('click',()=>{
    if(!vault.recovery())return;
    if(!confirm('Disconnect this device? Your local links will remain. To reconnect later, you will need your saved recovery code.'))return;
    vault.forget();localStorage.removeItem(CLOUD_DIRTY);recoveryInput.value='';cloudSave.disabled=true;
    vaultMessage('Disconnected. Your local links are unchanged.');
  });

  render();
  handleShare();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}).then(reg => {
        // Content updates are detected without uninstalling the Android PWA.
        reg.update().catch(()=>{});
      }).catch(()=>{});
    });
  }
  window.addEventListener('online', () => {aiBindingAvailable=null;resumeMetadata();scheduleCloudBackup();});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeMetadata(); });
  resumeMetadata();
  if (vault.recovery() && localStorage.getItem(CLOUD_DIRTY)) scheduleCloudBackup();
})();
