// The name of every icon-only control in the planner: its icon, the tooltip a pointer sees,
// and the accessible name a screen reader says. One list, so the wording is the same in the
// toolbar, the panel and the preview ticket. Dan's feedback (2026-11-23) asked for tooltips on
// the toolbar buttons; this is their text.
//
//   tip    two or three words, sentence case, no full stop: what the button is
//   name   what it does, as a full phrase, for `aria-label`
//
// `id` is the element's id in src/pages/plan.astro where the control exists today; controls
// that only the new panel has carry `id: null`. A body control (`icon: 'sun'` or `'moon'`)
// takes the canonical body from ./bodies.js, not an icon.
import { setIcon } from './icons.js';

export const CONTROL_NAMES = [
  // The toolbar, top right
  { key: 'compass', id: 'compass', icon: 'compass', tip: 'Face north', name: 'Compass: turn the map to face north' },
  { key: 'face-tower', id: 'face-tower', icon: 'tower', tip: 'Face the TV tower', name: 'Turn to face the TV tower' },
  { key: 'face-sun', id: 'face-sun', icon: 'sun', tip: 'Face the sun', name: 'Turn to face the sun' },
  { key: 'face-moon', id: 'face-moon', icon: 'moon', tip: 'Face the moon', name: 'Turn to face the moon' },
  { key: 'locate', id: 'locate', icon: 'locate', tip: 'My location', name: 'Stand where you are now' },
  { key: 'help', id: 'help', icon: 'help', tip: 'How this works', name: 'How this works' },
  { key: 'layers', id: 'layers', icon: 'layers', tip: 'Map layers', name: 'Map layers: choose what the map shows' },
  { key: 'tilt-flat', id: 'tilt', icon: null, tip: 'Flat view', name: 'Switch to the flat view from above' },
  { key: 'tilt-angled', id: 'tilt', icon: null, tip: 'Angled view', name: 'Switch to the angled view' },
  { key: 'photographer', id: 'photographer', icon: 'camera', tip: 'Stand here', name: 'Stand here: drag onto the map, or tap to stand in the middle' },

  // Top left
  { key: 'back', id: 'back', icon: 'arrow-left', tip: 'Back to the map', name: 'Back to the map' },
  { key: 'takeoff', id: 'takeoff', icon: 'drone', tip: 'Drone view', name: 'Take off: see this spot from a drone, up to 120 metres' },
  { key: 'land', id: 'takeoff', icon: 'walk', tip: 'Back on foot', name: 'Land: return to eye level on foot' },
  { key: 'go-there', id: 'share', icon: 'pin', tip: 'Go there', name: 'Go there: directions, calendar and a link to this view' },
  { key: 'directions', id: 'directions', icon: 'pin', tip: 'Directions', name: 'Directions to this spot' },
  { key: 'calendar', id: 'calendar', icon: 'calendar', tip: 'Add to calendar', name: 'Add this shot to your calendar' },
  { key: 'copy-link', id: 'copylink', icon: 'link', tip: 'Copy link', name: 'Copy a link to this exact view' },
  { key: 'share-link', id: 'copylink', icon: 'share', tip: 'Share', name: 'Share a link to this exact view' },

  // Panel, sheet and preview ticket
  { key: 'expand', id: 'sheet-toggle', icon: 'chevron-up', tip: 'Show more', name: 'Show more of the panel' },
  { key: 'collapse', id: 'sheet-toggle', icon: 'chevron-down', tip: 'Show less', name: 'Show less of the panel' },
  { key: 'close', id: null, icon: 'close', tip: 'Close', name: 'Close' },
  { key: 'more', id: null, icon: 'more', tip: 'Lens and format', name: 'More: lens and camera format' },
  { key: 'filters', id: null, icon: 'tune', tip: 'Filters', name: 'Filters: which shots to show' },
  { key: 'minimap', id: 'minimap', icon: 'minimap', tip: 'Minimap', name: 'Minimap: where you stand. Tap to go back to the map' },
  { key: 'minimap-toggle', id: 'minimap-toggle', icon: 'minimap', tip: 'Where you stand', name: 'Show or hide the small map of where you stand' },
  { key: 'lens', id: null, icon: 'lens', tip: 'Lens', name: 'Lens: choose the focal length' },
  { key: 'thirds', id: 'thirds', icon: 'thirds', tip: 'Thirds', name: 'Show lines at thirds' },
  { key: 'reaim', id: null, icon: 'aim', tip: 'Re-aim', name: 'Re-aim the camera at the shot' },
  { key: 'view-here', id: 'viewhere', icon: 'eye', tip: 'View from here', name: 'View from here at eye level' },

  // Time
  { key: 'shot-earlier', id: null, icon: 'shot-earlier', tip: 'Earlier shot', name: 'Go to the earlier shot' },
  { key: 'shot-later', id: null, icon: 'shot-later', tip: 'Later shot', name: 'Go to the later shot' },
  { key: 'minute-back', id: null, icon: 'minus', tip: '1 minute earlier', name: 'One minute earlier' },
  { key: 'minute-forward', id: null, icon: 'plus', tip: '1 minute later', name: 'One minute later' },
  { key: 'now', id: null, icon: 'now', tip: 'Now', name: 'Go to the present minute' },
  { key: 'play', id: null, icon: 'play', tip: 'Play', name: 'Run time forward' },
  { key: 'pause', id: null, icon: 'pause', tip: 'Pause', name: 'Pause time' },
  { key: 'prev-day', id: 'prev-day', icon: 'chevron-left', tip: 'Previous day', name: 'Previous day' },
  { key: 'next-day', id: 'next-day', icon: 'chevron-right', tip: 'Next day', name: 'Next day' },
  { key: 'pick-date', id: 'date', icon: 'calendar', tip: 'Choose a date', name: 'Choose a date' },
  { key: 'more-dates', id: 'dates-toggle', icon: 'calendar', tip: 'More dates', name: 'More dates from where you stand' },
];

/** One control's wording, by key. */
export function controlName(key) {
  const found = CONTROL_NAMES.find((c) => c.key === key);
  if (!found) throw new Error(`No control named "${key}"`);
  return found;
}

/**
 * Give a control its icon, tooltip and accessible name in one call.
 * The tooltip is the native `title`; a custom tooltip can read `data-tip` instead. Body
 * controls (sun, moon) and text controls (2D) get the names only: their content is set elsewhere.
 * @param {Element} el the button
 * @param {string} key a key of CONTROL_NAMES
 * @param {{ size?: number }} [options] icon size, 22 in a 40 px round control
 */
export function nameControl(el, key, { size = 22 } = {}) {
  const { icon, tip, name } = controlName(key);
  if (icon && icon !== 'sun' && icon !== 'moon') setIcon(el, icon, { size });
  el.setAttribute('aria-label', name);
  el.title = tip;
  el.dataset.tip = tip;
  return el;
}
