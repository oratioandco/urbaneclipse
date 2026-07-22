#!/usr/bin/env python3
"""Upload a converted 3D Tiles directory to Cloudflare R2 (S3-compatible).

What it uploads
---------------
Every file in the tileset directory produced by ``convert_batch.py``:
``tileset.json`` plus the ``tile_<x>_<y>.b3dm`` payloads.  The converter's
resume ledger (``_manifest.json``) and any ``*.tmp`` scratch files are
excluded by default - they are build state, not served assets.

Configuration (STRICTLY from the environment / a gitignored ``.env``)
---------------------------------------------------------------------
======================  ====================================================
``R2_ACCOUNT_ID``       Cloudflare account id -> endpoint
                        ``https://<account_id>.r2.cloudflarestorage.com``
``R2_ACCESS_KEY_ID``    R2 API token access key id
``R2_SECRET_ACCESS_KEY``R2 API token secret
``R2_BUCKET``           destination bucket name
``R2_PUBLIC_BASE_URL``  optional; the public/custom-domain base URL, used
                        only to print the resulting tileset URL
======================  ====================================================

Real environment variables win; anything missing is looked up in ``.env`` at
the repo root (``KEY=value`` lines, ``#`` comments, optional quotes).  No
credential is ever written to disk or echoed - only a masked key id is shown.

Skip logic (only changed objects are uploaded)
----------------------------------------------
The bucket is listed once (``list_objects_v2``, paginated) to obtain each
object's size and ETag.  A local file is considered UNCHANGED when its size
matches and its MD5 equals the remote ETag.  R2/S3 return a
``"<md5>-<parts>"`` ETag for multipart uploads, which is not a plain MD5;
for those objects the ``x-amz-meta-content-md5`` metadata this script writes
on every upload is fetched with ``head_object`` and compared instead.
``--force`` uploads everything regardless.

HTTP metadata written
---------------------
* ``tileset.json`` -> ``application/json``, ``Cache-Control:
  public, max-age=300`` (the index changes whenever tiles are added)
* ``*.b3dm``       -> ``application/octet-stream``, ``Cache-Control:
  public, max-age=31536000, immutable`` (content-addressed by tile name and
  regenerated only on a data refresh)
* everything else  -> guessed via ``mimetypes``, default octet-stream

Dry run
-------
``--dry-run`` NEEDS NO CREDENTIALS.  It enumerates the local directory,
resolves content types / cache headers / object keys exactly as a real run
would, and prints the byte total.  If credentials happen to be present it
also lists the bucket so the skip decision shown is the real one; without
credentials it says so explicitly and assumes every object must be uploaded.

Run::

    .venv/bin/python scripts/upload_tiles.py data/berlin-full --dry-run
    .venv/bin/python scripts/upload_tiles.py data/berlin-full --prefix berlin/
    .venv/bin/python scripts/upload_tiles.py data/berlin-full --force -j 8

Exit codes: 0 ok, 2 usage, 3 missing/invalid credentials, 4 upload failed,
5 source directory unusable.
"""

from __future__ import annotations

from typing import Iterable

import argparse
import concurrent.futures
import hashlib
import mimetypes
import os
import sys
import threading
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent
DOTENV_PATH = REPO_ROOT / ".env"

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NO_CREDENTIALS = 3
EXIT_UPLOAD_FAILED = 4
EXIT_BAD_SOURCE = 5

REQUIRED_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
OPTIONAL_KEYS = ("R2_PUBLIC_BASE_URL",)

EXCLUDED_NAMES = {"_manifest.json", "_manifest.json.tmp", ".DS_Store"}
EXCLUDED_SUFFIXES = (".tmp",)

CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
CACHE_INDEX = "public, max-age=300"

MD5_METADATA_KEY = "content-md5"  # stored as x-amz-meta-content-md5
MULTIPART_THRESHOLD = 64 * 1024 * 1024  # single-part PUT below this -> ETag == MD5


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

def read_dotenv(path: Path) -> dict[str, str]:
    """Parse a minimal ``KEY=value`` .env file.  Missing file -> ``{}``."""
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    try:
        text = path.read_text()
    except OSError:
        return {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key.strip()] = value
    return out


