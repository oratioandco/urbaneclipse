#!/usr/bin/env python3
"""Writes film C ("Out of the photo"): one continuous camera move from the real planner
(social/record_c.mjs), never cut, under an ambient track. `python3 build.py feed` writes the
1080×1350 version to ../film-c-feed. Re-running overwrites the HTML.

Journey timings (seconds into journey-*.mp4): photo 0–2.5, zoom out 2.5–6.5, rise 6.5–10.5,
back to the map 10.5–12.1, pull back 12.1–14.1, the day 14.1–20.1, dive 20.1–21.9, ring 21.9–25.9.
"""
import html
import shutil
import sys
from pathlib import Path

FEED = 'feed' in sys.argv[1:]
W, H = (1080, 1350) if FEED else (1080, 1920)
OFF = 285 if FEED else 0
DY = 120 if FEED else 0
HERE = Path(__file__).parent
ROOT = HERE.parent / 'film-c-feed' if FEED else HERE
SUN = '#f26a12'
JOURNEY = 25.9
# The feed uses the journey recorded at 4:5 (record_c.mjs FEED=1), which fills the frame.
FEEDTAG = '-feed' if FEED else ''
NATIVE = ' native' if FEED else ''
DURATION = 28.55


def words(text, accents=None):
    accents = accents or {}
    lines = []
    for line in text.split('|'):
        lines.append(' '.join(f'<span class="w"{f" style=\"color:{accents[w]}\"" if w in accents else ""}>{html.escape(w)}</span>' for w in line.split(' ')))
    return '<br>'.join(lines)


# (title, accents, start, end, sub)
LINES = [
    ("This photo hasn't|been taken yet.", None, 0.25, 2.62, 'Treptow · 18 February 2027 · 05:42'),
    ("It's a plan.", None, 3.0, 6.35, 'Your camera, 600 mm to 24 mm'),
    ('Up to 120 m', None, 7.0, 10.35, 'as a drone, airspace marked'),
    ('Every street|in Berlin', None, 12.3, 16.9, 'every minute of the year'),
    ('Then pick a day', None, 17.3, 20.0, '10 June 2027 · 21:04'),
    ('A ring of sun.', {'sun.': SUN}, 22.2, 25.8, 'Same spot, four months later'),
]

CSS = """
    #root { position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }
    .wrap { position: absolute; inset: 0; }
    .wrap video { position: absolute; left: 0; top: -OFFpx; width: 1080px; height: 1920px; object-fit: cover; }
    .wrap .native { top: 0; height: 1350px; }
    .scrim { position: absolute; left: 0; right: 0; top: 0; height: 760px; background: linear-gradient(rgba(6,10,20,.72), rgba(6,10,20,.42) 55%, rgba(6,10,20,0)); }
    .title { position: absolute; left: 84px; right: 84px; margin: 0; color: #fff; font: 800 92px/1.04 Inter, sans-serif; letter-spacing: -0.02em; text-shadow: 0 2px 18px rgba(0,0,0,.45); }
    .sub { position: absolute; left: 86px; right: 84px; margin: 0; color: rgba(255,255,255,.88); font: 600 38px/1.2 Inter, sans-serif; text-shadow: 0 1px 12px rgba(0,0,0,.55); }
    .w { display: inline-block; }
    .fade-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 240px; background: linear-gradient(rgba(13,20,36,0), rgba(13,20,36,.92)); }
""".replace('-OFFpx', f'{-OFF}px')


def journey():
    body, js = [], []
    body.append(f'  <div id="j-clean-wrap" class="wrap"><video id="j-clean" class="clip{NATIVE}" src="assets/journey-clean{FEEDTAG}.mp4" data-start="0" data-duration="{JOURNEY}" data-track-index="0" muted playsinline></video></div>')
    # The planner's own UI comes in as the lens pulls back, and leaves when the camera does.
    body.append(f'  <div id="j-ui-wrap" class="wrap" style="opacity:0"><video id="j-ui" class="clip{NATIVE}" src="assets/journey-ui{FEEDTAG}.mp4" data-start="0" data-duration="{JOURNEY}" data-track-index="1" muted playsinline></video></div>')
    js.append('tl.fromTo("#j-ui-wrap", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, 2.6);')
    js.append('tl.to("#j-ui-wrap", { opacity: 0, duration: 0.5, ease: "power2.inOut" }, 10.3);')
    body.append('  <div id="j-scrim" class="scrim" data-layout-ignore></div>')
    for i, (title, acc, s, e, sub) in enumerate(LINES):
        y = 236 - DY
        body.append(f'  <h1 id="j-t{i}" class="title clip" data-start="{s}" data-duration="{round(e - s, 3)}" data-track-index="{10 + i}" style="top:{y}px">{words(title, acc)}</h1>')
        sub_y = (236 + 92 * 1.04 * (title.count("|") + 1) + 36) - DY
        body.append(f'  <p id="j-s{i}" class="sub clip" data-start="{round(s + 0.3, 3)}" data-duration="{round(e - s - 0.3, 3)}" data-track-index="{20 + i}" style="top:{round(sub_y)}px"><span class="w">{html.escape(sub)}</span></p>')
        js.append(f'tl.fromTo("#j-t{i} .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.22, ease: "power3.out", stagger: 0.09 }}, {s});')
        js.append(f'tl.to("#j-t{i} .w", {{ opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power2.in", stagger: 0.03 }}, {round(e - 0.26, 3)});')
        js.append(f'tl.fromTo("#j-s{i} .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.25, ease: "power3.out" }}, {round(s + 0.3, 3)});')
        js.append(f'tl.to("#j-s{i} .w", {{ opacity: 0, filter: "blur(6px)", duration: 0.18, ease: "power2.in" }}, {round(e - 0.22, 3)});')
    return (
        '<template>\n  <style>' + CSS + '  </style>\n'
        f'<div id="root" data-composition-id="journey" data-width="{W}" data-height="{H}" data-duration="{JOURNEY}">\n'
        + '\n'.join(body) + '\n</div>\n<script>\nconst tl = gsap.timeline({ paused: true });\n' + '\n'.join(js)
        + '\nwindow.__timelines["journey"] = tl;\n</script>\n</template>\n'
    )


