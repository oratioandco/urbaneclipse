/**
 * The panel's shell. On a phone it is a bottom sheet with three heights: peek (one line),
 * half (the day view) and full (planning). The handle drags and snaps, a tap toggles peek
 * and half, moving the map drops it to peek, Escape and the back button step down, and the
 * height the user chose is remembered. From 900 px it is a side panel that folds to a rail.
 * The rules for the heights are in sheetHeights.js; this file is the wiring.
 */
import { params } from './config.js';
import { exitEye } from './eyeLevel.js';
import './glass.js';
import { controls } from './render.js';
import { parseHeight, sheetSizes, snapHeight, stepDown, stepUp, tapHeight } from './sheetHeights.js';
import { invalidate } from './state.js';

const sheet = document.getElementById('sheet');
const panel = document.getElementById('panel');
const head = document.getElementById('sheet-head');
const body = document.getElementById('sheet-body');
const dayview = document.getElementById('dayview');
const planning = document.getElementById('planning');
const overview = document.getElementById('overview');
const tabs = document.getElementById('viewbar');
const stepper = document.querySelector('.dv-nav');
const toggle = document.getElementById('sheet-toggle');
const grab = document.getElementById('sheet-grab');
const step = document.getElementById('sheet-step');

const HEIGHT_KEY = 'miniature.sheet';
const PANEL_KEY = 'miniature.panel';
const wide = matchMedia('(min-width: 900px)');
const atEye = () => document.body.dataset.eye === 'true';
/** The sheet only acts as one on a phone-shaped screen, on the map. */
const isSheet = () => !wide.matches && !atEye();

const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

// `?sheet=` and `?panel=` open a state without storing it, for links and checks.
let height = parseHeight(params.get('sheet') ?? stored(HEIGHT_KEY), 'half');
let sizes = { peek: 0, half: 0, full: 0 };

function measure() {
  const pad = (el, side) => parseFloat(getComputedStyle(el)[side]) || 0;
  const foot = pad(panel, 'paddingBottom');
  const under = pad(body, 'paddingBottom');
  const gap = pad(body, 'rowGap');
  const innerGap = pad(dayview, 'rowGap');
  sizes = sheetSizes({
    viewport: innerHeight,
    head: head.offsetHeight + foot,
    // Half is the top of whichever view is up: the tabs, then the day view or the overview.
    // The day view's step buttons lie just under the fold: half ends at its line of text, so
    // the sheet stays near half the screen; full (one step up) shows them.
    day: [tabs, dayview, overview].reduce((sum, el) => sum + (el.offsetHeight ? el.offsetHeight + gap : 0), 0) - gap + (stepper.offsetHeight ? under / 2 - stepper.offsetHeight - innerGap : under),
    all: body.scrollHeight,
  });
}

function show() {
  sheet.style.setProperty('--sheet-h', `${Math.round(sizes[height])}px`);
  document.body.dataset.sheet = height;
  toggle.setAttribute('aria-expanded', String(wide.matches || height !== 'peek'));
  step.setAttribute('aria-label', height === 'full' ? 'Hide the list of shots' : height === 'half' ? 'Show the list of shots' : 'Open the panel');
  step.setAttribute('aria-expanded', String(height === 'full'));
  invalidate();
}

