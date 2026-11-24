import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { asShot, byMonth, countWords, DECENT, gatherNotes, highlights, rank, rowWhen, shotFromKey, shownShots, sideOf, spectacle, targetOfKey, weekdayApart } from '../../src/miniature/fromHere.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 11, 0);
/** A shot `days` from now with a score; other fields as given. */
const shot = (days: number, score: number, more: Record<string, unknown> = {}) => ({ t: NOW + days * DAY, body: 'sun', kind: 'tower', score, series: `fernsehturm|sun|${days}`, ...more });

describe('from here: a found date as a shot', () => {
  it('turns a pass behind the tower into a card’s shot', () => {
    const go = () => {};
    const s = asShot({ t: NOW, until: NOW + 180_000, body: 'sun', kind: 'tower', target: 'fernsehturm', state: 'hidden', what: 'Sun behind the sphere', when: 'Tue, 24 Nov · 15:31–15:34', detail: 'Sun behind the sphere · 3° up · Golden hour', distanceM: 5400, altDeg: 3.2, go });
    expect(s).toMatchObject({ kind: 'tower', landmark: 'fernsehturm', where: 'sphere', short: 'TV tower', body: 'sun', distanceM: 5400, until: NOW + 180_000 });
    expect(s.title).toBe('TV tower: sun behind the sphere');
    expect(s.detail).toBe('TV tower · Sun behind the sphere · 3° up · Golden hour');
    expect(s.when).toBe('Tue, 24 Nov · 15:31–15:34');
    expect(s.go).toBe(go);
  });
  it('frames the antenna, and keeps a sentence that already names the tower', () => {
    expect(asShot({ t: NOW, body: 'moon', kind: 'tower', target: 'fernsehturm', state: 'antenna', what: 'Moon behind the antenna', detail: '' }).where).toBe('antenna');
    expect(asShot({ t: NOW, body: 'moon', kind: 'tower', target: 'fernsehturm', state: 'ring', what: 'Big moon behind the TV tower, 1.4× the sphere', detail: '' }).title).toBe('Big moon behind the TV tower, 1.4× the sphere');
  });
  it('gives the column and the gate the fields their day rows carry', async () => {
    const gate = asShot({ t: NOW, body: 'sun', kind: 'tower', target: 'brandenburger-tor', state: 'ring', what: 'The gate’s quadriga in the sun', detail: '2° up · Golden hour', distanceM: 640, fromDeg: 262, altDeg: 2.2 });
    expect(gate).toMatchObject({ landmark: 'brandenburger_tor', target: 'brandenburger-tor', where: 'quadriga', short: 'Brandenburger Tor', title: 'The gate’s quadriga in the sun' });
    expect(gate).toMatchObject({ stand: '640 m west', side: 'west', caution: 'trees unchecked', checked: { buildings: true, trees: false } });
    expect(gate.detail).toBe('Brandenburger Tor · 2° up · Golden hour · buildings checked, trees not');
    const column = asShot({ t: NOW, body: 'moon', kind: 'tower', target: 'siegessaeule', state: 'ring', what: 'Big moon round the column', detail: 'x', distanceM: 1900, fromDeg: 84 });
    expect(column).toMatchObject({ landmark: 'siegessaeule', where: 'viktoria', stand: '1.9 km east', caution: 'trees unchecked' });
    // The same names and the same words as the day list's rows (landmarkShots.js, landmarkStands.ts).
    // @ts-expect-error plain JS module
    const { LANDMARK_CAUTION, LANDMARK_CHECK } = await import('../../src/miniature/landmarkShots.js');
    const { FIGURE_TARGETS } = await import('../../src/lib/landmarkStands');
    expect([gate.caution, gate.detail.endsWith(LANDMARK_CHECK)]).toEqual([LANDMARK_CAUTION, true]);
    for (const target of FIGURE_TARGETS) {
      const shot = asShot({ t: NOW, body: 'sun', kind: 'tower', target: target.id, state: 'ring', detail: 'x' });
      expect([shot.where, shot.short], target.id).toEqual([target.where, target.short]);
    }
    // The tower's own shots carry no such caution: its viewshed and rules are its own.
    expect(asShot({ t: NOW, body: 'sun', kind: 'tower', target: 'fernsehturm', state: 'ring', what: 'x', detail: 'x', distanceM: 5000, fromDeg: 90 }).caution).toBeUndefined();
  });
  it('says which side of a landmark a spot is on', () => {
    expect([0, 44, 90, 135, 181, 262, 300, 359, -90].map(sideOf)).toEqual(['north', 'north-east', 'east', 'south-east', 'south', 'west', 'north-west', 'north', 'west']);
  });
  it('gives a row its small print in short: place, pass, height', () => {
    expect(asShot({ t: NOW, body: 'moon', kind: 'tower', target: 'fernsehturm', state: 'antenna', what: 'Moon behind the antenna', detail: 'Moon behind the antenna · on the axis 01:35:26 · 6° up · Night · 68% lit', altDeg: 6.2 }).brief).toBe('TV tower · Moon behind the antenna · 6° up');
    expect(asShot({ t: NOW, body: 'sun', kind: 'street', place: 'Karl-Marx-Allee', detail: 'x', altDeg: 1.4 }).brief).toBe('Karl-Marx-Allee · Sun down the street · 1° up');
    expect(asShot({ t: NOW, body: 'sun', kind: 'street', place: 'Karl-Marx-Allee' }).brief).toBe('Karl-Marx-Allee · Sun down the street');
  });
  it('makes a street date a street shot, its length as the card’s distance', () => {
    const s = asShot({ t: NOW, body: 'moon', kind: 'street', place: 'Karl-Marx-Allee', lengthM: 2400, detail: 'Moon down the street · 4° up · Night', when: 'x' });
    expect(s).toMatchObject({ kind: 'street', short: 'Karl-Marx-Allee', title: 'Moon down Karl-Marx-Allee', distanceM: 2400, series: 'street|moon' });
    expect(s.landmark).toBeUndefined();
    expect(s.detail).toBe('Karl-Marx-Allee · Moon down the street · 4° up · Night');
  });
});

