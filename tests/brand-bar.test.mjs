import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('shared brand bar links back to the hub', () => {
  const html = readFileSync('index.html', 'utf8');

  assert.match(html, /class="fifi-brand-bar"/);
  assert.match(html, /href="https:\/\/olafifi\.github\.io\/fifi-tools\/"/);
  assert.match(html, /Fifi 工具站/);
  assert.match(html, /FIFI-Richly/);
  assert.match(html, /assets\/danbai\/praise-sun\.png/);
});
