import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {validate,calculate,upsert,remove,parseMoney}=require('../asset-goals/monthly-history.js');
const base={version:1,base:{date:'2026-12-31',assets:600000000},records:[]};

test('asset growth includes new savings while investment P/L excludes it',()=>{
  let s=upsert(base,{date:'2027-01-31',assets:615000000,flow:10000000});
  let p=calculate(s).at(-1);
  assert.equal(p.change,15000000);assert.equal(p.profit,5000000);
  s=upsert(s,{date:'2027-02-28',assets:610000000,flow:2000000});
  p=calculate(s).at(-1);
  assert.equal(p.change,10000000);assert.equal(p.cumulativeFlow,12000000);
  assert.equal(p.profit,-2000000);assert.equal(p.periodProfit,-7000000);
});
test('withdrawals do not look like investment losses, and pure deposits have zero P/L',()=>{
  const deposit=upsert(base,{date:'2027-01-31',assets:610000000,flow:10000000});
  assert.equal(calculate(deposit).at(-1).profit,0);
  const withdrawal=upsert(base,{date:'2027-01-31',assets:590000000,flow:-10000000});
  assert.equal(calculate(withdrawal).at(-1).profit,0);
});
test('edits replace one month and recompute subsequent cumulative values',()=>{
  let s=upsert(base,{date:'2027-01-30',assets:610000000,flow:10000000});
  s=upsert(s,{date:'2027-02-28',assets:620000000,flow:5000000});
  s=upsert(s,{date:'2027-01-31',assets:611000000,flow:8000000});
  assert.equal(s.records.length,2);
  assert.equal(calculate(s).at(-1).profit,7000000);
  assert.equal(calculate(s).at(-1).periodProfit,4000000);
});
test('adding or removing a middle snapshot preserves later total external flows and profit',()=>{
  const later=upsert(base,{date:'2027-03-31',assets:630000000,flow:20000000});
  const inserted=upsert(later,{date:'2027-01-31',assets:613000000,flow:10000000});
  assert.equal(inserted.records[1].flow,10000000);
  assert.equal(calculate(inserted).at(-1).profit,10000000);
  assert.deepEqual(remove(inserted,'2027-01-31'),later);
  assert.equal(later.records[0].flow,20000000); // pure functions never mutate the saved state
});
test('invalid and duplicate snapshots are rejected before storage',()=>{
  assert.throws(()=>upsert(base,{date:'2027-02-30',assets:1,flow:0}));
  assert.throws(()=>upsert(base,{date:'2026-12-31',assets:1,flow:0}));
  assert.throws(()=>upsert(base,{date:'2027-01-31',assets:-1,flow:0}));
  assert.throws(()=>upsert(base,{date:'2027-01-31',assets:100,flow:NaN}));
  assert.throws(()=>validate({...base,records:[{date:'2027-01-30',assets:1,flow:0},{date:'2027-01-31',assets:1,flow:0}]}));
  assert.throws(()=>parseMoney(''));
  assert.throws(()=>parseMoney('10만원'));
  assert.equal(parseMoney('-1,000,000'),-1000000);
  assert.equal(parseMoney('0'),0);
});

function browser(storage=new Map(),fail=false){
  const nodes=new Map();
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',focus(){}});return nodes.get(id);}};
  const context=vm.createContext({document,structuredClone,console,setTimeout,confirm:()=>true,localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(fail)throw Error('quota');storage.set(k,v);}}});
  vm.runInContext(readFileSync(new URL('../asset-goals/monthly-history.js',import.meta.url),'utf8'),context);
  for(const id of ['historyAssets','historyFlow'])document.getElementById(id);
  return {nodes,storage};
}
test('browser entry renders both charts, persists and survives reload',()=>{
  const a=browser();
  a.nodes.get('historyDate').value='2026-10-31';
  a.nodes.get('historyAssets').value='654,375,646';
  a.nodes.get('historyFlow').value='10,000,000';
  a.nodes.get('historyForm').onsubmit({preventDefault(){}});
  assert.match(a.nodes.get('historySummary').innerHTML,/\+5,000,000원/);
  assert.match(a.nodes.get('historyAssetChart').innerHTML,/polyline/);
  assert.match(a.nodes.get('historyProfitChart').innerHTML,/2026-10-31/);
  const b=browser(a.storage);
  assert.match(b.nodes.get('historyRows').innerHTML,/2026-10-31/);
  assert.match(b.nodes.get('historySummary').innerHTML,/\+15,000,000원/);
});
test('failed writes and corrupt stored data are reported without overwriting records',()=>{
  for(const [storage,fail] of [[new Map(),true],[new Map([['invest-dash-monthly-history-v1','broken']]),false]]){
    const a=browser(storage,fail);
    a.nodes.get('historyDate').value='2026-10-31';
    a.nodes.get('historyAssets').value='654375646';
    a.nodes.get('historyFlow').value='10000000';
    a.nodes.get('historyForm').onsubmit({preventDefault(){}});
    assert.match(a.nodes.get('historyStatus').textContent,/저장하지 못했습니다/);
    assert.doesNotMatch(a.nodes.get('historyRows').innerHTML,/2026-10-31/);
    if(!fail)assert.equal(storage.get('invest-dash-monthly-history-v1'),'broken');
  }
});
