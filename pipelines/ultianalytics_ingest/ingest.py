#!/usr/bin/env python3
"""
ultianalytics_ingest.py — Convert .iexport files to normalised tmp_json.

Usage
-----
# Single file → printed to stdout
python ingest.py path/to/game.iexport

# Single file → written next to the source (same stem, .json extension)
python ingest.py path/to/game.iexport --out path/to/output.json

# Entire directory of .iexport files → output dir
python ingest.py path/to/exports/ --out-dir path/to/tmp_json/

# Dry-run: parse and validate without writing anything
python ingest.py path/to/exports/ --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make sure the repo root is importable regardless of CWD
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))

from pipelines.ultianalytics_ingest.parse_iexport import parse_iexport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _default_out_path(src: Path) -> Path:
    """Return <stem>.json in the same directory as *src*."""
    return src.with_suffix(".json")


def _write(data: dict, dest: Path, *, dry_run: bool) -> None:
    if dry_run:
        print(f"  [dry-run] would write → {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote → {dest}")


def _process_file(
    src: Path,
    out_path: Path | None,
    *,
    dry_run: bool,
    stdout: bool,
) -> bool:
    """Parse one .iexport file. Returns True on success."""
    try:
        data = parse_iexport(src)
    except Exception as exc:
        print(f"  ERROR parsing {src.name}: {exc}", file=sys.stderr)
        return False

    if stdout:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return True

    dest = out_path or _default_out_path(src)
    _write(data, dest, dry_run=dry_run)
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Convert UltiAnalytics .iexport files to normalised JSON."
    )
    p.add_argument(
        "source",
        type=Path,
        help="A single .iexport file or a directory containing .iexport files.",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        metavar="FILE",
        help="Output path (only valid when source is a single file). "
             "Defaults to <source_stem>.json beside the source file.",
    )
    p.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        metavar="DIR",
        help="Output directory (only valid when source is a directory). "
             "Files are written as <original_stem>.json inside this dir.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate without writing any output files.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    source: Path = args.source.resolve()

    # ---- Single file -------------------------------------------------------
    if source.is_file():
        if args.out_dir is not None:
            parser.error("--out-dir is only valid when source is a directory.")
        stdout = args.out is None and not args.dry_run and source.suffix != ".json"
        # If no --out given and not dry-run, write next to source
        out_path = args.out
        if out_path is None and not stdout:
            out_path = _default_out_path(source)
        ok = _process_file(source, out_path, dry_run=args.dry_run, stdout=stdout)
        return 0 if ok else 1

    # ---- Directory ---------------------------------------------------------
    if source.is_dir():
        if args.out is not None:
            parser.error("--out is only valid when source is a single file.")
        files = sorted(source.glob("*.iexport"))
        if not files:
            print(f"No .iexport files found in {source}", file=sys.stderr)
            return 1

        out_dir: Path | None = args.out_dir
        errors = 0
        for f in files:
            print(f"Processing {f.name} …")
            dest = (out_dir / f.with_suffix(".json").name) if out_dir else None
            ok = _process_file(f, dest, dry_run=args.dry_run, stdout=False)
            if not ok:
                errors += 1

        total = len(files)
        print(f"\nDone: {total - errors}/{total} succeeded.")
        return 0 if errors == 0 else 1

    print(f"Source does not exist: {source}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
