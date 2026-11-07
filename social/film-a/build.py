#!/usr/bin/env python3
"""Writes film A's HyperFrames files (index.html and one scene per shot) from the shot list below.

The output is plain HyperFrames HTML, editable in the desktop app; re-running this overwrites it.
Times are seconds; beats come from `npx hyperframes beats assets/urbaneclipse-A.mp3`.
"""
import html
import json
from pathlib import Path

import sys
FEED = 'feed' in sys.argv[1:]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from feedframe import feed_src as _feed_src, native_lift, native_origin, native_scale  # noqa: E402
# The story is 1080×1920; the feed post is 1080×1350, the same footage cropped around its middle.
W, H = (1080, 1350) if FEED else (1080, 1920)
OFF = 285 if FEED else 0      # how far the 1920-high footage sits above the frame
DY = 120 if FEED else 0       # type moves up by this much in the feed
ROOT = Path(__file__).parent.parent / (Path(__file__).parent.name + '-feed') if FEED else Path(__file__).parent
SUN, MOON = '#f26a12', '#7d9bff'
DURATION = 28.0

# Beat times measured on the track (first 0.315 s, period 0.4195 s); scene seams sit on these.
B = {5: 2.395, 8: 3.645, 17: 7.395, 33: 14.065, 42: 17.815, 48: 20.305, 54: 22.815, 59: 24.895}



def words(text, accents=None):
    """Each word in its own span so it can arrive on its own; accent words get a colour."""
    accents = accents or {}
    out = []
    for w in text.split(' '):
        style = f' style="color:{accents[w]}"' if w in accents else ''
        out.append(f'<span class="w"{style}>{html.escape(w)}</span>')
    return ' '.join(out)


SHOTS = [
    dict(
        id='eclipse', start=0, end=B[8],
        videos=[
            # The photo: pushed in on the sphere, the sun passing behind it.
            dict(src='eclipse-clean.mp4', start=0, end=B[5], media=5.2, origin=(465, 720), scale=(1.32, 1.22)),
            # The reveal: the same moment in the planner, viewfinder and all.
            dict(src='eclipse-ui.mp4', start=B[5], end=B[8], media=5.2 + B[5], origin=(540, 960), scale=(1.06, 1.0), swap=True),
        ],
        title=dict(text='The sun behind the TV tower', accents={'sun': SUN}, at=0, until=B[8] - 0.05, y=236, instant=True),
        subs=[
            dict(text='Treptow · 10 June 2027 · 21:04', at=0.35, until=B[5] - 0.02, y=470),
            dict(text='Planned in urbaneclipse', at=B[5] + 0.02, until=B[8] - 0.05, y=470),
        ],
    ),
    dict(
        id='golden', start=B[8], end=B[17],
        videos=[dict(src='city-golden.mp4', start=0, end=B[17] - B[8], media=0.4, origin=(540, 960), scale=(1.0, 1.07))],
        title=dict(text='Every street in Berlin', at=0.12, until=B[17] - B[8] - 0.1, y=236),
        subs=[dict(text='in 3D, at any minute of the year', at=0.7, until=B[17] - B[8] - 0.1, y=470)],
    ),
    dict(
        id='timelapse', start=B[17], end=B[33],
        videos=[dict(src='city-daynight.mp4', start=0, end=B[33] - B[17], media=0, rate=2, origin=(540, 960), scale=(1.0, 1.05))],
        # 900 → 1435 minutes across the 16 s source, played at 2×.
        clock=dict(from_min=900, span=535, source=16, rate=2, y=236),
        subs=[dict(text='22 March 2027 · afternoon into night', at=0.3, until=B[33] - B[17] - 0.1, y=420)],
        dip=True,
    ),
    dict(
        id='henge', start=B[33], end=B[42],
        videos=[dict(src='henge-clean.mp4', start=0, end=B[42] - B[33], media=6.2, origin=(590, 660), scale=(1.12, 1.24))],
        title=dict(text='Sunset down Karl-Marx-Allee', accents={'Sunset': SUN}, at=0.1, until=B[42] - B[33] - 0.08, y=236),
        subs=[dict(text='Frankfurter Tor · 12 April 2027 · 19:32', at=0.6, until=B[42] - B[33] - 0.08, y=470)],
    ),
    dict(
        id='night', start=B[42], end=B[48],
        videos=[dict(src='city-night.mp4', start=0, end=B[48] - B[42], media=1.0, origin=(540, 960), scale=(1.04, 1.0))],
        title=dict(text='And at night', at=0.42, until=B[48] - B[42] - 0.06, y=236),
    ),
    dict(
        id='moon', start=B[48], end=B[54],
        videos=[dict(src='moon-clean.mp4', start=0, end=B[54] - B[48], media=3.2, origin=(465, 640), scale=(1.22, 1.32))],
        title=dict(text='The moon on the antenna', accents={'moon': MOON}, at=0.08, until=B[54] - B[48] - 0.06, y=236),
        subs=[dict(text='Treptow · 18 February 2027 · 05:42', at=0.55, until=B[54] - B[48] - 0.06, y=470)],
    ),
    dict(
        id='drone', start=B[54], end=B[59],
        videos=[dict(src='drone-ui.mp4', start=0, end=B[59] - B[54], media=3.2, origin=(540, 960), scale=(1.0, 1.04))],
        title=dict(text='Take off to 120 m', at=0.08, until=B[59] - B[54] - 0.06, y=236),
    ),
]

