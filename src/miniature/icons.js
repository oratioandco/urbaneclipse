// The planner's icon set: one grid, one stroke, one corner style.
//
//   grid     24 × 24, drawn inside a 20 × 20 live area (2 units of air on every side)
//   stroke   1.75 units, round caps and round joins, `currentColor`, so both themes work
//   mass     the one solid thing in an icon may carry a 14 % wash of the same colour, the way
//            the miniature models the city as clay masses with drawn edges
//   bodies   there is no line-drawn sun or moon in this set. Wherever a sun or moon appears
//            (clear sky, part cloud, the light phases) it is the canonical body from
//            ./bodies.js, coloured by sunLook and moonLook. See docs/ICONS.md.
//
// Icons are inline-SVG strings. `icon()` returns one, `iconEl()` a DOM node, `setIcon()` puts
// one into a control, `iconSprite()` a <symbol> sprite. Decorative by default (aria-hidden);
// pass `label` when the icon alone carries the meaning.
import { discRadius, moonFragment, sunFragment, sunGlowFragment } from './bodies.js';

export const ICON_GRID = 24;
export const ICON_STROKE = 1.75;
const MASS_OPACITY = 0.14;
const SOFT_OPACITY = 0.5;
const DOT_STROKE = 2.5;

/** A full circle as path data. */
const c = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
/** A rounded rectangle as path data. */
const rr = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
/** A point, drawn as a zero-length round stroke. */
const dot = (x, y) => `M${x} ${y}h.01`;
/** The set's cloud, moved by ox, oy. `open` leaves a gap in its base for what falls from it. */
const cloud = (ox = 0, oy = 0, open = false) => {
  const top = `a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 ${7.1 + ox} ${9.6 + oy} 4.5 4.5 0 0 0 ${7 + ox} ${18.5 + oy}`;
  return open ? `M${15 + ox} ${18.5 + oy}h2${top}h2` : `M${7 + ox} ${18.5 + oy}h10${top}z`;
};
const TOWER = `M12 2.25v5${c(12, 10.5, 3.25)}M10.6 13.6l-1.1 7.9h5l-1.1-7.9`;
const RING = c(12, 12, 8.25);

/**
 * Every icon, by name. Parts: `d` the strokes, `mass` the clay wash, `soft` secondary strokes
 * at half strength, `solid` filled shapes, `dots` points. All in the 24-unit grid.
 * `use` says what the icon means in the planner; the specimen and the note print it.
 */
