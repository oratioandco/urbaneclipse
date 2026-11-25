# Round 4 — rain that speaks, moon windows

Built on D's skeleton: deckSky 0–46, loud frames around whole day columns (y 1.5 → 61, rx 7,
soft glow + crisp stroke), shared sun-phase axis once per card, hover crosshair. Status line
shrinks to 3–4 px; frames carry opportunity.

## Shared decisions (all four variants)

**Moon rule (hard).** `moonWin(d,h)` gates every moon frame: night hour (not `litH`), moon up,
`illum ≥ 0.25`, total cover < 0.7, rainP < 30. Below 0.25 illumination the moon is treated as
absent — **no frame, no glyph, nothing**. Saturday (0.22) demonstrates this: rail shows the moon
is up, but no window appears. New moon → empty night, never a "bad" mark.

**Where moon up-time lives.** The shared axis stays sun-phase only (it is the one thing every
day shares). Moon up-time differs per day, so it lives **per-day as a 2px silver rail**
(`#9fb9dc`, opacity 0.35 + 0.4·illum) in a reserved sliver of each row — drawn whenever the moon
is up, window or not. Rail-without-frame = "up but unusable" (too dim / too cloudy).

**Frames.** Same ticket geometry for both kinds; siblings, not twins:
- Sun: crisp stroke `var(--good)`, glow `#ffd984`, glyph = small radial sun disc.
- Moon: crisp stroke `var(--moon)`, glow `#d7e7fb`, glyph = crescent in a soft silver halo.
- Non-hue cues (accessibility): glyph shape + position over the shared axis (moon frames sit over
  the navy night stretch, sun frames over the cream/gold stretch).
- No window anywhere → **no frame at all**. A rainlocked day reads empty, not red.

**Status ink, quieted.** The honest hour-by-hour verdict stays but poor is demoted so red never
shouts over opportunity: good `#3aa65b` @ 0.95, fair `#e2a53f` @ 0.7, poor `#c7503d` @ 0.3,
night navy `#1b2140` @ 0.4.

**Gradients / filters to register** (ids used below):

| id | type | stops (offset · color · opacity) |
|---|---|---|
| `r4ground` | linear y | 0 · `#5fd8d5` · .10 · 0.55 · `#2aa5a2` · .45 · 1 · `#145e5c` · .92 |
| `r4drop` | radial | 0 · `#ecfcfb` · 1 · 0.45 · `#7cd4d2` · 1 · 1 · `#1e8a88` · 1 |
| `r4wet` | linear y | 0 · `#2aa5a2` · .30 · 1 · `#2aa5a2` · .02 |
| `r4moonglow` | radial | 0 · `#d7e7fb` · .55 · 1 · `#d7e7fb` · 0 |
| `r4sunglyph` | radial | 0 · `#ffe08a` · 1 · 0.55 · `#fbbf45` · 1 · 1 · `#e0830f` · 1 |
| `r4blur` | filter | `feGaussianBlur` stdDeviation 1.6, region x/y −40%, w/h 180% |

## Shared machinery (used by every variant)

