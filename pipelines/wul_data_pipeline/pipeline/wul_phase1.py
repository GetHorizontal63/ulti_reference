"""
WUL Phase 1 — Download stats CSVs from westernultimateleague.shinyapps.io/stats/

For each year (2022-2026) and each data type:
  - player_standard_game  : Tab 2, player_view_toggle = "Standard - Game"
  - player_advanced_game  : Tab 2, player_view_toggle = "Advanced - Game"
  - team_standard_game    : Tab 3, team_view_toggle   = "Standard - Game"
  - team_advanced_game    : Tab 3, team_view_toggle   = "Advanced - Game"

Downloaded CSVs are saved to:
  data/raw/wul/{year}_{data_type}.csv

Requires: playwright (pip install playwright && playwright install chromium)
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
_USAU = _ROOT / "usau_data_pipeline"
sys.path.insert(0, str(_USAU))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import now_iso, log_wul, is_wul_item_downloaded  # noqa: E402

logger = logging.getLogger(__name__)

WUL_URL = "https://westernultimateleague.shinyapps.io/stats/"
WUL_YEARS = ["2022", "2023", "2024", "2025", "2026"]
WUL_DATA_TYPES = [
    "player_standard_game",
    "player_advanced_game",
    "team_standard_game",
    "team_advanced_game",
]

# Maps data_type → (tab number, radio input name, radio value)
_DATA_TYPE_CONFIG: dict[str, tuple[int, str, str]] = {
    "player_standard_game": (2, "player_view_toggle", "Standard - Game"),
    "player_advanced_game": (2, "player_view_toggle", "Advanced - Game"),
    "team_standard_game":   (3, "team_view_toggle",   "Standard - Game"),
    "team_advanced_game":   (3, "team_view_toggle",   "Advanced - Game"),
}


def run_wul_phase1(
    conn,
    raw_dir: Path,
    dry_run: bool = False,
    force: bool = False,
    years: list[str] | None = None,
    data_types: list[str] | None = None,
) -> None:
    """Download WUL stats CSVs for all year × data_type combinations."""
    target_years = years if years is not None else WUL_YEARS
    target_types = data_types if data_types is not None else WUL_DATA_TYPES
    raw_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "WUL Phase 1: downloading CSVs (%d years × %d types)",
        len(target_years),
        len(target_types),
    )

    if dry_run:
        for year in target_years:
            for dt in target_types:
                logger.info("  [dry-run] Would download %s %s", year, dt)
        return

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        logger.error(
            "playwright is not installed.  Run:  pip install playwright && playwright install chromium"
        )
        return

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            accept_downloads=True,
        )
        page = context.new_page()

        # Load the Shiny app once — it stays alive for all downloads
        try:
            logger.info("  Loading WUL stats app …")
            # Use "load" not "networkidle" — Shiny keeps a WebSocket alive forever
            page.goto(WUL_URL, wait_until="load", timeout=90_000)
            # Wait for Shiny to render the first DataTable
            page.wait_for_selector("table.dataTable", timeout=90_000)
            _wait_shiny_idle(page, timeout=30_000)
            logger.info("  App loaded")
        except Exception as exc:
            logger.error("  Failed to load app: %s", exc)
            browser.close()
            return

        current_tab: int | None = None  # track to avoid redundant tab clicks

        for year in target_years:
            for dt in target_types:
                if not force and is_wul_item_downloaded(conn, year, dt):
                    logger.info("  Skipping already-downloaded %s %s", year, dt)
                    continue

                out_path = raw_dir / f"{year}_{dt}.csv"
                logger.info("  Downloading %s %s …", year, dt)

                try:
                    tab_num, radio_name, radio_value = _DATA_TYPE_CONFIG[dt]

                    # Switch tab only when needed
                    if tab_num != current_tab:
                        _set_tab(page, tab_num)
                        current_tab = tab_num

                    # Set year and view (always explicit for reliability)
                    _set_year(page, year)
                    _set_radio(page, radio_name, radio_value)

                    # Download
                    _download_csv(page, tab_num, out_path, PWTimeout, dt)

                    log_wul(conn, year, dt, "downloaded", str(out_path))
                    logger.info("  Saved → %s", out_path.name)

                except Exception as exc:
                    logger.error("  Failed %s %s: %s", year, dt, exc)
                    log_wul(conn, year, dt, "error", str(exc))

        browser.close()

    logger.info("WUL Phase 1 complete")


# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------

def _wait_shiny_idle(page, timeout: int = 30_000) -> None:
    """Block until Shiny's busy indicator is hidden (app is idle)."""
    try:
        page.wait_for_function(
            """() => {
                const b = document.getElementById('shiny-busy');
                return !b || b.style.display !== 'block';
            }""",
            timeout=timeout,
        )
    except Exception:
        pass  # If there's no busy indicator, assume idle


