import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { BabyEvent, Child } from '../src/lib/types';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { IdbStorage, MemoryStorage, openDb } from '../src/lib/db';
import { parseCsv, toCsv } from '../src/lib/csv';
import {
  eventsToCsv,
  importNativeCsv,
  isNativeCsvHeader,
  makeBackup,
  mergeData,
  parseBackup,
} from '../src/lib/dataio';
import {
  buildEvents,
  guessMapping,
  guessType,
  parseAmountMl,
  parseDateTime,
  parseDuration,
  diaperKindFrom,
} from '../src/lib/importer';

const at = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m).getTime();
const kid: Child = { id: 'c1', name: 'Juniper', birthdate: '2026-03-01', createdAt: 1 };
const events: BabyEvent[] = [
  { id: 'a', childId: 'c1', type: 'sleep', start: at(9, 9), end: at(9, 10, 30), notes: '- fussy, "teething"' },
  { id: 'b', childId: 'c1', type: 'feed', method: 'bottle', start: at(9, 11), end: at(9, 11, 10), amountMl: 120, content: 'formula' },
  { id: 'c', childId: 'c1', type: 'feed', method: 'breast', start: at(9, 12), end: at(9, 12, 20), leftMs: 12 * 60000, rightMs: 8 * 60000 },
  { id: 'd', childId: 'c1', type: 'diaper', start: at(9, 13), end: at(9, 13), diaper: 'both' },
  { id: 'e', childId: 'c1', type: 'pump', start: at(9, 14), end: at(9, 14, 25), amountMl: 100 },
];

describe('IndexedDB storage (offline data)', () => {
  const fresh = async () => new IdbStorage(await openDb(indexedDB, 'test-' + Math.random()));

  it('persists children, events and settings, and survives re-opening', async () => {
    const name = 'persist-' + Math.random();
    const a = new IdbStorage(await openDb(indexedDB, name));
    await a.putChild(kid);
    await a.putEvents(events);
    await a.saveSettings({ ...DEFAULT_SETTINGS, units: 'oz', selectedChildId: 'c1' });
    const b = new IdbStorage(await openDb(indexedDB, name));
    const snap = await b.load();
    expect(snap.children).toEqual([kid]);
    expect(snap.events).toHaveLength(5);
    expect(snap.settings.units).toBe('oz');
    expect(snap.events.find((e) => e.id === 'a')?.notes).toBe('- fussy, "teething"');
  });

  it('updates, deletes, and cascades child deletion', async () => {
    const s = await fresh();
    await s.putChild(kid);
    await s.putChild({ id: 'c2', name: 'Other', birthdate: '2025-01-01', createdAt: 2 });
    await s.putEvents([...events, { id: 'x', childId: 'c2', type: 'diaper', start: 5, end: 5, diaper: 'pee' }]);
    await s.putEvents([{ ...events[0], notes: 'changed' }]);
    await s.deleteEvents(['b']);
    let snap = await s.load();
    expect(snap.events.find((e) => e.id === 'a')?.notes).toBe('changed');
    expect(snap.events.some((e) => e.id === 'b')).toBe(false);
    await s.deleteChild('c1');
    snap = await s.load();
    expect(snap.children.map((c) => c.id)).toEqual(['c2']);
    expect(snap.events.map((e) => e.id)).toEqual(['x']);
  });

  it('replaceAll swaps the whole dataset', async () => {
    const s = await fresh();
    await s.putChild(kid);
    await s.putEvents(events);
    await s.replaceAll({ children: [{ ...kid, id: 'n', name: 'New' }], events: [], settings: DEFAULT_SETTINGS });
    const snap = await s.load();
    expect(snap.children.map((c) => c.id)).toEqual(['n']);
    expect(snap.events).toEqual([]);
  });

  it('the in-memory fallback behaves the same', async () => {
    const m = new MemoryStorage();
    await m.putChild(kid);
    await m.putEvents(events);
    await m.deleteChild('c1');
    expect((await m.load()).events).toEqual([]);
  });
});

describe('CSV', () => {
  it('parses quotes, escaped quotes, embedded newlines, BOM and CRLF', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,"line1\nline2",\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', 'he said "hi"'],
      ['2', 'line1\nline2', ''],
    ]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')[1]).toEqual(['1', '2']);
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });
  it('escapes on write and guards against formula injection', () => {
    const out = toCsv([['a,b', 'say "x"', '=cmd()', '-5']]);
    expect(out).toBe('"a,b","say ""x""",\'=cmd(),-5\r\n');
  });
});

