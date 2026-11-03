"""
UFA API — Player stats response parser.

Parses the JSON response from:
  https://www.backend.ufastats.com/api/v1/playerStats?playerIDs=...&years=all

Returns a list of stat row dicts ready for insert_ufa_stat_row().
"""
from typing import Any


def parse_player_stats_response(
    data: list[dict[str, Any]],
    scraped_at: str,
    player_team: dict[str, str] | None = None,
) -> list[dict]:
    """
    Convert the API response 'data' array into DB-ready row dicts.

    Each element looks like:
        {
          "player": {"playerID": "bjagt", "firstName": "Ben", "lastName": "Jagt"},
          "year": 2019,
          "assists": 64, "goals": 67, ...
        }

    player_team: optional {playerID: teamID} map built from the roster call.
    """
    rows = []
    for item in data:
        player = item.get("player") or {}
        player_id = player.get("playerID")
        year = item.get("year")
        if not player_id or year is None:
            continue

        rows.append({
            "player_id":                player_id,
            "year":                     year,
            "team_id":                  (player_team or {}).get(player_id),
            "assists":                  item.get("assists"),
            "goals":                    item.get("goals"),
            "hockey_assists":           item.get("hockeyAssists"),
            "completions":              item.get("completions"),
            "throw_attempts":           item.get("throwAttempts"),
            "throwaways":               item.get("throwaways"),
            "stalls":                   item.get("stalls"),
            "callahans_thrown":         item.get("callahansThrown"),
            "yards_received":           item.get("yardsReceived"),
            "yards_thrown":             item.get("yardsThrown"),
            "hucks_attempted":          item.get("hucksAttempted"),
            "hucks_completed":          item.get("hucksCompleted"),
            "catches":                  item.get("catches"),
            "drops":                    item.get("drops"),
            "blocks":                   item.get("blocks"),
            "callahans":                item.get("callahans"),
            "pulls":                    item.get("pulls"),
            "ob_pulls":                 item.get("obPulls"),
            "recorded_pulls":           item.get("recordedPulls"),
            "recorded_pulls_hangtime":  item.get("recordedPullsHangtime"),
            "o_points_played":          item.get("oPointsPlayed"),
            "o_points_scored":          item.get("oPointsScored"),
            "d_points_played":          item.get("dPointsPlayed"),
            "d_points_scored":          item.get("dPointsScored"),
            "seconds_played":           item.get("secondsPlayed"),
            "o_opportunities":          item.get("oOpportunities"),
            "o_opportunity_scores":     item.get("oOpportunityScores"),
            "d_opportunities":          item.get("dOpportunities"),
            "d_opportunity_stops":      item.get("dOpportunityStops"),
            "scraped_at":               scraped_at,
        })
    return rows
