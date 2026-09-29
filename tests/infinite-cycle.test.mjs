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
  const document={getElementById(id){if(!elements.has(id)) elements.set(id,{value:'',style:{},dataset:{},innerHTML:'',textContent:''}); return elements.get(id);},querySelectorAll(){return [];}};
  const context=vm.createContext({document,window:{},localStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);}},console,confirm:()=>true,alert:()=>{},navigator:{},setTimeout});
  vm.runInContext(script,context);
  for(const id of ['inBuy','anAvg']) document.getElementById(id);
  return {elements,storage,run:code=>vm.runInContext(code,context)};
}
function setting(a,id,value){
  const field=a.elements.get(id);
  field.value=String(value);
  field.onchange({target:field});
}
test('second-cycle sizing follows budget, FX, divisions and reference price without altering first-cycle history',()=>{
  const a=app(new Map(),true);
  const first=a.run('JSON.stringify(archives[0])');
  setting(a,'cfgP',20000000);
  setting(a,'cfgFx',1351.1);
  setting(a,'cfgT',30);
  assert.equal(a.run('cfg.sizingPrice'),79.08);
  assert.equal(a.run('cfg.Q'),6);
  assert.match(a.elements.get('sizingNote').textContent,/666,667원/);
  assert.match(a.elements.get('orders').innerHTML,/첫 매수 6주/);
  assert.equal(a.elements.get('pTotal').textContent,30);
  assert.equal(a.elements.get('pHalfMark').dataset.l,'15 후반전');
  setting(a,'cfgPrice',100);
  assert.equal(a.run('cfg.Q'),4);
  setting(a,'cfgFx',1000);
  assert.equal(a.run('cfg.Q'),6);
  setting(a,'cfgT',40);
  assert.equal(a.run('cfg.Q'),5);
  setting(a,'cfgT',30.5);
  assert.equal(a.run('cfg.T'),40);
  assert.equal(a.run('closes.length'),0);
  assert.equal(a.run('JSON.stringify(archives[0])'),first);
  const b=app(a.storage);
  assert.equal(b.run('cfg.Q'),5);
  assert.equal(b.run('cfg.sizingPrice'),100);
});
test('chosen cycle start persists, drives first trade date and never creates or removes fills',()=>{
  const a=app(new Map(),true);
  setting(a,'cfgStart','2026-09-28');
  assert.equal(a.run('cfg.startDate'),'2026-09-28');
  assert.equal(a.elements.get('inDate').value,'2026-09-28');
  assert.equal(a.run('closes.length'),0);
  for(const [id,value] of Object.entries({inDate:'2026-09-25',inPx:'78',inBuy:'6'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('closes.length'),0);
  a.elements.get('inDate').value='2026-09-28';
  a.elements.get('apply').onclick();
  assert.equal(a.run('replay().sh'),6);
  const before=a.run('JSON.stringify(closes)');
  setting(a,'cfgStart','2026-09-29');
  assert.equal(a.run('cfg.startDate'),'2026-09-28');
  assert.equal(a.run('JSON.stringify(closes)'),before);
  const b=app(a.storage);
  assert.equal(b.run('cfg.startDate'),'2026-09-28');
  assert.equal(b.run('replay().sh'),6);
  b.elements.get('cycleTab1').onclick();
  assert.equal(b.elements.get('cfgStart').disabled,true);
  assert.equal(b.elements.get('reset').disabled,true);
});
test('auto-sizing handles zero and odd lots, and 30 divisions switch at 15',()=>{
  const a=app(new Map(),true);
  setting(a,'cfgFx',1000);
  setting(a,'cfgT',30);
  setting(a,'cfgPrice',100);
  setting(a,'cfgP',21000000);
  assert.equal(a.run('cfg.Q'),7);
  assert.equal(a.run('guessBuy(100,100,7,1)'),7);
  assert.equal(a.run('guessBuy(104,100,98,14)'),4);
  assert.equal(a.run('guessBuy(104,100,105,15)'),0);
  setting(a,'cfgP',1000);
  assert.equal(a.run('cfg.Q'),0);
  assert.match(a.elements.get('orders').innerHTML,/1회 예산으로 1주를 살 수 없습니다/);
  assert.doesNotMatch(a.elements.get('strip').innerHTML,/NaN|Infinity/);
  assert.equal(a.run('window.__slip'),'');
  assert.equal(app(a.storage).run('cfg.Q'),0);
});
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
test('the sell-all button closes a cycle without an average price',()=>{
  const a=app();
  for(const [id,value] of Object.entries({inDate:'2026-09-21',inPx:'79.08',anAvg:''})) a.elements.get(id).value=value;
  a.elements.get('closeCycle').onclick();
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

/* 2026-09-29 사용자 보고: 2회차 첫 매수를 넣었는데 "전량 매도 확인 · 사이클 완료"로 찍히고 보유가 0이 됐다.
   사기 전 계좌 보유가 0인 것은 당연한데, 그 0을 "다 팔아서 비었다"는 확인으로 읽은 것이 원인이다. */
test('a first buy of a new cycle is not read as a confirmed sell-off just because holdings were zero',()=>{
  const a=app(new Map(),true);
  for(const [id,value] of Object.entries({inDate:'2026-09-29',inPx:'80',inBuy:'5'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('replay().sh'),5,'산 주식이 남아 있어야 한다');
  assert.equal(a.run('replay().ended'),false,'첫 매수로 사이클이 끝나면 안 된다');
  assert.equal(a.run('JSON.stringify(replay().rows.at(-1).hit)').includes('전량 매도'),false);
});

/* 잘못 들어간 기준점은 같은 날짜를 다시 입력하면 지워져야 한다 (행이 하나뿐이라 되돌리기가 안 먹는다) */
test('re-entering the same day without account values clears a stale anchor',()=>{
  const a=app(new Map(),true);
  for(const [id,value] of Object.entries({inDate:'2026-09-29',inPx:'80',inBuy:'0',anAvg:'80'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('anchor && anchor.avg'),80);
  for(const [id,value] of Object.entries({inDate:'2026-09-29',inPx:'80',inBuy:'5',anAvg:''})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('anchor'),null,'계좌 값을 비우고 다시 넣으면 기준점이 사라져야 한다');
  assert.equal(a.run('replay().sh'),5);
});

/* 1회 4주 설정에서 9/28 4주 · 9/29 2주 매수 = 6주. 표의 회차는 거래 후 보유÷1회주수(1.0 · 1.5)이고
   보유주수는 입력받지 않고 체결 주수로 계산한다 (2026-09-30 사용자 요청) */
test('table round is post-trade holdings over lot size, and holdings come from filled buys, not a separate field',()=>{
  const a=app(new Map(),true);
  setting(a,'cfgT',20);
  assert.equal(a.run('cfg.Q'),4);
  for(const [id,value] of Object.entries({inDate:'2026-09-28',inPx:'78',inBuy:'4'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  for(const [id,value] of Object.entries({inDate:'2026-09-29',inPx:'82',inBuy:'2',anAvg:'79.3'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('replay().sh'),6);
  assert.equal(a.run('anchor.sh'),null);
  const rows=a.elements.get('log').innerHTML.split('<tr').slice(1);
  assert.equal(rows.length,2);
  assert.match(rows[0],/2026-09-29/); assert.match(rows[0],/>1\.5</); assert.match(rows[0],/6주<\/td>/);
  assert.match(rows[0],/매수 2주 @\$82\.00 \+ 계좌 확인 6주 · 평단 \$79\.3000/);
  assert.match(rows[1],/2026-09-28/); assert.match(rows[1],/>1\.0</); assert.match(rows[1],/>4주<\/td>/);
  assert.equal(a.elements.get('pRound').textContent,'1.5');
});

test('a device whose 9/29 anchor still carries the old holdings field is corrected once to 6 shares',()=>{
  const storage=new Map();
  storage.set('tqqq-v2-state-v4',JSON.stringify({cycleNumber:2,archives:[],referenceClose:{d:'2026-09-22',px:79.08},cfg:{P:10000000,fx:1351.1,T:40,Q:2,sizingPrice:79.08,autoSizing:true},
    closes:[['2026-09-28',78,2,0],['2026-09-29',82,null,0]],anchor:{d:'2026-09-29',avg:79.3,sh:4}}));
  const a=app(storage);
  assert.equal(a.run('replay().sh'),6);
  assert.equal(a.run('anchor.sh'),null);
  assert.equal(a.run('cfg.Q'),4); assert.equal(a.run('cfg.T'),20);
  assert.equal(a.elements.get('pRound').textContent,'1.5');
  assert.match(a.elements.get('log').innerHTML.split('<tr').slice(1)[0],/>1\.5<[\s\S]*6주<\/td>/);
  const b=app(a.storage);
  assert.equal(b.run('replay().sh'),6,'다시 열어도 유지');
});
/* 2회차엔 종가 자동 갱신이 없다. 날짜 칸이 마지막 입력일에 머물면 다음 아침 [반영]이 그 행을 덮어쓴다 */
test('after a morning entry in a later cycle the date field moves to the next trading day and the close is blank',()=>{
  const a=app(new Map(),true);
  for(const [id,value] of Object.entries({inDate:'2026-09-29',inPx:'82',inBuy:'2',anAvg:'79.3'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.elements.get('inDate').value,'2026-09-30');
  assert.equal(a.elements.get('inPx').value,'');
  for(const [id,value] of Object.entries({inPx:'83',inBuy:'2',anAvg:'80.5'})) a.elements.get(id).value=value;
  a.elements.get('apply').onclick();
  assert.equal(a.run('closes.length'),2,'새 날짜로 쌓여야 한다');
  assert.equal(a.run('replay().sh'),4);
  assert.equal(a.elements.get('inDate').value,'2026-10-01');
});
