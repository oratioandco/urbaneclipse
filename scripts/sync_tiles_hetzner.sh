#!/usr/bin/env bash
# Sync a converted 3D Tiles directory to the Hetzner Coolify host, where it is served
# from a Docker volume mounted into the app's nginx docroot.
#
# WHY THIS AND NOT OBJECT STORAGE: the tiles are served from the SAME ORIGIN as the app
# (https://<app>/berlin-full/...), so no CORS configuration exists to get wrong, no
# second provider is involved, and the traffic is covered by the server's existing
# allowance. The Hetzner Storage Box on this account is SFTP-only backup storage with no
# public HTTP or CORS control, so it cannot serve tiles to a browser.
#
# ACCESS: the host is reachable over Tailscale only — the Hetzner firewall exposes just
# 80/443/ICMP publicly. Bring Tailscale up before running this.
#
# Usage:
#   scripts/sync_tiles_hetzner.sh [SRC_DIR] [REMOTE_DIR]
# Defaults:
#   SRC_DIR    data/berlin-full
#   REMOTE_DIR /data/plastervoid/tiles/berlin-full
set -euo pipefail

SRC="${1:-data/berlin-full}"
REMOTE_DIR="${2:-/data/plastervoid/tiles/berlin-full}"
HOST="${PLASTERVOID_HOST:-root@100.105.62.79}"

if [[ ! -f "$SRC/tileset.json" ]]; then
  echo "error: $SRC/tileset.json not found — run convert_batch.py --all first" >&2
  exit 2
fi

if ! ssh -o ConnectTimeout=15 -o BatchMode=yes "$HOST" true 2>/dev/null; then
  echo "error: cannot reach $HOST. Is Tailscale up? (tailscale status)" >&2
  exit 3
fi

count=$(find "$SRC" -name '*.b3dm' | wc -l | tr -d ' ')
size=$(du -sh "$SRC" | cut -f1)
echo "syncing $count tiles ($size) -> $HOST:$REMOTE_DIR"

ssh -o ConnectTimeout=15 "$HOST" "mkdir -p '$REMOTE_DIR'"

# -z matters: b3dm compresses to roughly half, and the Tailscale path is latency-bound
# (~160 ms RTT), so the wire is the bottleneck rather than CPU.
# --partial so an interrupted run resumes instead of restarting. Expect ~20-40 min for
# the full 545 MB set on a cold sync; subsequent syncs only send changed tiles.
rsync -az --partial --delete -e "ssh -o ConnectTimeout=20" "$SRC/" "$HOST:$REMOTE_DIR/"

remote_count=$(ssh -o ConnectTimeout=15 "$HOST" "ls '$REMOTE_DIR'/*.b3dm 2>/dev/null | wc -l" | tr -d ' ')
echo "remote now has $remote_count tiles"

if [[ "$remote_count" != "$count" ]]; then
  echo "error: remote tile count ($remote_count) != local ($count) — re-run to finish" >&2
  exit 4
fi

echo "done. The app serves these at /berlin-full/ via the Coolify persistent volume."