```js
const hours24 = [...Array(24).keys()];
const moonUpAt = (d, h) => (d.moon?.up ?? []).some(([a, b]) => h + 0.5 > a && h + 0.5 < b);
const MOON_MIN_ILLUM = 0.25;                      // below this the moon may as well be new
const moonWin = (d, h) => {                       // null | 'soft' | 'bright'
  if (!d.moon || d.moon.illum < MOON_MIN_ILLUM || litH(h) || !moonUpAt(d, h)) return null;
  const cover = Math.max(d.low[h], d.mid[h], d.high[h]);
  if (cover >= 0.7 || d.rainP[h] >= 30) return null;
  return d.moon.illum >= 0.4 && cover < 0.35 ? 'bright' : 'soft';
};
const sunRuns  = (d) => runsOf(hours24.filter((h) => litH(h) && gradeAt(d, h) === 'good'));
const moonRuns = (d) => runsOf(hours24.filter((h) => moonWin(d, h) !== null));
const upRuns   = (d) => runsOf(hours24.filter((h) => moonUpAt(d, h)));   // up, window or not

const r4frame = (svg, a, b, kind, strength = 1) => {
  const sun = kind === 'sun';
  const fx = Math.max(1, a * PX - 1.5);
  const fw = Math.min(239, (b + 1) * PX + 1.5) - fx;
  const r = { x: fx.toFixed(2), y: 1.5, width: fw.toFixed(2), height: TV - 3, rx: 7, fill: 'none' };
  svg.append(el('rect', { ...r, stroke: sun ? '#ffd984' : '#d7e7fb', 'stroke-width': 5,
    opacity: (0.2 * strength).toFixed(2), filter: 'url(#r4blur)' }));
  svg.append(el('rect', { ...r, stroke: sun ? 'var(--good)' : 'var(--moon)', 'stroke-width': 1.6,
    opacity: (0.55 + 0.4 * strength).toFixed(2), 'vector-effect': 'non-scaling-stroke' }));
  const gx = fx + 5.5, gy = 7;                    // ticket punch: the non-hue cue
  if (sun) svg.append(el('circle', { cx: gx.toFixed(1), cy: gy, r: 2.6, fill: 'url(#r4sunglyph)' }));
  else {
    svg.append(el('circle', { cx: gx.toFixed(1), cy: gy, r: 4.5, fill: 'url(#r4moonglow)' }));
    svg.append(el('path', { d: `M${gx + 1.5},${gy - 1.8} A2.4,2.4 0 1,0 ${gx + 1.5},${gy + 1.8} A3,3 0 0,1 ${gx + 1.5},${gy - 1.8} Z`, fill: '#e7f0fc' }));
  }
};
const r4verdict = (svg, d, y, hh, dotted = false) => {
  for (const h of hours24) {
    const x0 = h * PX + (dotted ? 0.8 : 0), w = PX - (dotted ? 1.6 : 0);
    if (!litH(h)) svg.append(el('rect', { x: x0.toFixed(2), y, width: w.toFixed(2), height: hh,
      fill: '#1b2140', opacity: 0.4, 'shape-rendering': 'crispEdges' }));
    else { const g = gradeAt(d, h);
      svg.append(el('rect', { x: x0.toFixed(2), y, width: w.toFixed(2), height: hh,
        fill: g === 'good' ? '#3aa65b' : g === 'fair' ? '#e2a53f' : '#c7503d',
        opacity: g === 'good' ? 0.95 : g === 'fair' ? 0.7 : 0.3, 'shape-rendering': 'crispEdges' })); }
  }
};
const r4frames = (svg, d) => {
  for (const [a, b] of sunRuns(d)) r4frame(svg, a, b, 'sun');
  for (const [a, b] of moonRuns(d)) r4frame(svg, a, b, 'moon', moonWin(d, a) === 'bright' ? 1 : 0.65);
};
const r4rail = (svg, d, y) => {                   // per-day moon-up rail, silver, quiet
  for (const [a, b] of upRuns(d))
    svg.append(el('rect', { x: (a * PX).toFixed(2), y, width: ((b + 1 - a) * PX).toFixed(2),
      height: 2, rx: 1, fill: '#9fb9dc', opacity: (0.35 + 0.4 * (d.moon?.illum ?? 0)).toFixed(2) }));
};
```

Expected outcome on the mocks: **Today** = small sun frame 12:00–13:00 + silver moon frame
21:00–24:00 (bright, illum .58); **Tomorrow** = no frames at all (soup day — empty, not red),
rail only; **Saturday** = one long sun frame 08:00–16:00, moon rail but **no moon frame**
(illum 0.22 — the new-moon rule made visible).

---

## A · Wet ground

