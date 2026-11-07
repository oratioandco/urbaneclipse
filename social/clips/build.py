#!/usr/bin/env python3
"""Writes one 8-second HyperFrames project per feature (clips/<name>/ and clips/<name>-feed/),
each cut on the beat of the opening bars of track B (0.285 s + 0.5 s × k):
the shot as a photo, the same moment in the planner from beat 8, the mark and URL from beat 13.
All projects share clips/assets. Re-running overwrites the HTML.
"""
import html
import shutil
from pathlib import Path

HERE = Path(__file__).parent
SUN, MOON = '#f26a12', '#7d9bff'
DUR = 9.0
SWAP, TAG = 4.285, 6.785


def words(text, accents=None):
    accents = accents or {}
    return '<br>'.join(
        ' '.join(f'<span class="w"{f" style=\"color:{accents[w]}\"" if w in accents else ""}>{html.escape(w)}</span>' for w in line.split(' '))
        for line in text.split('|')
    )


CLIPS = {
    'ring': dict(title='A ring of sun|round the TV tower', accents={'sun': SUN}, sub='Treptow · 10 June 2027 · 21:04',
                 photo=('eclipse-clean.mp4', 2.6), ui=('eclipse-ui.mp4', 2.6), origin=(465, 720), scale=(1.3, 1.18)),
    'moon': dict(title='The moon on|the antenna', accents={'moon': MOON}, sub='Treptow · 18 February 2027 · 05:42',
                 photo=('moon-clean.mp4', 0.6), ui=('moon-ui.mp4', 0.6), origin=(465, 640), scale=(1.3, 1.18)),
    'fullmoon': dict(title='Full moon at|the sphere', accents={'moon': MOON}, sub='Treptow · 24 November 2026 · 07:23',
                     photo=('dawn-clean.mp4', 1.6), ui=('dawn-ui.mp4', 1.6), origin=(490, 480), scale=(1.3, 1.18)),
    'allee': dict(title='Sunset down|Karl-Marx-Allee', accents={'Sunset': SUN}, sub='Frankfurter Tor · 12 April 2027 · 19:32',
                  photo=('henge-clean.mp4', 2.0), ui=('henge-ui.mp4', 2.0), origin=(590, 660), scale=(1.2, 1.08)),
    'klamott': dict(title='The sun behind|the sphere', accents={'sun': SUN}, sub='Mont Klamott · 21 February 2027 · 16:46',
                    photo=('klamott-clean.mp4', 2.0), ui=('klamott-ui.mp4', 2.0), origin=(520, 700), scale=(1.2, 1.08)),
    'drone': dict(title='Take off|to 120 m', sub='Over the Spree · 10 June 2027 · 20:50',
                  photo=('drone-clean.mp4', 0.0), ui=('drone-ui.mp4', 0.0), origin=(540, 900), scale=(1.12, 1.02)),
    'tools': dict(title='Every date,|a year ahead', sub='Pick one: the planner turns to it', title2='Then go there', sub2='Directions, calendar, a link',
                  photo=('dates.png', None), ui=('share.png', None), origin=(540, 1300), scale=(1.0, 1.14), origin2=(30, 300), scale2=(1.0, 1.25)),
}

CSS = """
    #root { position: absolute; inset: 0; overflow: hidden; background: #0d1424; font-family: Inter, sans-serif; }
    .wrap { position: absolute; inset: 0; }
    .wrap video, .wrap img { position: absolute; left: 0; top: -OFFpx; width: 1080px; height: 1920px; object-fit: cover; }
    .scrim { position: absolute; left: 0; right: 0; top: 0; height: 760px; background: linear-gradient(rgba(6,10,20,.86), rgba(6,10,20,.58) 55%, rgba(6,10,20,0)); }
    .scrim-low { position: absolute; left: 0; right: 0; bottom: 0; height: 1100px; background: linear-gradient(rgba(6,10,20,0), rgba(6,10,20,.82) 40%); opacity: 0; }
    .shade { position: absolute; inset: 0; background: rgba(9,14,26,.82); opacity: 0; }
    .title { position: absolute; left: 84px; right: 84px; margin: 0; color: #fff; font: 800 100px/1.02 Inter, sans-serif; letter-spacing: -0.025em; text-shadow: 0 2px 18px rgba(0,0,0,.45); }
    .sub { position: absolute; left: 86px; right: 84px; margin: 0; color: rgba(255,255,255,.9); font: 600 40px/1.2 Inter, sans-serif; text-shadow: 0 1px 12px rgba(0,0,0,.55); }
    .w { display: inline-block; }
    .mark { position: absolute; left: 440px; width: 200px; height: 280px; }
    .url { position: absolute; left: 0; right: 0; margin: 0; text-align: center; color: #fff; font: 800 64px/1 Inter, sans-serif; letter-spacing: -0.02em; }
    .fade-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 240px; background: linear-gradient(rgba(13,20,36,0), rgba(13,20,36,.92)); }
"""


