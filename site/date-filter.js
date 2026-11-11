/** Local-calendar saved-date filtering. No network, account or extra storage. */
((root)=>{
  'use strict';
  const pad=n=>String(n).padStart(2,'0');
  function localDay(date) {
    if(!(date instanceof Date)||!Number.isFinite(date.getTime()))return '';
    return [date.getFullYear(),pad(date.getMonth()+1),pad(date.getDate())].join('-');
  }
  function dayFromSaved(value) {
    if(typeof value!=='string'||!value.trim())return '';
    const date=new Date(value);
    return localDay(date);
  }
  function validDay(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [year,month,day]=value.split('-').map(Number);
    const actual=new Date(year,month-1,day);
    return actual.getFullYear()===year&&actual.getMonth()+1===month&&actual.getDate()===day;
  }
  function priorDay(now,daysAgo) {
    return localDay(new Date(now.getFullYear(),now.getMonth(),now.getDate()-daysAgo));
  }
  // Treat "last 7/30 days" as inclusive calendar dates, not elapsed hours;
  // saved links near midnight and across daylight-saving changes behave predictably.
  function matches(item,filter={mode:'all'},now=new Date()) {
    const mode=filter.mode||'all';
    if(mode==='all')return true;
    const saved=dayFromSaved(item?.created);
    if(!saved)return false;
    const today=localDay(now);
    if(mode==='today')return saved===today;
    if(mode==='yesterday')return saved===priorDay(now,1);
    if(mode==='week')return saved>=priorDay(now,6)&&saved<=today;
    if(mode==='month')return saved>=priorDay(now,29)&&saved<=today;
    if(mode==='day')return validDay(filter.day)&&saved===filter.day;
    if(mode==='range') {
      const start=validDay(filter.start)?filter.start:'';
      const end=validDay(filter.end)?filter.end:'';
      if(!start&&!end)return false;
      if(start&&end&&start>end)return false;
      return (!start||saved>=start)&&(!end||saved<=end);
    }
    return true;
  }
  function label(value) {
    if(typeof value!=='string'||!value.trim())return 'Date unavailable';
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return 'Date unavailable';
    return 'Saved '+new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(date);
  }
  root.RepositoryDates=Object.freeze({localDay,dayFromSaved,validDay,priorDay,matches,label});
})(typeof globalThis==='undefined'?self:globalThis);