def load_config(dotenv_path: Path = DOTENV_PATH) -> tuple[dict[str, str], list[str]]:
    """Return ``(config, missing_required_keys)``; real env wins over ``.env``."""
    dotenv = read_dotenv(dotenv_path)
    cfg: dict[str, str] = {}
    for key in REQUIRED_KEYS + OPTIONAL_KEYS:
        value = os.environ.get(key) or dotenv.get(key) or ""
        if value:
            cfg[key] = value
    missing = [k for k in REQUIRED_KEYS if not cfg.get(k)]
    return cfg, missing


def mask(secret: str) -> str:
    if len(secret) <= 6:
        return "*" * len(secret)
    return "%s...%s" % (secret[:3], secret[-3:])


# --------------------------------------------------------------------------
# Local enumeration
# --------------------------------------------------------------------------

def content_type_for(name: str) -> str:
    if name.endswith(".b3dm"):
        return "application/octet-stream"
    if name.endswith(".json"):
        return "application/json"
    guessed, _ = mimetypes.guess_type(name)
    return guessed or "application/octet-stream"


def cache_control_for(name: str) -> str:
    # .b3dm payloads never change under a given name within a data generation;
    # tileset.json is the mutable index that points at them.
    return CACHE_INDEX if name.endswith(".json") else CACHE_IMMUTABLE


def md5_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def enumerate_files(src_dir: Path, prefix: str) -> list[dict]:
    """Return the sorted upload plan entries for ``src_dir`` (recursive)."""
    entries: list[dict] = []
    for path in sorted(src_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(src_dir).as_posix()
        name = path.name
        if name in EXCLUDED_NAMES or name.endswith(EXCLUDED_SUFFIXES):
            continue
        entries.append({
            "path": path,
            "rel": rel,
            "key": prefix + rel,
            "size": path.stat().st_size,
            "content_type": content_type_for(name),
            "cache_control": cache_control_for(name),
        })
    return entries


# --------------------------------------------------------------------------
# Remote state
# --------------------------------------------------------------------------

def list_remote(client, bucket: str, prefix: str) -> dict[str, dict]:
    """Return ``{key: {"size": int, "etag": str}}`` for everything under prefix."""
    remote: dict[str, dict] = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            remote[obj["Key"]] = {
                "size": obj["Size"],
                "etag": (obj.get("ETag") or "").strip('"'),
            }
    return remote


def needs_upload(entry: dict, remote: dict[str, dict], client, bucket: str) -> tuple[bool, str]:
    """Decide whether ``entry`` must be uploaded.  Returns (upload?, reason)."""
    info = remote.get(entry["key"])
    if info is None:
        return True, "new"
    if info["size"] != entry["size"]:
        return True, "size %d != %d" % (entry["size"], info["size"])
    local_md5 = entry.setdefault("md5", md5_of(entry["path"]))
    etag = info["etag"]
    if "-" not in etag:
        return (False, "etag match") if etag == local_md5 else (True, "checksum differs")
    # Multipart ETag: fall back to the md5 we stored in object metadata.
    if client is None:
        return True, "multipart etag, no client to verify"
    try:
        head = client.head_object(Bucket=bucket, Key=entry["key"])
    except Exception:
        return True, "head_object failed"
    remote_md5 = (head.get("Metadata") or {}).get(MD5_METADATA_KEY)
    if remote_md5 == local_md5:
        return False, "metadata md5 match"
    return True, "no/So different metadata md5"


# --------------------------------------------------------------------------
# Upload
# --------------------------------------------------------------------------

class ClientFactory:
    """Thread-local boto3 S3 clients (one per worker thread, shared session)."""

    def __init__(self, cfg: dict[str, str]):
        import boto3  # imported lazily so --dry-run works without boto3 config

        self._boto3 = boto3
        self._cfg = cfg
        self._local = threading.local()
        self.endpoint = "https://%s.r2.cloudflarestorage.com" % cfg["R2_ACCOUNT_ID"]

    def get(self):
        client = getattr(self._local, "client", None)
        if client is None:
            from botocore.config import Config

            client = self._boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self._cfg["R2_ACCESS_KEY_ID"],
                aws_secret_access_key=self._cfg["R2_SECRET_ACCESS_KEY"],
                region_name="auto",  # R2 has a single 'auto' region
                config=Config(
                    signature_version="s3v4",
                    retries={"max_attempts": 5, "mode": "standard"},
                    max_pool_connections=32,
                ),
            )
            self._local.client = client
        return client