describe('from here: a shot again from a link', () => {
  // @ts-expect-error plain JS module
  const keyOf = async (shot: unknown) => (await import('../../src/miniature/dayShots.js')).shotKey(shot);
  it('reads back the name the link gave each kind of shot', async () => {
    const found = [
      { t: NOW, body: 'sun', kind: 'tower', target: 'fernsehturm', state: 'ring', what: 'Ring of sun round the sphere', detail: 'x', distanceM: 6000 },
      { t: NOW, body: 'moon', kind: 'tower', target: 'fernsehturm', state: 'antenna', what: 'Moon behind the antenna', detail: 'x', distanceM: 6000 },
      { t: NOW, body: 'moon', kind: 'tower', target: 'siegessaeule', state: 'ring', what: 'Big moon round the column', detail: 'x' },
      { t: NOW, body: 'sun', kind: 'tower', target: 'brandenburger-tor', state: 'edge', what: 'Sun at the gate’s edge', detail: 'x' },
      { t: NOW, body: 'moon', kind: 'street', place: 'Karl-Marx-Allee', lengthM: 1695, detail: 'x' },
    ];
    expect(await Promise.all(found.map((f) => keyOf(asShot(f))))).toEqual(['sphere-sun', 'antenna-moon', 'viktoria-moon', 'quadriga-sun', 'street-moon:Karl-Marx-Allee']);
    for (const f of found) {
      const shot = asShot(f);
      const again = shotFromKey(await keyOf(shot), NOW, 6000);
      expect(again, shot.title).toMatchObject({ t: NOW, body: shot.body, kind: shot.kind, short: shot.short, fromHere: true });
      expect([again.landmark, again.where], shot.title).toEqual([shot.landmark, shot.where]);
      expect(await keyOf(again)).toBe(await keyOf(shot));
    }
  });
  it('names the card and the calendar entry from the link alone', () => {
    expect(shotFromKey('sphere-sun', NOW, 6000)).toMatchObject({ title: 'Sun behind the TV tower’s sphere', short: 'TV tower', detail: 'TV tower', distanceM: 6000 });
    expect(shotFromKey('antenna-moon', NOW)).toMatchObject({ title: 'Moon behind the TV tower’s antenna', where: 'antenna' });
    expect(shotFromKey('viktoria-sun', NOW, 400, 84)).toMatchObject({ title: 'Sun behind the Siegessäule', stand: '400 m east', caution: 'trees unchecked' });
    expect(shotFromKey('viktoria-sun', NOW).stand).toBeUndefined();
    expect(['sphere-sun', 'antenna-moon', 'viktoria-sun', 'quadriga-moon', 'street-sun:Sonnenallee', 'x'].map(targetOfKey)).toEqual(['fernsehturm', 'fernsehturm', 'siegessaeule', 'brandenburger-tor', null, null]);
    expect(shotFromKey('quadriga-moon', NOW)).toMatchObject({ short: 'Brandenburger Tor', where: 'quadriga' });
    expect(shotFromKey('street-sun:Straße des 17. Juni', NOW)).toMatchObject({ title: 'Sun down Straße des 17. Juni', kind: 'street' });
  });
  it('gives nothing for a name it cannot read', () => {
    for (const key of ['', 'sphere', 'sphere-mars', 'street-sun', 'schloss-sun', 'siegessaeule-sun', null]) expect(shotFromKey(key, NOW)).toBeNull();
    expect(shotFromKey('sphere-sun', NaN)).toBeNull();
  });
});