export const ICONS = {
  // Panel and sheet
  'chevron-down': { d: 'M6 9.5l6 6 6-6', use: 'Collapse the panel or sheet one step' },
  'chevron-up': { d: 'M6 14.5l6-6 6 6', use: 'Expand the panel or sheet one step' },
  'chevron-left': { d: 'M14.5 6l-6 6 6 6', use: 'Previous day; back one level' },
  'chevron-right': { d: 'M9.5 6l6 6-6 6', use: 'Next day; open a row' },
  close: { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11', use: 'Close a menu, sheet or dialog' },
  more: { dots: dot(5.5, 12) + dot(12, 12) + dot(18.5, 12), use: 'More: lens and format in the preview ticket' },
  tune: { d: `M4 8h8.5M17.5 8H20${c(15, 8, 2.25)}M4 16h2.5M11.5 16H20${c(9, 16, 2.25)}`, use: 'Filters and planning options' },
  help: { d: 'M9 9.25a3 3 0 1 1 4.6 2.55c-.9.6-1.6 1.2-1.6 2.45', dots: dot(12, 18.25), use: 'How this works' },

  // Time
  'shot-earlier': { d: 'M17 6l-6 6 6 6M7 6v12', use: 'Jump to the earlier shot' },
  'shot-later': { d: 'M7 6l6 6-6 6M17 6v12', use: 'Jump to the later shot' },
  minus: { d: 'M6 12h12', use: 'One minute earlier' },
  plus: { d: 'M6 12h12M12 6v12', use: 'One minute later' },
  now: { d: `${RING}M12 7.25V12l3.25 2`, use: 'Return to the present minute' },
  play: { d: 'M8.5 6.25l9.75 5.75-9.75 5.75z', solid: 'M8.5 6.25l9.75 5.75-9.75 5.75z', use: 'Run time forward' },
  pause: { d: rr(7.25, 6.25, 2.75, 11.5, 0.9) + rr(14, 6.25, 2.75, 11.5, 0.9), solid: rr(7.25, 6.25, 2.75, 11.5, 0.9) + rr(14, 6.25, 2.75, 11.5, 0.9), use: 'Hold time' },
  calendar: { d: `${rr(3.75, 5.5, 16.5, 14.75, 3)}M3.75 10.5h16.5M8.5 3.25v4M15.5 3.25v4`, use: 'Pick a date; more dates from here; add to calendar' },
  rise: { d: 'M3.5 18.5h17M6.5 12.5l5.5-5.5 5.5 5.5', use: 'Rises at (moonrise, sunrise)' },
  set: { d: 'M3.5 18.5h17M6.5 7l5.5 5.5L17.5 7', use: 'Sets at (moonset, sunset)' },

  // Map and view
  layers: { d: 'M12 3.75l8.5 4.5-8.5 4.5-8.5-4.5z', mass: 'M12 3.75l8.5 4.5-8.5 4.5-8.5-4.5z', soft: 'M3.5 12.25l8.5 4.5 8.5-4.5M3.5 16.25l8.5 4.5 8.5-4.5', use: 'What the map shows' },
  locate: { d: 'M19.75 4.25L4 10.75l6.75 2.5 2.5 6.75z', use: 'Stand where you are' },
  compass: { d: `${RING}M12 6.75l2.4 5.25-2.4 5.25-2.4-5.25z`, solid: 'M12 6.75l2.4 5.25h-4.8z', use: 'Turn to face north; the filled half of the needle is north' },
  minimap: { d: rr(3.25, 4.25, 17.5, 15.5, 3.5) + rr(6.25, 11.5, 7.5, 5.5, 1.5), mass: rr(6.25, 11.5, 7.5, 5.5, 1.5), use: 'The minimap, as a corner button in preview' },
  map: { d: 'M3.5 6.5L9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z', soft: 'M9 4.5v13M15 6.5v13', use: 'Back to the map' },
  eye: { d: `M2.5 12c2.3-4.2 5.5-6.3 9.5-6.3s7.2 2.1 9.5 6.3c-2.3 4.2-5.5 6.3-9.5 6.3S4.8 16.2 2.5 12z${c(12, 12, 2.75)}`, use: 'View from here: the eye-level preview' },
  aim: { d: `${c(12, 12, 5.75)}M12 2.5v3.75M12 17.75v3.75M2.5 12h3.75M17.75 12h3.75`, dots: dot(12, 12), use: 'Re-aim the camera at the shot' },
  camera: { d: `M4.25 8.25H7.5l1.4-2.5h6.2l1.4 2.5h3.25a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5v-8a1.5 1.5 0 0 1 1.5-1.5z${c(12, 13.5, 3.25)}`, mass: c(12, 13.5, 3.25), use: 'The photographer: stand here' },
  lens: { d: RING + c(12, 12, 3.75), mass: c(12, 12, 3.75), soft: 'M7.3 9.6a5.3 5.3 0 0 1 2.3-2.3', use: 'Lens and focal length' },
  thirds: { d: rr(3, 5.25, 18, 13.5, 2.75), soft: 'M9 5.25v13.5M15 5.25v13.5M3 9.75h18M3 14.25h18', use: 'Lines at thirds' },
  drone: { d: `M2.25 5.75H10M14 5.75h7.75M6 5.75v4.75M18 5.75v4.75M6 10.5h2M16 10.5h2${rr(8, 7.75, 8, 6.5, 2.5)}${c(12, 18.5, 2.4)}`, mass: rr(8, 7.75, 8, 6.5, 2.5), dots: dot(12, 18.5), use: 'Drone view: fly above the spot' },
  walk: { d: `${c(13, 4.5, 1.9)}M12.25 8.75l-2 5.25 3.25 3 .75 4.5M10.25 14L7.5 21.25M8 12.25l4.25-3.5 2.75 3 2.75.75`, use: 'Eye level on foot: walk from here' },
  takeoff: { d: 'M4.5 20.5h15M12 16.5V4M7.5 8.5L12 4l4.5 4.5', use: 'Take off' },

  // Going there
  pin: { d: `M12 21.25c-4.3-3.9-6.5-7.6-6.5-11.1a6.5 6.5 0 0 1 13 0c0 3.5-2.2 7.2-6.5 11.1z${c(12, 10.1, 2.25)}`, use: 'Go there; directions' },
  share: { d: 'M12 14.5V3.5M7.75 7.75L12 3.5l4.25 4.25M5 12.5v5.75a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12.5', use: 'Share this view' },
  link: { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', use: 'Copy link' },
  'arrow-left': { d: 'M19.5 12h-15M10 6.5L4.5 12l5.5 5.5', use: 'Back' },
  'arrow-right': { d: 'M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5', use: 'Go: open this shot' },
  external: { d: 'M7.5 16.5l9-9M9.25 7.5h7.25v7.25', use: 'Opens another site' },

  // Map layers and landmarks
  tower: { d: TOWER, mass: c(12, 10.5, 3.25), use: 'The TV tower; turn to it' },
  'tower-line': { d: TOWER, mass: c(12, 10.5, 3.25), soft: 'M3 19.5L21 12', use: 'Layer: tower alignments' },
  henge: { d: 'M6 21L9.75 3.5M18 21L14.25 3.5', soft: 'M12 20.5v-3M12 14v-2.5M12 8.5V7', mass: 'M9.75 3.5h4.5L18 21H6z', use: 'Layer: street henges' },
  tree: { d: `${c(12, 9.25, 6.25)}M12 21.25V10.5M12 15.25L9.25 12.5M12 13l2.5-2.5`, mass: c(12, 9.25, 6.25), use: 'Layer: trees' },
  names: { d: `M3.75 18.5L8.5 6l4.75 12.5M5.5 14.25h6${c(17.5, 15.25, 3)}M20.5 12v6.5`, use: 'Layer: street names' },
  'cloud-map': { d: cloud(0, -2), mass: cloud(0, -2), soft: 'M5 20.75h14', use: 'Layer: clouds over the map' },

  // Weather. Clear sky and part cloud take a canonical body: see weatherIcon().
  cloud: { d: cloud(), mass: cloud(), use: 'Cloud; layer: weather' },
  overcast: { d: cloud(-1, 1.5), mass: cloud(-1, 1.5), soft: 'M11.4 5.5a4.7 4.7 0 0 1 7.5 2.4 3.6 3.6 0 0 1 2.6 5', use: 'Overcast' },
  rain: { d: `${cloud(0, -2.75)}M8.5 18.75l-1 2.75M12.5 18.75l-1 2.75M16.5 18.75l-1 2.75`, mass: cloud(0, -2.75), use: 'Rain' },
  thunder: { d: `${cloud(0, -2.75, true)}M12.9 13.25l-2.9 4.5h3.9L11.4 22`, mass: cloud(0, -2.75), use: 'Thunderstorm' },

  // Verdicts: support for the word, never instead of it
  'verdict-go': { d: `${RING}M8.25 12.25l2.6 2.6 4.9-5.35`, use: 'Beside the word "Go"' },
  'verdict-maybe': { d: `${RING}M7.75 12.6c1.4-2 2.85-2 4.25 0s2.85 2 4.25 0`, use: 'Beside the word "Maybe"' },
  'verdict-skip': { d: `${RING}M6.2 17.8L17.8 6.2`, use: 'Beside the word "Skip"' },
};

export const ICON_NAMES = Object.keys(ICONS);

const escapeText = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** The drawing of an icon, without the outer <svg>: for sprites and for composing. */
export function iconBody(name) {
  const def = ICONS[name];
  if (!def) throw new Error(`No icon named "${name}"`);
  return (
    (def.mass ? `<path d="${def.mass}" fill="currentColor" fill-opacity="${MASS_OPACITY}" stroke="none"/>` : '') +
    (def.soft ? `<path d="${def.soft}" stroke-opacity="${SOFT_OPACITY}"/>` : '') +
    (def.d ? `<path d="${def.d}"/>` : '') +
    (def.solid ? `<path d="${def.solid}" fill="currentColor"/>` : '') +
    (def.dots ? `<path d="${def.dots}" stroke-width="${DOT_STROKE}"/>` : '')
  );
}

const STROKE_ATTRS = `fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"`;

function shell(inner, { size = 24, label = '', className = '' } = {}, kind = 'ue-icon') {
  const a11y = label ? `role="img" aria-label="${escapeText(label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${kind}${className ? ` ${escapeText(className)}` : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" ${STROKE_ATTRS} ${a11y} focusable="false">${label ? `<title>${escapeText(label)}</title>` : ''}${inner}</svg>`;
}

/**
 * An icon as an inline-SVG string.
 * @param {string} name a key of ICONS
 * @param {{ size?: number, label?: string, className?: string }} [options] `size` in CSS pixels
 *   (16, 20, 24 and 32 are the tested sizes). Without `label` the icon is hidden from assistive
 *   technology, which is right whenever a word or the control's own label says the same thing.
 */
export function icon(name, options) {
  return shell(iconBody(name), options, `ue-icon ue-icon-${name}`);
}

/** The same icon as a DOM element. */
export function iconEl(name, options) {
  const holder = document.createElement('template');
  holder.innerHTML = icon(name, options);
  return holder.content.firstElementChild;
}

/**
 * Put an icon into a control, replacing the one this helper put there before. The label goes
 * on the control, where a screen reader expects it, and the drawing stays hidden.
 * @param {Element} target a button, link or label
 * @param {string} name
 * @param {{ size?: number, label?: string, className?: string, after?: boolean }} [options]
 *   `label` sets the control's aria-label (leave it out when the control shows its own text);
 *   `after` puts the icon behind the text, not before it.
 */
export function setIcon(target, name, { label = '', after = false, ...options } = {}) {
  const fresh = name.nodeType ? name : iconEl(name, options);
  fresh.setAttribute('aria-hidden', 'true');
  fresh.removeAttribute('role');
  fresh.removeAttribute('aria-label');
  fresh.dataset.ueSlot = '';
  const old = target.querySelector(':scope > [data-ue-slot]');
  if (old) old.replaceWith(fresh);
  else if (after) target.append(fresh);
  else target.prepend(fresh);
  if (label) target.setAttribute('aria-label', label);
  return fresh;
}

/**
 * All icons as one hidden sprite of <symbol>s, for pages that prefer
 * `<svg class="ue-icon" …><use href="#ue-i-layers"/></svg>`. Insert it once, at the top of <body>.
 */
export function iconSprite() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${ICON_NAMES.map((name) => `<symbol id="ue-i-${name}" viewBox="0 0 24 24">${iconBody(name)}</symbol>`).join('')}</svg>`;
}

/** An icon drawn from the sprite. Same options as `icon`. */
export function iconUse(name, options) {
  if (!ICONS[name]) throw new Error(`No icon named "${name}"`);
  return shell(`<use href="#ue-i-${name}"/>`, options, `ue-icon ue-icon-${name}`);
}

// ---------------------------------------------------------------------------------------------
// Weather and light: icons that contain a body take the canonical one.

export const WEATHER_STATES = ['clear', 'some-cloud', 'overcast', 'rain', 'thunder'];
export const WEATHER_NAMES = { clear: 'Clear', 'some-cloud': 'Some cloud', overcast: 'Overcast', rain: 'Rain', thunder: 'Thunderstorm' };

let maskSerial = 0;
const bodyFragment = (cx, cy, r, { kind = 'sun', altitudeDeg = 30, ...rest } = {}, glow = true) =>
  kind === 'moon' ? moonFragment(cx, cy, r, { altitudeDeg, ...rest, glow }) : sunFragment(cx, cy, r, altitudeDeg, { glow });

/**
 * The sky's state as an icon.
 * @param {'clear'|'some-cloud'|'overcast'|'rain'|'thunder'} state
 * @param {{ size?: number, label?: string, className?: string,
 *   body?: { kind: 'sun'|'moon', altitudeDeg?: number, fraction?: number, waxing?: boolean, sunAltitudeDeg?: number } }} [options]
 *   `body` is the sun or moon of the minute shown; it appears in `clear` and `some-cloud`.
 *   Leave it out and a daytime sun is drawn.
 */
export function weatherIcon(state, { body, ...options } = {}) {
  if (state === 'clear') return shell(`<g stroke="none">${bodyFragment(12, 12, discRadius(24), body)}</g>`, options, 'ue-icon ue-weather ue-weather-clear');
  if (state === 'some-cloud') {
    // The body sits up and to the right; the cloud passes in front and cuts it with a clear gap.
    const id = `ue-cut-${++maskSerial}`;
    const cloudAt = 'translate(-0.75 4.6) scale(0.86)';
    return shell(
      `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff" stroke="none"/>` +
        `<path d="${cloud()}" transform="${cloudAt}" fill="#000" stroke="#000" stroke-width="${ICON_STROKE + 3.2}"/></mask></defs>` +
        `<g mask="url(#${id})" stroke="none">${bodyFragment(15.25, 8.5, 4.4, body)}</g>` +
        `<g transform="${cloudAt}" stroke-width="${ICON_STROKE / 0.86}"><path d="${cloud()}" fill="currentColor" fill-opacity="${MASS_OPACITY}" stroke="none"/><path d="${cloud()}"/></g>`,
      options,
      'ue-icon ue-weather ue-weather-some-cloud',
    );
  }
  if (!WEATHER_STATES.includes(state)) throw new Error(`No weather state "${state}"`);
  return shell(iconBody(state), options, `ue-icon ue-weather ue-weather-${state}`);
}

