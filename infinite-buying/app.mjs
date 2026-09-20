import { DEFAULT_STATE, applyMorningEntry, mergeState, orders, phase, roundOf } from './calculator.mjs';

const STORAGE_KEY = 'tqqq-v2-state-v4';
const $ = selector => document.querySelector(selector);
const money = value => `$${Number(value).toFixed(2)}`;

function load() {
  try {
    return mergeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return mergeState({});
  }
}

function save(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  state = next;
  render();
}

function render() {
  const round = roundOf(state);
  const currentPhase = phase(round);
  $('#round').textContent = `${round} / ${state.maxRounds}`;
  $('#shares').textContent = `${state.shares}주`;
  $('#average').textContent = money(state.averagePrice);
  $('#last-date').textContent = state.lastDate || '미입력';
  $('#orders').innerHTML = currentPhase === 'unsupported'
    ? '<article class="order sell"><strong>지원 종료</strong><p>40회차 이후 쿼터손절 규칙은 지원하지 않습니다.</p></article>'
    : orders(state).map(order => `<article class="order ${order.side}"><div class="k">${order.side === 'buy' ? '매수' : '매도'} · ${order.type}</div><strong>${order.quantity}주 @ ${money(order.price)}</strong><p>${order.label}</p></article>`).join('');
  $('#phase-note').innerHTML = currentPhase === 'first'
    ? '<b>전반전</b> · 평단과 평단 +5%에서 나눠 사고, +10%에서 전량 익절합니다.'
    : currentPhase === 'second'
      ? '<b>후반전</b> · 평단에서만 사고, +5%와 +10%에서 절반씩 익절합니다.'
      : '<b>40회차 도달</b> · 새 주문을 만들지 않습니다.';

  const morning = $('#morning-form').elements;
  morning.accountAveragePrice.value = state.averagePrice;
  morning.accountShares.value = state.shares;
  const settings = $('#settings-form').elements;
  for (const key of ['principalKrw', 'exchangeRate', 'perRoundShares', 'maxRounds']) settings[key].value = state[key];
  $('#history').innerHTML = state.history.length
    ? [...state.history].reverse().map(row => `<tr><td>${row.date}</td><td>${money(row.close)}</td><td>${money(row.averagePrice)}</td><td>${row.shares}</td><td>${row.round}</td></tr>`).join('')
    : '<tr><td colspan="5">새 링크에서 입력한 이력이 아직 없습니다.</td></tr>';
}

let state = load();
render();

$('#morning-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    $('#error').textContent = '';
    save(applyMorningEntry(state, values));
  } catch (error) {
    $('#error').textContent = error.message;
  }
});

$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const next = mergeState({
      ...state,
      principalKrw: Number(values.principalKrw),
      exchangeRate: Number(values.exchangeRate),
      perRoundShares: Number(values.perRoundShares),
    });
    orders(next);
    save(next);
  } catch (error) {
    $('#error').textContent = error.message;
  }
});

$('#reset').addEventListener('click', () => {
  if (confirm('새 링크에 저장된 설정과 이력을 초기 상태로 되돌릴까요?')) save(mergeState(DEFAULT_STATE));
});
