import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync(new URL('../site/projects.js',import.meta.url),'utf8');
const model=vm.runInNewContext(js+'\nRepositoryProjects');
const items=[{id:'manual'}];
const project={id:'coolant',title:'Coolant',linkIds:['manual']};
const research={question:'Which coolant type and capacity apply?',research:'Check the exact model-year service manual.'};

test('research and cited findings become tasks with their original context',()=>{
  const question=model.checklistCandidate('research',research);
  assert.equal(question.title,research.question);
  assert.equal(question.detail,research.research);
  const cited=model.checklistCandidate('findings',{text:'Locate the drain bolt.'},'manual');
  assert.equal(cited.sourceId,'manual');
  assert.equal(cited.origin,model.checklistCandidate('findings',{text:'Locate the drain bolt.'},'manual').origin);
  assert.equal(model.checklistCandidate('steps','An earlier uncited suggestion'),null);
  assert.equal(model.checklistCandidate('limitations','Missing article'),null);
});

test('tasks keep edits, completion and source across regeneration and a backup round trip',()=>{
  const candidate=model.checklistCandidate('steps',{text:'Locate the drain bolt.'},'manual');
  const checklist=[{...candidate,id:'one',title:'Confirm drain bolt in manual',done:true}];
  const snapshot=JSON.parse(JSON.stringify([{...project,brief:null,checklist}]));
  const restored=model.sanitize(snapshot,items)[0];
  assert.equal(restored.checklist[0].origin,candidate.origin);
  assert.equal(restored.checklist[0].title,'Confirm drain bolt in manual');
  assert.equal(restored.checklist[0].sourceId,'manual');
  assert.equal(restored.checklist[0].done,true);
  assert.equal(model.sanitize([{...restored,brief:{summary:'New brief'}}],items)[0].checklist[0].done,true);
  assert.equal(model.sanitize(snapshot,[])[0].checklist[0].sourceId,'');
});

test('older backups load an empty checklist and malformed tasks are ignored',()=>{
  assert.equal(model.sanitize([project],items)[0].checklist.length,0);
  const checklist=[null,{id:'blank',title:' '},{id:'one',title:'Check coolant',done:'yes'},
    {id:'one',title:'Duplicate'},{id:'two',title:'x'.repeat(400),sourceId:'missing'}];
  const restored=model.sanitize([{...project,checklist}],items)[0].checklist;
  assert.equal(restored.length,2);
  assert.equal(restored[0].done,false);
  assert.equal(restored[1].title.length,350);
  assert.equal(restored[1].sourceId,'');
});
