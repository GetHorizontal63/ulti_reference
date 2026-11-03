"""
parse_iexport.py — Parse a UltiAnalytics .iexport file into a normalized dict.

.iexport files are plain JSON with three top-level keys:
  - "teamJson"   — JSON-encoded string with roster / team metadata
  - "gameJson"   — JSON-encoded string with per-point play-by-play
  - "hash"       — MD5 of the payload (for integrity checking)
  - "dateExported" / "userThatExported" — provenance

Output schema (tmp_json):
{
  "source": "ultianalytics",
  "exported_at": str,          # UTC string from the file
  "exported_by": str,          # email of exporter
  "game": {
    "game_id": str,
    "team_cloud_id": str,
    "team_name": str,
    "season": str,
    "opponent": str,
    "tournament": str,
    "date": str,               # YYYY-MM-DD
    "time": str,               # HH:MM (local, as recorded)
    "score_us": int,
    "score_them": int,
    "game_point": int,
    "first_point_oline": bool,
    "wind_mph": int,
    "wind_degrees": int
  },
  "roster": [
    {
      "name": str,
      "number": str,
      "position": str,         # "Handler" | "Cutter" | "Any"
      "gender": str,           # "M" | "F"
      "absent": bool,
      "stats": {
        "goals":                 int,
        "assists":               int,
        "hockey_assists":        int,   # passer 2 throws before the score
        "pass_attempts":         int,   # catches + goals + throwaways + drops
        "completions":           int,   # catches + goals (not drops)
        "throwaways":            int,
        "pass_pct":              float | None,  # completions / pass_attempts
        "drops":                 int,
        "blocks":                int,
        "callahans":             int,   # block as last event, we scored
        "pulls":                 int,
        "pull_hangtime_avg_sec": float | None
      }
    }
  ],
  "points": [
    {
      "point_num": int,        # 1-based
      "line_type": str,        # "O" | "D"
      "line": [str],           # player names (7-person line)
      "score_before": {"us": int, "them": int},
      "score_after":  {"us": int, "them": int},
      "elapsed_seconds": int,
      "finished": bool,
      "substitutions": [
        {
          "from_player": str,
          "to_player": str,
          "reason": str,
          "timestamp": int
        }
      ],
      "events": [
        {
          "seq": int,          # 0-based within the point
          "timestamp": int,    # Unix seconds
          "side": str,         # "offense" | "defense"
          "action": str,       # "goal" | "catch" | "throwaway" | "drop" |
                               #   "block" | "pull" | "opponent_goal"
          "passer": str | null,
          "receiver": str | null,
          "defender": str | null,
          "pull_hangtime_ms": int | null
        }
      ]
    }
  ]
}
"""
from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Action normalisation map
# ---------------------------------------------------------------------------
_ACTION_MAP: dict[str, str] = {
    # Offense
    "Goal":      "goal",
    "Catch":     "catch",
    "Throwaway": "throwaway",
    "Drop":      "drop",
    # Defense
    "D":         "block",
    "Pull":      "pull",
    # Opponent scored (shows up as Defense → Goal or Offense → Goal on the
    # wrong side of a turnover point)
}


def _normalise_action(raw_type: str, raw_action: str) -> str:
    """Return a canonical action string."""
    if raw_type == "Defense" and raw_action == "Goal":
        return "opponent_goal"
    return _ACTION_MAP.get(raw_action, raw_action.lower())


def _parse_event(seq: int, raw: dict[str, Any]) -> dict[str, Any]:
    side = raw.get("type", "").lower()   # "offense" | "defense"
    raw_action = raw.get("action", "")
    action = _normalise_action(raw.get("type", ""), raw_action)

    details = raw.get("details") or {}
    pull_hangtime = details.get("hangtime")

    return {
        "seq": seq,
        "timestamp": raw.get("timestamp"),
        "side": side,
        "action": action,
        "passer": raw.get("passer"),
        "receiver": raw.get("receiver"),
        "defender": raw.get("defender"),
        "pull_hangtime_ms": pull_hangtime,
    }


