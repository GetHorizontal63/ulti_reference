"""Convert per-game throws JSON files into frontend bundles.

Outputs:
  frontend/public/data/ufa/throws-<season>.json     season bundle (unchanged)
  frontend/public/data/ufa/games/<slug>.json         per-game bundle
  frontend/public/data/ufa/players/<id>.json         per-player bundle
  frontend/public/data/ufa/players.json              player index
  frontend/public/data/ufa/teams.json                team index
  frontend/public/data/ufa/seasons.json              seasons index
  frontend/public/data/manifest.json                 top-level manifest
"""
from __future__ import annotations

import os
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT     = Path(__file__).resolve().parents[2]
PROCESSED_DIR = REPO_ROOT / "data" / "processed" / "ufa"
RAW_DIR       = REPO_ROOT / "data" / "raw" / "ufa"
PUBLIC_DIR    = Path(os.environ.get("UFA_EXPORT_DIR") or REPO_ROOT / "data" / "exports") / "ufa"
MANIFEST_PATH = Path(os.environ.get("UFA_EXPORT_DIR") or REPO_ROOT / "data" / "exports") / "manifest.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_rosters(slug: str, bundle: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    if isinstance(bundle.get("rosters"), dict) and bundle["rosters"]:
        return bundle["rosters"]
    legacy = RAW_DIR / slug / "rosters.json"
    if legacy.exists():
        return json.loads(legacy.read_text(encoding="utf-8"))
    return {}


def _bundle_for_slug(slug: str) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    throws_path = PROCESSED_DIR / f"{slug}__throws.json"
    if not throws_path.exists():
        raise FileNotFoundError(throws_path)
    bundle = json.loads(throws_path.read_text(encoding="utf-8"))
    rosters = _load_rosters(slug, bundle)
    name_by_id: dict[str, str] = {}
    for _team, roster in rosters.items():
        for p in roster:
            name_by_id[str(p["id"])] = p.get("name") or str(p["id"])

    items: list[dict[str, Any]] = []
    for i, r in enumerate(bundle["rows"]):
        thr = str(r["Thrower_ID"]) if r.get("Thrower_ID") is not None else None
        rcv = str(r["Receiver_ID"]) if r.get("Receiver_ID") is not None else None
        items.append({
            "throw_id":       f"{slug}-{r['Team']}-{i:05d}",
            "game_id":        slug,
            "team_id":        r["Team"],
            "thrower_id":     thr,
            "receiver_id":    rcv,
            "thrower_name":   name_by_id.get(thr) if thr else None,
            "receiver_name":  name_by_id.get(rcv) if rcv else None,
            "pbp_throw_type": r["Event_Outcome"],
            "svg_throw_x":    r.get("Thrower_X"),
            "svg_throw_y":    r.get("Thrower_Y"),
            "svg_recv_x":     r.get("Receiver_X"),
            "svg_recv_y":     r.get("Receiver_Y"),
            "svg_outcome":    r["Event_Outcome"],
            "thrower_color":  r.get("Thrower_color", "lightblue"),
            "receiver_color": r.get("Receiver_color", "white"),
        })
    return items, rosters


