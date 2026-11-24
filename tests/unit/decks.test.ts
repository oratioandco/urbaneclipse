import { describe, expect, it } from 'vitest';
import { deckTop } from '../../src/miniature/decks.js';

/**
 * A drawn city, one street running east-west along z = 0 with a point every 20 m.
 * `ground(x)` is the terrain along it and `built(x, z)` the built top over a point or
 * -Infinity. The shapes below are the ones measured in the planner at the Lichtenberger
 * Brücke on 2026-11-24 (scene metres: terrain 10 to 11 on the ramps, 4.5 to 7 in the rail
 * cutting, the deck's top 9 to 10 across it).
 */
const city = (ground: (x: number) => number, built: (x: number, z: number) => number, roads: Array<[number, number]> = Array.from({ length: 41 }, (_, i) => [-400 + i * 20, 0] as [number, number])) => ({
  roofAt: built,
  groundAt: (x: number) => ground(x),
  roadsNear: (x: number, z: number, radius: number) => roads.filter(([px, pz]) => Math.hypot(px - x, pz - z) <= radius),
});

describe('telling a bridge deck from a roof', () => {
  // A cutting 200 m wide under a deck at 9.6: the street runs over it from ramps at 9.8.
  const cutting = (x: number) => (Math.abs(x) < 100 ? 4.8 : 9.8);
  const bridge = city(cutting, (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 12 ? 9.6 : -Infinity));

  it('stands on the deck of a bridge that a street runs over', () => {
    expect(deckTop(0, 0, bridge)).toBe(9.6);
    expect(deckTop(60, 8, bridge)).toBe(9.6);
    // On the ramp there is no built top: plain ground, no deck.
    expect(deckTop(150, 0, bridge)).toBeNull();
    // Beside the bridge, down in the cutting: nothing built overhead, no deck.
    expect(deckTop(0, 40, bridge)).toBeNull();
  });
  it('does not take a house for a deck', () => {
    // A house 9 m high, 30 m back from the street: no street point is on its roof.
    const house = city(() => 0, (x, z) => (Math.abs(x) < 15 && z > 20 && z < 50 ? 9 : -Infinity));
    expect(deckTop(0, 35, house)).toBeNull();
    // Nor a low shed right beside the street.
    const shed = city(() => 0, (x, z) => (Math.abs(x) < 10 && z > 5 && z < 16 ? 3 : -Infinity));
    expect(deckTop(0, 10, shed)).toBeNull();
  });
  it('does not take a house beside a bridge for part of it', () => {
    // Eaves at the deck's height, 8 m of open air between the house and the deck.
    const beside = city(cutting, (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 12 ? 9.6 : Math.abs(x) < 15 && z > 20 && z < 36 ? 9.8 : -Infinity));
    expect(deckTop(0, 28, beside)).toBeNull();
    expect(deckTop(0, 10, beside)).toBe(9.6);
  });
  it('does not take a viaduct over the street for a deck', () => {
    // A rail viaduct 14 m wide crossing the street 5.5 m above it: the street's points under
    // it step down by the clearance where they come out.
    const viaduct = city(() => 0, (x) => (Math.abs(x) < 7 ? 5.5 : -Infinity));
    expect(deckTop(0, 0, viaduct)).toBeNull();
    // Nor a house built over a passage.
    const passage = city(() => 0, (x, z) => (Math.abs(x) < 25 && Math.abs(z) < 30 ? 18 : -Infinity));
    expect(deckTop(0, 0, passage)).toBeNull();
  });
  it('follows a long deck to its end, and gives up on one with no end in reach', () => {
    const long = city((x) => (Math.abs(x) < 300 ? 2 : 9.8), (x, z) => (Math.abs(x) < 300 && Math.abs(z) < 12 ? 9.6 : -Infinity));
    expect(deckTop(0, 0, long)).toBe(9.6);
    // A wide built top with a street on it that never comes down to the ground (the deck of a
    // parking structure, 200 m by 120 m): not a bridge.
    const island = city(() => 0, (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 60 ? 9.6 : -Infinity));
    expect(deckTop(0, 0, island)).toBeNull();
  });
  it('does not take a long narrow top with a way under it for a bridge', () => {
    // The Stadtbahn viaduct, measured in the planner on 2026-11-24: 7 m over the terrain, 12 m
    // wide, a way under it along 400 m, and no way down without a step. The Bösebrücke, whose
    // approaches the model lacks, measures the same and is not recognised either.
    const viaduct = city(() => 13.5, (x, z) => (Math.abs(x) < 200 && Math.abs(z) < 6 ? 20.5 : -Infinity));
    expect(deckTop(0, 0, viaduct)).toBeNull();
  });
  it('does not stand on anything higher than a bridge', () => {
    const tall = city((x) => (Math.abs(x) < 100 ? -30 : 0), (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 12 ? 0 : -Infinity));
    expect(deckTop(0, 0, tall)).toBeNull();
  });
});

describe('bridges the model does not have', () => {
  it('names the bridge at a place on it or just beside it, and none elsewhere', async () => {
    const { missingBridgeAt, missingBridgeNote } = await import('../../src/miniature/bridgesMissing.js');
    // Centres from OpenStreetMap (Nominatim, 2026-11-24): ways 380356103 and 288514442.
    expect(missingBridgeAt(52.5547093, 13.3981606)?.name).toBe('Bösebrücke');
    expect(missingBridgeAt(52.5017288, 13.4457312)?.name).toBe('Oberbaumbrücke');
    // 20 m north of the Bösebrücke's outline: still it (one is moved to the street beside it).
    expect(missingBridgeAt(52.5548866 + 20 / 111_320, 13.398)?.name).toBe('Bösebrücke');
    // The Lichtenberger Brücke and the Moltkebrücke are in the model.
    expect(missingBridgeAt(52.5111010, 13.4991829)).toBeNull();
    expect(missingBridgeAt(52.52189, 13.36876)).toBeNull();
    expect(missingBridgeNote({ name: 'Elsenbrücke' })).toMatch(/Elsenbrücke is not in the model yet/);
  });
  it('knows the railway viaducts the deck rule would take for bridges', async () => {
    const { railViaductAt } = await import('../../src/miniature/bridgesMissing.js');
    // The two cells of the census, OpenStreetMap ways 266284848 and 96837199 (building=viaduct).
    expect(railViaductAt(52.50465, 13.32633)).toBe(true);
    expect(railViaductAt(52.50509, 13.32914)).toBe(true);
    // Hardenbergstraße itself, 200 m north, and the Lichtenberger Brücke: not on the list.
    expect(railViaductAt(52.5068, 13.3275)).toBe(false);
    expect(railViaductAt(52.5111010, 13.4991829)).toBe(false);
  });
});
