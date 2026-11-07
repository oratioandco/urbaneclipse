#!/usr/bin/env python3
"""Writes film B ("When, where, which lens"): kinetic type on colour fields, cut on the beat of a
120 bpm track, answered by real clips from the planner. Re-running overwrites the HTML.
Beats: 0.285 s + 0.5 s × k (`npx hyperframes beats assets/urbaneclipse-B.mp3`); final hit at 21.785 s.
"""
import html
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
SUN, MOON, NIGHT, PAPER, INK = '#f26a12', '#7d9bff', '#0d1424', '#f4f1ea', '#0d1424'
DURATION = 25.0


def b(k):
    return round(0.285 + 0.5 * k, 3)


def words(text, accents=None):
    accents = accents or {}
    lines = []
    for line in text.split('|'):
        spans = []
        for w in line.split(' '):
            style = f' style="color:{accents[w]}"' if w in accents else ''
            spans.append(f'<span class="w"{style}>{html.escape(w)}</span>')
        lines.append(' '.join(spans))
    return '<br>'.join(lines)


# Each scene: (id, start, end, elements). Element times are local to the scene.
def field(c, s, e):
    return dict(kind='field', colour=c, start=s, end=e)



def big(text, s, e, ink='#fff', accents=None, size=172, y=520):
    # A hit: the words are there on the beat's frame, no easing.
    return dict(kind='type', text=text, start=s, end=e, ink=ink, accents=accents, size=size, y=y, hit=True)


def over(text, s, e, accents=None, size=104, y=236):
    return dict(kind='type', text=text, start=s, end=e, ink='#fff', accents=accents, size=size, y=y, hit=False, shadow=True)


def video(src, s, e, media, origin=(540, 960), scale=(1.0, 1.05), rate=None):
    return dict(kind='video', src=src, start=s, end=e, media=media, origin=origin, scale=scale, rate=rate)


def still(src, s, e, origin, scale):
    return dict(kind='img', src=src, start=s, end=e, origin=origin, scale=scale)


S0 = b(2)  # 1.285: first cut
SCENES = [
    ('hook', 0, b(6), [
        field(SUN, 0, S0),
        big('Manhattan-|henge?', 0, S0, ink=INK),
        video('henge-clean.mp4', S0, b(6), 6.8, origin=(590, 660), scale=(1.14, 1.24)),
        big('Berlin-|henge.', b(3), b(6), y=300),
    ]),
    ('ask', b(6), b(12), [
        field(NIGHT, 0, 1.0), big('When?', 0, 1.0),
        field(SUN, 1.0, 2.0), big('Where?', 1.0, 2.0, ink=INK),
        field(PAPER, 2.0, 3.0), big('Which|lens?', 2.0, 3.0, ink=INK),
    ]),
    ('sun', b(12), b(17), [
        video('eclipse-ui.mp4', 0, 2.5, 5.0, scale=(1.0, 1.04)),
        over('To the second.', 0.5, 2.44),
    ]),
    ('moon', b(17), b(24), [
        field(PAPER, 0, 1.0), big('The|moon?', 0, 1.0, ink=INK, accents={'moon?': '#3c64e6'}),
        video('moon-clean.mp4', 1.0, 3.5, 3.4, origin=(465, 640), scale=(1.22, 1.34)),
        over('On the antenna.', 1.5, 3.44),
    ]),
    ('drone', b(24), b(30), [
        field(NIGHT, 0, 1.0), big('From|above?', 0, 1.0),
        video('drone-ui.mp4', 1.0, 3.0, 3.0, scale=(1.0, 1.04)),
        over('Up to 120 m.', 1.4, 2.94),
    ]),
    ('montage', b(30), b(38), [
        field(SUN, 0, 1.5), big('Every day|of the year.', 0, 1.5, ink=INK, size=140),
        # One shot per beat, each with the one thing it proves.
        still('dates.png', 1.5, 2.0, origin=(540, 1300), scale=(1.32, 1.4)), over('Next dates', 1.5, 2.0, size=96),
        still('share.png', 2.0, 2.5, origin=(30, 300), scale=(1.5, 1.6)), over('Go there', 2.0, 2.5, size=96, y=1180),
        video('city-golden.mp4', 2.5, 3.0, 5.0), over('Every shadow', 2.5, 3.0, size=96),
        video('city-daynight.mp4', 3.0, 3.5, 7.0, rate=4), over('Every hour', 3.0, 3.5, size=96),
        video('klamott-clean.mp4', 3.5, 4.0, 5.6, origin=(520, 700), scale=(1.1, 1.16)), over('Every view', 3.5, 4.0, size=96),
    ]),
    ('claim', b(38), b(43), [
        video('city-night.mp4', 0, 2.5, 2.0, scale=(1.0, 1.06)),
        big('Plan it.', 0, 2.5, y=600),
        big('Shoot it.', 1.0, 2.5, y=800, accents={'Shoot': SUN}),
    ]),
]