describe('JSON backup', () => {
  it('round-trips and validates', () => {
    const text = JSON.stringify(makeBackup([kid], events, { ...DEFAULT_SETTINGS, units: 'oz' }));
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toEqual(events);
      expect(r.settings.units).toBe('oz');
    }
  });
  it('rejects things that are not backups and drops malformed events', () => {
    expect(parseBackup('{').ok).toBe(false);
    expect(parseBackup('{"app":"other"}').ok).toBe(false);
    const r = parseBackup(JSON.stringify({ app: 'nestlog', version: 1, children: [kid], events: [events[0], { id: 1 }, null] }));
    expect(r.ok && r.events.length).toBe(1);
    expect(r.ok && r.skipped).toBe(2);
  });
  it('merge keeps existing, takes incoming by id, drops orphans', () => {
    const cur = { children: [kid], events: [events[0]] };
    const inc = { children: [], events: [{ ...events[0], notes: 'new' }, events[1], { ...events[2], childId: 'ghost' }] };
    const m = mergeData(cur, inc);
    expect(m.events).toHaveLength(2);
    expect(m.events.find((e) => e.id === 'a')?.notes).toBe('new');
    expect(m.addedEvents).toBe(1);
    expect(m.updatedEvents).toBe(1);
    expect(m.dropped).toBe(1);
  });
});

describe('CSV export and import', () => {
  it('round-trips through the native CSV losslessly', () => {
    const csv = eventsToCsv(events, [kid]);
    const rows = parseCsv(csv);
    expect(isNativeCsvHeader(rows[0])).toBe(true);
    const r = importNativeCsv(rows, 'c1');
    expect(r.skipped).toEqual([]);
    expect(r.events).toHaveLength(5);
    const byId = Object.fromEntries(r.events.map((e) => [e.id, e]));
    expect(byId.a.notes).toBe('- fussy, "teething"');
    expect(byId.a.start).toBe(events[0].start);
    expect(byId.a.end).toBe(events[0].end);
    expect(byId.b).toMatchObject({ method: 'bottle', amountMl: 120, content: 'formula' });
    expect(byId.c).toMatchObject({ method: 'breast', leftMs: 12 * 60000, rightMs: 8 * 60000 });
    expect(byId.d.diaper).toBe('both');
    expect(byId.e.amountMl).toBe(100);
  });
  it('can filter one child out of a multi-child file', () => {
    const csv = eventsToCsv([...events, { id: 'z', childId: 'c2', type: 'diaper', start: at(9, 15), end: at(9, 15), diaper: 'pee' }], [kid, { ...kid, id: 'c2', name: 'Other' }]);
    const r = importNativeCsv(parseCsv(csv), 'dest', 'Other');
    expect(r.events).toHaveLength(1);
    expect(r.events[0].childId).toBe('dest');
    expect(r.childNames.sort()).toEqual(['Juniper', 'Other']);
  });
});

describe('importer helpers', () => {
  it('parses date-times in common formats', () => {
    expect(parseDateTime('2026-07-09 14:30')).toBe(at(9, 14, 30));
    expect(parseDateTime('2026-07-09T14:30:00')).toBe(at(9, 14, 30));
    expect(parseDateTime('07/09/2026 2:30 PM')).toBe(at(9, 14, 30));
    expect(parseDateTime('07/09/2026 12:05 AM')).toBe(at(9, 0, 5));
    expect(parseDateTime('09/07/2026 14:30', 'dmy')).toBe(at(9, 14, 30));
    expect(parseDateTime('2026-07-09T14:30:00Z')).toBe(Date.UTC(2026, 6, 9, 14, 30));
    expect(parseDateTime('2026-13-45 10:00')).toBeNull();
    expect(parseDateTime('garbage')).toBeNull();
  });
  it('parses durations', () => {
    expect(parseDuration('1:30')).toBe(90 * 60000);
    expect(parseDuration('00:45:30')).toBe(45.5 * 60000);
    expect(parseDuration('45')).toBe(45 * 60000);
    expect(parseDuration('1h 20m')).toBe(80 * 60000);
    expect(parseDuration('2 hours 5 min')).toBe(125 * 60000);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
  });
  it('parses amounts and diaper kinds', () => {
    expect(parseAmountMl('120 ml', 'oz')).toBe(120);
    expect(parseAmountMl('4 oz', 'ml')).toBe(118);
    expect(parseAmountMl('90', 'ml')).toBe(90);
    expect(parseAmountMl('left side', 'ml')).toBeUndefined();
    expect(diaperKindFrom('Pee')).toBe('pee');
    expect(diaperKindFrom('Poo')).toBe('poo');
    expect(diaperKindFrom('pee and poo')).toBe('both');
    expect(diaperKindFrom('Both')).toBe('both');
    expect(diaperKindFrom('Dry')).toBe('dry');
    expect(diaperKindFrom('?')).toBeUndefined();
  });
  it('guesses types', () => {
    expect(guessType('Sleep')).toBe('sleep');
    expect(guessType('Nap')).toBe('sleep');
    expect(guessType('Diaper')).toBe('diaper');
    expect(guessType('Pump')).toBe('pump');
    expect(guessType('Bottle')).toBe('bottle');
    expect(guessType('Breastfeed')).toBe('breast');
    expect(guessType('Feed')).toBe('feed');
    expect(guessType('Solids')).toBe('skip');
    expect(guessType('Growth')).toBe('skip');
  });
});