def _set_tab(page, tab_num: int) -> None:
    """Click a main tab by its data-value and wait for Shiny to settle."""
    page.click(f"a[data-toggle='tab'][data-value='{tab_num}']")
    page.wait_for_timeout(400)
    _wait_shiny_idle(page)


def _set_year(page, year: str) -> None:
    """Select a year in the year_toggle Selectize dropdown."""
    # Use JS to set Selectize value — more reliable than simulating clicks
    page.evaluate(
        f"document.getElementById('year_toggle').selectize.setValue('{year}')"
    )
    page.wait_for_timeout(300)
    _wait_shiny_idle(page)


def _set_radio(page, input_name: str, value: str) -> None:
    """Click a radio button by its input[name] and value."""
    page.click(f"input[name='{input_name}'][value='{value}']")
    page.wait_for_timeout(300)
    _wait_shiny_idle(page)


def _wait_for_table_ready(page, timeout: int = 60_000) -> None:
    """Wait until the active DataTable is in a stable, default (non-show-all) state.

    Critically, this must block while dt_len == -1 (show-all from a prior download),
    because Shiny's re-render after a year/radio change always resets page length
    back to 25. If we call _set_show_all before Shiny finishes that re-render, the
    subsequent re-render overwrites our change and leaves the table at 25.
    """
    try:
        page.wait_for_function(
            """() => {
                const pane = document.querySelector('div.tab-pane.active');
                if (!pane) return false;
                const info = pane.querySelector('.dataTables_info');
                if (!info) return false;
                const text = info.textContent.trim();
                if (!text || text.toLowerCase().includes('loading')) return false;
                if (text.toLowerCase().includes('no data') || text.toLowerCase().includes('no matching')) return true;
                if (!text.includes('of')) return false;
                // Block while still in show-all state from a previous download —
                // Shiny re-render will reset dt.page.len() to 25.
                if (typeof $ !== 'undefined') {
                    const tableEl = pane.querySelector('table.dataTable');
                    if (tableEl) {
                        try {
                            const dt = $(tableEl).DataTable();
                            if (dt.page.len() === -1) return false;
                        } catch(e) {}
                    }
                }
                return true;
            }""",
            timeout=timeout,
        )
    except Exception:
        logger.warning("    Timed out waiting for initial table ready state — proceeding anyway")


def _wait_for_all_rows(page, timeout: int = 120_000) -> None:
    """Wait until the DataTable has rendered ALL rows (to == total).

    Also waits for the processing indicator to be hidden, covering the transient
    empty/loading state that fires briefly after a page-length change.
    """
    try:
        page.wait_for_function(
            """() => {
                const pane = document.querySelector('div.tab-pane.active');
                if (!pane) return false;
                // Must not be in processing state
                const proc = pane.querySelector('.dataTables_processing');
                if (proc && proc.style.display !== 'none') return false;
                const info = pane.querySelector('.dataTables_info');
                if (!info) return false;
                const text = info.textContent.trim();
                if (!text || text.toLowerCase().includes('loading')) return false;
                // Empty table — nothing to expand
                if (text.toLowerCase().includes('no data') || text.toLowerCase().includes('no matching')) return true;
                // "Showing 1 to N of N entries"
                const m = text.match(/to\\s+([\\d,]+)\\s+of\\s+([\\d,]+)/);
                if (!m) return false;
                const to    = parseInt(m[1].replace(/,/g, ''), 10);
                const total = parseInt(m[2].replace(/,/g, ''), 10);
                return to === total && total > 0;
            }""",
            timeout=timeout,
        )
    except Exception:
        logger.warning("    Timed out waiting for all rows to render — proceeding anyway")


