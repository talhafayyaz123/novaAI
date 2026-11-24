import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status


lock = threading.Lock()
requests: dict[str, deque[float]] = defaultdict(deque)


def enforce_rate_limit(key: str, limit: int | None = None, window_seconds: int | None = None) -> None:
    limit = limit or int(os.getenv("AI_RATE_LIMIT_PER_MINUTE", "20"))
    window_seconds = window_seconds or int(os.getenv("AI_RATE_LIMIT_WINDOW_SECONDS", "60"))
    now = time.monotonic()

    with lock:
        timestamps = requests[key]
        while timestamps and now - timestamps[0] >= window_seconds:
            timestamps.popleft()
        if len(timestamps) >= limit:
            retry_after = max(1, int(window_seconds - (now - timestamps[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit reached. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        timestamps.append(now)
