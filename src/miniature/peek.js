/**
 * The panel's one line: the next shot worth going out for, said in full (what, where, when
 * and the verdict), or a plain sentence when nothing is coming. It is all the phone sheet
 * shows at peek, the side panel's heading, and, folded, the rail's middle button.
 *
 * The line never cuts the shot off. It has several wordings of the same shot, fullest first
 * (shotWords.js), and takes the first that fits the width it has: the countdown goes first,
 * then "Straße" becomes "Str." and the day its short name. The type stays the panel's size.
 */
import { bodyIcon } from './bodyAt.js';
import { showVerdict } from './daylist.js';
import { peekVariants } from './shotWords.js';
import { formatClock } from './time.js';
import { countdown } from './verdict.js';

const line = document.getElementById('peek-line');
const toggle = document.getElementById('sheet-toggle');
const rail = document.getElementById('rail-next');

const node = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });

/** What the line was last asked to show, so a new width can word it again. */
let shown = null;

/** Word the line with the first variant that fits; the last one may still be cut by its ellipsis. */
function fit() {
  if (!shown) return;
  const { variants, icon, verdict } = shown;
  for (const [i, v] of variants.entries()) {
    const what = node('span', 'what', v.what);
    const parts = [node('b', '', v.when), what];
    if (v.wait) parts.push(node('span', 'in', v.wait));
    if (verdict) {
      const said = node('em', 'verdict', '');
      showVerdict(said, verdict, { reason: false });
      said.title = verdict.label;
      parts.push(said);
    }
    line.innerHTML = icon;
    line.append(...parts);
    // Hidden (the folded rail) there is nothing to measure: the fullest wording stands.
    if (!line.clientWidth || what.scrollWidth <= what.clientWidth || i === variants.length - 1) return;
  }
}
new ResizeObserver(fit).observe(line);

/**
 * Show the next shot. `shot` is `{ row, day, dayShort, verdict }` (a plan row, its day's name
 * when it is not today, long and short, and its verdict), or null with `sentence` saying why
 * there is none.
 */
export function renderPeek(shot, now, sentence = 'Looking for the next shot…') {
  if (!shot) {
    shown = null;
    line.replaceChildren(node('span', 'what sentence', sentence));
    toggle.setAttribute('aria-label', sentence);
    rail.replaceChildren();
    rail.removeAttribute('aria-label');
    return;
  }
  const { row, day, dayShort, verdict } = shot;
  const clock = formatClock(row.t);
  const when = `${day ? `${day} ` : ''}${clock}`;
  const wait = countdown(row.t, now);
  const icon = bodyIcon(row.body, row.t, { size: 20 });
  shown = { variants: peekVariants({ brief: row.brief ?? row.title, compact: row.compact ?? row.brief ?? row.title, short: row.short ?? row.title, when, whenShort: `${dayShort ? `${dayShort} ` : ''}${clock}`, wait }), icon, verdict };
  fit();
  const said = `Next shot: ${row.title}, ${when}, ${wait}${verdict ? `. ${verdict.label}` : ''}`;
  toggle.setAttribute('aria-label', said);
  rail.innerHTML = icon;
  rail.append(node('b', '', clock), node('small', '', wait.replace(/^in /, '')));
  rail.setAttribute('aria-label', `${said}. Show it.`);
  rail.title = `${row.title} · ${when} · ${wait}`;
}
