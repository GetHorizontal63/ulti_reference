"""
HTTP session, rate limiter, and retry logic for the USAU scraper.
"""
import time
import random
import logging
from typing import Optional

import requests

from pipelines.usau_data_pipeline.config import HEADERS, RATE_LIMIT_SECONDS, RATE_LIMIT_JITTER, REQUEST_TIMEOUT, MAX_RETRIES, RETRY_BACKOFF

logger = logging.getLogger(__name__)


class RateLimiter:
    """Per-worker rate limiter: enforces a minimum delay within a single thread."""

    def __init__(self, min_delay: float = RATE_LIMIT_SECONDS, jitter: float = RATE_LIMIT_JITTER):
        self.min_delay = min_delay
        self.jitter = jitter
        self._last_request = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last_request
        delay = self.min_delay + random.uniform(0, self.jitter)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request = time.monotonic()


def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def get_with_retry(
    session: requests.Session,
    url: str,
    rate_limiter: RateLimiter,
    max_retries: int = MAX_RETRIES,
) -> Optional[requests.Response]:
    for attempt in range(max_retries):
        rate_limiter.wait()
        try:
            resp = session.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                return resp
            if resp.status_code in (404, 500):
                return resp  # caller handles as skip/not-found; don't retry
            if resp.status_code in (429, 503):
                wait_time = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning("Rate limited (%d) on %s, waiting %ds", resp.status_code, url, wait_time)
                time.sleep(wait_time)
                continue
            resp.raise_for_status()
        except requests.RequestException as exc:
            if attempt == max_retries - 1:
                logger.error("Failed GET %s: %s", url, exc)
                return None
            wait_time = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning("Request error on %s: %s — retrying in %ds", url, exc, wait_time)
            time.sleep(wait_time)
    return None


def post_with_retry(
    session: requests.Session,
    url: str,
    data: dict,
    rate_limiter: RateLimiter,
    max_retries: int = MAX_RETRIES,
) -> Optional[requests.Response]:
    for attempt in range(max_retries):
        rate_limiter.wait()
        try:
            resp = session.post(url, data=data, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                return resp
            if resp.status_code == 404:
                return None
            if resp.status_code in (429, 503):
                wait_time = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning("Rate limited (%d) on POST %s, waiting %ds", resp.status_code, url, wait_time)
                time.sleep(wait_time)
                continue
            resp.raise_for_status()
        except requests.RequestException as exc:
            if attempt == max_retries - 1:
                logger.error("Failed POST %s: %s", url, exc)
                return None
            wait_time = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning("Request error on POST %s: %s — retrying in %ds", url, exc, wait_time)
            time.sleep(wait_time)
    return None
