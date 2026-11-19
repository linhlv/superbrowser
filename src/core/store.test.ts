import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from './store.ts';
import { defaultState } from './appState.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-store-'));
}

test('missing file loads defaults', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(createStore(path.join(dir, 'state.json')).load(), defaultState());
});

test('save + flush round-trips, creating the parent dir', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sub', 'state.json');
  const s = createStore(file, { debounceMs: 5 });
  s.save({ ...defaultState(), showNames: true, activeProfile: 'Default' });
  s.flush();
  const back = createStore(file).load();
  assert.equal(back.showNames, true);
  assert.equal(back.activeProfile, 'Default');
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('two saves within the debounce keep the last', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const s = createStore(file, { debounceMs: 60000 });
  s.save({ ...defaultState(), activeProfile: 'A' });
  assert.equal(fs.existsSync(file), false);
  s.save({ ...defaultState(), activeProfile: 'B' });
  s.flush();
  assert.equal(createStore(file).load().activeProfile, 'B');
  s.flush(); // nothing pending: no throw
});

test('debounced save is written after the delay', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const s = createStore(file, { debounceMs: 10 });
  s.save({ ...defaultState(), activeProfile: 'A' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(createStore(file).load().activeProfile, 'A');
});

test('corrupt file is set aside and defaults returned', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(createStore(file).load(), defaultState());
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')));
});

test('a steady stream of saves is still written every maxWait', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  const s = createStore(file, { debounceMs: 50, maxWaitMs: 150 });
  const started = Date.now();
  let n = 0;
  while (Date.now() - started < 400) {
    s.save({ ...defaultState(), activeProfile: `P${n++}` });
    await new Promise((r) => setTimeout(r, 10)); // always within the debounce
  }
  assert.ok(fs.existsSync(file), 'written although the debounce never elapsed');
  s.flush();
  assert.equal(createStore(file).load().activeProfile, `P${n - 1}`);
});

test('an unreadable file (not just a missing one) is set aside and defaults returned', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(file); // reading it fails with EISDIR
  assert.deepEqual(createStore(file).load(), defaultState());
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')));
});
