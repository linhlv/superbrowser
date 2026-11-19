import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, luminance, readableTint, textOn, MAX_TOP_LUMINANCE } from './colors.ts';

const topOf = (hex: string): number => {
  // The window gradient's lightest point: 70 % tint, 30 % black (ui.css).
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * 0.7).toString(16).padStart(2, '0');
  return luminance(`#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`);
};

test('luminance and contrast follow WCAG', () => {
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#000000'), 0);
  assert.equal(Math.round(contrast('#ffffff', '#000000') * 10) / 10, 21);
  assert.equal(Math.round(contrast('#767676', '#ffffff') * 10) / 10, 4.5);
});

test('readableTint: dark enough colours are kept as they are', () => {
  assert.equal(readableTint('#3366cc'), '#3366cc');
  assert.equal(readableTint('#000000'), '#000000');
});

test('readableTint: light colours are darkened until white text reads on the gradient, keeping the hue', () => {
  for (const hex of ['#ffeb3b', '#ffffff', '#a5d6a7', '#2e9e5b', '#f8bbd0']) {
    const out = readableTint(hex);
    assert.ok(topOf(out) <= MAX_TOP_LUMINANCE, `${hex} → ${out}`);
    assert.ok(contrast('#ffffff', out) > contrast('#ffffff', hex), `${hex} got darker`);
  }
  const y = parseInt(readableTint('#ffeb3b').slice(1), 16);
  assert.ok((y >> 16) > (y & 255), 'yellow stays warm (red above blue)');
});

test('readableTint: anything that is not #rrggbb passes through', () => {
  assert.equal(readableTint('red'), 'red');
  assert.equal(readableTint(''), '');
});

test('textOn: dark text on light fills, white on dark ones', () => {
  assert.equal(textOn('#ffeb3b'), '#111111');
  assert.equal(textOn('#ffffff'), '#111111');
  assert.equal(textOn('#3366cc'), '#ffffff');
  assert.equal(textOn('#000000'), '#ffffff');
  assert.equal(textOn('nonsense'), '#ffffff');
});
