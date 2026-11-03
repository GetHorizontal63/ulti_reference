CREATE TABLE IF NOT EXISTS mlu_players (
    player_id   TEXT PRIMARY KEY,
    full_name   TEXT NOT NULL,
    team_id     TEXT,
    year        INTEGER,
    jersey_num  INTEGER
);

CREATE TABLE IF NOT EXISTS mlu_throws (
    throw_id                TEXT PRIMARY KEY,
    game_id                 TEXT REFERENCES mlu_games(game_id),
    point_id                TEXT,
    period                  INTEGER,
    period_time_remaining   REAL,
    possession_team_id      TEXT,
    thrower_id              TEXT REFERENCES mlu_players(player_id),
    thrower_name            TEXT,
    thrower_x               REAL,
    thrower_y               REAL,
    receiver_id             TEXT REFERENCES mlu_players(player_id),
    receiver_name           TEXT,
    receiver_x_at_throw     REAL,
    receiver_y_at_throw     REAL,
    receiver_x_at_catch     REAL,
    receiver_y_at_catch     REAL,
    throw_outcome           TEXT CHECK(throw_outcome IN ('complete','goal','throwaway','drop','incomplete','block')),
    throw_timestamp         REAL,
    catch_timestamp         REAL,
    tagged_by               TEXT,
    tagged_at               TEXT
);

CREATE TABLE IF NOT EXISTS mlu_player_positions (
    position_id TEXT PRIMARY KEY,
    throw_id    TEXT REFERENCES mlu_throws(throw_id),
    snapshot    TEXT CHECK(snapshot IN ('throw','catch')),
    player_id   TEXT REFERENCES mlu_players(player_id),
    player_name TEXT,
    team_id     TEXT,
    x           REAL,
    y           REAL
);