export const LIGHT_PHASES = ['night', 'twilight', 'blue', 'golden', 'day'];
/** The sun's height each phase is drawn at: inside the phase's range in src/lib/lightPhases.ts. */
export const PHASE_ALTITUDE = { night: -18, twilight: -10, blue: -6, golden: 2, day: 30 };
const HORIZON_Y = 19;
const HORIZON = `M3 ${HORIZON_Y}h18`;
/** A star: a small cross with round ends. */
const star = (x, y, r) => `M${x} ${y - r}v${2 * r}M${x - r} ${y}h${2 * r}`;
const STARS = {
  night: { d: star(8.5, 9, 3.25) + star(17, 5.25, 1.75), dots: dot(16, 13) },
  twilight: { d: star(8.5, 6.75, 2.5), dots: dot(16.5, 8.5) },
  blue: { d: '', dots: dot(16.5, 5.5) },
};

/**
 * A light phase as an icon: the canonical sun against a horizon, at the height that makes the
 * phase. Day: high. Golden hour: on the horizon. Blue hour: gone, its glow left, the first
 * star. Twilight: a trace of glow, two stars. Night: stars.
 * @param {'night'|'twilight'|'blue'|'golden'|'day'} phase as in src/lib/lightPhases.ts
 * @param {{ size?: number, label?: string, className?: string }} [options]
 */
