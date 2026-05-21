import time
import threading
from collections import defaultdict


class RateLimiter:
    def __init__(self, max_attempts: int = 20, window_seconds: int = 60):
        self._max_attempts = max_attempts
        self._window_seconds = window_seconds
        self._lock = threading.Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self._window_seconds
        self._attempts[key] = [t for t in self._attempts[key] if t > cutoff]

    def is_rate_limited(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            if len(self._attempts[key]) >= self._max_attempts:
                return True
            self._attempts[key].append(now)
            return False

    def reset_key(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)

    def remaining_attempts(self, key: str) -> int:
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            return max(0, self._max_attempts - len(self._attempts[key]))


login_rate_limiter = RateLimiter(max_attempts=20, window_seconds=60)
owner_login_rate_limiter = RateLimiter(max_attempts=20, window_seconds=60)
