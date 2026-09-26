import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pages = [
  { file: 'index.html', title: 'Market Dash' },
  { file: 'asset-goals/index.html', title: '8억 목표 달성판' },
  { file: 'infinite-buying/index.html', title: 'TQQQ 무한매수 V2.0' },
  { file: 'asset-trend/index.html', title: '2026년 금융 자산·손익 추이' },
];

for (const page of pages) {
  test(`${page.file} exposes the expected title and navigation`, async () => {
    const html = await readFile(new URL(`../${page.file}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<title>${page.title}</title>`));
    if (!page.standalone) {
      assert.match(html, /data-site-nav/);
      assert.match(html, /asset-goals\//);
      assert.match(html, /infinite-buying\//);
      assert.match(html, /asset-trend\//);
    }
  });
}

test('market dashboard inline script parses', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline script is present');
  assert.doesNotThrow(() => new Function(script));
});

test('infinite-buying page preserves the recovered Claude v24 interface', async () => {
  const html = await readFile(new URL('../infinite-buying/index.html', import.meta.url), 'utf8');
  for (const marker of [
    '무한매수 주문 계산기',
    '진행률',
    '주문 3건 예약',
    '오늘 밤 걸 주문',
    '매수 체결 주수',
    '선택일부터 계산',
    '1회 매수 주수 (자동)',
    '체결 이력',
    'V2.0 규칙',
    "const KEY='tqqq-v2-state-v4'",
    '["2026-09-17",71.38,1]',
    '["2026-09-18",72.64]',
    'fx:1351.1',
    "const ANCHOR0={d:'2026-09-18', avg:71.0204, sh:37}",
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('every page declares UTF-8 before Korean content', async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../${page.file}`, import.meta.url), 'utf8');
    const head = html.slice(0, 300).toLowerCase();
    assert.match(head, /<meta charset="utf-8">/, `${page.file} must declare UTF-8 early`);
  }
});

test('asset-trend page keeps its monthly data table editable in one place', async () => {
  const html = await readFile(new URL('../asset-trend/index.html', import.meta.url), 'utf8');
  /* 매달 DATA 에 한 줄만 추가하면 되는 구조가 유지되는지 */
  assert.match(html, /const DATA=\[/);
  assert.match(html, /\{m:'25\.12'/);
  assert.match(html, /\{m:'26\.09'/);
  /* 파생값은 DATA 에서 계산되어야 한다 — 따로 박아두면 갱신 때 어긋난다 */
  assert.match(html, /const TOT=DATA\.map/);
  assert.match(html, /const NM=M\.length/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline script is present');
  assert.doesNotThrow(() => new Function(script));
});
