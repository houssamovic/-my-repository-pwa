import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const context=vm.createContext({Date,Intl,globalThis:null});
context.globalThis=context;
vm.runInContext(read('site/projects.js'),context);
vm.runInContext(read('site/date-filter.js'),context);
const model=context.RepositoryProjects,dates=context.RepositoryDates;
const scores=Array.from({length:10},(_,i)=>({id:'r'+(i+1),rating:i+1}));
const all=[...scores,{id:'unrated-null',rating:null},{id:'unrated-undefined'}];
const selected=(filter)=>all.filter(item=>model.ratingMatches(item.rating,filter)).map(item=>item.id);

test('rating filter shows every saved link, including unrated, by default',()=>{
  assert.equal(selected({mode:'any'}).length,12);
  assert.equal(all.every(item=>model.ratingMatches(item.rating)),true);
  assert.equal(model.ratingMatches(0,{mode:'any'}),true);
});
test('presets cover all ten integer scores without gaps or overlap',()=>{
  assert.deepEqual(selected({mode:'high'}),['r8','r9','r10']);
  assert.deepEqual(selected({mode:'mid'}),['r5','r6','r7']);
  assert.deepEqual(selected({mode:'low'}),['r1','r2','r3','r4']);
});
test('exact rating handles each score, including 1 and 10',()=>{
  for(let i=1;i<=10;i++)assert.deepEqual(selected({mode:'exact',exact:String(i)}),['r'+i]);
  assert.equal(selected({mode:'exact',exact:''}).length,0);
  assert.equal(selected({mode:'exact',exact:'11'}).length,0);
});
test('custom ranges include both endpoints and recognize invalid bounds',()=>{
  assert.deepEqual(selected({mode:'range',min:'3',max:'6'}),['r3','r4','r5','r6']);
  assert.deepEqual(selected({mode:'range',min:'1',max:'10'}),scores.map(x=>x.id));
  assert.deepEqual(selected({mode:'range',min:'9',max:'9'}),['r9']);
  assert.deepEqual(selected({mode:'range',min:'9',max:'4'}),[]);
  assert.deepEqual(selected({mode:'range',min:'',max:'4'}),[]);
  assert.deepEqual(selected({mode:'range',min:'2',max:'not-a-score'}),[]);
});
test('rated only and unrated only do not conflate missing with score zero',()=>{
  assert.equal(selected({mode:'rated'}).length,10);
  assert.deepEqual(selected({mode:'unrated'}),['unrated-null','unrated-undefined']);
  assert.equal(model.ratingMatches(0,{mode:'unrated'}),true);
  assert.equal(model.ratingMatches('8',{mode:'high'}),true);
  assert.equal(model.ratingMatches('8',{mode:'unrated'}),false);
  assert.equal(model.ratingMatches(8,{mode:'unsupported'}),false);
});
test('rating composes with date, text and category/project membership',()=>{
  const now=new Date(2026,10,11,12);
  const records=[
    {id:'a',category:'DIY',rating:9,title:'Drywall tutorial',created:new Date(2026,10,11,9).toISOString()},
    {id:'b',category:'DIY',rating:3,title:'Drywall tool list',created:new Date(2026,10,11,10).toISOString()},
    {id:'c',category:'DIY',rating:9,title:'Drywall old resource',created:new Date(2026,9,11,9).toISOString()},
    {id:'d',category:'Reading',rating:10,title:'History article',created:new Date(2026,10,11,9).toISOString()},
    {id:'e',category:'DIY',rating:null,title:'Drywall old note',created:new Date(2026,10,11,8).toISOString()}
  ];
  const combined=records.filter(e=>
    e.category==='DIY' &&
    e.title.toLowerCase().includes('drywall') &&
    dates.matches(e,{mode:'today'},now) &&
    model.ratingMatches(e.rating,{mode:'high'})
  );
  assert.deepEqual(combined.map(e=>e.id),['a']);
  const projectIds=new Set(['a','d','e']);
  const project=records.filter(e=>projectIds.has(e.id) &&
    dates.matches(e,{mode:'today'},now) &&
    model.ratingMatches(e.rating,{mode:'high'}));
  assert.deepEqual(project.map(e=>e.id),['a','d']);
});
test('minimal rating UI exists and main results apply both filters across all views',()=>{
  const app=read('site/app.js'),html=read('site/index.html'),css=read('site/styles.css');
  for(const id of ['saved-rating-mode','saved-rating-exact-fields','saved-rating-exact',
    'saved-rating-range-fields','saved-rating-min','saved-rating-max',
    'saved-rating-clear','saved-rating-error'])assert.ok(html.includes('id="'+id+'"'),id);
  for(const mode of ['any','rated','unrated','high','mid','low','exact','range'])
    assert.ok(html.includes('value="'+mode+'"'),mode);
  assert.match(app,/dates\.matches\(e,savedDateFilter\)&&projectModel\.ratingMatches\(e\.rating,savedRatingFilter\)/);
  assert.match(app,/selectedItems\.filter\(e=>project\.linkIds\.includes\(e\.id\)\)/);
  assert.match(app,/selectedItems\.filter\(e=>e\.category===currentCategory\)/);
  assert.match(app,/query \|\| dateActive \|\| ratingActive/);
  assert.match(app,/ratingClear\.addEventListener\('click'/);
  assert.match(css,/\.saved-filters/);
  assert.match(read('site/sw.js'),/repository-shell-v1-16-preparation-checklist/);
});
