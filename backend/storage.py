import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any

import boto3


class StorageConfigurationError(RuntimeError):
    pass


def _storage_backend() -> str:
    backend = os.getenv("FILE_STORAGE_BACKEND", "local").strip().lower()
    if backend not in {"local", "s3"}:
        raise StorageConfigurationError(
            "FILE_STORAGE_BACKEND must be either 'local' or 's3'"
        )
    return backend


def _local_storage_root() -> Path:
    configured_path = os.getenv("LOCAL_STORAGE_PATH")
    if configured_path:
        return Path(configured_path).expanduser().resolve()
    return (Path(__file__).resolve().parent / "local_storage").resolve()


def _local_file_path(key: str) -> Path:
    root = _local_storage_root()
    file_path = (root / key).resolve()
    if not file_path.is_relative_to(root):
        raise ValueError("Invalid local storage key")
    return file_path


def _get_s3_client() -> tuple[str, Any]:
    bucket = os.getenv("S3_BUCKET") or os.getenv("FILE_STORAGE_BUCKET")
    if not bucket:
        raise StorageConfigurationError(
            "S3_BUCKET is required when FILE_STORAGE_BACKEND=s3"
        )
    client = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL") or None,
        region_name=os.getenv("S3_REGION") or os.getenv("AWS_REGION") or None,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID") or None,
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY") or None,
        aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None,
    )
    return bucket, client


def upload_bytes(
    content: bytes,
    filename: str,
    owner_id: int,
    content_type: str,
) -> str:
    extension = Path(filename).suffix.lower()
    key = f"documents/{owner_id}/{uuid.uuid4().hex}{extension}"

    if _storage_backend() == "local":
        file_path = _local_file_path(key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(content)
        return key

    bucket, client = _get_s3_client()
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
    )
    return key


def download_bytes(key: str) -> bytes:
    if _storage_backend() == "local":
        return _local_file_path(key).read_bytes()

    bucket, client = _get_s3_client()
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def delete_file(key: str) -> None:
    if _storage_backend() == "local":
        _local_file_path(key).unlink(missing_ok=True)
        return

    bucket, client = _get_s3_client()
    client.delete_object(Bucket=bucket, Key=key)


def upload_file(file_path: str, filename: str) -> str:
    safe_filename = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
    content_type = (
        "application/pdf"
        if Path(filename).suffix.lower() == ".pdf"
        else "text/plain"
    )
    with open(file_path, "rb") as source:
        return upload_bytes(
            source.read(),
            safe_filename,
            owner_id=0,
            content_type=content_type,
        )


def download_file(key: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False) as target:
        target.write(download_bytes(key))
        return target.name