**Concept.** Rain becomes a teal fog lying on the horizon of each day: its **height is the mm
depth**, its **colour density is the probability**. It trades away per-drop charm for an
instant "how much water is in the air" read, and the shape does the typing for free — a front is
one continuous sheet across hours, a shower a lone mound, drizzle a capped 2.6px damp film.
Trades away: nothing marks individual falling drops; the sky stays clean above the fog.

**Geometry.** deckSky 0–46. Ground baseline y=46; height `gh = 2.6` (drizzle, mm<0.2) or
`1.5 + 13·min(1, mm/2.5)` (max 14.5 → top y=31.5); zero below p 25/mm .05. Gloss hairline
`#8fd8d6` w0.8 op .65 along the top of every ground segment with gh ≥ 4. Verdict 3px at y=48.
Moon rail 2px at y=54. Frames y 1.5–61 as shared. Glyph at frame corner (+5.5, +7).

```js
function drawRound4A(svg, d) {
  deckSky(svg, d);
  const gh = (h) => { const p = d.rainP[h], mm = d.rainMm[h];
    if (p < 25 && mm < 0.05) return 0;
    return mm < 0.2 ? 2.6 : 1.5 + 13 * Math.min(1, mm / 2.5); };
  let dPath = 'M0,46';
  for (const h of hours24)
    dPath += ` L${h * PX},${(46 - gh(h)).toFixed(2)} L${(h + 1) * PX},${(46 - gh(h)).toFixed(2)}`;
  svg.append(el('path', { d: dPath + ' L240,46 Z', fill: 'url(#r4ground)' }));
  for (const h of hours24) if (gh(h) > 0)                       // confidence = colour density
    svg.append(el('rect', { x: (h * PX).toFixed(2), y: (46 - gh(h)).toFixed(2), width: PX,
      height: gh(h).toFixed(2), fill: '#145e5c', opacity: (0.5 * (d.rainP[h] / 100)).toFixed(2),
      'shape-rendering': 'crispEdges' }));
  for (const h of hours24) if (gh(h) >= 4)                      // clay gloss on deep ground
    svg.append(el('line', { x1: (h * PX + 1).toFixed(2), y1: (46 - gh(h)).toFixed(2),
      x2: ((h + 1) * PX - 1).toFixed(2), y2: (46 - gh(h)).toFixed(2), stroke: '#8fd8d6',
      'stroke-width': 0.8, opacity: 0.65, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }));
  r4verdict(svg, d, STY, 3);
  r4rail(svg, d, 54);
  r4frames(svg, d);
}
```

**Hover.** Readout names the rain class first — "heavy shower / steady rain / drizzle film /
dry" — then `mm/h` and `%`, and appends moon state ("up 58%, window 21:00–24:00" or "up but 22%
lit — no window").

---

## B · Clay stipple

**Concept.** Rain is a field of tiny clay beads: **count = probability, bead size = mm**, and
downpour hours (mm ≥ 0.7) switch to larger glossy gradient beads with motion tails that settle
low in the column. Type is granular and unmistakable — drizzle a mist of specks, a front a dense
wall of beads across many hours, a shower a sparse pinch. Trades away: continuity (a front is
implied by density, not drawn as one object) for the most tactile, most clay-faithful rain.

**Geometry.** deckSky 0–46. Beads: per hour `n = max(1, round(p/100·9))` (1–9), radius
`0.3 + 0.45·min(1, mm/1.5)` (0.3–0.75; heavy fixed 0.8), `cx` uniform in hour,
`cy = 4 + √rnd·39` (4–43, downward-biased when heavy); opacity `0.3 + 0.5·p/100`. Heavy tails:
vertical 2.1px lines w0.6 op .55 above each bead. Deterministic LCG seeded per day. Verdict
dotted 3px slivers at y=48 (width PX−1.6, gap 1.6 — hours stay countable). Rail 2px y=54.
Frames y 1.5–61.

