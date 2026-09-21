import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../infinite-buying/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(){
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',style:{},innerHTML:'',textContent:''}); return elements.get(id);},querySelectorAll(){return [];}};
  const context=vm.createContext({document,window:{},localStorage:{getItem(){return null;},setItem(){}},console,confirm:()=>true,alert:()=>{},navigator:{},setTimeout});
  vm.runInContext(script,context);
  for(const id of ['inBuy','anSh','anAvg']) document.getElementById(id);
  return {elements,run:code=>vm.runInContext(code,context)};
}
test('account anchor above target requests confirmation, not a fictitious sale',()=>{
  const a=app();
  a.run("closes.push(['2026-09-22',79.08]); anchor={d:'2026-09-22',avg:71.0204,sh:37}; render();");
  assert.equal(a.run('replay().sh'),37);
  assert.match(a.elements.get('cycleStatus').innerHTML,/목표 도달/);
  assert.equal(a.run('window.__slip'),'');
  a.elements.get('closeCycle').onclick();
  assert.equal(a.run('replay().sh'),0);
  assert.match(a.elements.get('cycleStatus').innerHTML,/사이클 종료 · 전량 매도 확인/);
  a.run("closes.push(['2026-09-23',80]); render();");
  assert.equal(a.run('replay().sh'),0);
  assert.equal(a.run('window.__slip'),'');
});
test('zero buys still allows a target sale, and future closes do not restart buying',()=>{
  const a=app();
  a.run("closes.push(['2026-09-21',79.08,0],['2026-09-22',80]); render();");
  assert.equal(a.run('replay().sh'),0);
  assert.match(a.elements.get('cycleStatus').innerHTML,/사이클 종료 \(추정\)/);
  assert.equal(a.run('window.__slip'),'');
});
test('zero account holdings can close a cycle without an average price',()=>{
  const a=app();
  for(const [id,value] of Object.entries({inDate:'2026-09-21',inPx:'79.08',anSh:'0',anAvg:'',inBuy:'0'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('replay().confirmed'),true);
  assert.equal(a.run('replay().sh'),0);
});
test('confirmed cycle only restarts with explicit filled buys',()=>{
  const a=app();
  a.run("anchor={d:'2026-09-21',avg:0,sh:0}; closes.push(['2026-09-21',79.08,0],['2026-09-22',80,2]); render();");
  assert.equal(a.run('replay().sh'),2);
  assert.equal(a.run('replay().ended'),false);
});
