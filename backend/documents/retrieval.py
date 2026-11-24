from typing import Any
from sqlalchemy.orm import Session
from backend.db.models import DocumentChunk


def retrieve_relevant_chunks(
    db: Session,
    document_id: int,
    query_embedding: list[float],
    limit: int,
) -> list[DocumentChunk]:
    return (
        db.query(DocumentChunk)
        .filter(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding_384.isnot(None),
        )
        .order_by(DocumentChunk.embedding_384.cosine_distance(query_embedding))
        .limit(limit)
        .all()
    )


def build_citations(chunks: list[DocumentChunk]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"c{index}",
            "page_number": chunk.page_number,
            "content": chunk.content,
        }
        for index, chunk in enumerate(chunks, start=1)
    ]