CSS = """
    #root { position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }
    .field { position: absolute; inset: 0; }
    .wrap { position: absolute; inset: 0; }
    .wrap video, .wrap img { position: absolute; left: 0; top: -OFFpx; width: 1080px; height: 1920px; object-fit: cover; }
    .wrap .native { top: 0; height: 1350px; }
    .type { position: absolute; left: 72px; right: 60px; margin: 0; font-weight: 800; line-height: 0.94; letter-spacing: -0.04em; }
    .type.shadow { line-height: 1.04; letter-spacing: -0.02em; text-shadow: 0 2px 18px rgba(0,0,0,.5); }
    .w { display: inline-block; }
    .fade-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 240px; background: linear-gradient(rgba(13,20,36,0), rgba(13,20,36,.92)); }
    .scrim { position: absolute; left: 0; right: 0; top: 0; height: 700px; background: linear-gradient(rgba(6,10,20,.6), rgba(6,10,20,.3) 55%, rgba(6,10,20,0)); }
"""


def scene(sid, start, end, els):
    dur = round(end - start, 3)
    body, js = [], []
    cropped = False
    for i, e in enumerate(els):
        eid = f'{sid}-{i}'
        d = round(e['end'] - e['start'], 3)
        if e['kind'] == 'field':
            body.append(f'  <div id="{eid}" class="field clip" data-start="{e["start"]}" data-duration="{d}" data-track-index="{i}" style="background:{e["colour"]}"></div>')
        elif e['kind'] in ('video', 'img'):
            ox, oy = e['origin']
            src, native, take = _feed_src(e['src'], FEED)
            s0, s1 = e['scale']
            lift = 0
            if native:
                ox, oy = native_origin(take, (ox, oy))
                s0, s1 = native_scale(take, e['origin'], e['scale'])
                lift = native_lift(take, e['origin'], (s0, s1))
            cropped = cropped or not native
            if e['kind'] == 'video':
                rate = f' data-playback-rate="{e["rate"]}"' if e.get('rate') else ''
                media = f'<video id="{eid}" class="clip{" native" if native else ""}" src="assets/{src}" data-start="{e["start"]}" data-duration="{d}" data-media-start="{e["media"]}"{rate} data-track-index="{i}" muted playsinline></video>'
            else:
                media = f'<img id="{eid}" class="clip" src="assets/{e["src"]}" data-start="{e["start"]}" data-duration="{d}" data-track-index="{i}" alt="">'
            body.append(f'  <div id="{eid}-wrap" class="wrap" style="transform-origin:{ox}px {oy if native else oy - OFF}px{f';top:{lift}px' if lift else ''}">{media}</div>')
            js.append(f'tl.fromTo("#{eid}-wrap", {{ scale: {s0} }}, {{ scale: {s1}, duration: {d}, ease: "none" }}, {e["start"]});')
            # Footage carries white type at the top: a scrim keeps it readable, only while the shot shows.
            body.append(f'  <div id="{eid}-scrim" class="scrim clip" data-start="{e["start"]}" data-duration="{d}" data-track-index="{i}" data-layout-ignore></div>')
        elif e['kind'] == 'type':
            cls = 'type clip shadow' if e.get('shadow') else 'type clip'
            body.append(f'  <h1 id="{eid}" class="{cls}" data-start="{e["start"]}" data-duration="{d}" data-track-index="{20 + i}" style="top:{e["y"] - DY}px;font-size:{e["size"]}px;color:{e["ink"]}">{words(e["text"], e.get("accents"))}</h1>')
            if not e['hit']:
                js.append(f'tl.fromTo("#{eid} .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power4.out", stagger: 0.067 }}, {e["start"]});')
    if FEED and cropped:
        # The feed crops the planner's panel mid-card; a fade makes the edge read as meant.
        body.append(f'  <div id="{sid}-fade" class="fade-bottom" data-layout-ignore></div>')
    return (
        '<template>\n  <style>' + CSS.replace('-OFFpx', f'{-OFF}px') + '  </style>\n'
        f'<div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}" data-duration="{dur}">\n'
        + '\n'.join(body) + '\n</div>\n<script>\nconst tl = gsap.timeline({ paused: true });\n'
        + '\n'.join(js) + f'\nwindow.__timelines["{sid}"] = tl;\n</script>\n</template>\n'
    )