```js
function drawRound4B(svg, d) {
  deckSky(svg, d);
  let seed = 11 + Math.round(97 * (d.rainMm[12] || 0) + d.rainP[6]);   // deterministic per day
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const h of hours24) {
    const p = d.rainP[h], mm = d.rainMm[h];
    if (p < 20 && mm < 0.05) continue;
    const n = Math.max(1, Math.round((p / 100) * 9));          // density = probability
    const heavy = mm >= 0.7;                                   // downpour: big glossy beads
    for (let k = 0; k < n; k++) {
      const cx = h * PX + 1 + rnd() * (PX - 2);
      const cy = 4 + Math.sqrt(rnd()) * 39;                    // heavy beads fall low
      const r = heavy ? 0.8 : 0.3 + 0.45 * Math.min(1, mm / 1.5);
      svg.append(el('circle', { cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2),
        fill: heavy ? 'url(#r4drop)' : '#2aa5a2', opacity: (0.3 + 0.5 * (p / 100)).toFixed(2) }));
      if (heavy) svg.append(el('line', { x1: cx.toFixed(2), y1: (cy - 3.2).toFixed(2),
        x2: cx.toFixed(2), y2: (cy - 1.1).toFixed(2), stroke: '#2aa5a2', 'stroke-width': 0.6,
        opacity: 0.55, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }));
    }
  }
  r4verdict(svg, d, STY, 3, true);
  r4rail(svg, d, 54);
  r4frames(svg, d);
}
```

**Hover.** Readout reports the bead census — "7 beads · 2 glossy, low → downpour · 80% ·
0.5 mm/h" — plus the moon line as in A.

---

## C · Sheets & clusters

**Concept.** Rain is classified into **weather systems**, and each type gets its own drawing:
runs of ≥3 wet hours are *fronts* — a curtain of near-vertical strokes spanning the whole sky
for the run's length, thickening and darkening with mm, with a blurred dark underlay when heavy
(≥0.7mm avg); runs of 1–2 hours are *showers* — three short slanted dashes that only occupy
their hours. Trades away: exact per-hour probability (opacity is the carrier, coarse at a
glance) for the meteorological story — showers punctuate, fronts persist — which is exactly how
a photographer plans around weather.

**Geometry.** deckSky 0–46. Front: per hour in run, 3 curtain lines (4 if heavy) at
`lx = h·PX + 1.4 + k·2.7`, from y=5 to y=44 (1px slant), stroke `#2aa5a2` w 0.7/1.1, opacity
`0.2 + 0.5·p/100`; heavy underlay rect x=a·PX w=len·PX y=5 h=39 fill `#145e5c` op .16 blurred.
Shower: 3 dashes at `sx = h·PX + 2 + k·3, sy = 9 + k·4`, each falling 4.5px over 1.5px, w
`0.6 + 1.2·min(1, mm/1.5)`, op .6. Rail 2px at y=48 (above verdict — this variant keeps D's 4px
verdict form at y=52, the one place the original line survives). Frames y 1.5–61.

