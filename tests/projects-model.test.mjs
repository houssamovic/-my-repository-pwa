import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../site/projects.js',import.meta.url),'utf8');
const sandbox=vm.createContext({Date,Intl,globalThis:null});
sandbox.globalThis=sandbox;vm.runInContext(code,sandbox);
const model=sandbox.RepositoryProjects;
const links=[{id:'a'},{id:'b'},{id:'c'}];
const source={id:'project-1',title:'Repair bedroom drywall',purpose:'Prepare this weekend',
  date:'2026-11-14',linkIds:['a','b','a','missing'],
  insights:{a:'Covers mesh patch',missing:'No longer available'},
  brief:{summary:'Prepare the surface',tools:['Putty knife'],steps:['Check the hole size'],
    questions:['Is a patch needed?'],limitations:['Video transcript unavailable'],sourceCount:2,generated:'2026-11-11T10:00:00.000Z'}};

test('sanitize project membership, keep categories and saved links separate',()=>{
  const out=model.sanitize([source],links);
  assert.equal(out.length,1);
  assert.deepEqual(Array.from(out[0].linkIds),['a','b']);
  assert.equal(out[0].insights.a,'Covers mesh patch');
  assert.equal(out[0].insights.missing,undefined);
  assert.equal(out[0].brief.summary,'Prepare the surface');
  assert.equal(links.length,3);
});
test('reject invented importance values and validate date',()=>{
  for(const rating of [null,'',0,11,-1,1.5,'bad'])assert.equal(model.importance(rating),null);
  assert.equal(model.importance('9'),9);
  assert.equal(model.importance(10),10);
  assert.equal(model.validDate('2026-11-14'),true);
  assert.equal(model.validDate('2026-02-30'),false);
  assert.equal(model.validDate('2026-13-02'),false);
});
test('calendar entry contains user title, target date and day-before alert',()=>{
  const ics=model.calendar(source);
  assert.match(ics,/BEGIN:VCALENDAR/);
  assert.match(ics,/DTSTART:20261114T090000/);
  assert.match(ics,/TRIGGER:-P1D/);
  assert.match(ics,/SUMMARY:Repository: Repair bedroom drywall/);
  assert.equal(model.calendar({...source,date:''}),'');
  assert.equal(model.calendar({...source,date:'2026-02-30'}),'');
});
test('never allow unsupported objects or excessive project payload',()=>{
  const invalid=Array.from({length:95},(_,i)=>({...source,id:'id-'+i,title:'x'.repeat(200),purpose:'p'.repeat(900)}));
  const out=model.sanitize(invalid,links);
  assert.equal(out.length,80);
  assert.ok(out.every(p=>p.title.length<=90&&p.purpose.length<=600));
});
test('project model allows import from old backups without projects',()=>{
  assert.deepEqual(Array.from(model.sanitize(undefined,links)),[]);
  assert.deepEqual(Array.from(model.sanitize([],links)),[]);
});