END_START = b(43)  # 21.785, the final hit
END_DUR = round(DURATION - END_START, 3)
END_CARD = f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }}
    #end-bg {{ position: absolute; left: 0; top: {-OFF}px; width: 1080px; height: 1920px; object-fit: cover; }}
    #end-shade {{ position: absolute; inset: 0; background: rgba(9,14,26,.8); }}
    #end-mark {{ position: absolute; left: 250px; top: {440 - 2 * DY - 30 * FEED}px; width: 580px; height: 580px; }}
    #end-logo {{ display: block; width: 100%; height: 100%; }}
    #end-line {{ position: absolute; left: 0; right: 0; top: {1060 - 2 * DY - 30 * FEED}px; margin: 0; text-align: center; color: #fff; font: 800 112px/1 Inter, sans-serif; letter-spacing: -0.03em; }}
    #end-url {{ position: absolute; left: 0; right: 0; top: {1210 - 2 * DY - 30 * FEED}px; margin: 0; text-align: center; color: rgba(255,255,255,.82); font: 600 46px/1 Inter, sans-serif; }}
    .w {{ display: inline-block; }}
  </style>
<div id="root" data-composition-id="end" data-width="{W}" data-height="{H}" data-duration="{END_DUR}">
  <video id="end-bg" class="clip" src="assets/city-night.mp4" data-start="0" data-duration="{END_DUR}" data-media-start="4.5" data-track-index="5" muted playsinline></video>
  <div id="end-shade"></div>
  <div id="end-mark" class="clip" data-start="0" data-duration="{END_DUR}" data-track-index="0"><img id="end-logo" src="assets/logo-night.png" alt="Urban Eclipse: the TV tower as a clay miniature, the sun ringed round its sphere"></div>
  <h1 id="end-line" class="clip" data-start="0.5" data-duration="{round(END_DUR - 0.5, 3)}" data-track-index="1">{words('Find your shot.')}</h1>
  <p id="end-url" class="clip" data-start="1.0" data-duration="{round(END_DUR - 1.0, 3)}" data-track-index="2"><span class="w">urbaneclipse.oratio.co</span></p>
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
tl.fromTo("#end-logo", {{ opacity: 0, scale: 0.94, y: 24 }}, {{ opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power3.out" }}, 0);
tl.fromTo("#end-line .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power4.out", stagger: 0.09 }}, 0.5);
tl.fromTo("#end-url .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power4.out" }}, 1.0);
window.__timelines["end"] = tl;
</script>
</template>
"""


def index():
    hosts = []
    for i, (sid, s, e, _) in enumerate(SCENES + [('end', END_START, DURATION, None)]):
        hosts.append(
            f'      <div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{s}" '
            f'data-duration="{round(e - s, 3)}" data-track-index="{i}" data-track-kind="graphics" data-width="{W}" data-height="{H}"></div>'
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
      <audio id="music" class="clip" src="assets/urbaneclipse-B.mp3" data-start="0" data-duration="{DURATION}" data-track-index="20" data-volume="1" data-fade-out="0.8"></audio>
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
for sid, s, e, els in SCENES:
    (ROOT / 'compositions' / f'{sid}.html').write_text(scene(sid, s, e, els))
(ROOT / 'compositions' / 'end.html').write_text(END_CARD)
(ROOT / 'index.html').write_text(index())
print('wrote', len(SCENES) + 1, 'scenes')