def upload_one(client, bucket: str, entry: dict) -> int:
    """PUT one object with its content type, cache headers and md5 metadata."""
    md5 = entry.setdefault("md5", md5_of(entry["path"]))
    with entry["path"].open("rb") as body:
        client.put_object(
            Bucket=bucket,
            Key=entry["key"],
            Body=body,
            ContentType=entry["content_type"],
            CacheControl=entry["cache_control"],
            Metadata={MD5_METADATA_KEY: md5},
        )
    return entry["size"]


def _fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return "%.2f %s" % (n, unit)
        n /= 1024.0
    return "%.2f GB" % n


def run(
    src_dir: Path,
    *,
    prefix: str,
    dry_run: bool,
    force: bool,
    workers: int,
    cfg: dict[str, str],
    have_credentials: bool,
) -> tuple[int, dict]:
    entries = enumerate_files(src_dir, prefix)
    if not entries:
        print("error: no uploadable files in %s" % src_dir, file=sys.stderr)
        return EXIT_BAD_SOURCE, {}

    factory = None
    client = None
    remote: dict[str, dict] = {}
    if have_credentials:
        factory = ClientFactory(cfg)
        client = factory.get()
        try:
            remote = list_remote(client, cfg["R2_BUCKET"], prefix)
        except Exception as e:
            print("error: cannot list bucket %r: %s" % (cfg["R2_BUCKET"], e), file=sys.stderr)
            if not dry_run:
                return EXIT_NO_CREDENTIALS, {}
            print("  (dry run continues assuming an empty bucket)")
        print("remote objects under prefix %r: %d" % (prefix, len(remote)))
    else:
        print("no credentials present - dry run assumes an EMPTY bucket "
              "(every object counted as an upload)")

    todo: list[dict] = []
    skipped: list[dict] = []
    for e in entries:
        if force:
            e["reason"] = "forced"
            todo.append(e)
            continue
        up, reason = needs_upload(e, remote, client, cfg.get("R2_BUCKET", ""))
        e["reason"] = reason
        (todo if up else skipped).append(e)

    total_bytes = sum(e["size"] for e in todo)
    by_type: dict[str, list[int]] = {}
    for e in todo:
        by_type.setdefault(e["content_type"], []).append(e["size"])

    print("=" * 70)
    print("R2 upload plan")
    print("=" * 70)
    print("source dir       : %s" % src_dir)
    print("bucket           : %s" % cfg.get("R2_BUCKET", "<unset>"))
    print("key prefix       : %r" % prefix)
    print("local files      : %d (%s)" % (
        len(entries), _fmt_bytes(sum(e["size"] for e in entries))))
    print("to upload        : %d (%s)" % (len(todo), _fmt_bytes(total_bytes)))
    print("to skip          : %d" % len(skipped))
    for ctype, sizes in sorted(by_type.items()):
        print("  %-26s %5d objects  %s" % (
            ctype, len(sizes), _fmt_bytes(sum(sizes))))
    print("cache-control    : *.b3dm %r" % CACHE_IMMUTABLE)
    print("                 : *.json %r" % CACHE_INDEX)

    if dry_run:
        print("-" * 70)
        print("DRY RUN - nothing uploaded.  Objects that would be PUT:")
        for e in todo[:10]:
            print("  %-36s %10d B  %-24s %-34s [%s]" % (
                e["key"], e["size"], e["content_type"], e["cache_control"], e["reason"]))
        if len(todo) > 10:
            print("  ... and %d more" % (len(todo) - 10))
        if skipped:
            print("Objects that would be SKIPPED (unchanged):")
            for e in skipped[:5]:
                print("  %-36s [%s]" % (e["key"], e["reason"]))
            if len(skipped) > 5:
                print("  ... and %d more" % (len(skipped) - 5))
        print("TOTAL BYTES TO UPLOAD: %d (%s)" % (total_bytes, _fmt_bytes(total_bytes)))
        print("=" * 70)
        return EXIT_OK, {"planned": len(todo), "skipped": len(skipped), "bytes": total_bytes}

    if not todo:
        print("nothing to upload - bucket already up to date")
        print("=" * 70)
        return EXIT_OK, {"uploaded": 0, "skipped": len(skipped), "bytes": 0}

    bucket = cfg["R2_BUCKET"]
    t0 = time.time()
    done = 0
    sent = 0
    failures: list[tuple[str, str]] = []
    lock = threading.Lock()

    def worker(entry: dict) -> int:
        return upload_one(factory.get(), bucket, entry)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(worker, e): e for e in todo}
        for fut in concurrent.futures.as_completed(futures):
            entry = futures[fut]
            try:
                n = fut.result()
            except Exception as exc:
                with lock:
                    failures.append((entry["key"], str(exc)))
                    done += 1
                print("  FAILED %s: %s" % (entry["key"], exc), file=sys.stderr)
                continue
            with lock:
                done += 1
                sent += n
                d, s = done, sent
            if d % 25 == 0 or d == len(todo):
                elapsed = time.time() - t0
                rate = s / elapsed if elapsed > 0 else 0
                print("  [%d/%d] %s uploaded  %.1fs  %s/s" % (
                    d, len(todo), _fmt_bytes(s), elapsed, _fmt_bytes(rate)))

    elapsed = time.time() - t0
    print("-" * 70)
    print("uploaded         : %d objects, %s in %.1fs" % (
        len(todo) - len(failures), _fmt_bytes(sent), elapsed))
    print("skipped          : %d" % len(skipped))
    print("failed           : %d" % len(failures))
    base = cfg.get("R2_PUBLIC_BASE_URL")
    if base:
        print("public tileset   : %s/%stileset.json" % (base.rstrip("/"), prefix))
    print("=" * 70)
    if failures:
        for key, err in failures[:20]:
            print("  %s: %s" % (key, err), file=sys.stderr)
        return EXIT_UPLOAD_FAILED, {"uploaded": len(todo) - len(failures),
                                    "failed": len(failures), "bytes": sent}
    return EXIT_OK, {"uploaded": len(todo), "skipped": len(skipped), "bytes": sent}


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Upload a converted 3D Tiles directory to Cloudflare R2."
    )
    p.add_argument("src", help="Tileset directory (e.g. data/berlin-full).")
    p.add_argument(
        "--prefix", default="",
        help="Key prefix inside the bucket, e.g. 'berlin/' (default: bucket root).",
    )
    p.add_argument("--dry-run", action="store_true",
                   help="List what would be uploaded and exit.  Needs no credentials.")
    p.add_argument("--force", action="store_true",
                   help="Upload every file, even if the remote copy is identical.")
    p.add_argument("-j", "--workers", type=int, default=8, metavar="N",
                   help="Parallel upload workers (default: %(default)s).")
    p.add_argument("--env-file", default=str(DOTENV_PATH),
                   help="Path to the .env fallback (default: %(default)s).")
    args = p.parse_args(list(argv) if argv is not None else None)

    src_dir = Path(args.src).expanduser().resolve()
    if not src_dir.is_dir():
        print("error: not a directory: %s" % src_dir, file=sys.stderr)
        return EXIT_BAD_SOURCE
    if args.workers < 1 or args.workers > 32:
        print("error: --workers must be 1..32", file=sys.stderr)
        return EXIT_USAGE
    prefix = args.prefix
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    if prefix.startswith("/"):
        print("error: --prefix must not start with '/'", file=sys.stderr)
        return EXIT_USAGE

    cfg, missing = load_config(Path(args.env_file))
    have_credentials = not missing

    if not have_credentials:
        if not args.dry_run:
            # Never silently no-op: a real run without credentials is an error.
            print("error: missing R2 credentials: %s" % ", ".join(missing), file=sys.stderr)
            print("       set them in the environment or in %s "
                  "(see .env.example); never commit them." % args.env_file,
                  file=sys.stderr)
            return EXIT_NO_CREDENTIALS
    else:
        print("R2 endpoint      : https://%s.r2.cloudflarestorage.com" % cfg["R2_ACCOUNT_ID"])
        print("R2 access key id : %s" % mask(cfg["R2_ACCESS_KEY_ID"]))
        try:
            import boto3  # noqa: F401
        except ImportError:
            print("error: boto3 is not installed (.venv/bin/pip install boto3)",
                  file=sys.stderr)
            return EXIT_USAGE

    code, _ = run(
        src_dir,
        prefix=prefix,
        dry_run=args.dry_run,
        force=args.force,
        workers=args.workers,
        cfg=cfg,
        have_credentials=have_credentials,
    )
    return code


if __name__ == "__main__":
    sys.exit(main())