describe('from here: spectacle', () => {
  it('ranks as a day’s rows do: big moon over a ring of sun over a plain pass', () => {
    const moon = spectacle({ kind: 'tower', body: 'moon', state: 'ring', distanceM: 6000 });
    const ring = spectacle({ kind: 'tower', body: 'sun', state: 'ring', distanceM: 6000 });
    const plain = spectacle({ kind: 'tower', body: 'sun', state: 'hidden', distanceM: 1500 });
    const edge = spectacle({ kind: 'tower', body: 'sun', state: 'edge', distanceM: 1500 });
    expect(moon).toBeGreaterThan(ring);
    expect(ring).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(edge);
    expect(moon).toBeLessThanOrEqual(2.4);
    expect(edge).toBeGreaterThanOrEqual(DECENT);
  });
  it('counts the moon for less by day, and the sun the same at any hour', () => {
    const noon = Date.UTC(2027, 5, 21, 11, 0);
    const night = Date.UTC(2027, 5, 21, 23, 0);
    const antenna = { kind: 'tower', body: 'moon', state: 'antenna' };
    expect(spectacle({ ...antenna, t: night })).toBe(2);
    expect(spectacle({ ...antenna, t: noon })).toBeCloseTo(1.2);
    expect(spectacle({ ...antenna })).toBe(2);
    expect(spectacle({ kind: 'tower', body: 'sun', state: 'ring', t: noon })).toBe(1.8);
  });
  it('scores a street by its length, a short one under decent', () => {
    expect(spectacle({ kind: 'street', body: 'sun', lengthM: 400 })).toBeLessThan(DECENT);
    expect(spectacle({ kind: 'street', body: 'sun', lengthM: 3000 })).toBe(1.6);
  });
});

