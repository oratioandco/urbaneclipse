/**
 * The landmarks the date search watches for the sun or moon passing behind them: the TV tower
 * by its own rules, and any solid of revolution from src/lib/landmarks.ts through
 * bodyAgainstProfile. Plain data and maths, so the worker and the tests can use it.
 *
 * Scene positions are sceneFromLatLon (eye.js) of the landmark's axis, with the Fernsehturm's
 * axis as the origin, rounded to a centimetre; tests/unit/miniature.test.ts keeps them honest.
 */
import { BRANDENBURGER_TOR, SIEGESSAEULE, landmarkHeight } from '../lib/landmarks.ts';
import { TOWER_TARGET, bodyAgainstProfile } from './towerShots.js';

/** Rank and wanted states shared by the solid landmarks: the edge and the halo are the shots. */
const SOLID_RANK = { hidden: 4, ring: 4, edge: 3 };
const SOLID_WANTED = { sun: ['hidden', 'ring', 'edge'], moon: ['ring', 'edge'] };

/** A target for bodyAgainstProfile: stateAt closed over the landmark's profile and axis. */
const solid = (landmark, x, z) => ({
  id: landmark.id,
  name: landmark.name,
  x,
  z,
  topAGL: landmarkHeight(landmark),
  wanted: SOLID_WANTED,
  rank: SOLID_RANK,
  stateAt: (eye, base, body) => bodyAgainstProfile(landmark.profile, x, z, landmarkHeight(landmark), eye, base, body),
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
  {
    ...solid(BRANDENBURGER_TOR, -2153.0, 505.0),
    heading: 'Behind the Brandenburger Tor from here',
    none: 'Neither the sun nor the moon passes behind the gate from this spot in the next 12 months.',
    stateText: {
      sun: { hidden: 'Sun behind the gate', ring: 'The gate’s quadriga in the sun', edge: 'Sun at the gate’s edge' },
      moon: { ring: 'The gate’s quadriga in the moon', edge: 'Moon at the gate’s edge' },
    },
  },
  {
    ...solid(SIEGESSAEULE, -4027.1, 699.6),
    heading: 'Behind the Siegessäule from here',
    none: 'Neither the sun nor the moon passes behind the column from this spot in the next 12 months.',
    stateText: {
      sun: { hidden: 'Sun behind the column', ring: 'Ring of sun round the column', edge: 'Sun at the column’s edge' },
      moon: { ring: 'Big moon round the column', edge: 'Moon at the column’s edge' },
    },
  },
];
