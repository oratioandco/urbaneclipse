/**
 * The toolbar's tips on a touch screen, where nothing hovers (Dan's feedback, 2026-11-23, and
 * the adversarial test of 2026-11: six of the map's buttons are bare icons to a finger).
 *
 *   a tap          does what the button does and shows its tip beside it for a moment, so
 *                  every press says what it was (a menu button's menu names itself)
 *   a long press   shows the tip and does nothing else: a way to ask before pressing
 *
 * The tip is the button's `data-tip` (controlNames.js), drawn by miniature.css while
 * `data-tip-shown` is set. A mouse and the keyboard keep hover and focus.
 */
const HOLD_MS = 450;
const SHOW_MS = 1800;
const MOVE_PX = 10;

let shown = null;
let hideTimer = 0;
function hide() {
  clearTimeout(hideTimer);
  shown?.removeAttribute('data-tip-shown');
  shown = null;
}
function show(el, ms = SHOW_MS) {
  if (shown !== el) hide();
  shown = el;
  el.setAttribute('data-tip-shown', '');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, ms);
}

/** True while a long press that only asked for the tip is being let go: for a button that
 * acts on the pointer's release rather than on a click (the camera button, pointer.js). */
let asked = false;
export const onlyAsked = () => asked;

let press = null;
addEventListener('pointerdown', (event) => {
  press = null;
  if (event.pointerType === 'mouse') return;
  const el = event.target.closest?.('.tools [data-tip], .topleft [data-tip]');
  if (!el) return hide();
  press = { el, x: event.clientX, y: event.clientY, tip: el.dataset.tip, held: false };
  const mine = press;
  press.timer = setTimeout(() => {
    if (press !== mine) return;
    mine.held = true;
    show(el, 4000);
  }, HOLD_MS);
}, true);
addEventListener('pointermove', (event) => {
  // A drag (the camera button is dragged onto the map) is not a press.
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_PX) {
    clearTimeout(press.timer);
    press = null;
  }
}, true);
addEventListener('pointercancel', () => {
  if (press) clearTimeout(press.timer);
  press = null;
}, true);
addEventListener('pointerup', () => {
  if (!press) return;
  clearTimeout(press.timer);
  const { el, held, tip } = press;
  if (held) {
    // The long press only asked: its click is swallowed, and the tip stays a little longer.
    const swallow = (click) => {
      click.stopPropagation();
      click.preventDefault();
    };
    asked = true;
    setTimeout(() => (asked = false), 0);
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, true), 400);
    show(el);
  } else if (el.hasAttribute('aria-controls')) {
    // A button that opens a menu: the menu's own heading names it, and would cover the tip.
    hide();
  } else {
    show(el);
    // A button that changes what it is on a press (2D and 3D, take off and land) would now
    // name its next press, not this one: say nothing rather than the wrong thing.
    setTimeout(() => {
      if (shown === el && el.dataset.tip !== tip) hide();
    }, 120);
  }
  press = null;
}, true);
