/**
 * From the plan to the place: directions to where you stand, the moment in your calendar, and
 * a link that opens this exact view. Also the toast that confirms such things.
 */
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { compassName, latLonFromScene } from './eye.js';
import { formatClock, formatDay } from './time.js';
import { instant } from './clock.js';
import { look } from './eyeLevel.js';

const button = document.getElementById('share');
const menu = document.getElementById('share-menu');
const directions = document.getElementById('directions');
const toastBox = document.getElementById('toast');
const copyLabel = document.getElementById('copylink-label');
/** Apple devices get Apple Maps; everything else Google Maps. */
const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const canShare = typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
/** How early to be there: time to find the spot and set up. */
const EARLY_MIN = 20;

let toastTimer = 0;
export function toast(text, ms = 2600) {
  toastBox.textContent = text;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (toastBox.hidden = true), ms);
}

const spot = () => {
  const [lat, lon] = latLonFromScene(look.x, look.z, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { lat: lat.toFixed(6), lon: lon.toFixed(6) };
};

/** What the moment is: the eye-level line when something lines up, else just the view. */
function title() {
  const status = document.getElementById('eclipse');
  if (status.dataset.state === 'now') return status.textContent.replace(/ now$/, '');
  return `Photo facing ${compassName(look.heading)}`;
}

function openMenu(open) {
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const { lat, lon } = spot();
  directions.href = apple ? `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
  document.getElementById('directions-app').textContent = `${apple ? 'Apple Maps' : 'Google Maps'}, on foot`;
  const t = instant().getTime();
  document.getElementById('calendar-what').textContent = `${formatDay(t)} \u00b7 ${formatClock(t)}, with an alarm an hour before`;
  copyLabel.textContent = canShare ? 'Share link\u2026' : 'Copy link';
}
button.addEventListener('click', () => openMenu(menu.hidden));
addEventListener('pointerdown', (event) => {
  if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) openMenu(false);
});
directions.addEventListener('click', () => openMenu(false));

document.getElementById('copylink').addEventListener('click', async () => {
  openMenu(false);
  const url = location.href;
  try {
    if (canShare) await navigator.share({ title: `Urban Eclipse: ${title()}`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied: it opens this exact view');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Could not copy the link');
  }
});

/** iCalendar wants UTC as 20270322T051000Z, and text with its commas and semicolons escaped. */
const icsTime = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 octets fold onto the next, which starts with a space (RFC 5545). */
function icsFold(line) {
  const bytes = new TextEncoder();
  const parts = [];
  let current = '';
  for (const ch of line) {
    if (bytes.encode(current + ch).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
    }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
const icsText = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

document.getElementById('calendar').addEventListener('click', () => {
  openMenu(false);
  const t = instant().getTime();
  const { lat, lon } = spot();
  const what = title();
  const heading = Math.round(((look.heading % 360) + 360) % 360);
  const description = `${what} at ${formatClock(t)}. Facing ${compassName(heading)} ${heading}\u00b0, ${Math.round(look.lens)} mm. Be there ${EARLY_MIN} minutes early. Open the view: ${location.href}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Urban Eclipse//Berlin//EN',
    'BEGIN:VEVENT',
    `UID:${t}-${lat}-${lon}@urbaneclipse.oratio.co`,
    `DTSTAMP:${icsTime(Date.now())}`,
    `DTSTART:${icsTime(t - EARLY_MIN * 60_000)}`,
    `DTEND:${icsTime(t + 10 * 60_000)}`,
    `SUMMARY:${icsText(what)}`,
    `LOCATION:${lat}\\, ${lon}`,
    `GEO:${lat};${lon}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${location.href}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(what)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar' }));
  link.download = `urban-eclipse-${new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  toast('Calendar file ready: open it to add the date');
});
