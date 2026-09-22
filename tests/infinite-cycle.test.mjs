import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../infinite-buying/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const SALE_FLAG='tqqq-v2-state-v4-first-sale-v4-realized';
const PREVIOUS_SALE_FLAG='tqqq-v2-state-v4-first-sale-v3';
/* 기본값은 1회차 매도 정정을 이미 끝낸 기기 — 사이클 기본 동작을 그대로 검증한다.
   correct=true 면 정정 전 기기처럼 열어 마이그레이션 자체를 검증한다. */
function app(storage=new Map(),correct=false){
  if(!correct){storage.set(SALE_FLAG,'1'); storage.set(PREVIOUS_SALE_FLAG,'1');}
  else {storage.delete(SALE_FLAG); storage.delete(PREVIOUS_SALE_FLAG);}
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
test('a completed cycle shows its closing state and final return, not zeros',()=>{
  const a=app(new Map(),true);
  a.elements.get('cycleTab1').onclick();
  const strip=a.elements.get('strip').innerHTML;
  assert.match(strip,/매입평균 <small>계좌 확인<\/small>/);
  assert.match(strip,/\$71\.0203/);
  assert.match(strip,/매도평균 <small>계좌 확인<\/small>/);
  assert.match(strip,/\$78\.12/);
  assert.match(strip,/\$79\.08/); // 매도일 종가는 체결 평균과 별도 보존
  assert.match(strip,/실현 수익률/);
  assert.match(strip,/\+9\.82/);
  assert.match(strip,/\$258\.30/);
  assert.doesNotMatch(strip,/\$0\.0000/);
  assert.match(a.elements.get('cycleStatus').innerHTML,/최종 수익률[\s\S]*\+11\.35%/);
  assert.match(a.elements.get('cycleStatus').innerHTML,/실현 수익률[\s\S]*\+9\.82%/);
  assert.match(a.elements.get('cycleStatus').innerHTML,/실현손익[\s\S]*\$258\.30/);
  assert.match(a.elements.get('log').innerHTML,/계좌 확인 37주/);
  a.elements.get('cycleTab2').onclick();
  assert.match(a.elements.get('cycleArchives').innerHTML,/최종 수익률[\s\S]*\+11\.35%/);
  assert.match(a.elements.get('cycleArchives').innerHTML,/실현 수익률[\s\S]*\+9\.82%/);
  assert.match(a.elements.get('cycleArchives').innerHTML,/실현손익[\s\S]*\$258\.30/);
  assert.equal(a.run('archives.find(x=>x.number===1).realizedReturnPct'),9.82);
  assert.equal(a.run('archives.find(x=>x.number===1).realizedProfitUsd'),258.30);
  const b=app(a.storage);
  assert.equal(b.run('archives[0].buyAverageUsd'),71.0203);
  assert.equal(b.run('archives[0].sellAverageUsd'),78.12);
  b.elements.get('cycleTab1').onclick();
  assert.match(b.elements.get('cycleStatus').innerHTML,/매입평균 \$71\.0203 · 매도평균 \$78\.12/);
});
test('an earlier correction that wiped the account anchor is redone from the backup',()=>{
  const a=app();
  // v2 정정이 끝난 기기: 기준점이 매도일 0주로 덮여 평단이 종가 추정으로 남아 있다
  a.run("closes=closes.filter(c=>c[0]<'2026-09-22').concat([['2026-09-22',79.08,0,0]]); anchor={d:'2026-09-22',avg:0,sh:0}; startNextCycle();");
  a.storage.set('tqqq-v2-state-v4-before-first-sale-correction',JSON.stringify({
    cfg:{P:10000000,fx:1351.1,T:40,Q:2},
    closes:[["2026-08-17",77.18],["2026-09-17",71.38,1],["2026-09-18",72.64]],
    anchor:{d:'2026-09-18',avg:71.0204,sh:37}, cycleNumber:1, archives:[], referenceClose:null}));
  assert.equal(a.run('archives[0].anchor.sh'),0);
  const b=app(a.storage,true);
  assert.equal(b.run('archives[0].anchor.avg'),71.0204);      // 계좌 평단이 되살아난다
  assert.equal(b.run('archives[0].state.sh'),0);
  assert.equal(b.run('archives[0].state.confirmed'),true);
  b.elements.get('cycleTab1').onclick();
  assert.match(b.elements.get('strip').innerHTML,/\$71\.0203/);
  assert.match(b.elements.get('strip').innerHTML,/\+9\.82/);
});
test('a second cycle shows the same summary while running and when completed',()=>{
  const a=app(new Map(),true);          // 1회차 정정이 돌아 2회차가 열린 상태
  // 2회차 시작: 첫 매수 2주, 추가 매수, 계좌 평단 반영
  a.run("closes.push(['2026-09-23',80,2],['2026-09-24',78,2]); anchor={d:'2026-09-24',avg:78.9500,sh:4}; render();");
  assert.equal(a.run('cycleNumber'),2);
  const live=a.elements.get('strip').innerHTML;
  assert.match(live,/평단<\/p>/);                       // 진행 중에는 '매도 전' 꼬리표가 없다
  assert.match(live,/\$78\.9500/);
  assert.match(live,/보유<\/p>/);
  assert.match(live,/평가손익/);
  assert.doesNotMatch(live,/최종 수익률/);

  // 전량 매도 완료 버튼 — 평단을 지우지 않고 매도 주수를 기록한다
  a.elements.get('inDate').value='2026-09-25';
  a.elements.get('inPx').value='86.85';
  a.elements.get('closeCycle').onclick();
  assert.equal(a.run('replay().sh'),0);
  assert.equal(a.run('replay().confirmed'),true);
  assert.equal(a.run('anchor.avg'),78.95);              // 계좌 평단이 살아 있다
  const done=a.elements.get('strip').innerHTML;
  assert.match(done,/평단 <small>매도 전<\/small>/);
  assert.match(done,/\$78\.9500/);
  assert.match(done,/매도 <small>전량<\/small>/);
  assert.match(done,/4<small>주<\/small>/);
  assert.match(done,/최종 수익률/);
  assert.match(done,/\+10\.01/);                       // 86.85 / 78.95 - 1
  assert.doesNotMatch(done,/\$0\.0000/);
  assert.equal(a.elements.get('cycleTitle').textContent,'2회차 · 완료');

  // 3회차를 열면 2회차도 1회차와 같은 형식으로 보관된다
  a.elements.get('newCycle').onclick();
  assert.equal(a.run('cycleNumber'),3);
  const arch=a.elements.get('cycleArchives').innerHTML;
  assert.match(arch,/2차 사이클 · 완료/);
  assert.match(arch,/매도 전 4주 · 평단 \$78\.9500/);
  assert.match(arch,/최종 수익률[\s\S]*\+10\.01%/);
  assert.match(a.elements.get('cycleTabs').innerHTML,/2회차 · 완료/);
  a.elements.get('cycleTab2').onclick();
  assert.match(a.elements.get('cycleStatus').innerHTML,/최종 수익률[\s\S]*\+10\.01%/);
  assert.match(a.elements.get('log').innerHTML,/\+10\.01%/);
});
