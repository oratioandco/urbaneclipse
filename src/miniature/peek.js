/**
 * The panel's one line: the next shot worth going out for, with a countdown, or a plain
 * sentence when nothing is coming. It is all the phone sheet shows at peek, the side panel's
 * heading, and, folded, the rail's middle button.
 */
import { bodyIcon } from './daylist.js';
import { formatClock } from './time.js';
import { countdown } from './verdict.js';

const line = document.getElementById('peek-line');
const toggle = document.getElementById('sheet-toggle');
const rail = document.getElementById('rail-next');

const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });

/**
 * Show the next shot. `shot` is `{ row, day, verdict }` (a plan row, its day's name when it is
 * not today, and its verdict), or null with `sentence` saying why there is none.
 */
export function renderPeek(shot, now, sentence = 'Looking for the next shot…') {
  if (!shot) {
    line.replaceChildren(span('what', sentence));
    toggle.setAttribute('aria-label', sentence);
    rail.replaceChildren();
    rail.removeAttribute('aria-label');
    return;
  }
  const { row, day, verdict } = shot;
  const when = `${day ? `${day} ` : ''}${formatClock(row.t)}`;
  const wait = countdown(row.t, now);
  const icon = document.createElement('template');
  icon.innerHTML = bodyIcon(row.body, row.t);
  const time = Object.assign(document.createElement('b'), { textContent: when });
  const parts = [icon.content, time, span('what', row.title), span('in', wait)];
  if (verdict) parts.push(Object.assign(document.createElement('em'), { className: 'verdict', textContent: verdict.word, title: verdict.label }));
  line.replaceChildren(...parts);
  if (verdict) line.lastElementChild.dataset.grade = verdict.grade ?? 'none';
  const said = `Next shot: ${row.title}, ${when}, ${wait}${verdict ? `. ${verdict.label}` : ''}`;
  toggle.setAttribute('aria-label', said);
  const railIcon = document.createElement('template');
  railIcon.innerHTML = bodyIcon(row.body, row.t);
  rail.replaceChildren(railIcon.content, Object.assign(document.createElement('b'), { textContent: formatClock(row.t) }), Object.assign(document.createElement('small'), { textContent: wait.replace(/^in /, '') }));
  rail.setAttribute('aria-label', `${said}. Show it.`);
  rail.title = `${row.title} · ${when} · ${wait}`;
}
