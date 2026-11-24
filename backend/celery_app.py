import os

from celery import Celery


redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery = Celery(
    "nova",
    broker=redis_url,
    backend=redis_url,
    include=["backend.tasks.rag"],
)
celery.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_routes={"backend.tasks.rag.process_document": {"queue": "rag"}},
)