describe('from here: the switches', () => {
  const shots = [
    { body: 'sun', kind: 'tower', target: 'fernsehturm' },
    { body: 'moon', kind: 'tower', target: 'fernsehturm' },
    { body: 'sun', kind: 'street' },
    { body: 'moon', kind: 'street' },
    { body: 'sun', kind: 'tower', target: 'siegessaeule' },
    { body: 'moon', kind: 'tower', target: 'brandenburger-tor' },
  ];
  it('shows all with nothing switched off', () => {
    expect(shownShots(shots)).toHaveLength(6);
    expect(shownShots(shots, { sun: true, moon: true, tower: true, landmarks: true, streets: true })).toHaveLength(6);
  });
  it('applies body and kind together, as the day list does', () => {
    expect(shownShots(shots, { moon: false })).toEqual([shots[0], shots[2], shots[4]]);
    expect(shownShots(shots, { tower: false })).toEqual([shots[2], shots[3], shots[4], shots[5]]);
    expect(shownShots(shots, { sun: false, streets: false })).toEqual([shots[1], shots[5]]);
  });
  it('keeps the tower and the other landmarks apart, as the day list’s two switches do', () => {
    expect(shownShots(shots, { landmarks: false })).toEqual(shots.slice(0, 4));
    expect(shownShots(shots, { tower: false, streets: false })).toEqual([shots[4], shots[5]]);
  });
});

describe('from here: highlights', () => {
  it('puts the next shot first when it is decent, then the best', () => {
    const next = shot(2, 1.2);
    const big = shot(200, 2.4);
    const ring = shot(90, 1.8);
    const plain = shot(40, 1.2);
    expect(highlights([plain, big, next, ring], NOW)).toEqual([next, ring, big]);
  });
  it('does not force a weak next shot to the front', () => {
    const weak = shot(1, 0.5, { kind: 'street' });
    const a = shot(30, 1.8);
    const b = shot(60, 2.4);
    const c = shot(120, 1.2);
    expect(highlights([weak, a, b, c], NOW)).toEqual([a, b, c]);
  });
  it('does not force a next shot the forecast says to skip', () => {
    const cloudy = shot(1, 1.8);
    const a = shot(30, 1.8);
    const b = shot(60, 1.8);
    const c = shot(120, 1.8);
    const picked = highlights([cloudy, a, b, c], NOW, { gradeOf: (s: unknown) => (s === cloudy ? 'poor' : null) });
    expect(picked).toEqual([a, b, c]);
  });
  it('prefers the sooner of two equal shots, and the bigger one even when later', () => {
    expect(rank(shot(10, 1.8), NOW)).toBeGreaterThan(rank(shot(300, 1.8), NOW));
    expect(rank(shot(330, 2.4), NOW)).toBeGreaterThan(rank(shot(3, 1.2), NOW));
    expect(rank(shot(3, 1.8), NOW, 'poor')).toBeLessThan(rank(shot(3, 1.2), NOW, 'good'));
  });
  it('gives a run of the same shot on neighbouring days one card', () => {
    const run = [0.5, 1.5, 2.5, 3.5].map((d) => shot(d, 1.6, { kind: 'street', series: 'street|sun' }));
    const autumn = shot(190, 1.6, { kind: 'street', series: 'street|sun' });
    expect(highlights([...run, autumn], NOW)).toEqual([run[0], autumn]);
  });
  it('shows the next chance on its best day', () => {
    const edge = shot(10, 1, { series: 'fernsehturm|sun' });
    const ring = shot(11, 1.8, { series: 'fernsehturm|sun' });
    const after = shot(12, 1, { series: 'fernsehturm|sun' });
    const later = shot(150, 1.8, { series: 'fernsehturm|sun' });
    expect(highlights([edge, ring, after, later], NOW)).toEqual([ring, later]);
    // A better day of the same kind a week on is another chance, not this one.
    const week = shot(17, 1.8, { series: 'fernsehturm|sun' });
    expect(highlights([edge, week], NOW)[0]).toBe(edge);
  });
  it('shows one of each kind before a second of any', () => {
    const moons = [20, 50, 80, 110].map((d) => shot(d, 2, { body: 'moon', series: 'fernsehturm|moon' }));
    const sun = shot(130, 1.2, { series: 'fernsehturm|sun' });
    const street = shot(200, 1.1, { kind: 'street', series: 'street|sun' });
    expect(highlights([...moons, sun, street], NOW)).toEqual([moons[0], sun, street]);
    // With one kind only, the cards are its best three.
    expect(highlights(moons, NOW)).toEqual(moons.slice(0, 3));
  });
  it('leaves out what has passed, keeps a pass still running, and gives fewer than three when that is all', () => {
    const gone = shot(-1, 2.4);
    const running = shot(-0.001, 1.8, { until: NOW + 60_000 });
    expect(highlights([gone, running], NOW)).toEqual([running]);
    expect(highlights([], NOW)).toEqual([]);
  });
  it('returns at most max, in time order', () => {
    const many = Array.from({ length: 9 }, (_, i) => shot(30 * (i + 1), 1 + (i % 3) * 0.5));
    const picked = highlights(many, NOW, { max: 3 });
    expect(picked).toHaveLength(3);
    expect(picked.map((s: { t: number }) => s.t)).toEqual([...picked.map((s: { t: number }) => s.t)].sort((a, b) => a - b));
    expect(highlights(many, NOW, { max: 2 })).toHaveLength(2);
  });
});