def export_seasons(seasons: list[int], slugs: list[str] | None = None,
                   verbose: bool = True) -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR / "games").mkdir(exist_ok=True)
    (PUBLIC_DIR / "players").mkdir(exist_ok=True)

    by_season: dict[int, list[str]] = {y: [] for y in seasons}
    if slugs is not None:
        for s in slugs:
            try:
                yr = int(s[:4])
            except ValueError:
                continue
            if yr in by_season:
                by_season[yr].append(s)
    else:
        for path in PROCESSED_DIR.glob("*__throws.json"):
            slug = path.name.replace("__throws.json", "")
            try:
                yr = int(slug[:4])
            except ValueError:
                continue
            if yr in by_season:
                by_season[yr].append(slug)
    for y in seasons:
        by_season[y].sort()

    all_players: dict[str, dict[str, Any]] = {}
    all_teams:   dict[str, dict[str, Any]] = {}
    player_throws: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seasons_meta: list[dict[str, Any]] = []

    for season, season_slugs in by_season.items():
        season_items: list[dict[str, Any]] = []
        game_metas:   list[dict[str, Any]] = []

        for slug in season_slugs:
            try:
                items, rosters = _bundle_for_slug(slug)
            except FileNotFoundError as exc:
                if verbose:
                    print(f"[export] skip {slug}: {exc}")
                continue

            # Per-game bundle.
            parts = slug.split("-")
            away, home = parts[3], parts[4]
            (PUBLIC_DIR / "games" / f"{slug}.json").write_text(
                json.dumps({
                    "items": items,
                    "meta": {
                        "league":         "UFA",
                        "season":         season,
                        "game_id":        slug,
                        "home":           home,
                        "away":           away,
                        "generated_at":   _now_iso(),
                        "schema_version": "0.3.0",
                    },
                }, indent=2),
                encoding="utf-8",
            )

            season_items.extend(items)

            played_teams = sorted({t["team_id"] for t in items if t["team_id"]})
            game_metas.append({
                "game_id":     slug,
                "season":      season,
                "date":        slug[:10],
                "away":        away,
                "home":        home,
                "throw_count": len(items),
                "teams":       played_teams,
            })

            for team, roster in rosters.items():
                all_teams.setdefault(team, {
                    "id": team, "league": "UFA", "abbrev": team,
                })
                for p in roster:
                    pid = str(p["id"])
                    all_players[pid] = {
                        "id":           pid,
                        "league":       "UFA",
                        "team_id":      team,
                        "display_name": p.get("name") or pid,
                        "jersey":       p.get("jersey"),
                    }

            for item in items:
                for pid_key in ("thrower_id", "receiver_id"):
                    pid = item.get(pid_key)
                    if pid:
                        player_throws[pid].append(item)

        # Season bundle.
        (PUBLIC_DIR / f"throws-{season}.json").write_text(
            json.dumps({
                "items": season_items,
                "meta": {
                    "league":         "UFA",
                    "season":         season,
                    "games":          season_slugs,
                    "generated_at":   _now_iso(),
                    "source":         "pipeline.export_static_bundle",
                    "schema_version": "0.3.0",
                },
            }, indent=2),
            encoding="utf-8",
        )

        seasons_meta.append({
            "id":          season,
            "year":        season,
            "game_count":  len(season_slugs),
            "throw_count": len(season_items),
            "games":       game_metas,
        })

        if verbose:
            print(f"[export] season {season}: {len(season_slugs)} games, "
                  f"{len(season_items)} throws")

    # Per-player bundles.
    for pid, p_items in player_throws.items():
        player_info = all_players.get(pid, {"id": pid, "display_name": pid})
        by_game: dict[str, list] = defaultdict(list)
        for item in p_items:
            by_game[item["game_id"]].append(item)
        game_summaries = [
            {
                "game_id":     gid,
                "season":      int(gid[:4]),
                "date":        gid[:10],
                "throw_count": len(g_items),
            }
            for gid, g_items in sorted(by_game.items(), reverse=True)
        ]
        (PUBLIC_DIR / "players" / f"{pid}.json").write_text(
            json.dumps({
                "player": player_info,
                "games":  game_summaries,
                "items":  p_items,
                "meta": {
                    "league":       "UFA",
                    "player_id":    pid,
                    "throw_count":  len(p_items),
                    "generated_at": _now_iso(),
                },
            }, indent=2),
            encoding="utf-8",
        )

    # Global indexes.
    (PUBLIC_DIR / "players.json").write_text(
        json.dumps({
            "items": list(all_players.values()),
            "meta":  {"league": "UFA", "generated_at": _now_iso()},
        }, indent=2), encoding="utf-8",
    )
    (PUBLIC_DIR / "teams.json").write_text(
        json.dumps({
            "items": list(all_teams.values()),
            "meta":  {"league": "UFA", "generated_at": _now_iso()},
        }, indent=2), encoding="utf-8",
    )
    seasons_meta.sort(key=lambda s: s["year"], reverse=True)
    (PUBLIC_DIR / "seasons.json").write_text(
        json.dumps({
            "items": seasons_meta,
            "meta":  {"league": "UFA", "generated_at": _now_iso()},
        }, indent=2), encoding="utf-8",
    )

    # Manifest.
    throws_map = {str(s["year"]): f"ufa/throws-{s['year']}.json" for s in seasons_meta}
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps({
            "generated_at": _now_iso(),
            "leagues": {
                "UFA": {
                    "available": True,
                    "files": {
                        "seasons":       "ufa/seasons.json",
                        "players":       "ufa/players.json",
                        "teams":         "ufa/teams.json",
                        "throws":        throws_map,
                        "games":         "ufa/games/",
                        "player_throws": "ufa/players/",
                    },
                }
            },
        }, indent=2), encoding="utf-8",
    )

    if verbose:
        print(f"[export] {len(all_players)} players, {len(all_teams)} teams")
        print(f"[export] {len(player_throws)} per-player bundles written")
        print(f"[export] manifest → {MANIFEST_PATH}")


def _main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game",    help="Export a single game slug.")
    ap.add_argument("--season",  type=int)
    ap.add_argument("--seasons", nargs="*", type=int)
    ap.add_argument("--all",     action="store_true")
    args = ap.parse_args()

    if args.all:
        years = sorted({int(p.name[:4]) for p in PROCESSED_DIR.glob("*__throws.json")
                        if p.name[:4].isdigit()})
        export_seasons(years)
    elif args.seasons:
        export_seasons(args.seasons)
    elif args.game:
        season = args.season or int(args.game[:4])
        export_seasons([season], slugs=[args.game])
    else:
        ap.error("Provide --all, --seasons, or --game.")


if __name__ == "__main__":
    _main()