import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=read('site/app.js'),share=read('site/share-receiver.js'),
  index=read('site/index.html'),receipt=read('site/share.html'),sw=read('site/sw.js');
test('all production scripts have valid syntax',()=>{
  for(const file of ['site/app.js','site/share-receiver.js','site/projects.js','site/date-filter.js','site/sw.js'])
    assert.doesNotThrow(()=>new Function(read(file)),file);
});
test('project controls and source scripts are present on main page',()=>{
  for(const id of ['projects-section','project-grid','new-project-button','project-generate','project-add-links',
    'project-calendar','project-edit','project-brief','project-status','project-dialog','project-form',
    'project-name','project-purpose','project-date','project-picker-dialog','project-picker-list',
    'entry-project','entry-rating'])assert.ok(index.includes('id="'+id+'"'),id);
  assert.match(index,/src="\/projects\.js"/);
  assert.match(app,/function navigateProject/);
  assert.match(app,/function renderBrief/);
  assert.match(app,/function explainProjectLink/);
  assert.match(app,/projectAiBody\(p,'relevance',item\)/);
  assert.match(app,/projectAiBody\(p,'brief'\)/);
});
test('Share Target receives rating and optional project without changing manifest',()=>{
  assert.match(receipt,/id="capture-project"/);
  assert.match(receipt,/id="capture-rating"/);
  assert.match(receipt,/src="\/projects\.js"/);
  assert.match(share,/PROJECTS_KEY/);
  assert.match(share,/projectModel\.importance/);
  assert.match(share,/selected\.linkIds\.push\(active\.id\)/);
  const manifest=JSON.parse(read('site/manifest.webmanifest'));
  assert.equal(manifest.share_target.action,'/share.html');
  assert.equal(manifest.id,'/');
});
test('local, JSON and encrypted cloud snapshots include projects',()=>{
  assert.match(app,/localStorage\.setItem\(PROJECTS_KEY, JSON\.stringify\(projects\)\)/);
  assert.match(app,/version:1,exported:new Date\(\)\.toISOString\(\),categories,items,projects/);
  assert.match(share,/version:1,exported:new Date\(\)\.toISOString\(\),categories,items,projects/);
  assert.match(app,/projects=projectModel\.sanitize\(data\.projects,safeItems\)/);
  assert.match(app,/projects=projectModel\.sanitize\(data\.projects,items\)/);
  assert.match(sw,/repository-shell-v1-14-rating-filters/);
  assert.match(sw,/projects\.js/);
});
test('AI runs only after explicit user action and never receives recovery credentials',()=>{
  assert.match(app,/projectGenerate\.addEventListener\('click'/);
  assert.match(app,/projectAiBody\(p,'brief'\)/);
  assert.match(app,/projectAiBody\(p,'relevance',item\)/);
  assert.ok(!read('functions/api/project-brief.js').includes('YOUTUBE_API_KEY'));
  assert.match(app,/project\.linkIds\.includes\(item\.id\)/);
});
