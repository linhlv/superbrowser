import test from 'node:test';
import assert from 'node:assert/strict';
import { tabBounds, restoreBounds, findBarBounds, SIDEBAR_W, GAP, BOTTOM_H } from './layout.ts';

test('layout constants', () => {
  assert.deepEqual([SIDEBAR_W, GAP, BOTTOM_H], [240, 8, 44]);
});

test('tabBounds with the sidebar visible', () => {
  assert.deepEqual(tabBounds({ width: 1400, height: 900 }, true), { x: 240, y: 8, width: 1152, height: 900 - 8 - 44 });
});

test('tabBounds with the sidebar hidden', () => {
  assert.deepEqual(tabBounds({ width: 1400, height: 900 }, false), { x: 8, y: 8, width: 1384, height: 900 - 8 - 44 });
});

const screens = [{ x: 0, y: 25, width: 1512, height: 920 }, { x: 1512, y: 0, width: 1920, height: 1055 }];
const fallback = { width: 1400, height: 900 };

test('restoreBounds keeps an on-screen rect', () => {
  const saved = { x: 1600, y: 100, width: 1200, height: 800 };
  assert.deepEqual(restoreBounds(saved, screens, fallback), saved);
});

test('restoreBounds drops an off-screen rect', () => {
  assert.deepEqual(restoreBounds({ x: 5000, y: 3000, width: 1200, height: 800 }, screens, fallback), fallback);
});

test('restoreBounds drops a rect with only a 50-px sliver on screen', () => {
  assert.deepEqual(restoreBounds({ x: -1150, y: 100, width: 1200, height: 800 }, screens, fallback), fallback);
});

test('restoreBounds without saved bounds uses the fallback', () => {
  assert.deepEqual(restoreBounds(null, screens, fallback), fallback);
});

test('findBarBounds: 320×44, 8 px from the tab rect\'s top and right edges', () => {
  assert.deepEqual(findBarBounds({ x: 240, y: 8, width: 1152, height: 852 }), { x: 1064, y: 16, width: 320, height: 44 });
  assert.deepEqual(findBarBounds({ x: 8, y: 8, width: 1384, height: 852 }), { x: 1064, y: 16, width: 320, height: 44 });
});