def _set_show_all(page) -> None:
    """Use the DataTables jQuery API to set page length to -1 (All) and redraw.

    Using .page.len(-1).draw() is more reliable than simulating a DOM event on the
    <select>, because Shiny's DT widget registers its listener through jQuery's
    internal event system which a plain dispatchEvent can miss.
    """
    page.evaluate("""
        (() => {
            const pane = document.querySelector('div.tab-pane.active');
            if (!pane) return;
            const tableEl = pane.querySelector('table.dataTable');
            if (!tableEl || typeof $ === 'undefined') return;
            const dt = $(tableEl).DataTable();
            if (dt) dt.page.len(-1).draw();
        })()
    """)
    # Let DataTables kick off the server request before we start polling
    page.wait_for_timeout(600)


def _table_state(page) -> str:
    """Return a diagnostic string describing the active DataTable's current state."""
    return page.evaluate("""
        (() => {
            const pane = document.querySelector('div.tab-pane.active');
            if (!pane) return 'no active pane';
            const info = pane.querySelector('.dataTables_info');
            const sel  = pane.querySelector('.dataTables_length select');
            const proc = pane.querySelector('.dataTables_processing');
            const tbody = pane.querySelector('table.dataTable tbody');
            let dtLen = '?', dtCount = '?';
            if (typeof $ !== 'undefined') {
                const tableEl = pane.querySelector('table.dataTable');
                if (tableEl) {
                    try {
                        const dt = $(tableEl).DataTable();
                        dtLen   = dt.page.len();
                        dtCount = dt.rows().count();
                    } catch(e) { dtLen = 'err'; dtCount = 'err'; }
                }
            }
            return [
                'info=' + (info ? info.textContent.trim() : 'N/A'),
                'sel='  + (sel  ? sel.value : 'N/A'),
                'proc=' + (proc ? proc.style.display : 'N/A'),
                'tbody_tr=' + (tbody ? tbody.querySelectorAll('tr').length : 0),
                'dt_len=' + dtLen,
                'dt_rows=' + dtCount,
            ].join(' | ');
        })()
    """)


def _csv_row_count(path: Path) -> int:
    """Return number of data rows in a CSV (header excluded). -1 if file missing."""
    if not path.exists():
        return -1
    with path.open(encoding="utf-8-sig") as fh:
        return sum(1 for _ in fh) - 1  # subtract header line


def _download_csv(page, tab_num: int, out_path: Path, PWTimeout, data_type: str) -> None:
    """Wait for the full table then download, retrying if the row count looks wrong."""
    is_player = data_type.startswith("player")
    max_attempts = 4

    for attempt in range(max_attempts):
        # 1. Wait for the initial DataTable render to stabilise
        _wait_for_table_ready(page)

        # 2. Force show-all
        _set_show_all(page)

        # 3. Wait for Shiny server-side work triggered by the page-length change
        _wait_shiny_idle(page, timeout=45_000)

        # 4. Wait until the info bar reports all rows rendered
        _wait_for_all_rows(page, timeout=120_000)

        # 5. Download
        with page.expect_download(timeout=60_000) as dl_info:
            page.locator("div.tab-pane.active button.buttons-csv").first.click()
        dl_info.value.save_as(str(out_path))

        # 6. Validate row count
        count = _csv_row_count(out_path)
        bad = count == 0 or (is_player and count % 25 == 0)
        if not bad:
            return  # looks good

        if attempt < max_attempts - 1:
            wait_ms = 4_000 * (attempt + 1)
            logger.warning(
                "    Got %d rows (%s) — waiting %ds then retrying (attempt %d/%d)",
                count,
                "zero" if count == 0 else "multiple of 25",
                wait_ms // 1000,
                attempt + 1,
                max_attempts,
            )
            # Reset to 25 rows via jQuery API so the next _set_show_all triggers a real reload
            page.evaluate("""
                (() => {
                    const pane = document.querySelector('div.tab-pane.active');
                    if (!pane) return;
                    const tableEl = pane.querySelector('table.dataTable');
                    if (!tableEl || typeof $ === 'undefined') return;
                    const dt = $(tableEl).DataTable();
                    if (dt) dt.page.len(25).draw();
                })()
            """)
            page.wait_for_timeout(wait_ms)

    logger.warning("    Could not get clean row count after %d attempts", max_attempts)
