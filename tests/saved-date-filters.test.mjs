import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx=vm.createContext({Date,Intl,globalThis:null});
ctx.globalThis=ctx;
vm.runInContext(fs.readFileSync(new URL('../site/date-filter.js',import.meta.url),'utf8'),ctx);
const dates=ctx.RepositoryDates;
const at=(year,month,day,hour=12)=>new Date(year,month-1,day,hour).toISOString();
const item=(created)=>({created});
const today=new Date(2026,10,11,10,30);

test('local calendar day preserves local time-zone boundaries',()=>{
  const d=new Date(2026,10,11,0,5);
  assert.equal(dates.dayFromSaved(d.toISOString()),'2026-11-11');
  assert.equal(dates.localDay(today),'2026-11-11');
  assert.equal(dates.priorDay(new Date(2026,0,1,3),1),'2025-12-31');
});
test('today and yesterday filter exact local days',()=>{
  assert.equal(dates.matches(item(at(2026,11,11,0)),{mode:'today'},today),true);
  assert.equal(dates.matches(item(at(2026,11,10,23)),{mode:'today'},today),false);
  assert.equal(dates.matches(item(at(2026,11,10,23)),{mode:'yesterday'},today),true);
});
test('last seven days includes today and six prior calendar dates',()=>{
  const filter={mode:'week'};
  assert.equal(dates.matches(item(at(2026,11,5)),filter,today),true);
  assert.equal(dates.matches(item(at(2026,11,11)),filter,today),true);
  assert.equal(dates.matches(item(at(2026,11,4)),filter,today),false);
  assert.equal(dates.matches(item(at(2026,11,12)),filter,today),false);
});
test('last thirty days includes exactly thirty local calendar dates',()=>{
  const start=dates.priorDay(today,29);
  const prior=dates.priorDay(today,30);
  assert.equal(dates.matches(item(new Date(start+'T12:00:00').toISOString()),{mode:'month'},today),true);
  assert.equal(dates.matches(item(new Date(prior+'T12:00:00').toISOString()),{mode:'month'},today),false);
});
test('specific date matches only the chosen day',()=>{
  assert.equal(dates.matches(item(at(2026,11,7)),{mode:'day',day:'2026-11-07'},today),true);
  assert.equal(dates.matches(item(at(2026,11,8)),{mode:'day',day:'2026-11-07'},today),false);
  assert.equal(dates.matches(item(at(2026,11,7)),{mode:'day',day:''},today),false);
});
test('inclusive custom range supports partial bounds and checks order',()=>{
  const a=item(at(2026,11,7)),b=item(at(2026,11,9));
  assert.equal(dates.matches(a,{mode:'range',start:'2026-11-07',end:'2026-11-09'},today),true);
  assert.equal(dates.matches(b,{mode:'range',start:'2026-11-07',end:'2026-11-09'},today),true);
  assert.equal(dates.matches(a,{mode:'range',start:'2026-11-08'},today),false);
  assert.equal(dates.matches(b,{mode:'range',start:'2026-11-08'},today),true);
  assert.equal(dates.matches(a,{mode:'range',end:'2026-11-07'},today),true);
  assert.equal(dates.matches(a,{mode:'range',start:'2026-11-10',end:'2026-11-01'},today),false);
});
test('invalid and legacy missing dates are never assigned invented dates',()=>{
  assert.equal(dates.validDay('2026-02-30'),false);
  assert.equal(dates.dayFromSaved(null),'');
  assert.equal(dates.matches(item(null),{mode:'today'},today),false);
  assert.equal(dates.matches(item('invalid'),{mode:'range',start:'2026-11-01'},today),false);
  assert.equal(dates.matches(item(null),{mode:'all'},today),true);
  assert.equal(dates.label(null),'Date unavailable');
  assert.match(dates.label(at(2026,11,11)),/^Saved /);
});
test('main UI combines date, text and category filters without changing Share Target or storage keys',()=>{
  const index=fs.readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../site/app.js',import.meta.url),'utf8');
  const share=fs.readFileSync(new URL('../site/share-receiver.js',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('../site/sw.js',import.meta.url),'utf8');
  assert.match(index,/<script defer src="\/date-filter\.js"><\/script>/);
  assert.match(index,/value="today"/);
  assert.match(index,/value="yesterday"/);
  assert.match(index,/value="week"/);
  assert.match(index,/value="month"/);
  assert.match(index,/value="day"/);
  assert.match(index,/value="range"/);
  assert.match(app,/matches\(e,query\)&&dates\.matches\(e,savedDateFilter\)/);
  assert.match(app,/selectedItems\.filter\(e=>e\.category===currentCategory\)/);
  assert.match(app,/dates\.label\(item\.created\)/);
  assert.match(app,/created:typeof e\.created==='string'/);
  assert.match(share,/created:new Date\(\)\.toISOString\(\)/);
  assert.match(sw,/date-filter\.js/);
});