END_DUR = round(DURATION - JOURNEY, 3)
Y = 2 * DY + 30 * FEED
END_CARD = f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }}
    #end-bg {{ position: absolute; left: 0; top: {-OFF}px; width: 1080px; height: 1920px; object-fit: cover; }}
    #end-shade {{ position: absolute; inset: 0; background: rgba(9,14,26,.8); }}
    #end-mark {{ position: absolute; left: 250px; top: {440 - Y}px; width: 580px; height: 580px; }}
    #end-logo {{ display: block; width: 100%; height: 100%; }}
    #end-line {{ position: absolute; left: 0; right: 0; top: {1060 - Y}px; margin: 0; text-align: center; color: #fff; font: 800 112px/1 Inter, sans-serif; letter-spacing: -0.03em; }}
    #end-url {{ position: absolute; left: 0; right: 0; top: {1210 - Y}px; margin: 0; text-align: center; color: rgba(255,255,255,.82); font: 600 46px/1 Inter, sans-serif; }}
    .w {{ display: inline-block; }}
  </style>
<div id="root" data-composition-id="end" data-width="{W}" data-height="{H}" data-duration="{END_DUR}">
  <video id="end-bg" class="clip" src="assets/city-night.mp4" data-start="0" data-duration="{END_DUR}" data-media-start="4.5" data-track-index="5" muted playsinline></video>
  <div id="end-shade"></div>
  <div id="end-mark" class="clip" data-start="0" data-duration="{END_DUR}" data-track-index="0"><img id="end-logo" src="assets/logo-night.png" alt="Urban Eclipse: the TV tower as a clay miniature, the sun ringed round its sphere"></div>
  <h1 id="end-line" class="clip" data-start="0.35" data-duration="{round(END_DUR - 0.35, 3)}" data-track-index="1">{words('Find your shot.')}</h1>
  <p id="end-url" class="clip" data-start="0.6" data-duration="{round(END_DUR - 0.6, 3)}" data-track-index="2"><span class="w">urbaneclipse.oratio.co</span></p>
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
tl.fromTo("#end-logo", {{ opacity: 0, scale: 0.94, y: 24 }}, {{ opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power3.out" }}, 0);
tl.fromTo("#end-line .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.22, ease: "power3.out", stagger: 0.1 }}, 0.35);
tl.fromTo("#end-url .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.25, ease: "power3.out" }}, 0.6);
window.__timelines["end"] = tl;
</script>
</template>
"""

INDEX = f"""<!doctype html>
<html lang="en"{'' if FEED else ' data-resolution="portrait"'}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; background: #0d1424; }}
      #root {{ position: relative; width: 100%; height: 100%; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{DURATION}" data-width="{W}" data-height="{H}">
      <div id="journey" data-composition-id="journey" data-composition-src="compositions/journey.html" data-start="0" data-duration="{JOURNEY}" data-track-index="0" data-track-kind="graphics" data-width="{W}" data-height="{H}"></div>
      <div id="end" data-composition-id="end" data-composition-src="compositions/end.html" data-start="{JOURNEY}" data-duration="{END_DUR}" data-track-index="1" data-track-kind="graphics" data-width="{W}" data-height="{H}"></div>
      <audio id="music" class="clip" src="assets/urbaneclipse-C.mp3" data-start="0" data-duration="{DURATION}" data-media-start="1.4" data-track-index="20" data-volume="1" data-fade-out="1.5"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""

(ROOT / 'compositions').mkdir(parents=True, exist_ok=True)
if FEED:
    if not (ROOT / 'assets').exists():
        (ROOT / 'assets').symlink_to(HERE / 'assets')
    for f in ('hyperframes.json', 'package.json', 'meta.json'):
        shutil.copy(HERE / f, ROOT / f)
(ROOT / 'compositions' / 'journey.html').write_text(journey())
(ROOT / 'compositions' / 'end.html').write_text(END_CARD)
(ROOT / 'index.html').write_text(INDEX)
print('wrote film C', 'feed' if FEED else 'story')
