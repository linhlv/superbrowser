import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDownload, safeFilename, uniqueDownloadPath, MAX_DOWNLOADS } from './downloads.ts';
import type { DownloadState } from '../shared/types.ts';

const DIR = '/Users/me/Downloads';
/** A fake file system holding the given names in DIR. */
const existing = (...names: string[]) => {
  const set = new Set(names.map((n) => `${DIR}/${n}`));
  return (p: string) => set.has(p);
};

test('uniqueDownloadPath: a free name is kept', () => {
  assert.equal(uniqueDownloadPath(DIR, 'a.pdf', existing()), `${DIR}/a.pdf`);
});

test('uniqueDownloadPath: taken names get (1), (2)… before the extension', () => {
  assert.equal(uniqueDownloadPath(DIR, 'a.pdf', existing('a.pdf')), `${DIR}/a (1).pdf`);
  assert.equal(uniqueDownloadPath(DIR, 'a.pdf', existing('a.pdf', 'a (1).pdf')), `${DIR}/a (2).pdf`);
});

test('uniqueDownloadPath: no extension → "a (1)"', () => {
  assert.equal(uniqueDownloadPath(DIR, 'a', existing('a')), `${DIR}/a (1)`);
});

test('uniqueDownloadPath: empty or unsafe names → "download"', () => {
  for (const name of ['', '   ', '.', '..', '/', '../', '...', '\u0000']) {
    assert.equal(uniqueDownloadPath(DIR, name, existing()), `${DIR}/download`, JSON.stringify(name));
  }
  assert.equal(uniqueDownloadPath(DIR, '..', existing('download')), `${DIR}/download (1)`);
});

test('uniqueDownloadPath: server-supplied paths land in the folder as a plain name', () => {
  assert.equal(uniqueDownloadPath(DIR, '../../evil.sh', existing()), `${DIR}/evil.sh`);
  assert.equal(uniqueDownloadPath(DIR, '/etc/x', existing()), `${DIR}/x`);
  assert.equal(uniqueDownloadPath(DIR, '..\\..\\win.bat', existing()), `${DIR}/win.bat`);
  assert.equal(uniqueDownloadPath(DIR, 'dir/', existing()), `${DIR}/dir`);
});

test('safeFilename: leading dots, control characters and colons go', () => {
  assert.equal(safeFilename('.bashrc'), 'bashrc');
  assert.equal(safeFilename('...hidden.txt'), 'hidden.txt');
  assert.equal(safeFilename('a\u0000b\nc.txt'), 'abc.txt');
  assert.equal(safeFilename('a:b.txt'), 'a_b.txt');
  assert.equal(safeFilename('  report final.pdf  '), 'report final.pdf');
});

test('safeFilename: very long names are cut, keeping the extension', () => {
  const name = safeFilename('x'.repeat(300) + '.pdf');
  assert.ok(name.length <= 200, String(name.length));
  assert.ok(name.endsWith('x.pdf'));
});

const d = (id: string, state: DownloadState['state'] = 'progressing'): DownloadState =>
  ({ id, filename: `${id}.bin`, path: `${DIR}/${id}.bin`, state, received: 0, total: 10 });

test('recordDownload: appends new, replaces known in place, never mutates', () => {
  const l0: DownloadState[] = [];
  const l1 = recordDownload(l0, d('a'));
  const l2 = recordDownload(l1, d('b'));
  const l3 = recordDownload(l2, { ...d('a', 'completed'), received: 10 });
  assert.deepEqual(l3.map((x) => x.id), ['a', 'b']);
  assert.equal(l3[0]!.state, 'completed');
  assert.equal(l2[0]!.state, 'progressing');
  assert.deepEqual(l0, []);
});

test('recordDownload: keeps the newest MAX_DOWNLOADS (20)', () => {
  assert.equal(MAX_DOWNLOADS, 20);
  let list: DownloadState[] = [];
  for (let i = 0; i < 25; i++) list = recordDownload(list, d(`d${i}`));
  assert.equal(list.length, 20);
  assert.equal(list[0]!.id, 'd5');
  assert.equal(list.at(-1)!.id, 'd24');
});
