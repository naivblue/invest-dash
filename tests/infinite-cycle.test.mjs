import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../infinite-buying/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const SALE_FLAG='tqqq-v2-state-v4-first-sale-v2';
/* 기본값은 1회차 매도 정정을 이미 끝낸 기기 — 사이클 기본 동작을 그대로 검증한다.
   correct=true 면 정정 전 기기처럼 열어 마이그레이션 자체를 검증한다. */
function app(storage=new Map(),correct=false){
  if(!correct) storage.set(SALE_FLAG,'1'); else storage.delete(SALE_FLAG);
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
  assert.match(a.elements.get('cycleStatus').innerHTML,/사이클 완료 · 전량 매도 확인/);
  a.run("closes.push(['2026-09-23',80]); render();");
  assert.equal(a.run('replay().sh'),0);
  assert.equal(a.run('window.__slip'),'');
});
test('zero buys still allows a target sale, and future closes do not restart buying',()=>{
  const a=app();
  a.run("closes.push(['2026-09-21',79.08,0],['2026-09-22',80]); render();");
  assert.equal(a.run('replay().sh'),0);
  assert.match(a.elements.get('cycleStatus').innerHTML,/사이클 완료 \(추정\)/);
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
  assert.match(b.elements.get('cycleArchives').innerHTML,/1차 사이클 · 완료/);
  const archived=b.run('JSON.stringify(archives[0])');
  const c=app(b.storage);
  assert.equal(c.run('cycleNumber'),2);
  assert.equal(c.run('closes.length'),0);
  assert.equal(c.run('archives.length'),1);
  assert.equal(c.elements.get('newCycle').disabled,false);
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
test('cycle buttons switch between archived and current histories without overwriting storage',()=>{
  const a=app();
  a.run("anchor={d:'2026-09-21',avg:0,sh:0}; closes.push(['2026-09-21',79.08,0]); startNextCycle(); closes.push(['2026-09-22',80,2]); render();");
  const before=a.storage.get('tqqq-v2-state-v4');
  assert.match(a.elements.get('cycleTabs').innerHTML,/1회차 · 완료/);
  assert.match(a.elements.get('cycleTabs').innerHTML,/2회차/);
  a.elements.get('cycleTab1').onclick();
  assert.equal(a.elements.get('cycleTitle').textContent,'1회차 · 완료');
  assert.match(a.elements.get('log').innerHTML,/2026-08-17/);
  assert.equal(a.elements.get('apply').disabled,true);
  assert.equal(a.storage.get('tqqq-v2-state-v4'),before);
  assert.equal(a.run('cycleNumber'),2);
  a.elements.get('cycleTab2').onclick();
  assert.equal(a.elements.get('cycleTitle').textContent,'2회차 · 진행 중');
  assert.doesNotMatch(a.elements.get('log').innerHTML,/2026-08-17/);
  assert.match(a.elements.get('log').innerHTML,/2026-09-22/);
  assert.equal(a.elements.get('apply').disabled,false);
  assert.equal(a.storage.get('tqqq-v2-state-v4'),before);
});
test('next-cycle button works with holdings and never asks or fabricates a sale',()=>{
  const a=app();
  a.run("closes.push(['2026-09-22',79.08]); anchor={d:'2026-09-22',avg:71.0204,sh:37}; render();");
  assert.equal(a.elements.get('newCycle').disabled,false);
  a.run("confirm=()=>{throw Error('must not ask');}");
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),2);
  assert.equal(a.run('archives[0].state.sh'),37);
  assert.equal(a.run('archives[0].state.confirmed'),false);
  assert.equal(a.run('closes.length'),0);
  a.elements.get('cycleTab1').onclick();
  assert.match(a.elements.get('log').innerHTML,/계좌 확인 37주/);
});
test('failing persistence preserves existing holdings',()=>{
  const a=app();
  const before=a.run('JSON.stringify({closes,anchor})');
  a.run("localStorage.setItem=()=>{throw Error('quota');}");
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),1);
  assert.equal(a.run('JSON.stringify({closes,anchor})'),before);
});
test('creation is enabled even for an empty active cycle',()=>{
  const a=app();
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),2);
  assert.equal(a.elements.get('newCycle').disabled,false);
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),3);
  assert.equal(a.run('closes.length'),0);
});
test('user-confirmed first-cycle sale corrects archived holdings without changing second-cycle trades',()=>{
  const a=app();
  a.run("closes.push(['2026-09-22',79.08]); anchor={d:'2026-09-22',avg:71.0204,sh:37}; startNextCycle(); closes.push(['2026-09-23',80,2]); render();");
  assert.equal(a.run('archives[0].state.sh'),37);
  const b=app(a.storage,true);
  assert.equal(b.run('archives[0].state.sh'),0);
  assert.equal(b.run('archives[0].state.confirmed'),true);
  assert.equal(b.run('archives[0].saleConfirmedByUser'),true);
  assert.equal(b.run('replay().sh'),2);
  assert.equal(b.run('closes[0][0]'),'2026-09-23');
  b.elements.get('cycleTab1').onclick();
  assert.match(b.elements.get('cycleTitle').textContent,/1회차 · 완료/);
  assert.equal(b.run('archives[0].end'),'2026-09-22');
  assert.equal(b.run('archives[0].closes.at(-1)[1]'),79.08);
  assert.match(b.elements.get('log').innerHTML,/전량 매도 확인/);
  const c=app(b.storage);
  assert.equal(c.run('archives[0].state.sh'),0);
  assert.equal(c.run('replay().sh'),2);
});
test('a browser still on the first cycle closes it and opens the second one',()=>{
  const a=app(new Map(),true);
  assert.equal(a.run('cycleNumber'),2);
  assert.equal(a.run('archives[0].state.sh'),0);
  assert.equal(a.run('archives[0].state.confirmed'),true);
  assert.equal(a.run('archives[0].end'),'2026-09-22');
  assert.match(a.elements.get('cycleTabs').innerHTML,/1회차 · 완료/);
  assert.equal(a.elements.get('cycleTitle').textContent,'2회차 · 첫 매수 대기');
  // 두 번째 방문에서 또 손대지 않는다
  const b=app(a.storage,false);
  assert.equal(b.run('cycleNumber'),2);
  assert.equal(b.run('archives.length'),1);
  assert.equal(b.run('closes.length'),0);
});
