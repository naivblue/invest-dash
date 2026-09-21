import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../infinite-buying/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(storage=new Map()){
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',style:{},innerHTML:'',textContent:''}); return elements.get(id);},querySelectorAll(){return [];}};
  const context=vm.createContext({document,window:{},localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);}},console,confirm:()=>true,alert:()=>{},navigator:{},setTimeout});
  vm.runInContext(script,context);
  for(const id of ['inBuy','anSh','anAvg']) document.getElementById(id);
  return {elements,storage,run:code=>vm.runInContext(code,context)};
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
test('legacy closed history migrates once, survives reload, and isolates second cycle',()=>{
  const a=app();
  a.run("anchor={d:'2026-09-21',avg:0,sh:0}; closes.push(['2026-09-21',79.08,0]); render();");
  const b=app(a.storage);
  assert.equal(b.run('cycleNumber'),2);
  assert.equal(b.run('archives.length'),1);
  assert.equal(b.run('closes.length'),0);
  assert.equal(b.run('anchor'),null);
  assert.match(b.elements.get('cycleArchives').innerHTML,/1차 사이클 · 종료/);
  const archived=b.run('JSON.stringify(archives[0])');
  const c=app(b.storage);
  assert.equal(c.run('cycleNumber'),2);
  assert.equal(c.run('closes.length'),0);
  assert.equal(c.run('archives.length'),1);
  assert.equal(c.run('startNextCycle()'),false);
  c.run("closes.push(['2026-09-22',79,2]); render();");
  assert.equal(c.run('replay().sh'),2);
  assert.equal(c.run('replay().inv'),158);
  assert.equal(c.run('JSON.stringify(archives[0])'),archived);
  const d=app(c.storage);
  assert.equal(d.run('replay().sh'),2);
  assert.equal(d.run('closes.length'),1);
  assert.ok(d.storage.has('tqqq-v2-state-v4-before-cycle-1'));
});
test('next-cycle action preserves history and does not invent first purchases',()=>{
  const a=app();
  a.run("anchor={d:'2026-09-21',avg:0,sh:0}; closes.push(['2026-09-21',79.08,0]); render();");
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),2);
  assert.equal(a.run('archives[0].state.sh'),0);
  a.run("closes.push(['2026-09-22',79,0],['2026-09-23',78]); render();");
  assert.equal(a.run('replay().sh'),0);
});
test('storage failure leaves the completed cycle and its history intact',()=>{
  const a=app();
  a.run("anchor={d:'2026-09-21',avg:0,sh:0}; closes.push(['2026-09-21',79.08,0]); render();");
  const original=a.run('JSON.stringify({closes,anchor})');
  a.run("localStorage.setItem=()=>{throw Error('quota');}");
  assert.equal(a.run('startNextCycle()'),false);
  assert.equal(a.run('cycleNumber'),1);
  assert.equal(a.run('JSON.stringify({closes,anchor})'),original);
});
