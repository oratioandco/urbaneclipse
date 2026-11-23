/**
 * Accuracy audit, step 1: dump what the APP computes, so an independent reference
 * (scripts/audit/reference.py, Skyfield + its own geometry) can be compared against it.
 *
 * Run through scripts/audit/run.sh, which bundles this file with esbuild and runs it in Node.
 * Output: data/audit/app.json (data/ is gitignored; the committed summary is in
 * docs/accuracy-audit-2026-11.md and scripts/audit/results/).
 *
 * Nothing here decides what is right. It only calls the app's own functions with the same
 * arguments the UI passes (panel 05: stepMinutes 5, refinePeaks true; the miniature's
 * worker: findShots with sampleBody and suncalc's illumination).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getMoonIllumination, getTimes, getMoonTimes } from 'suncalc';
import { sampleBody } from '../../src/lib/bodyPosition.ts';
import { enumerateVantageWindows } from '../../src/lib/vantageWindows.ts';
import { enumerateHorizonGatedWindows } from '../../src/lib/horizonWindows.ts';
import { LICHTENBERGER_BRUECKE, STRASSE_DES_17_JUNI } from '../../src/lib/vantages.ts';
import { FERNSEHTURM, SIEGESSAEULE, BRANDENBURGER_TOR, BERLINER_DOM } from '../../src/lib/landmarks.ts';
import { createHeightmap, decodeSamples, sampleGroundOrthometric } from '../../src/lib/heightmap.ts';
import { decodeStreets, findStreetPasses } from '../../src/lib/streets.ts';
import { MIN_MOON_ILLUMINATION } from '../../src/lib/dailyPaths.ts';
import { lightBands } from '../../src/lib/lightPhases.ts';
import { berlinDayBounds } from '../../src/lib/berlinTime.ts';
import { findShots, gridConvergenceDeg } from '../../src/miniature/towerShots.js';
import { TARGETS } from '../../src/miniature/targets.js';
import { sceneFromLatLon, latLonFromScene } from '../../src/miniature/eye.js';

const START = Date.UTC(2026, 10, 23);
const END = Date.UTC(2027, 10, 23);
const iso = (t: number | Date) => new Date(t).toISOString();

const loadMap = (name: string) => {
  const header = JSON.parse(readFileSync(`public/heightmap/${name}.json`, 'utf8'));
  const bin = readFileSync(`public/heightmap/${name}.bin`);
  return createHeightmap(header, decodeSamples(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));
};
const grids = [loadMap('berlin-dgm1'), loadMap('berlin-dgm1-horizon')];

// 1. Ephemeris on a 10-minute grid over the year, at the Fernsehturm.
const ephem: { stepMin: number; start: string; lat: number; lon: number; sun: number[][]; moon: number[][]; lit: number[] } = {
  stepMin: 10,
  start: iso(START),
  lat: FERNSEHTURM.lat,
  lon: FERNSEHTURM.lon,
  sun: [],
  moon: [],
  lit: [],
};
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
for (let t = START; t < END; t += 600_000) {
  const d = new Date(t);
  const s = sampleBody('sun', d, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const m = sampleBody('moon', d, FERNSEHTURM.lat, FERNSEHTURM.lon);
  ephem.sun.push([r5(s.az), r5(s.alt), Math.round(s.distanceKm)]);
  ephem.moon.push([r5(m.az), r5(m.alt), Math.round(m.distanceKm * 10) / 10]);
  ephem.lit.push(r5(getMoonIllumination(d).fraction));
}

// 2. Panel 05, Lichtenberger Bruecke -> Fernsehturm, exactly as VantageCalendar calls it.
const panel05 = LICHTENBERGER_BRUECKE.points.map((point) => ({
  point,
  windows: enumerateVantageWindows({
    point,
    landmark: FERNSEHTURM,
    bodyAt: (t, body) => sampleBody(body, t, point.lat, point.lon),
    start: new Date(START),
    end: new Date(END),
    stepMinutes: 5,
    refinePeaks: true,
  }).map((w) => {
    const b = sampleBody(w.body, w.peak, point.lat, point.lon);
    return { ...w, start: iso(w.start), end: iso(w.end), peak: iso(w.peak), peakAz: b.az, peakAlt: b.alt };
  }),
}));

// 3. Panel 05 preview, Strasse des 17. Juni -> Siegessaeule, terrain-gated.
const siegessaeule = STRASSE_DES_17_JUNI.points.map((point) => ({
  point,
  windows: enumerateHorizonGatedWindows({
    point,
    landmark: SIEGESSAEULE,
    map: grids,
    bodyAt: (t, body) => sampleBody(body, t, point.lat, point.lon),
    start: new Date(START),
    end: new Date(END),
    stepMinutes: 5,
    refinePeaks: true,
    enabled: true,
  }).map((w) => ({ ...w, start: iso(w.start), end: iso(w.end), peak: iso(w.peak) })),
}));

// 4. The miniature's date search ("Behind the tower from here"), from named spots.
// Ground comes from the DGM1 grid, except on the bridge deck (surveyed DOM1 height).
const ground = (lat: number, lon: number) => {
  for (const g of grids) {
    const v = sampleGroundOrthometric(g, lat, lon);
    if (v !== undefined) return v;
  }
  return 34;
};
const bridge = LICHTENBERGER_BRUECKE.points.find((p) => p.id === 'sued-mitte')!;
const spots: Array<{ id: string; lat: number; lon: number; groundM?: number }> = [
  { id: 'lichtenberger-bruecke-sued-mitte', lat: bridge.lat, lon: bridge.lon, groundM: bridge.surfaceOrthometric },
  { id: 'strausberger-platz', lat: 52.5184, lon: 13.4283 },
  { id: 'karl-marx-allee-frankfurter-tor', lat: 52.5158, lon: 13.4540 },
  { id: 'oberbaumbruecke', lat: 52.5019, lon: 13.4456 },
  { id: 'tempelhofer-feld-nord', lat: 52.4800, lon: 13.4020 },
  { id: 'strasse-17-juni-west', lat: STRASSE_DES_17_JUNI.points[0]!.lat, lon: STRASSE_DES_17_JUNI.points[0]!.lon },
  { id: 'strasse-17-juni-ost', lat: STRASSE_DES_17_JUNI.points[2]!.lat, lon: STRASSE_DES_17_JUNI.points[2]!.lon },
  { id: 'pariser-platz-east', lat: 52.51625, lon: 13.3805 },
  { id: 'grosser-stern-west-1km', lat: 52.5133, lon: 13.3355 },
];
const towerBase = FERNSEHTURM.baseOrthometric;
const miniature = spots.map((spot) => {
  const [x, z] = sceneFromLatLon(spot.lat, spot.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const groundM = spot.groundM ?? ground(spot.lat, spot.lon);
  // The page converts the scene spot back to lat/lon for the ephemeris; do the same.
  const [lat, lon] = latLonFromScene(x, z, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const eye = { x, y: groundM + 1.6, z };
  const shots = findShots({
    eye,
    base: towerBase,
    start: START,
    end: END,
    targets: TARGETS,
    bodyAt: (body: 'sun' | 'moon', t: number) => sampleBody(body, new Date(t), lat, lon),
    moonLit: (t: number) => getMoonIllumination(new Date(t)).fraction,
    minMoonLit: MIN_MOON_ILLUMINATION,
    // As dates.js calls it since the audit's fix; AUDIT_BEFORE=1 reproduces the search as it shipped.
    northOffsetDeg: process.env.AUDIT_BEFORE ? 0 : gridConvergenceDeg(lat, lon, FERNSEHTURM.lon),
  }).map((s: any) => ({ ...s, start: iso(s.start), end: iso(s.end), peak: iso(s.peak), align: iso(s.align) }));
  return { spot: { ...spot, groundM, x, z, latBack: lat, lonBack: lon }, shots };
});

// 5. Street henges: every view's stored bearing (for the true-north check) and the passes of a spread.
const streets = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));
const wantedStreets = ['Karl-Marx-Allee', 'Straße des 17. Juni', 'Unter den Linden', 'Frankfurter Allee', 'Bismarckstraße', 'Kurfürstendamm', 'Schönhauser Allee', 'Friedrichstraße'];
const seen = new Set<string>();
const streetPasses = streets
  .filter((v) => wantedStreets.includes(v.name))
  .filter((v) => {
    const key = `${v.name}|${Math.round(v.bearingDeg / 20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, 16)
  .map((view) => ({
    view,
    sun: findStreetPasses(view, 'sun', START, END).map((p) => ({ ...p, peak: iso(p.peak) })),
    moon: findStreetPasses(view, 'moon', START, END).map((p) => ({ ...p, peak: iso(p.peak) })),
  }));

// 6. Sun and moon times and light bands on chosen days (solstices, equinoxes, clock changes, named moon dates).
const days = ['2026-12-21', '2027-01-14', '2027-03-20', '2027-03-27', '2027-03-28', '2027-03-29', '2027-06-21', '2027-09-23', '2027-09-27', '2027-10-30', '2027-10-31', '2027-11-01'];
/** The sunrise and sunset the /plan/ weather line prints. Copied from horizonAzimuths in
 * src/miniature/weather.js, which does not export it: 5-minute samples, apparent centre at 0 deg. */
