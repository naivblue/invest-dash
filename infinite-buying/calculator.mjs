export const DEFAULT_STATE = Object.freeze({
  version: 4,
  ticker: 'TQQQ',
  principalKrw: 10_000_000,
  exchangeRate: 1_381,
  perRoundShares: 2,
  maxRounds: 40,
  shares: 35,
  averagePrice: 70.9638,
  lastDate: '2026-09-16',
  lastClose: null,
  history: [],
});

const finite = (value, label, { allowZero = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  return number;
};

const cents = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function mergeState(saved = {}) {
  const candidate = saved && typeof saved === 'object' ? saved : {};
  return {
    ...DEFAULT_STATE,
    ...candidate,
    version: DEFAULT_STATE.version,
    history: Array.isArray(candidate.history) ? candidate.history : [],
  };
}

export function roundOf(state) {
  const perRoundShares = finite(state.perRoundShares, '1회 주수');
  const shares = finite(state.shares, '보유 주수', { allowZero: true });
  return Math.round((shares / perRoundShares) * 100) / 100;
}

export function phase(round) {
  const value = finite(round, '회차', { allowZero: true });
  if (value >= 40) return 'unsupported';
  return value >= 20 ? 'second' : 'first';
}

export function orders(state) {
  const averagePrice = finite(state.averagePrice, '평단');
  const shares = Math.trunc(finite(state.shares, '보유 주수', { allowZero: true }));
  const perRoundShares = Math.trunc(finite(state.perRoundShares, '1회 주수'));
  const currentPhase = phase(roundOf({ ...state, shares, perRoundShares }));
  if (currentPhase === 'unsupported') return [];

  if (currentPhase === 'first') {
    const atAverage = Math.ceil(perRoundShares / 2);
    const aboveAverage = perRoundShares - atAverage;
    return [
      { side: 'buy', type: 'LOC', quantity: atAverage, price: cents(averagePrice), label: '평단 매수' },
      ...(aboveAverage ? [{ side: 'buy', type: 'LOC', quantity: aboveAverage, price: cents(averagePrice * 1.05), label: '+5% 매수' }] : []),
      { side: 'sell', type: 'LIMIT', quantity: shares, price: cents(averagePrice * 1.1), label: '+10% 익절' },
    ];
  }

  const firstSell = Math.floor(shares / 2);
  return [
    { side: 'buy', type: 'LOC', quantity: perRoundShares, price: cents(averagePrice), label: '평단 매수' },
    { side: 'sell', type: 'LIMIT', quantity: firstSell, price: cents(averagePrice * 1.05), label: '+5% 익절' },
    { side: 'sell', type: 'LIMIT', quantity: shares - firstSell, price: cents(averagePrice * 1.1), label: '+10% 익절' },
  ];
}

export function applyMorningEntry(state, entry) {
  if (!entry?.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error('거래일을 YYYY-MM-DD로 입력하세요.');
  }
  const close = finite(entry.close, '종가');
  const averagePrice = finite(entry.accountAveragePrice, '계좌 평단');
  const shares = Math.trunc(finite(entry.accountShares, '계좌 보유 주수', { allowZero: true }));
  const next = mergeState({
    ...state,
    lastDate: entry.date,
    lastClose: close,
    averagePrice,
    shares,
  });
  const historyRow = {
    date: entry.date,
    close,
    averagePrice,
    shares,
    round: roundOf(next),
  };
  return {
    ...next,
    history: [...next.history.filter(row => row.date !== entry.date), historyRow]
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
