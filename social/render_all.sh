#!/bin/sh
# Renders the films and clips into social/renders. Pass names (film-a, film-a-feed, clips/ring-feed …) to render only those.
set -e
cd "$(dirname "$0")"
ALL="film-a film-a-feed film-b film-b-feed film-c film-c-feed $(ls -d clips/*/ | sed 's#/$##' | grep -v assets)"
for p in ${*:-$ALL}; do
  case $p in
    film-?) out=renders/urbaneclipse-$(echo $p | cut -c6 | tr a-z A-Z)-story.mp4 ;;
    film-?-feed) out=renders/urbaneclipse-$(echo $p | cut -c6 | tr a-z A-Z)-feed.mp4 ;;
    clips/*-feed) n=${p#clips/}; out=renders/clips/urbaneclipse-${n%-feed}-feed.mp4 ;;
    clips/*) out=renders/clips/urbaneclipse-${p#clips/}-story.mp4 ;;
  esac
  npx hyperframes render "$p" -o "$(pwd)/$out" --skill hyperframes >/dev/null
  echo "$out"
done