function shownRiseSet(dayStart: number) {
  let rise: number | null = null;
  let set: number | null = null;
  let last = sampleBody('sun', new Date(dayStart), FERNSEHTURM.lat, FERNSEHTURM.lon);
  for (let t = dayStart + 300_000; t <= dayStart + 86_400_000; t += 300_000) {
    const p = sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    if (last.alt < 0 && p.alt >= 0) rise = t;
    if (last.alt >= 0 && p.alt < 0) set = t;
    last = p;
  }
  return { rise: rise && iso(rise), set: set && iso(set) };
}
const dayTimes = days.map((day) => {
  const noon = new Date(`${day}T11:00:00Z`);
  const t = getTimes(noon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const m = getMoonTimes(new Date(`${day}T00:00:00Z`), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const from = Date.parse(`${day}T00:00:00Z`) - 2 * 3600_000;
  return {
    day,
    berlinMidnight: iso(berlinDayBounds(day).start),
    weatherLine: shownRiseSet(berlinDayBounds(day).start.getTime()),
    sun: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])),
    moon: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])),
    bands: lightBands(from, from + 28 * 3600_000, FERNSEHTURM.lat, FERNSEHTURM.lon).map((b) => ({ phase: b.phase, from: iso(b.from), to: iso(b.to) })),
  };
});

const landmarks = { FERNSEHTURM, SIEGESSAEULE, BRANDENBURGER_TOR, BERLINER_DOM };
const targets = TARGETS.map((t: any) => ({ id: t.id, x: t.x, z: t.z, topAGL: t.topAGL }));

mkdirSync('data/audit', { recursive: true });
writeFileSync(
  'data/audit/app.json',
  JSON.stringify({ range: [iso(START), iso(END)], landmarks, targets, ephem, panel05, siegessaeule, miniature, streetViews: streets, streetPasses, dayTimes }),
);
console.log(
  `panel05 windows: ${panel05.map((p) => `${p.point.id}=${p.windows.length}`).join(' ')}\n` +
    `siegessaeule: ${siegessaeule.map((p) => `${p.point.id}=${p.windows.length}`).join(' ')}\n` +
    `miniature: ${miniature.map((m) => `${m.spot.id}=${m.shots.length}`).join(' ')}\n` +
    `streets: ${streets.length} views, passes for ${streetPasses.length}`,
);
