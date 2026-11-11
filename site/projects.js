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
  function ids(value,validItemIds) {
    if(!Array.isArray(value))return [];
    return [...new Set(value.filter(x=>typeof x==='string'&&x.length<=120&&validItemIds.has(x)))].slice(0,MAX_LINKS_PER_PROJECT);
  }
  function safeInsight(value){
    return typeof value==='string'?value.trim().slice(0,600):'';
  }
  function safeBrief(b) {
    if(!b||typeof b!=='object'||typeof b.summary!=='string')return null;
    const list=k=>Array.isArray(b[k])?b[k].filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,350)):[];
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
  root.RepositoryProjects=Object.freeze({MAX_PROJECTS,NAME_LIMIT,PURPOSE_LIMIT,validDate,importance,sanitize,safeBrief,calendar});
})(typeof globalThis==='undefined'?self:globalThis);