CSS = """
    #root { position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }
    .wrap { position: absolute; inset: 0; }
    .wrap video { position: absolute; left: 0; top: -OFFpx; width: 1080px; height: 1920px; object-fit: cover; }
    .wrap .native { top: 0; height: 1350px; }
    .title { position: absolute; left: 84px; right: 84px; margin: 0; color: #fff; font: 800 92px/1.04 Inter, sans-serif; letter-spacing: -0.02em; text-shadow: 0 2px 18px rgba(0,0,0,.45); }
    .sub { position: absolute; left: 86px; right: 84px; margin: 0; color: rgba(255,255,255,.88); font: 600 38px/1.2 Inter, sans-serif; text-shadow: 0 1px 12px rgba(0,0,0,.55); }
    .w { display: inline-block; }
    .fade-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 240px; background: linear-gradient(rgba(13,20,36,0), rgba(13,20,36,.92)); }
    .clock { position: absolute; left: 80px; margin: 0; color: #fff; font: 800 168px/1 Inter, sans-serif; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; text-shadow: 0 2px 22px rgba(0,0,0,.5); }
    .dip { position: absolute; inset: 0; background: #000; opacity: 0; }
    .scrim { position: absolute; left: 0; right: 0; top: 0; height: 760px; background: linear-gradient(rgba(6,10,20,.78), rgba(6,10,20,.5) 55%, rgba(6,10,20,0)); pointer-events: none; }
"""