```js
function drawRound4C(svg, d) {
  deckSky(svg, d);
  for (const [a, b] of runsOf(hours24.filter((h) => d.rainP[h] >= 20 || d.rainMm[h] >= 0.05))) {
    const len = b - a + 1, front = len >= 3;                  // ≥3 h: front, else shower
    const mm = d.rainMm.slice(a, b + 1).reduce((s, v) => s + v, 0) / len;
    const heavy = mm >= 0.7;
    if (front) {
      if (heavy) svg.append(el('rect', { x: (a * PX).toFixed(2), y: 5,
        width: (len * PX).toFixed(2), height: 39, fill: '#145e5c', opacity: 0.16, filter: 'url(#r4blur)' }));
      for (let h = a; h <= b; h++) for (let k = 0; k < (heavy ? 4 : 3); k++) {
        const lx = h * PX + 1.4 + k * 2.7;
        svg.append(el('line', { x1: lx.toFixed(2), y1: 5, x2: (lx - 1).toFixed(2), y2: 44,
          stroke: '#2aa5a2', 'stroke-width': heavy ? 1.1 : 0.7,
          opacity: (0.2 + 0.5 * (d.rainP[h] / 100)).toFixed(2),
          'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }));
      }
    } else {
      for (let h = a; h <= b; h++) for (let k = 0; k < 3; k++) {
        const sx = h * PX + 2 + k * 3, sy = 9 + k * 4;
        svg.append(el('line', { x1: sx.toFixed(2), y1: sy.toFixed(2), x2: (sx - 1.5).toFixed(2),
          y2: (sy + 4.5).toFixed(2), stroke: '#2aa5a2',
          'stroke-width': (0.6 + 1.2 * Math.min(1, mm / 1.5)).toFixed(2), opacity: 0.6,
          'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }));
      }
    }
  }
  r4rail(svg, d, STY);        // rail 48–50
  r4verdict(svg, d, 52, 4);   // D's original 4px line form, kept here
  r4frames(svg, d);
}
```

**Hover.** Readout names the system — "front · hour 3 of 9 · steady 0.3 mm/h" or "isolated
shower · 0.1 mm" — so the whole run is narrated from any hour inside it.

---

## D · Wetness trace

**Concept.** One cumulative line per day: rain *accumulates* along a teal trace rising from the
horizon (fixed 4mm full scale, 20px climb), so **slope = intensity, a step = a shower, a long
climb = a front, flat = dry**. Area under the trace is a faint teal wash; a glossy bead marks
every real shower step. Trades away: instantaneous probability (it is not drawn at all — hover
only) for the cleanest sky of the four and a cross-day comparison that no other variant gives:
Tomorrow's trace climbs all day, Today's jumps twice, Saturday's stays flat.

**Geometry.** deckSky 0–46. Trace baseline y=44, `y(h) = 44 − 20·min(1, cum/4)` (top y=24);
area fill `url(#r4wet)` down to y=44; polyline `#2aa5a2` w1.6 round joins; gloss beads r1.5
`url(#r4drop)` at `x(h)`, on the trace, for any hourly step ≥ 0.3mm. Verdict 3px y=48. Rail 2px
y=53. Frames y 1.5–61. Drawn only if day total ≥ 0.05mm.

```js
function drawRound4D(svg, d) {
  deckSky(svg, d);
  const T = d.rainMm.reduce((s, v) => s + v, 0);
  if (T >= 0.05) {
    const SCALE = 4;                                   // mm of accumulation filling the 20px climb
    let cum = 0; const pts = ['0,44'];
    for (const h of hours24) { cum += d.rainMm[h]; pts.push(`${x(h).toFixed(2)},${(44 - 20 * Math.min(1, cum / SCALE)).toFixed(2)}`); }
    pts.push(`240,${(44 - 20 * Math.min(1, cum / SCALE)).toFixed(2)}`);
    svg.append(el('path', { d: `M${pts.join(' L')} L240,44 L0,44 Z`, fill: 'url(#r4wet)' }));
    svg.append(el('polyline', { points: pts.join(' '), fill: 'none', stroke: '#2aa5a2',
      'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round',
      'stroke-linecap': 'round' }));
    cum = 0;
    for (const h of hours24) { const before = cum; cum += d.rainMm[h];     // gloss on shower steps
      if (cum - before >= 0.3) svg.append(el('circle', { cx: x(h).toFixed(2),
        cy: (44 - 20 * Math.min(1, cum / SCALE)).toFixed(2), r: 1.5, fill: 'url(#r4drop)' })); }
  }
  r4verdict(svg, d, STY, 3);
  r4rail(svg, d, 53);
  r4frames(svg, d);
}
```

**Hover.** Readout speaks in accumulation — "+0.9 mm this hour · 1.4 mm so far today · trace
climbing" (or "trace flat") — plus the moon line as in A.
