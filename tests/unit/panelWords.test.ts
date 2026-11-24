import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { breakable, peekVariants, shortStreet } from '../../src/miniature/shotWords.js';
import { shotPicture } from '../../src/miniature/shotPicture.js';
import { bodyIcon, bodyState } from '../../src/miniature/bodyAt.js';

describe('short words for a shot', () => {
  it('shortens Straße as the street signs do, and nothing else', () => {
    expect(shortStreet('Karl-Marx-Straße')).toBe('Karl-Marx-Str.');
    expect(shortStreet('Weserstraße')).toBe('Weserstr.');
    expect(shortStreet('Straße des 17. Juni')).toBe('Str. des 17. Juni');
    expect(shortStreet('Sun down Karl-Liebknecht-Straße')).toBe('Sun down Karl-Liebknecht-Str.');
    expect(shortStreet('Hohenzollerndamm')).toBe('Hohenzollerndamm');
    expect(shortStreet('Straßenbahnring')).toBe('Straßenbahnring');
  });
  it('lets a long street name break at its joint', () => {
    expect(breakable('Hohenzollerndamm')).toBe('Hohenzollern­damm');
    expect(breakable('Sonnenallee')).toBe('Sonnen­allee');
    expect(breakable('Weserstr.')).toBe('Weser­str.');
    expect(breakable('TV tower')).toBe('TV tower');
    expect(breakable('Am Ring')).toBe('Am Ring');
  });
  it('words the peek line fullest first, and keeps the time in every wording', () => {
    const v = peekVariants({ brief: 'Sun down Karl-Liebknecht-Straße', compact: 'Sun · Karl-Liebknecht-Straße', short: 'Karl-Liebknecht-Straße', when: 'Tomorrow 07:12', whenShort: 'Wed 07:12', wait: 'in 1 day' });
    expect(v[0]).toEqual({ when: 'Tomorrow 07:12', what: 'Sun down Karl-Liebknecht-Straße', wait: 'in 1 day' });
    expect(v.map((x) => x.what)).toEqual([
      'Sun down Karl-Liebknecht-Straße',
      'Sun down Karl-Liebknecht-Straße',
      'Sun down Karl-Liebknecht-Str.',
      'Sun down Karl-Liebknecht-Str.',
      'Sun · Karl-Liebknecht-Str.',
      'Karl-Liebknecht-Str.',
    ]);
    expect(v.at(-1)!.when).toBe('Wed 07:12');
    for (const x of v) expect(x.when).toMatch(/07:12$/);
    // Each wording is no longer than the one before it.
    const length = (x: { when: string; what: string; wait: string }) => (x.when + x.what + x.wait).length;
    for (let i = 1; i < v.length; i++) expect(length(v[i])).toBeLessThanOrEqual(length(v[i - 1]));
  });
  it('does not repeat a wording that changes nothing', () => {
    const v = peekVariants({ brief: 'Sun behind TV tower', short: 'TV tower', when: '15:23', wait: 'in 2 h' });
    expect(v.map((x) => `${x.what}|${x.wait}`)).toEqual(['Sun behind TV tower|in 2 h', 'Sun behind TV tower|', 'TV tower|']);
  });
});

describe('one sun, one moon, one set of marks', () => {
  const t = Date.UTC(2026, 10, 24, 14, 30);
  it('draws a row’s body from bodies.js at that minute', () => {
    expect(bodyState('sun', t).kind).toBe('sun');
    expect(bodyState('sun', t).altitudeDeg).toBeLessThan(5);
    const moon = bodyState('moon', t);
    expect(moon.fraction).toBeGreaterThan(0.9);
    expect(bodyIcon('sun', t)).toContain('ue-sun');
    expect(bodyIcon('moon', t)).toContain('ue-moon');
  });
  it('pictures a shot as that body with the set’s tower or street', () => {
    const tower = shotPicture({ body: 'sun', kind: 'tower', where: 'sphere', t });
    const street = shotPicture({ body: 'moon', kind: 'street', t });
    expect(tower).toContain('ue-shot-tower');
    expect(street).toContain('ue-shot-street');
    expect(tower).not.toBe(shotPicture({ body: 'sun', kind: 'tower', where: 'antenna', t }));
    // Decorative: the words stand beside it.
    expect(tower).toContain('aria-hidden="true"');
  });
  it('leaves no sun, moon or mark drawn by hand in the planner', () => {
    const dir = new URL('../../src/miniature/', import.meta.url);
    const own = new Set(['bodies.js', 'marks.js', 'icons.js', 'sky.js', 'introLogo.js', '__sprites.js']);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js') && !own.has(f))) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      // The interim body art and marks: the two-tone discs, the phase path, the ad-hoc mark shapes.
      expect(source, file).not.toMatch(/litDiscPath|#2a3150|#f8a03a|markShape|markIcon|DRONE_ICON/);
    }
    const page = readFileSync(new URL('../../src/pages/plan.astro', import.meta.url), 'utf8');
    expect(page).not.toMatch(/#2a3150|#f8a03a|#f26a12" stroke-width="2" stroke-linecap="round"\/><\/svg><\/button>/);
    // The only inline drawings left in the page are the legend's samples of the map's own lines.
    expect((page.match(/<svg /g) ?? []).length).toBe(6);
    const css = readFileSync(new URL('miniature.css', dir), 'utf8');
    expect(css).not.toMatch(/mark-halo|spark-tick::after|\.disc\b/);
  });
});