def _parse_point(point_num: int, raw: dict[str, Any]) -> dict[str, Any]:
    summary = raw.get("summary") or {}
    score = summary.get("score") or {}

    # score *after* this point
    score_after = {"us": score.get("ours", 0), "them": score.get("theirs", 0)}

    # score *before* = back-calculate from line_type and finished
    score_before = dict(score_after)
    if summary.get("finished", False):
        line_type = summary.get("lineType", "O")
        if line_type == "O":
            # O-line held → we scored
            score_before["us"] = max(0, score_after["us"] - 1)
        else:
            # D-line either broke (we scored) or opponent held (they scored)
            # Detect by checking last event
            events_raw = raw.get("events") or []
            last_event = events_raw[-1] if events_raw else {}
            if last_event.get("type") == "Defense" and last_event.get("action") == "Goal":
                score_before["them"] = max(0, score_after["them"] - 1)
            else:
                score_before["us"] = max(0, score_after["us"] - 1)

    events_raw = raw.get("events") or []
    events = [_parse_event(i, e) for i, e in enumerate(events_raw)]

    subs_raw = raw.get("substitutions") or []
    substitutions = [
        {
            "from_player": s.get("fromPlayer"),
            "to_player":   s.get("toPlayer"),
            "reason":      s.get("reason"),
            "timestamp":   s.get("timestamp"),
        }
        for s in subs_raw
    ]

    return {
        "point_num": point_num,
        "line_type": summary.get("lineType", "O"),
        "line": raw.get("line") or [],
        "score_before": score_before,
        "score_after": score_after,
        "elapsed_seconds": summary.get("elapsedTime"),
        "finished": summary.get("finished", False),
        "substitutions": substitutions,
        "events": events,
    }