def scene(shot):
    sid = shot['id']
    dur = round(shot['end'] - shot['start'], 3)
    body, js, natives = [], [], []
    for i, v in enumerate(shot['videos']):
        vid = f'{sid}-v{i}'
        ox, oy = v['origin']
        src, native, take = _feed_src(v['src'], FEED)
        natives.append(native)
        s0, s1 = v['scale']
        lift = 0
        if native:
            ox, oy = native_origin(take, (ox, oy))
            s0, s1 = native_scale(take, v['origin'], v['scale'])
            lift = native_lift(take, v['origin'], (s0, s1))
        rate = f' data-playback-rate="{v["rate"]}"' if v.get('rate') else ''
        body.append(
            f'  <div id="{vid}-wrap" class="wrap" style="transform-origin:{ox}px {oy if native else oy - OFF}px{f';top:{lift}px' if lift else ''}">\n'
            f'    <video id="{vid}" class="clip{" native" if native else ""}" src="assets/{src}" data-start="{v["start"]}" data-duration="{round(v["end"] - v["start"], 3)}" data-media-start="{v["media"]}"{rate} data-track-index="{i}" muted playsinline></video>\n'
            f'  </div>'
        )
        js.append(f'tl.fromTo("#{vid}-wrap", {{ scale: {s0} }}, {{ scale: {s1}, duration: {round(v["end"] - v["start"], 3)}, ease: "none" }}, {v["start"]});')
        if v.get('swap'):
            # Blur swap on one stage: the photo blurs out, the planner sharpens in.
            prev = f'{sid}-v{i - 1}-wrap'
            js.append(f'tl.fromTo("#{prev}", {{ filter: "blur(0px)" }}, {{ filter: "blur(10px)", duration: 0.14, ease: "power3.in" }}, {v["start"] - 0.14});')
            js.append(f'tl.fromTo("#{vid}-wrap", {{ filter: "blur(10px)" }}, {{ filter: "blur(0px)", duration: 0.16, ease: "power3.out" }}, {v["start"]});')
    z = 10
    body.append(f'  <div id="{sid}-scrim" class="scrim" data-layout-ignore></div>')
    if t := shot.get('title'):
        tid = f'{sid}-title'
        body.append(f'  <h1 id="{tid}" class="title clip" data-start="{t["at"]}" data-duration="{round(t["until"] - t["at"], 3)}" data-track-index="{z}" style="top:{t["y"] - DY}px">{words(t["text"], t.get("accents"))}</h1>')
        if not t.get('instant'):
            js.append(f'tl.fromTo("#{tid} .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power4.out", stagger: 0.07 }}, {t["at"]});')
        js.append(f'tl.to("#{tid} .w", {{ opacity: 0, filter: "blur(8px)", duration: 0.12, ease: "power3.in", stagger: 0.02 }}, {round(t["until"] - 0.16, 3)});')
        z += 1
    for k, s in enumerate(shot.get('subs', [])):
        uid = f'{sid}-sub{k}'
        body.append(f'  <p id="{uid}" class="sub clip" data-start="{s["at"]}" data-duration="{round(s["until"] - s["at"], 3)}" data-track-index="{z}" style="top:{s["y"] - DY}px"><span class="w">{html.escape(s["text"])}</span></p>')
        js.append(f'tl.fromTo("#{uid} .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" }}, {s["at"]});')
        js.append(f'tl.to("#{uid} .w", {{ opacity: 0, filter: "blur(6px)", duration: 0.12, ease: "power3.in" }}, {round(s["until"] - 0.14, 3)});')
        z += 1
    if c := shot.get('clock'):
        cid = f'{sid}-clock'
        body.append(f'  <p id="{cid}" class="clock clip" data-start="0" data-duration="{dur}" data-track-index="{z}" style="top:{c["y"] - DY}px"><span class="w" id="{cid}-t">15:00</span></p>')
        # The clock is a pure function of the timeline: it reads the minute the footage shows.
        js.append(
            f'const {sid}Clock = {{ m: {c["from_min"]} }};\n'
            f'tl.fromTo({sid}Clock, {{ m: {c["from_min"]} }}, {{ m: {c["from_min"] + c["span"] * c["rate"] * dur / c["source"]}, duration: {dur}, ease: "none",\n'
            f'  onUpdate: () => {{ const m = Math.floor({sid}Clock.m); document.getElementById("{cid}-t").textContent = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }} }}, 0);'
        )
        js.append(f'tl.fromTo("#{cid} .w", {{ opacity: 0, filter: "blur(10px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }}, 0.05);')
        z += 1
    if shot.get('dip'):
        # Three frames darker before the hard cut into the night, so the cut reads as meant.
        body.append(f'  <div id="{sid}-dip" class="dip clip" data-start="{round(dur - 0.1, 3)}" data-duration="0.1" data-track-index="{z}"></div>')
        js.append(f'tl.fromTo("#{sid}-dip", {{ opacity: 0 }}, {{ opacity: 0.45, duration: 0.1, ease: "none" }}, {round(dur - 0.1, 3)});')
    if FEED and not any(natives):
        # The feed crops the planner's panel mid-card; a fade makes the edge read as meant.
        body.append(f'  <div id="{sid}-fade" class="fade-bottom" data-layout-ignore></div>')
    return (
        '<template>\n  <style>' + CSS.replace('-OFFpx', f'{-OFF}px') + '  </style>\n'
        f'<div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}" data-duration="{dur}">\n'
        + '\n'.join(body) + '\n</div>\n'
        '<script>\n'
        'const tl = gsap.timeline({ paused: true });\n' + '\n'.join(js) + f'\nwindow.__timelines["{sid}"] = tl;\n'
        '</script>\n</template>\n'
    )


