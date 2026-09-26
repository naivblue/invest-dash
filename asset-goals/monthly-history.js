(function(){
  'use strict';
  const KEY='invest-dash-monthly-history-v1';
  const INITIAL={version:1,base:{date:'2026-09-20',assets:639375646},records:[]};
  const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  const money=n=>Number.isSafeInteger(n);
  function validate(value){
    if(!value||value.version!==1||!value.base||!day(value.base.date)||!money(value.base.assets)||value.base.assets<0||!Array.isArray(value.records)) throw Error('기록 파일의 형식을 확인해주세요.');
    const months=new Set();
    const records=value.records.map(r=>{
      if(!r||!day(r.date)||r.date<=value.base.date||!money(r.assets)||r.assets<0||!money(r.flow)) throw Error('날짜와 금액을 확인해주세요. 월별 기준일은 최초 비교 기준일보다 뒤여야 합니다.');
      const month=r.date.slice(0,7);
      if(months.has(month)) throw Error('같은 달의 기록이 두 개 있습니다.');
      months.add(month);
      return {date:r.date,assets:r.assets,flow:r.flow};
    }).sort((a,b)=>a.date.localeCompare(b.date));
    return {version:1,base:{date:value.base.date,assets:value.base.assets},records};
  }
  function calculate(value){
    const data=validate(value);
    let flow=0,previous=data.base.assets;
    return [{...data.base,flow:0,cumulativeFlow:0,change:0,profit:0,periodProfit:0,baseline:true},...data.records.map(r=>{
      flow+=r.flow;
      const change=r.assets-data.base.assets,profit=change-flow,periodProfit=r.assets-previous-r.flow;
      previous=r.assets;
      return {...r,cumulativeFlow:flow,change,profit,periodProfit};
    })];
  }
  function upsert(value,record){
    const data=validate(value),month=record.date.slice(0,7);
    const old=data.records.find(r=>r.date.slice(0,7)===month);
    // 빠진 중간 달을 추가하면 다음 기록의 합산 순저축에서 그 달의 금액을 분리한다.
    if(!old){const next=data.records.find(r=>r.date>record.date);if(next)next.flow-=record.flow;}
    return validate({...data,records:[...data.records.filter(r=>r.date.slice(0,7)!==month),record]});
  }
  function remove(value,date){
    const data=validate(value),i=data.records.findIndex(r=>r.date===date);
    if(i<0) return data;
    // 중간 기록을 삭제해도 외부 입출금은 사라지지 않도록 다음 관측 기간에 합산한다.
    if(i<data.records.length-1) data.records[i+1].flow+=data.records[i].flow;
    data.records.splice(i,1);
    return validate(data);
  }
  function parseMoney(input){
    const s=String(input).replaceAll(',','').trim();
    if(!/^-?\d+$/.test(s)||!money(Number(s))) throw Error('금액은 원 단위 정수로 입력해주세요. 순저축액이 없으면 0을 입력하세요.');
    return Number(s);
  }
  if(typeof module!=='undefined'&&module.exports) module.exports={validate,calculate,upsert,remove,parseMoney,INITIAL};
  if(typeof document==='undefined') return;
  const el=id=>document.getElementById(id);
  const format=n=>n.toLocaleString('ko-KR')+'원';
  const signed=n=>(n>0?'+':'')+format(n);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const color=n=>n<0?'history-negative':n>0?'history-positive':'';
  let state=structuredClone(INITIAL),loadFailed=false;
  function status(message){el('historyStatus').textContent=message;}
  try{const saved=localStorage.getItem(KEY);if(saved)state=validate(JSON.parse(saved));}
  catch(e){loadFailed=true;status('기존 기록을 읽지 못했습니다. 저장된 원본을 덮어쓰지 않습니다. 백업 불러오기로 복원해주세요.');}
  function save(next,message,restore=false){
    try{
      if(loadFailed&&!restore) throw Error('기존 기록 보호를 위해 먼저 백업 파일을 불러와주세요.');
      const checked=validate(next),old=localStorage.getItem(KEY);
      if(old!==null)localStorage.setItem(KEY+'-previous',old);
      localStorage.setItem(KEY,JSON.stringify(checked));
      state=checked;loadFailed=false;render();status(message);return true;
    }catch(e){status('저장하지 못했습니다: '+e.message);return false;}
  }
  function chart(points,series,label){
    if(points.length===1)return '<div class="history-empty">월별 기록을 추가하면<br>누적 추이가 표시됩니다.</div><div class="history-legend">'+series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')+'</div>';
    const w=420,h=238,left=70,right=18,top=18,bottom=40;
    const values=points.flatMap(p=>series.map(s=>p[s.key]));
    let lo=Math.min(0,...values),hi=Math.max(0,...values);
    const pad=(hi-lo||10000)*.13;lo-=pad;hi+=pad;
    const x=i=>left+(points.length===1?(w-left-right)/2:i/(points.length-1)*(w-left-right));
    const y=v=>top+(hi-v)/(hi-lo)*(h-top-bottom);
    let svg=`<svg class="history-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title><desc>단위 만원. 점은 입력된 기준일의 실제 기록이며 선은 기록을 연결합니다.</desc>`;
    for(let i=0;i<5;i++){
      const v=lo+(hi-lo)*i/4,yy=y(v);
      svg+=`<line class="grid" x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})}</text>`;
    }
    svg+=`<text x="${left-8}" y="10" text-anchor="end">만원</text><line class="zero" x1="${left}" x2="${w-right}" y1="${y(0)}" y2="${y(0)}"/>`;
    const step=Math.max(1,Math.ceil(points.length/4));
    points.forEach((p,i)=>{
      if(i%step===0||i===points.length-1)svg+=`<text x="${x(i)}" y="${h-12}" text-anchor="middle">${p.date.slice(2,7)}</text>`;
    });
    series.forEach(s=>{
      svg+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash?'stroke-dasharray="5 4"':''} points="${points.map((p,i)=>x(i)+','+y(p[s.key])).join(' ')}"/>`;
      points.forEach((p,i)=>{svg+=`<circle tabindex="0" cx="${x(i)}" cy="${y(p[s.key])}" r="4" fill="${s.color}"><title>${p.date} · ${s.name}: ${signed(p[s.key])}</title></circle>`;});
    });
    return '<div class="history-chart-scroll">'+svg+'</svg></div><div class="history-legend">'+series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')+'</div>';
  }
  function render(){
    const points=calculate(state),last=points.at(-1);
    el('historySummary').innerHTML=[['최근 금융자산',last.assets,false],['누적 자산 증감',last.change,true],['누적 순저축액',last.cumulativeFlow,true],['누적 투자손익',last.profit,true]].map(([title,n,sign])=>`<div class="tile"><p class="k">${title}</p><p class="v ${sign?color(n):''}">${sign?signed(n):format(n)}</p></div>`).join('');
    el('historyAssetChart').innerHTML=chart(points,[{key:'change',name:'자산 증감 · 저축 포함',color:'var(--s1)'},{key:'cumulativeFlow',name:'누적 순저축',color:'var(--ink3)',dash:true}],'기준일 대비 누적 자산 증감과 순저축');
    el('historyProfitChart').innerHTML=chart(points,[{key:'profit',name:'투자손익 · 저축 제외',color:'var(--s3)'}],'기준일 대비 누적 투자손익');
    el('historyRange').textContent=state.base.date+' 기준 → '+last.date+' · '+state.records.length+'개 월별 기록. '+(state.records.length?'기록이 없는 달은 계산하지 않습니다. 선은 입력된 기록을 연결합니다.':'아직 월별 기록이 없습니다. 첫 기록을 저장하면 추이가 표시됩니다.');
    el('historyBaseDate').value=state.base.date;el('historyBaseAssets').value=state.base.assets.toLocaleString('ko-KR');
    el('historyRows').innerHTML=points.slice().reverse().map(p=>`<tr><td>${p.date}${p.baseline?' · 비교 기준':''}</td><td>${format(p.assets)}</td><td>${p.baseline?'—':signed(p.flow)}</td><td class="${color(p.periodProfit)}">${p.baseline?'—':signed(p.periodProfit)}</td><td class="${color(p.change)}">${signed(p.change)}</td><td class="${color(p.profit)}">${signed(p.profit)}</td><td>${p.baseline?'기준':`<div class="history-row-actions"><button type="button" data-edit="${p.date}">수정</button><button type="button" data-remove="${p.date}">삭제</button></div>`}</td></tr>`).join('');
  }
  el('historyDate').value=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  el('historyForm').onsubmit=e=>{
    e.preventDefault();
    try{
      const record={date:el('historyDate').value,assets:parseMoney(el('historyAssets').value),flow:parseMoney(el('historyFlow').value)};
      const next=upsert(state,record),old=state.records.find(r=>r.date.slice(0,7)===record.date.slice(0,7));
      if(old&&!confirm(record.date.slice(0,7)+' 기존 기록을 수정할까요? 이후 누적 금액도 다시 계산됩니다.'))return;
      const insertedBetween=!old&&state.records.some(r=>r.date>record.date);
      if(save(next,insertedBetween?'월별 기록을 저장했습니다. 다음 기록의 순저축액에서 이번 기간 금액을 분리했습니다.':'월별 기록을 저장했습니다.')){el('historyAssets').value='';el('historyFlow').value='';}
    }catch(error){status(error.message);}
  };
  el('historyBaseForm').onsubmit=e=>{
    e.preventDefault();
    try{
      const next=validate({...state,base:{date:el('historyBaseDate').value,assets:parseMoney(el('historyBaseAssets').value)}});
      if(state.records.length&&next.base.date!==state.base.date){status('기록이 있는 상태에서는 기준일을 옮길 수 없습니다. 각 기간의 순저축액을 함께 정리한 백업 파일로 불러와주세요.');return;}
      if(confirm('비교 기준을 변경하면 모든 누적 증감과 손익이 다시 계산됩니다. 저장할까요?'))save(next,'비교 기준을 저장했습니다.');
    }catch(error){status(error.message);}
  };
  el('historyRows').onclick=e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.dataset.edit){
      const r=state.records.find(r=>r.date===button.dataset.edit);
      el('historyDate').value=r.date;el('historyAssets').value=r.assets.toLocaleString('ko-KR');el('historyFlow').value=r.flow.toLocaleString('ko-KR');el('historyAssets').focus();
    }else if(button.dataset.remove){
      if(confirm('이 월 기록을 삭제할까요? 중간 기록이라면 순저축액은 다음 기록에 합산해 누적 손익을 유지합니다.'))save(remove(state,button.dataset.remove),'월별 기록을 삭제했습니다.');
    }
  };
  el('historyExport').onclick=()=>{
    if(loadFailed){status('기록을 읽지 못한 상태입니다. 먼저 원본 백업을 복원해주세요.');return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='monthly-assets-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  el('historyImport').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>1000000)throw Error('백업 파일은 1MB 이하로 선택해주세요.');
      const next=validate(JSON.parse(await file.text()));
      if(confirm('백업의 '+next.records.length+'개 월별 기록으로 현재 기록을 교체할까요?'))save(next,'백업을 불러왔습니다.',true);
    }catch(error){status('불러오지 못했습니다: '+error.message);}
    e.target.value='';
  };
  render();
})();
