import logging
from pathlib import Path

from backend.auth.dependencies import SessionLocal
from backend.celery_app import celery
from backend.db.models import Document, DocumentChunk
from backend.rag_processing import (
    chunk_pages,
    encode_texts,
    extract_document_pages,
    get_embedding_model,
)
from backend.storage import download_bytes


logger = logging.getLogger(__name__)


def _process_document(document_id: int) -> None:
    db = SessionLocal()
    try:
        document = db.query(Document).filter(Document.id == document_id).first()
        if document is None:
            raise ValueError(f"Document {document_id} does not exist")
        if document.status == "ready":
            return

        document.status = "processing"
        db.commit()

        file_content = download_bytes(document.s3_key)
        pages = extract_document_pages(
            file_content,
            Path(document.filename).suffix.lower(),
        )
        model = get_embedding_model()
        chunks = chunk_pages(pages, model.tokenizer)
        if not chunks:
            raise ValueError(f"Document {document_id} contains no text chunks")
        embeddings = encode_texts([chunk["content"] for chunk in chunks])
        if len(embeddings) != len(chunks):
            raise RuntimeError("Embedding count did not match document chunk count")

        db.query(DocumentChunk).filter(
            DocumentChunk.document_id == document_id
        ).delete(synchronize_session=False)
        db.add_all(
            [
                DocumentChunk(
                    document_id=document_id,
                    chunk_index=index,
                    page_number=chunk["page_number"],
                    content=chunk["content"],
                    embedding_384=embedding,
                )
                for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
            ]
        )
        document.status = "ready"
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _mark_document_failed(document_id: int) -> None:
    db = SessionLocal()
    try:
        document = db.query(Document).filter(Document.id == document_id).first()
        if document is not None:
            document.status = "failed"
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not update failed status for document %s", document_id)
    finally:
        db.close()


def process_document(document_id: int) -> None:
    try:
        _process_document(document_id)
    except Exception:
        _mark_document_failed(document_id)
        logger.exception("Local document processing failed for document %s", document_id)


@celery.task(
    bind=True,
    name="backend.tasks.rag.process_document",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=5,
)
def process_document_task(self, document_id: int) -> None:
    try:
        _process_document(document_id)
    except Exception:
        if self.request.retries >= self.max_retries:
            _mark_document_failed(document_id)
        logger.exception("Document processing failed for document %s", document_id)
        raise
