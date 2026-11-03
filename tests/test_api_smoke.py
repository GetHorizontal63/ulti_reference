"""
API smoke tests that need no database (the DB isn't in git).

TestClient is used without its context manager, so the startup hook —
which requires ultimate.db and applies migrations — never runs.

Run:  pytest tests/
"""
from collections import Counter

from fastapi.testclient import TestClient

from backend import api

client = TestClient(api.app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_no_duplicate_routes():
    # FastAPI silently serves only the first registration of a path, so a
    # duplicate means dead code that looks live.
    seen = Counter(
        (method, route.path)
        for route in api.app.routes
        for method in (getattr(route, "methods", None) or ())
    )
    dupes = [key for key, n in seen.items() if n > 1]
    assert not dupes, f"duplicate routes: {dupes}"


def test_usau_hidden_by_default():
    assert api.ENABLE_USAU is False
    for path in ("/api/usau/programs", "/api/usau/games/123",
                 "/api/players/00000001/usau_season_stats",
                 "/api/players/00000001/videos"):
        assert client.get(path).status_code == 404, path