describe('from here: the year by month', () => {
  it('groups by Berlin’s month, in time order, without empty months', () => {
    // 31 Jan 2027 23:30 UTC is 1 Feb 00:30 in Berlin.
    const late = { t: Date.UTC(2027, 0, 31, 23, 30) };
    const jan = { t: Date.UTC(2027, 0, 12, 7, 0) };
    const may = { t: Date.UTC(2027, 4, 3, 18, 0) };
    const dec = { t: Date.UTC(2026, 11, 2, 15, 0) };
    const months = byMonth([may, late, jan, dec]);
    expect(months.map((m: { key: string }) => m.key)).toEqual(['2026-12', '2027-01', '2027-02', '2027-05']);
    expect(months.map((m: { label: string }) => m.label)).toEqual(['December 2026', 'January 2027', 'February 2027', 'May 2027']);
    expect(months[2].shots).toEqual([late]);
  });
  it('leaves the year to the month’s heading in a row’s date', () => {
    expect(rowWhen('Thu, 14 Jan 2027 · 23:34–23:37')).toBe('Thu, 14 Jan · 23:34–23:37');
    expect(rowWhen('Mon, 30 Nov · 11:43')).toBe('Mon, 30 Nov · 11:43');
    expect(rowWhen(undefined)).toBe('');
    expect(weekdayApart('Thu, 14 Jan · 23:34–23:37')).toEqual(['Thu, ', '14 Jan · 23:34–23:37']);
    expect(weekdayApart('14 Jan · 23:34')).toEqual(['', '14 Jan · 23:34']);
  });
  it('keeps the same month of two years apart', () => {
    const months = byMonth([{ t: Date.UTC(2026, 10, 25, 12) }, { t: Date.UTC(2027, 10, 20, 12) }]);
    expect(months.map((m: { label: string }) => m.label)).toEqual(['November 2026', 'November 2027']);
  });
});

describe('from here: what the search said', () => {
  it('says the same thing once, under every name it holds for', () => {
    const hidden = 'Buildings hide it from here. Try a few steps along, or take off.';
    const said = gatherNotes([
      { id: 'street', heading: 'Down Karl-Marx-Allee', notes: ['3 more hidden by buildings from this spot.'] },
      { id: 'fernsehturm', heading: 'Behind the TV tower from here', notes: [hidden] },
      { id: 'brandenburger-tor', heading: 'Behind the Brandenburger Tor from here', notes: [hidden] },
      { id: 'siegessaeule', heading: 'Behind the Siegessäule from here', notes: [] },
    ]);
    expect(said).toEqual([
      { names: ['Down Karl-Marx-Allee'], note: '3 more hidden by buildings from this spot.' },
      { names: ['TV tower', 'Brandenburger Tor'], note: hidden },
    ]);
    expect(gatherNotes([])).toEqual([]);
  });
});

describe('from here: the count in words', () => {
  it('says how many, and how many the switches hide', () => {
    expect(countWords(1)).toBe('1 date in 12 months');
    expect(countWords(14)).toBe('14 dates in 12 months');
    expect(countWords(5, 14)).toBe('5 dates of 14 shown');
  });
});