def media(tag_id, src, start, end, mstart, track):
    d = round(end - start, 3)
    if src.endswith('.png'):
        return f'<img id="{tag_id}" class="clip" src="assets/{src}" data-start="{start}" data-duration="{d}" data-track-index="{track}" alt="">'
    return f'<video id="{tag_id}" class="clip" src="assets/{src}" data-start="{start}" data-duration="{d}" data-media-start="{round(mstart + start, 3)}" data-track-index="{track}" muted playsinline></video>'


def project(name, c, feed):
    W, H = (1080, 1350) if feed else (1080, 1920)
    OFF, DY = (285, 120) if feed else (0, 0)
    ox, oy = c['origin']
    ox2, oy2 = c.get('origin2', (540, 960))
    tools = name == 'tools'
    body, js = [], []
    body.append(f'  <div id="c-photo" class="wrap" style="transform-origin:{ox}px {oy - OFF}px">{media("c-photo-m", c["photo"][0], 0, SWAP, c["photo"][1] or 0, 0)}</div>')
    body.append(f'  <div id="c-ui" class="wrap" style="transform-origin:{ox2 if tools else 540}px {(oy2 if tools else 960) - OFF}px">{media("c-ui-m", c["ui"][0], SWAP, DUR, c["ui"][1] or 0, 1)}</div>')
    s0, s1 = c['scale']
    js.append(f'tl.fromTo("#c-photo", {{ scale: {s0} }}, {{ scale: {s1}, duration: {SWAP}, ease: "none" }}, 0);')
    s20, s21 = c.get('scale2', (1.05, 1.0))
    js.append(f'tl.fromTo("#c-ui", {{ scale: {s20} }}, {{ scale: {s21}, duration: {round(DUR - SWAP, 3)}, ease: "none" }}, {SWAP});')
    # Blur swap on the beat: the photo becomes the planner showing the same moment.
    js.append(f'tl.fromTo("#c-photo", {{ filter: "blur(0px)" }}, {{ filter: "blur(10px)", duration: 0.12, ease: "power3.in" }}, {SWAP - 0.12});')
    js.append(f'tl.fromTo("#c-ui", {{ filter: "blur(10px)" }}, {{ filter: "blur(0px)", duration: 0.14, ease: "power3.out" }}, {SWAP});')
    body.append('  <div id="c-scrim" class="scrim" data-layout-ignore></div>')
    lines = c['title'].count('|') + 1
    ty, sy = 236 - DY, round(236 + 102 * lines + 34 - DY)
    first_end = SWAP if tools else TAG
    body.append(f'  <h1 id="c-title" class="title clip" data-start="0" data-duration="{round(first_end - 0.02, 3)}" data-track-index="10" style="top:{ty}px">{words(c["title"], c.get("accents"))}</h1>')
    body.append(f'  <p id="c-sub" class="sub clip" data-start="0.3" data-duration="{round(first_end - 0.32, 3)}" data-track-index="11" style="top:{sy}px"><span class="w">{html.escape(c["sub"])}</span></p>')
    js.append('tl.fromTo("#c-sub .w", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" }, 0.3);')
    js.append(f'tl.to("#c-title .w, #c-sub .w", {{ opacity: 0, filter: "blur(8px)", duration: 0.12, ease: "power3.in" }}, {round(first_end - 0.16, 3)});')
    if tools:
        body.append('  <div id="c-low" class="scrim-low" data-layout-ignore></div>')
        js.append(f'tl.fromTo("#c-low", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.2, ease: "power2.out" }}, {SWAP});')
        body.append(f'  <h1 id="c-title2" class="title clip" data-start="{SWAP}" data-duration="{round(TAG - SWAP - 0.02, 3)}" data-track-index="12" style="top:{1180 - DY - 2 * OFF // 3}px">{words(c["title2"])}</h1>')
        body.append(f'  <p id="c-sub2" class="sub clip" data-start="{SWAP + 0.3}" data-duration="{round(TAG - SWAP - 0.32, 3)}" data-track-index="13" style="top:{1300 - DY - 2 * OFF // 3}px"><span class="w">{html.escape(c["sub2"])}</span></p>')
        js.append(f'tl.fromTo("#c-title2 .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power4.out", stagger: 0.07 }}, {SWAP});')
        js.append(f'tl.fromTo("#c-sub2 .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power4.out" }}, {SWAP + 0.3});')
        js.append(f'tl.to("#c-title2 .w, #c-sub2 .w", {{ opacity: 0, filter: "blur(8px)", duration: 0.12, ease: "power3.in" }}, {round(TAG - 0.16, 3)});')
    # The tag: the footage darkens, the sun slides behind the sphere, the address lands.
    body.append(f'  <div id="c-shade" class="shade" data-layout-ignore></div>')
    js.append(f'tl.fromTo("#c-shade", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.25, ease: "power2.out" }}, {TAG - 0.05});')
    my = (H - 280 - 64 - 60) // 2
    body.append(
        f'  <svg id="c-mark" class="mark clip" data-start="{TAG}" data-duration="{round(DUR - TAG, 3)}" data-track-index="14" style="top:{my}px" viewBox="0 0 400 560">'
        f'<circle id="c-sun" cx="230" cy="250" r="118" fill="{SUN}"/><rect x="196" y="40" width="8" height="120" rx="3" fill="#2a3550"/>'
        f'<circle cx="200" cy="250" r="96" fill="#2a3550"/><path d="M182 340 h36 l14 220 h-64 z" fill="#2a3550"/></svg>'
    )
    js.append(f'tl.fromTo("#c-sun", {{ attr: {{ cx: 560, cy: 300 }} }}, {{ attr: {{ cx: 228, cy: 246 }}, duration: 0.42, ease: "expo.out" }}, {TAG});')
    body.append(f'  <p id="c-url" class="url clip" data-start="{TAG + 0.15}" data-duration="{round(DUR - TAG - 0.15, 3)}" data-track-index="15" style="top:{my + 320}px"><span class="w">urbaneclipse.oratio.co</span></p>')
    js.append(f'tl.fromTo("#c-url .w", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.16, ease: "power4.out" }}, {TAG + 0.15});')
    if feed:
        body.append('  <div id="c-fade" class="fade-bottom" data-layout-ignore></div>')
    scene = (
        '<template>\n  <style>' + CSS.replace('-OFFpx', f'{-OFF}px') + '  </style>\n'
        f'<div id="root" data-composition-id="clip" data-width="{W}" data-height="{H}" data-duration="{DUR}">\n' + '\n'.join(body)
        + '\n</div>\n<script>\nconst tl = gsap.timeline({ paused: true });\n' + '\n'.join(js) + '\nwindow.__timelines["clip"] = tl;\n</script>\n</template>\n'
    )
    index = f"""<!doctype html>
<html lang="en"{'' if feed else ' data-resolution="portrait"'}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>* {{ margin: 0; padding: 0; box-sizing: border-box; }} html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; background: #0d1424; }} #root {{ position: relative; width: 100%; height: 100%; }}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{DUR}" data-width="{W}" data-height="{H}">
      <div id="clip" data-composition-id="clip" data-composition-src="compositions/clip.html" data-start="0" data-duration="{DUR}" data-track-index="0" data-track-kind="graphics" data-width="{W}" data-height="{H}"></div>
      <audio id="music" class="clip" src="assets/urbaneclipse-B.mp3" data-start="0" data-duration="{DUR}" data-track-index="20" data-volume="1" data-fade-out="0.5"></audio>
    </div>
    <script>window.__timelines["main"] = gsap.timeline({{ paused: true }});</script>
  </body>
</html>
"""
    root = HERE / (f'{name}-feed' if feed else name)
    (root / 'compositions').mkdir(parents=True, exist_ok=True)
    if not (root / 'assets').exists():
        (root / 'assets').symlink_to(HERE / 'assets')
    for f in ('hyperframes.json', 'package.json', 'meta.json'):
        shutil.copy(HERE.parent / 'film-a' / f, root / f)
    (root / 'compositions' / 'clip.html').write_text(scene)
    (root / 'index.html').write_text(index)


for name, c in CLIPS.items():
    for feed in (False, True):
        project(name, c, feed)
print('wrote', len(CLIPS) * 2, 'clip projects')
