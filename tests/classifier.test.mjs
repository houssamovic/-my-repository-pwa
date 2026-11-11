import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({URL,globalThis:null});context.globalThis=context;
vm.runInContext(fs.readFileSync(new URL('../site/classifier.js',import.meta.url),'utf8'),context);
const classify=context.RepositoryClassifier.classify;
const base=['DIY','Food & Recipes','Travel','Technology','Reading','Unsorted'];
const check=(input)=>classify({...input,existingCategories:base}).category;
test('classifies game-specific YouTube title into an on-demand Gaming category',()=>{
  assert.equal(check({title:'What 3 Keys of Boat Captain Unlock in GoW Valhalla?',url:'https://youtube.com/shorts/abc'}),'Gaming');
});
test('classifies DIY and recipes',()=>{
  assert.equal(check({title:'How to repair drywall',url:'https://example.org/drywall'}),'DIY');
  assert.equal(check({title:'Sourdough bread baking recipe',url:'https://example.org/bake'}),'Food & Recipes');
});
test('does not classify social IDs or generic titles',()=>{
  assert.equal(check({title:'Instagram reel',description:'Instagram reel · Shared link (content not analyzed)',url:'https://www.instagram.com/reel/ABCDEFG/'}),'Unsorted');
  assert.equal(check({title:'What a surprising moment!',url:'https://www.youtube.com/shorts/k324'}),'Unsorted');
});
test('avoids substring collisions',()=>{
  assert.equal(check({title:'A walk through Warsaw',url:'https://www.example.org/warsaw/'}),'Unsorted');
});
test('rejects ambiguous competing topics',()=>{
  assert.equal(check({title:'Movie review and music',description:'',url:'https://example.org/x'}),'Unsorted');
});
