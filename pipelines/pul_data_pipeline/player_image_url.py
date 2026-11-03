from pathlib import Path
import os
import sqlite3
import requests
from bs4 import BeautifulSoup
import time
import re

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

def get_photo_url(player_url):
    try:
        resp = requests.get(player_url, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        # Find the container div
        container = soup.find("div", class_=re.compile(r"flex flex-col sm:flex-row items-center"))
        if container:
            img = container.find("img")
            if img and img.get("src"):
                return img["src"]
        # Fallback: any img with the r2.dev CDN path
        for img in soup.find_all("img"):
            src = img.get("src", "")
            if "r2.dev/assets/players" in src:
                return src
        return None
    except Exception as e:
        print(f"  ERROR fetching {player_url}: {e}")
        return None

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Get all distinct player_name + player_url from pul_player_season_stats
    cur.execute("""
        SELECT DISTINCT player_name, player_url
        FROM pul_player_season_stats
        WHERE player_url IS NOT NULL AND player_url != ''
    """)
    players = cur.fetchall()
    print(f"Found {len(players)} unique players with URLs")

    updated = 0
    skipped = 0
    not_found = 0

    for player_name, player_url in players:
        # Check if master_players already has a photo for this player
        cur.execute("""
            SELECT ID, PUL_photo_url FROM master_players
            WHERE Name = ?
        """, (player_name,))
        match = cur.fetchone()

        if not match:
            print(f"  NO MATCH in master_players: {player_name}")
            not_found += 1
            continue

        player_id, existing_photo = match

        PLACEHOLDER = "https://pub-d284bbb3229c435b8e085787c253db6f.r2.dev/assets/pul-logo.png"
        if existing_photo and existing_photo != PLACEHOLDER:
            print(f"  SKIP (already has photo): {player_name}")
            skipped += 1
            continue

        print(f"  Scraping: {player_name} -> {player_url}")
        photo_url = get_photo_url(player_url)

        if photo_url:
            cur.execute("""
                UPDATE master_players SET PUL_photo_url = ? WHERE ID = ?
            """, (photo_url, player_id))
            conn.commit()
            print(f"    SET: {photo_url}")
            updated += 1
        else:
            print(f"    No photo found")
            not_found += 1

        time.sleep(0.5)  # polite delay

    conn.close()
    print(f"\nDone. Updated: {updated} | Skipped (had photo): {skipped} | Not matched/found: {not_found}")

if __name__ == "__main__":
    main()