export function phaseIcon(phase, options) {
  if (!LIGHT_PHASES.includes(phase)) throw new Error(`No light phase "${phase}"`);
  const alt = PHASE_ALTITUDE[phase];
  const id = `ue-sky-${++maskSerial}`;
  // Everything of the sun is cut off a little above the horizon line, so the line stays clean.
  const sky = `<defs><clipPath id="${id}"><rect x="0" y="0" width="24" height="${HORIZON_Y - ICON_STROKE / 2 - 0.9}"/></clipPath></defs>`;
  let sun = '';
  if (phase === 'day') sun = sunFragment(12, 9, 4.75, alt);
  else if (phase === 'golden') sun = sunFragment(12, 15.2, 5.25, alt);
  else if (phase === 'blue') sun = sunGlowFragment(12, HORIZON_Y + 0.5, 10, alt, 1.5);
  else if (phase === 'twilight') sun = sunGlowFragment(12, HORIZON_Y + 1, 7, alt, 1);
  const stars = STARS[phase];
  return shell(
    `${sky}<g clip-path="url(#${id})" stroke="none">${sun}</g><path d="${HORIZON}"/>` +
      (stars?.d ? `<path d="${stars.d}" stroke-width="1.5"/>` : '') +
      (stars?.dots ? `<path d="${stars.dots}" stroke-width="2.25"/>` : ''),
    options,
    `ue-icon ue-phase ue-phase-${phase}`,
  );
}