// Back steps the sheet down before it leaves the page: raising the sheet adds one history
// entry, and lowering it to peek by hand takes that entry away again.
let entry = false;
let skipPop = false;
// Eye level is a place of its own in the history: entering it adds an entry, the Map button
// takes it away again, and the back button or Escape leaves through it.
let eyeEntry = false;
new MutationObserver(() => {
  const eye = document.body.dataset.eye === 'true';
  if (eye && !eyeEntry) {
    history.pushState({ eye: true }, '');
    eyeEntry = true;
    // The keyboard's focus goes where eye level's controls are.
    if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected || document.activeElement.closest('#sheet-body')) {
      // The page moves the focus here, nobody asked what the button is: no tip until they do.
      const back = document.getElementById('back');
      back.dataset.tipQuiet = '';
      back.addEventListener('blur', () => delete back.dataset.tipQuiet, { once: true });
      back.focus({ preventScroll: true });
    }
  } else if (!eye && eyeEntry) {
    eyeEntry = false;
    skipPop = true;
    history.back();
  }
  // Back on the map, the focus returns to the panel's first control.
  if (!eye && (document.activeElement === document.body || document.activeElement?.closest('.topleft'))) toggle.focus({ preventScroll: true });
}).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });
function syncHistory() {
  if (!isSheet()) return;
  if (height !== 'peek' && !entry) {
    history.pushState({ sheet: true }, '');
    entry = true;
  } else if (height === 'peek' && entry) {
    entry = false;
    skipPop = true;
    history.back();
  }
}
addEventListener('popstate', () => {
  if (skipPop) {
    skipPop = false;
    return;
  }
  // Back at eye level returns to the map, not to the page before the planner.
  if (eyeEntry) {
    eyeEntry = false;
    exitEye();
    return;
  }
  if (!entry) return;
  entry = false;
  setHeight(stepDown(height), { history: false });
  if (height !== 'peek') {
    history.pushState({ sheet: true }, '');
    entry = true;
  }
});

/**
 * Set the sheet's height. A choice the user made is remembered; a drop the app made (the map
 * moved) is not, so the next visit opens where the user left it.
 */
export function setHeight(next, { remember = true, history: touchHistory = true } = {}) {
  height = parseHeight(next, height);
  if (height === 'full' && sizes.full <= sizes.half + 1) height = 'half';
  if (remember) store(HEIGHT_KEY, height);
  show();
  if (height !== 'full') body.scrollTop = 0;
  if (touchHistory) syncHistory();
}
export const getHeight = () => height;

function refresh() {
  measure();
  if (!sheet.classList.contains('dragging')) show();
}
new ResizeObserver(refresh).observe(dayview);
new ResizeObserver(refresh).observe(overview);
new ResizeObserver(refresh).observe(planning);
new ResizeObserver(refresh).observe(head);
addEventListener('resize', refresh);
wide.addEventListener('change', refresh);
new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });

/** What the peek line does on a wide screen, where there is nothing to toggle. */
let peekAction = null;
export function onPeek(action) {
  peekAction = action;
}

// The handle row drags the sheet. The pointer is followed on the window (a drag leaves the
// row at once) and is only captured once it has moved, so a plain tap still reaches the
// buttons in the row.
let drag = null;
let dragged = false;
function moveDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dy = event.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.abs(dy) < 6) return;
    drag.moved = true;
    sheet.classList.add('dragging');
    head.setPointerCapture(drag.id);
  }
  const dt = event.timeStamp - drag.t;
  // Up is positive; smoothed, so the last few events decide the flick.
  if (dt > 0) drag.v = 0.6 * ((drag.y - event.clientY) / dt) + 0.4 * drag.v;
  drag.y = event.clientY;
  drag.t = event.timeStamp;
  drag.at = Math.min(sizes.full, Math.max(sizes.peek, drag.h0 - dy));
  sheet.style.setProperty('--sheet-h', `${Math.round(drag.at)}px`);
  // The content shows while the sheet is on its way, and scrolls only once it is full.
  document.body.dataset.sheet = drag.at > sizes.half + 1 ? 'full' : 'half';
  invalidate();
}
function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const done = drag;
  drag = null;
  removeEventListener('pointermove', moveDrag);
  removeEventListener('pointerup', endDrag);
  removeEventListener('pointercancel', endDrag);
  if (!done.moved) return;
  sheet.classList.remove('dragging');
  dragged = true;
  setTimeout(() => (dragged = false), 0);
  // A finger that stopped before lifting is a placement, not a flick.
  const velocity = event.timeStamp - done.t > 120 ? 0 : done.v;
  setHeight(event.type === 'pointercancel' ? done.from : snapHeight({ at: done.at, velocity, from: done.from, sizes }));
}
head.addEventListener('pointerdown', (event) => {
  if (!isSheet() || drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
  measure();
  drag = { id: event.pointerId, y0: event.clientY, h0: sheet.offsetHeight, from: height, moved: false, y: event.clientY, t: event.timeStamp, v: 0 };
  addEventListener('pointermove', moveDrag);
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);
});
// The click that ends a drag is not a tap.
head.addEventListener(
  'click',
  (event) => {
    if (!dragged) return;
    event.stopPropagation();
    event.preventDefault();
  },
  true,
);

