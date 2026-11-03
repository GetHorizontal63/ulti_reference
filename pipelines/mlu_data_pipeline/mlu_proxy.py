"""
mlu_proxy.py — lightweight Flask proxy between mlu_tagger.html and ultimate.db
Run on your TrueNAS host (or any machine with access to the DB):

    pip install flask flask-cors
    python mlu_proxy.py --db /path/to/ultimate.db --port 5050

Then point the tagger tool at http://<host>:5050
"""
import argparse
import sqlite3
import json
import os
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

parser = argparse.ArgumentParser()
parser.add_argument('--db', default='ultimate.db', help='Path to ultimate.db')
parser.add_argument('--port', type=int, default=5050)
args = parser.parse_args()

app = Flask(__name__)
CORS(app)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/')
def index():
    return send_from_directory(SCRIPT_DIR, 'mlu_tagger.html')

def get_db():
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/games')
def get_games():
    conn = get_db()
    rows = conn.execute(
        "SELECT g.game_id, g.year, g.away_team_id, g.home_team_id, g.away_score, g.home_score, "
        "g.status, g.start_timestamp, g.week, g.week_label, "
        "CASE gu.site "
        "  WHEN 'youtube' THEN 'https://www.youtube.com/watch?v=' || gu.slug "
        "  ELSE gu.slug "
        "END AS streaming_url "
        "FROM mlu_games g "
        "LEFT JOIN game_urls gu ON gu.game_id = g.game_id "
        "ORDER BY g.start_timestamp DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/throw', methods=['POST'])
def save_throw():
    data = request.get_json()
    other_positions = data.pop('other_positions', [])

    cols = list(data.keys())
    placeholders = ','.join(['?' for _ in cols])
    vals = [data[c] for c in cols]

    conn = get_db()
    try:
        conn.execute(
            f"INSERT OR IGNORE INTO mlu_throws ({','.join(cols)}) VALUES ({placeholders})",
            vals
        )
        for i, pos in enumerate(other_positions):
            pid = f"{data['throw_id']}_op{i}"
            conn.execute(
                "INSERT OR IGNORE INTO mlu_player_positions "
                "(position_id, throw_id, snapshot, player_id, player_name, team_id, x, y) "
                "VALUES (?,?,?,?,?,?,?,?)",
                [pid, data['throw_id'], pos.get('snapshot'), pos.get('player_id'),
                 pos.get('player_name'), pos.get('team_id'), pos.get('x'), pos.get('y')]
            )
        conn.commit()
        return jsonify({'status': 'ok', 'throw_id': data['throw_id']}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/throws')
def get_throws():
    game_id = request.args.get('game_id')
    conn = get_db()
    if game_id:
        rows = conn.execute(
            "SELECT * FROM mlu_throws WHERE game_id=? ORDER BY throw_timestamp",
            [game_id]
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM mlu_throws ORDER BY tagged_at DESC LIMIT 200"
        ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/players')
def get_players():
    conn = get_db()
    rows = conn.execute("SELECT * FROM mlu_players ORDER BY full_name").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

if __name__ == '__main__':
    print(f"MLU Proxy starting on port {args.port} → {args.db}")
    app.run(host='0.0.0.0', port=args.port, debug=False)