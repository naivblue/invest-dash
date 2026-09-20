import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pages = [
  { file: 'index.html', title: 'Market Dash' },
  { file: 'asset-goals/index.html', title: '8억 목표 달성판' },
  { file: 'infinite-buying/index.html', title: 'TQQQ 무한매수 계산기' },
];

for (const page of pages) {
  test(`${page.file} exposes the expected title and navigation`, async () => {
    const html = await readFile(new URL(`../${page.file}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<title>${page.title}</title>`));
    assert.match(html, /data-site-nav/);
    assert.match(html, /asset-goals\//);
    assert.match(html, /infinite-buying\//);
  });
}

test('market dashboard inline script parses', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline script is present');
  assert.doesNotThrow(() => new Function(script));
});

test('every page declares UTF-8 before Korean content', async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../${page.file}`, import.meta.url), 'utf8');
    const head = html.slice(0, 300).toLowerCase();
    assert.match(head, /<meta charset="utf-8">/, `${page.file} must declare UTF-8 early`);
  }
});
