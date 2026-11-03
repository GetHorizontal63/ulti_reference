-- Indexes for the hot USAU lookup paths. Before this, every one of these
-- queries was a full table scan (players: 1.2M rows, games: 207k rows).

CREATE INDEX IF NOT EXISTS idx_players_event_team  ON players(event_team_id);
CREATE INDEX IF NOT EXISTS idx_players_usau_pid    ON players(usau_player_id);
CREATE INDEX IF NOT EXISTS idx_players_event_slug  ON players(event_slug);

CREATE INDEX IF NOT EXISTS idx_games_event_slug    ON games(event_slug);
CREATE INDEX IF NOT EXISTS idx_games_home_team     ON games(home_event_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away_team     ON games(away_event_team_id);

CREATE INDEX IF NOT EXISTS idx_uet_usau_team       ON usau_event_teams(usau_team_id);
CREATE INDEX IF NOT EXISTS idx_nps_event_team      ON usau_nationals_player_stats(event_team_id);
CREATE INDEX IF NOT EXISTS idx_team_coaches_team   ON team_coaches(event_team_id);