describe('Huckleberry-style CSV import (layout assumed, mapping always confirmed by the user)', () => {
  const header = ['Start', 'End', 'Duration', 'Type', 'Start Condition', 'Start Location', 'End Condition', 'Notes'];
  const rows = [
    header,
    ['2026-07-09 09:00', '2026-07-09 10:15', '01:15', 'Sleep', '', '', '', 'good nap'],
    ['2026-07-09 11:00', '2026-07-09 11:12', '00:12', 'Feed', 'Bottle', '', '120ml', ''],
    ['2026-07-09 12:00', '2026-07-09 12:20', '00:20', 'Feed', 'Left', 'Breast', '', ''],
    ['2026-07-09 13:00', '2026-07-09 13:00', '', 'Diaper', 'Pee', '', '', ''],
    ['2026-07-09 14:00', '2026-07-09 14:00', '', 'Diaper', 'Poo', '', '', ''],
    ['2026-07-09 15:00', '2026-07-09 15:00', '', 'Diaper', 'Both', '', '', ''],
    ['2026-07-09 16:00', '2026-07-09 16:25', '00:25', 'Pump', '', '', '3 oz', ''],
    ['2026-07-09 17:00', '', '', 'Solids', 'Banana', '', '', ''],
    ['2026-07-09 18:00', '', '', 'Sleep', '', '', '', 'no end'],
    ['bad date', '', '', 'Diaper', 'Pee', '', '', ''],
    ['2026-07-09 09:00', '2026-07-09 10:15', '01:15', 'Sleep', '', '', '', 'duplicate of first'],
  ];

  it('auto-maps the columns from the headers', () => {
    const m = guessMapping(header, rows.slice(1));
    expect(m).toMatchObject({ start: 0, end: 1, duration: 2, type: 3, notes: 7 });
    expect(m.details).toEqual([4, 5, 6]);
    expect(m.typeMap).toMatchObject({ Sleep: 'sleep', Feed: 'feed', Diaper: 'diaper', Pump: 'pump', Solids: 'skip' });
  });

  it('builds events, skipping what it cannot read and reporting why', () => {
    const r = buildEvents(rows, guessMapping(header, rows.slice(1)), 'c1');
    const types = r.events.map((e) => e.type + ':' + (e.method ?? e.diaper ?? ''));
    expect(types).toEqual(['sleep:', 'feed:bottle', 'feed:breast', 'diaper:pee', 'diaper:poo', 'diaper:both', 'pump:']);
    expect(r.events[0]).toMatchObject({ start: at(9, 9), end: at(9, 10, 15), notes: 'good nap' });
    expect(r.events[1]).toMatchObject({ amountMl: 120, end: at(9, 11, 12) });
    expect(r.events[2]).toMatchObject({ leftMs: 20 * 60000 });
    expect(r.events[6].amountMl).toBe(89); // 3 oz
    expect(r.ignoredTypes).toEqual({ Solids: 1 });
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'sleep has no end time or duration',
      expect.stringContaining('start time not understood'),
      'duplicate row',
    ]);
  });

  it('is idempotent: re-importing gives the same ids', () => {
    const m = guessMapping(header, rows.slice(1));
    const a = buildEvents(rows, m, 'c1').events.map((e) => e.id);
    const b = buildEvents(rows, m, 'c1').events.map((e) => e.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(buildEvents(rows, m, 'c2').events[0].id).not.toBe(a[0]);
  });

  it('honours a user-changed type mapping', () => {
    const m = guessMapping(header, rows.slice(1));
    m.typeMap.Feed = 'bottle';
    const r = buildEvents(rows, m, 'c1');
    expect(r.events.filter((e) => e.type === 'feed').every((e) => e.method === 'bottle')).toBe(true);
  });

  it('works when only a duration column is present', () => {
    const r = buildEvents(
      [['when', 'what', 'length'], ['2026-07-09 09:00', 'Nap', '1h 10m']],
      guessMapping(['when', 'what', 'length'], []),
      'c1',
    );
    // "when" is not auto-detected as start, so nothing imports until the user maps it
    expect(r.events).toHaveLength(0);
    const m = { ...guessMapping(['when', 'what', 'length'], [['2026-07-09 09:00', 'Nap', '1h 10m']]), start: 0, type: 1, duration: 2 };
    m.typeMap = { Nap: 'sleep' };
    const r2 = buildEvents([['when', 'what', 'length'], ['2026-07-09 09:00', 'Nap', '1h 10m']], m, 'c1');
    expect(r2.events[0]).toMatchObject({ type: 'sleep', start: at(9, 9), end: at(9, 10, 10) });
  });
});
