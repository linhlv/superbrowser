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

test('readableTint: dark enough colours are kept as they are, including Chrome\'s usual profile colours', () => {
  for (const hex of ['#3366cc', '#000000', '#4285f4', '#1a73e8', '#1e8e3e', '#e52592', '#808080']) {
    assert.equal(readableTint(hex), hex, hex);
  }
});

test('readableTint: light colours are darkened until white text reads on the gradient, keeping the hue', () => {
  for (const hex of ['#ffeb3b', '#ffffff', '#a5d6a7', '#f8bbd0', '#81d4fa']) {
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

test('textOn: dark text only where white would be hard to read (light fills), white like Chrome elsewhere', () => {
  for (const hex of ['#ffeb3b', '#ffffff', '#a5d6a7', '#f8bbd0']) assert.equal(textOn(hex), '#111111', hex);
  for (const hex of ['#3366cc', '#000000', '#4285f4', '#34a853', '#1e8e3e', '#e52592', '#e8710a', '#ff5722']) {
    assert.equal(textOn(hex), '#ffffff', hex);
  }
  assert.equal(textOn('nonsense'), '#ffffff');
});