END_CARD = f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }}
    #end-bg {{ position: absolute; left: 0; top: {-OFF}px; width: 1080px; height: 1920px; object-fit: cover; }}
    #end-shade {{ position: absolute; inset: 0; background: rgba(9,14,26,.8); }}
    #end-mark {{ position: absolute; left: 340px; top: {420 - 2 * DY - 30 * FEED}px; width: 400px; height: 560px; }}
    #end-line {{ position: absolute; left: 0; right: 0; top: {1060 - 2 * DY - 30 * FEED}px; margin: 0; text-align: center; color: #fff; font: 800 112px/1 Inter, sans-serif; letter-spacing: -0.03em; }}
    #end-url {{ position: absolute; left: 0; right: 0; top: {1210 - 2 * DY - 30 * FEED}px; margin: 0; text-align: center; color: rgba(255,255,255,.82); font: 600 46px/1 Inter, sans-serif; }}
    .w {{ display: inline-block; }}
  </style>
<div id="root" data-composition-id="end" data-width="{W}" data-height="{H}" data-duration="{round(DURATION - B[59], 3)}">
  <video id="end-bg" class="clip" src="assets/city-night.mp4" data-start="0" data-duration="{round(DURATION - B[59], 3)}" data-media-start="4.5" data-track-index="5" muted playsinline></video>
  <div id="end-shade"></div>
  <svg id="end-mark" class="clip" data-start="0" data-duration="{round(DURATION - B[59], 3)}" data-track-index="0" viewBox="0 0 400 560">
    <defs><clipPath id="end-sky"><rect x="0" y="0" width="400" height="560"/></clipPath></defs>
    <g clip-path="url(#end-sky)">
      <circle id="end-sun" cx="230" cy="250" r="118" fill="{SUN}"/>
    </g>
    <rect x="196" y="40" width="8" height="120" rx="3" fill="#2a3550"/>
    <circle cx="200" cy="250" r="96" fill="#2a3550"/>
    <path d="M182 340 h36 l14 220 h-64 z" fill="#2a3550"/>
  </svg>
  <h1 id="end-line" class="clip" data-start="0.6" data-duration="{round(DURATION - B[59] - 0.6, 3)}" data-track-index="1">{words('Find your shot.')}</h1>
  <p id="end-url" class="clip" data-start="1.0" data-duration="{round(DURATION - B[59] - 1.0, 3)}" data-track-index="2"><span class="w">urbaneclipse.oratio.co</span></p>
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
// The mark is the film's subject: the sun slides in behind the sphere and leaves a crescent.
tl.fromTo("#end-sun", {{ attr: {{ cx: 560, cy: 300 }} }}, {{ attr: {{ cx: 228, cy: 246 }}, duration: 0.5, ease: "expo.out" }}, 0);
tl.fromTo("#end-line .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power4.out", stagger: 0.09 }}, 0.6);
tl.fromTo("#end-url .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }}, 1.0);
window.__timelines["end"] = tl;
</script>
</template>
"""


def index():
    hosts = []
    for i, s in enumerate(SHOTS + [dict(id='end', start=B[59], end=DURATION)]):
        hosts.append(
            f'      <div id="{s["id"]}" data-composition-id="{s["id"]}" data-composition-src="compositions/{s["id"]}.html" '
            f'data-start="{s["start"]}" data-duration="{round(s["end"] - s["start"], 3)}" data-track-index="{i}" data-track-kind="graphics" '
            f'data-width="{W}" data-height="{H}"></div>'
        )
    return f"""<!doctype html>
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
{chr(10).join(hosts)}
      <audio id="music" class="clip" src="assets/urbaneclipse-A.mp3" data-start="0" data-duration="{DURATION}" data-track-index="20" data-volume="1" data-fade-out="1.2"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"""


(ROOT / 'compositions').mkdir(parents=True, exist_ok=True)
if FEED:
    import shutil
    if not (ROOT / 'assets').exists():
        (ROOT / 'assets').symlink_to(Path(__file__).parent / 'assets')
    for f in ('hyperframes.json', 'package.json', 'meta.json'):
        shutil.copy(Path(__file__).parent / f, ROOT / f)
for s in SHOTS:
    (ROOT / 'compositions' / f'{s["id"]}.html').write_text(scene(s))
(ROOT / 'compositions' / 'end.html').write_text(END_CARD)
(ROOT / 'index.html').write_text(index())
print('wrote', len(SHOTS) + 1, 'scenes')
