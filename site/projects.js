/** Local project helpers. No automatic server calls. */
((root)=>{
  'use strict';
  const MAX_PROJECTS=80;
  const NAME_LIMIT=90;
  const PURPOSE_LIMIT=600;
  const MAX_LINKS_PER_PROJECT=250;
  const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value+'T12:00:00')) &&
    new Date(value+'T12:00:00').getFullYear()===Number(value.slice(0,4)) &&
    new Date(value+'T12:00:00').getMonth()+1===Number(value.slice(5,7)) &&
    new Date(value+'T12:00:00').getDate()===Number(value.slice(8,10));
  function importance(value){
    if(value===null||value===undefined||value==='')return null;
    const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=10?n:null;
  }
  /** Filter personal 1–10 importance scores; older and unrated links stay distinguishable. */
  function ratingMatches(value,filter={mode:'any'}) {
    const mode=filter?.mode||'any';
    if(mode==='any')return true;
    const score=importance(value);
    if(mode==='unrated')return score===null;
    if(score===null)return false;
    if(mode==='rated')return true;
    if(mode==='high')return score>=8&&score<=10;
    if(mode==='mid')return score>=5&&score<=7;
    if(mode==='low')return score>=1&&score<=4;
    if(mode==='exact') {
      const chosen=importance(filter?.exact);
      return chosen!==null&&score===chosen;
    }
    if(mode==='range') {
      const minimum=importance(filter?.min),maximum=importance(filter?.max);
      return minimum!==null&&maximum!==null&&minimum<=maximum&&score>=minimum&&score<=maximum;
    }
    return false;
  }
  function ids(value,validItemIds) {
    if(!Array.isArray(value))return [];
    return [...new Set(value.filter(x=>typeof x==='string'&&x.length<=120&&validItemIds.has(x)))].slice(0,MAX_LINKS_PER_PROJECT);
  }
  function safeInsight(value){
    return typeof value==='string'?value.trim().slice(0,600):'';
  }
  const EVIDENCE_LABELS=Object.freeze({
    article:'Article excerpt',
    page_metadata:'Page metadata only',
    youtube_metadata:'YouTube title and available creator description',
    youtube_title:'YouTube title only',
    saved:'Saved details only · source content unavailable'
  });
  const evidenceKind=value=>Object.hasOwn(EVIDENCE_LABELS,value)?value:'saved';
  function sourceAnalysisUrl(raw) {
    try {
      const url=new URL(raw);
      if(url.protocol!=='https:'||url.username||url.password||url.port)return '';
      if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(url.hostname)) {
        const id=url.hostname.endsWith('youtu.be')?url.pathname.split('/')[1]:
          url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
        return /^[A-Za-z0-9_-]{11}$/.test(id||'')?'https://www.youtube.com/watch?v='+id:'';
      }
      if(url.search)return '';
      url.hash='';
      return url.href;
    } catch {return '';}
  }
  function safeBrief(b) {
    if(!b||typeof b!=='object'||typeof b.summary!=='string')return null;
    const list=k=>Array.isArray(b[k])?b[k].filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,350)):[];
    if(Array.isArray(b.sources)) {
      const sources=b.sources.slice(0,12).flatMap(source=>
        typeof source?.itemId==='string'&&source.itemId.length<=120&&
        Number.isInteger(source.source)&&source.source>=1&&source.source<=12
          ?[{itemId:source.itemId,source:source.source,kind:evidenceKind(source.kind)}]:[]);
      const articleIds=new Set(sources.filter(s=>s.kind==='article').map(s=>s.source));
      const citations=key=>Array.isArray(b[key])?b[key].slice(0,5).flatMap(entry=>
        articleIds.has(entry?.source)&&typeof entry.text==='string'&&typeof entry.quote==='string'
          ?[{text:entry.text.slice(0,260),source:entry.source,quote:entry.quote.slice(0,180)}]:[]):[];
      const research=Array.isArray(b.research)?b.research.slice(0,6).flatMap(entry=>
        typeof entry?.question==='string'&&typeof entry.research==='string'
          ?[{question:entry.question.slice(0,240),research:entry.research.slice(0,260)}]:[]):[];
      return {summary:b.summary.slice(0,900),findings:citations('findings'),tools:citations('tools'),
        steps:citations('steps'),research,limitations:list('limitations'),sources,sourceCount:sources.length,
        generated:typeof b.generated==='string'?b.generated.slice(0,40):''};
    }
    return {
      summary:b.summary.slice(0,900),
      tools:list('tools'), steps:list('steps'), questions:list('questions'),
      limitations:list('limitations'), generated:typeof b.generated==='string' ? b.generated.slice(0,40) : '',
      sourceCount:Number.isInteger(b.sourceCount)?Math.min(b.sourceCount,12):0
    };
  }
  function sanitize(value,items) {
    const known=new Set(items.map(x=>x.id).filter(x=>typeof x==='string'));
    if(!Array.isArray(value))return [];
    const seen=new Set();
    return value.slice(0,MAX_PROJECTS).flatMap(entry=>{
      if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||entry.id.length>120||seen.has(entry.id))return [];
      seen.add(entry.id);
      const insights={};
      if(entry.insights&&typeof entry.insights==='object'&&!Array.isArray(entry.insights)) {
        for(const id of Object.keys(entry.insights).slice(0,MAX_LINKS_PER_PROJECT)){
          if(known.has(id)) {
            const text=safeInsight(entry.insights[id]);
            if(text)insights[id]=text;
          }
        }
      }
      const links=ids(entry.linkIds,known);
      return [{
        id:entry.id,title:String(entry.title||'Untitled project').trim().slice(0,NAME_LIMIT)||'Untitled project',
        purpose:typeof entry.purpose==='string'?entry.purpose.trim().slice(0,PURPOSE_LIMIT):'',
        date:validDate(entry.date)?entry.date:'',
        created:typeof entry.created==='string'&&Number.isFinite(Date.parse(entry.created))?entry.created:new Date().toISOString(),
        linkIds:links,brief:safeBrief(entry.brief),insights
      }];
    });
  }
  const escapeCal=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;').slice(0,800);
  function calendar(project) {
    if(!validDate(project?.date))return '';
    // Floating local time is interpreted by the importing calendar's timezone.
    const day=project.date.replaceAll('-','');
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    return [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Repository//Project Reminder//EN',
      'BEGIN:VEVENT','UID:'+encodeURIComponent(project.id)+'@repository.local',
      'DTSTAMP:'+stamp,
      'DTSTART:'+day+'T090000','DTEND:'+day+'T093000',
      'SUMMARY:'+escapeCal('Repository: '+project.title),
      'DESCRIPTION:'+escapeCal(project.purpose+'\nOpen Repository to see your saved sources and preparation brief.'),
      'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Review your Repository project preparation','TRIGGER:-P1D','END:VALARM',
      'END:VEVENT','END:VCALENDAR',''
    ].join('\r\n');
  }
  root.RepositoryProjects=Object.freeze({MAX_PROJECTS,NAME_LIMIT,PURPOSE_LIMIT,validDate,importance,ratingMatches,sanitize,safeBrief,calendar,sourceAnalysisUrl,evidenceKind,EVIDENCE_LABELS});
})(typeof globalThis==='undefined'?self:globalThis);
