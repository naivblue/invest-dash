import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_STATE,
  applyMorningEntry,
  mergeState,
  orders,
  phase,
} from '../infinite-buying/calculator.mjs';

test('mergeState keeps saved values and restores newly added defaults', () => {
  const state = mergeState({ shares: 31, averagePrice: 71.23 });
  assert.equal(state.shares, 31);
  assert.equal(state.averagePrice, 71.23);
  assert.equal(state.perRoundShares, DEFAULT_STATE.perRoundShares);
  assert.deepEqual(state.history, []);
});

test('phase changes at round 20 and stops at round 40', () => {
  assert.equal(phase(19.5), 'first');
  assert.equal(phase(20), 'second');
  assert.equal(phase(40), 'unsupported');
});

test('first-half orders split the round and sell all at average plus 10%', () => {
  const result = orders({ shares: 35, averagePrice: 70.9638, perRoundShares: 2 });
  assert.deepEqual(result, [
    { side: 'buy', type: 'LOC', quantity: 1, price: 70.96, label: '평단 매수' },
    { side: 'buy', type: 'LOC', quantity: 1, price: 74.51, label: '+5% 매수' },
    { side: 'sell', type: 'LIMIT', quantity: 35, price: 78.06, label: '+10% 익절' },
  ]);
});

test('second-half orders buy only at average and split sells at 5% and 10%', () => {
  const result = orders({ shares: 41, averagePrice: 50, perRoundShares: 2 });
  assert.deepEqual(result, [
    { side: 'buy', type: 'LOC', quantity: 2, price: 50, label: '평단 매수' },
    { side: 'sell', type: 'LIMIT', quantity: 20, price: 52.5, label: '+5% 익절' },
    { side: 'sell', type: 'LIMIT', quantity: 21, price: 55, label: '+10% 익절' },
  ]);
});

test('applyMorningEntry uses account truth and records one history row', () => {
  const state = mergeState({ history: [] });
  const next = applyMorningEntry(state, {
    date: '2026-09-17',
    close: 72.1,
    accountAveragePrice: 70.9638,
    accountShares: 35,
  });
  assert.equal(next.lastDate, '2026-09-17');
  assert.equal(next.lastClose, 72.1);
  assert.equal(next.averagePrice, 70.9638);
  assert.equal(next.shares, 35);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].round, 17.5);
});

test('invalid account values are rejected', () => {
  assert.throws(() => orders({ shares: 0, averagePrice: -1, perRoundShares: 2 }), /평단/);
  assert.throws(
    () => applyMorningEntry(mergeState({}), { date: '', close: 0, accountAveragePrice: 70, accountShares: 35 }),
    /거래일/,
  );
});