def _parse_roster(players_raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    roster = []
    for p in players_raw:
        roster.append({
            "name":     p.get("name", ""),
            "number":   p.get("number", ""),
            "position": p.get("position", ""),
            "gender":   "M" if p.get("male", True) else "F",
            "absent":   p.get("absent", False),
        })
    return roster


_EMPTY_STATS: dict[str, Any] = {
    "goals":               0,
    "assists":             0,
    "hockey_assists":      0,
    "pass_attempts":       0,
    "completions":         0,
    "throwaways":          0,
    "pass_pct":            None,
    "drops":               0,
    "blocks":              0,
    "callahans":           0,
    "pulls":               0,
    "pull_hangtime_avg_sec": None,
}


def _compute_player_stats(
    roster: list[dict[str, Any]],
    points: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Walk every event in every point and accumulate per-player stats.

    Returns a dict  {player_name: stats_dict}.
    """
    # Seed with known roster players (preserves entries with 0 stats)
    stats: dict[str, dict[str, Any]] = {}
    _hangtimes: dict[str, list[int]] = {}
    for p in roster:
        name = p["name"]
        stats[name] = dict(_EMPTY_STATS)
        _hangtimes[name] = []

    def _get(name: str | None) -> dict[str, Any] | None:
        """Return the stats bucket for *name*, creating one if unseen."""
        if not name or name == "Anonymous":
            return None
        if name not in stats:
            stats[name] = dict(_EMPTY_STATS)
            _hangtimes[name] = []
        return stats[name]

    for point in points:
        events = point["events"]
        score_before = point["score_before"]
        score_after = point["score_after"]
        finished = point.get("finished", False)

        for i, ev in enumerate(events):
            action   = ev["action"]
            passer   = ev["passer"]
            receiver = ev["receiver"]
            defender = ev["defender"]

            if action == "goal":
                # Receiver scored
                if r := _get(receiver):
                    r["goals"] += 1
                # Passer threw the assist
                if p := _get(passer):
                    p["assists"]       += 1
                    p["pass_attempts"] += 1
                    p["completions"]   += 1
                # Hockey assist: passer on the nearest prior catch
                for j in range(i - 1, -1, -1):
                    prev = events[j]
                    if prev["action"] == "catch" and prev["side"] == "offense":
                        if ha := _get(prev["passer"]):
                            ha["hockey_assists"] += 1
                        break
                    if prev["action"] in ("throwaway", "drop", "block", "pull"):
                        break

            elif action == "catch":
                if p := _get(passer):
                    p["pass_attempts"] += 1
                    p["completions"]   += 1

            elif action == "throwaway" and ev["side"] == "offense":
                if p := _get(passer):
                    p["pass_attempts"] += 1
                    p["throwaways"]    += 1

            elif action == "drop":
                # Passer: pass attempt only (disc was not caught → not a completion)
                if p := _get(passer):
                    p["pass_attempts"] += 1
                # Receiver: credited with the drop
                if r := _get(receiver):
                    r["drops"] += 1

            elif action == "block":
                if d := _get(defender):
                    d["blocks"] += 1
                    # Callahan: block is the last event and we scored
                    if (
                        finished
                        and i == len(events) - 1
                        and score_after["us"] > score_before["us"]
                    ):
                        d["callahans"] += 1

            elif action == "pull":
                if d := _get(defender):
                    d["pulls"] += 1
                    if ev["pull_hangtime_ms"] is not None:
                        _hangtimes[defender].append(ev["pull_hangtime_ms"])

    # Post-process: pass_pct and pull_hangtime_avg
    for name, s in stats.items():
        s["pass_pct"] = (
            round(s["completions"] / s["pass_attempts"], 3)
            if s["pass_attempts"] > 0 else None
        )
        ht = _hangtimes.get(name, [])
        s["pull_hangtime_avg_sec"] = round(sum(ht) / len(ht) / 1000, 2) if ht else None

    return stats


def parse_iexport(path: Path | str) -> dict[str, Any]:
    """
    Read a .iexport file and return a normalised tmp_json dict.

    Raises:
        FileNotFoundError  – if the path does not exist
        ValueError         – if the file is not a valid iexport
    """
    path = Path(path)
    raw_text = path.read_text(encoding="utf-8")
    outer = json.loads(raw_text)

    if "teamJson" not in outer or "gameJson" not in outer:
        raise ValueError(f"Not a valid .iexport file: {path}")

    team = json.loads(outer["teamJson"])
    game = json.loads(outer["gameJson"])

    # Parse points_json (another embedded JSON string)
    points_raw: list[dict[str, Any]] = json.loads(game.get("pointsJson", "[]"))

    # Derive YYYY-MM-DD from timestamp field "2020-02-08 14:35"
    timestamp_str: str = game.get("timestamp", "")
    date_part = timestamp_str.split(" ")[0] if " " in timestamp_str else timestamp_str
    time_part = timestamp_str.split(" ")[1] if " " in timestamp_str else ""

    wind = game.get("wind") or {}

    roster = _parse_roster(team.get("players") or [])
    points = [_parse_point(i + 1, p) for i, p in enumerate(points_raw)]
    player_stats = _compute_player_stats(roster, points)

    # Attach stats to each roster entry
    for entry in roster:
        entry["stats"] = player_stats.get(entry["name"], dict(_EMPTY_STATS))

    result: dict[str, Any] = {
        "source": "ultianalytics",
        "exported_at": outer.get("dateExported"),
        "exported_by": outer.get("userThatExported"),
        "game": {
            "game_id":           game.get("gameId"),
            "team_cloud_id":     team.get("cloudId"),
            "team_name":         team.get("name"),
            "season":            team.get("season"),
            "opponent":          game.get("opponentName"),
            "tournament":        game.get("tournamentName", ""),
            "date":              date_part,
            "time":              time_part,
            "score_us":          game.get("ours"),
            "score_them":        game.get("theirs"),
            "game_point":        game.get("gamePoint"),
            "first_point_oline": game.get("firstPointOline", True),
            "wind_mph":          wind.get("mph"),
            "wind_degrees":      wind.get("degrees"),
        },
        "roster": roster,
        "points": points,
    }
    return result
