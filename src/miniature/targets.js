/**
 * The landmarks the date search watches for the sun or moon passing behind them: the TV tower
 * by its own rules, and the figures on the Siegessäule and the Brandenburger Tor by the day
 * list's (src/lib/landmarkStands.ts, landmarkShots.js): the disc on the Viktoria or the
 * quadriga, not anywhere behind the column or the gate. Plain data and maths, so the worker
 * and the tests can use it.
 *
 * Scene positions are sceneFromLatLon (eye.js) of the landmark's axis, with the Fernsehturm's
 * axis as the origin, rounded to a centimetre; tests/unit/miniature.test.ts keeps them honest.
 */
import { landmarkHeight } from '../lib/landmarks.ts';
import { MIN_ALTITUDE_DEG, QUADRIGA, VIKTORIA, discShare, minDistanceM } from '../lib/landmarkStands.ts';
import { figureView, figureWord } from './landmarkShots.js';
import { TOWER_TARGET } from './towerShots.js';

const distanceText = (m) => `${Math.round(m / 10) * 10} m`;

/**
 * A figure as a target for `findShots`: one state, `figure`, for the minutes the disc overlaps
 * the figure as the eye-level line judges it (`figureView`: the figure's own height band, a
 * third of its height either side), with the body at least `MIN_ALTITUDE_DEG` up and the spot
 * far enough out for the disc to be `minDiscShare` of the figure. Those are the day list's
 * three conditions (`standFor`), asked from the spot instead of solved for it; behind the
 * shaft or the gate's columns is no shot. Buildings are checked afterwards, as for the tower
 * (dates.js); trees are not, which every date says.
 */
const figure = (target, x, z) => ({
  id: target.id,
  name: target.landmark.name,
  figure: target,
  x,
  z,
  topAGL: landmarkHeight(target.landmark),
  wanted: { sun: ['figure'], moon: ['figure'] },
  rank: { figure: 4 },
  stateAt: (eye, _base, body) => {
    const view = figureView(target, eye, { x, z }, body);
    const on = view.covered && (body.trueAlt ?? body.alt) >= MIN_ALTITUDE_DEG && discShare(target, view.distanceM) >= target.minDiscShare;
    return { state: on ? 'figure' : 'near', sepDeg: Math.hypot(view.across, view.up), signedOff: view.across, rise: body.alt };
  },
  heading: `Behind the ${target.short}\u2019s ${figureWord(target)} from here`,
  /** Why the year holds nothing, from `flat` metres out: too close for the disc, or no pass. */
  none: (flat) =>
    flat < minDistanceM(target)
      ? `Too close: under ${distanceText(minDistanceM(target))} from ${target.noun} the sun or moon is less than half the ${figureWord(target)}. Step back.`
      : `Neither the sun nor the moon stands behind the ${figureWord(target)} from this spot in the next 12 months.`,
  stateText: {
    sun: { figure: `Sun behind the ${target.short}\u2019s ${figureWord(target)}` },
    moon: { figure: `Moon behind the ${target.short}\u2019s ${figureWord(target)}` },
  },
});

export const TARGETS = [
  {
    ...TOWER_TARGET,
    heading: 'Behind the TV tower from here',
    none: 'Neither the sun nor the moon passes behind the tower from this spot in the next 12 months. Tower lines on the map show where they do.',
    stateText: {
      sun: { hidden: 'Sun behind the sphere', ring: 'Ring of sun round the sphere', edge: 'Sun at the sphere’s edge', antenna: 'Sun behind the antenna' },
      moon: { edge: 'Moon at the sphere’s edge', antenna: 'Moon behind the antenna' },
    },
  },
  figure(QUADRIGA, -2153.0, 505.0),
  figure(VIKTORIA, -4027.1, 699.6),
];