toggle.addEventListener('click', () => {
  if (isSheet()) setHeight(tapHeight(height));
  else peekAction?.();
});
step.addEventListener('click', () => setHeight(height === 'full' ? 'half' : stepUp(height)));
// The grabber is the handle for keys: Enter walks the three heights, the arrows step.
grab.addEventListener('click', () => setHeight(height === 'full' ? 'peek' : stepUp(height)));
grab.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  setHeight(event.key === 'ArrowUp' ? stepUp(height) : stepDown(height));
});

addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // At eye level Escape goes back to the map, unless a menu, a dialog or a field wants it.
  if (document.body.dataset.eye === 'true') {
    if (document.querySelector('dialog[open]') || !document.getElementById('layers-menu').hidden || !document.getElementById('share-menu').hidden) return;
    if (event.target instanceof HTMLElement && event.target.matches('input:not([type=range]), select, textarea')) return;
    exitEye();
    return;
  }
  if (!isSheet() || height === 'peek') return;
  // A dialog, a menu or a field has its own use for Escape.
  if (document.querySelector('dialog[open]') || !document.getElementById('layers-menu').hidden) return;
  if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
  setHeight(stepDown(height));
  // Folded to peek, whatever had the focus is out of reach: hand it to the peek line.
  if (height === 'peek' && body.contains(document.activeElement)) toggle.focus({ preventScroll: true });
});

// A keyboard can walk into what lies under the fold at half height (the step buttons, the
// list). The sheet opens fully for it, so the focus is never on something out of sight.
body.addEventListener('focusin', (event) => {
  if (!isSheet() || height !== 'half' || drag || document.body.dataset.eye === 'true') return;
  if (body.scrollTop > 0 || event.target.getBoundingClientRect().top > innerHeight - 12) {
    body.scrollTop = 0;
    setHeight('full', { remember: false });
    event.target.scrollIntoView?.({ block: 'nearest' });
  }
});

// Moving the map means looking at the map: the sheet gets out of the way.
let touching = false;
controls.addEventListener('start', () => (touching = true));
controls.addEventListener('end', () => (touching = false));
controls.addEventListener('change', () => {
  if (touching && isSheet() && height !== 'peek' && !drag) setHeight('peek', { remember: false });
});

// The side panel and its rail.
const fold = document.getElementById('panel-fold');
function setPanel(state, remember = true) {
  document.body.dataset.panel = state === 'rail' ? 'rail' : 'open';
  if (remember) store(PANEL_KEY, document.body.dataset.panel);
  invalidate();
}
/** Open the side panel (a no-op for the sheet) and bring one of its sections into view. */
export function openPanel(section) {
  const wasRail = document.body.dataset.panel === 'rail';
  setPanel('open');
  section?.scrollIntoView({ block: 'start' });
  if (wasRail && wide.matches) (section?.querySelector('button, input') ?? fold).focus({ preventScroll: true });
}
fold.addEventListener('click', () => {
  setPanel('rail');
  document.getElementById('rail-open').focus({ preventScroll: true });
});
document.getElementById('rail-open').addEventListener('click', () => {
  setPanel('open');
  fold.focus({ preventScroll: true });
});
document.getElementById('rail-next').addEventListener('click', () => {
  openPanel(dayview);
  peekAction?.();
});
const showView = (mode) => document.querySelector(`.tabs [data-mode="${mode}"]`).click();
document.getElementById('rail-day').addEventListener('click', () => {
  showView('shoot');
  openPanel(dayview);
});
document.getElementById('rail-plan').addEventListener('click', () => {
  showView('plan');
  openPanel(overview);
});
setPanel(params.get('panel') ?? stored(PANEL_KEY), false);

measure();
show();
