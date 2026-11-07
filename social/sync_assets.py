#!/usr/bin/env python3
"""Copies into each film project's assets folder every file its compositions name, from the
recorded footage, stills and music in social/assets. Feed and clip projects link their assets
folder to a shared one, so names are gathered per real folder. Run after build.py and after
re-recording.

    python3 social/sync_assets.py
"""
import re
import shutil
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
SOURCES = [HERE / 'assets' / d for d in ('footage', 'stills', 'music')]
NAME = re.compile(r'assets/([\w.-]+\.(?:mp4|png|jpg|mp3))')

wanted = defaultdict(set)
for index in [*HERE.glob('*/index.html'), *HERE.glob('clips/*/index.html')]:
    project = index.parent
    folder = (project / 'assets').resolve()
    for html in [index, *project.glob('compositions/*.html')]:
        wanted[folder] |= set(NAME.findall(html.read_text()))

for folder, names in sorted(wanted.items()):
    folder.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in sorted(names):
        src = next((d / name for d in SOURCES if (d / name).exists()), None)
        if src is None:
            print(f'{folder.relative_to(HERE)}: missing {name}')
            continue
        dst = folder / name
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)
            copied.append(name)
    print(f'{folder.relative_to(HERE)}: {len(names)} files, copied {", ".join(copied) or "none"}')
