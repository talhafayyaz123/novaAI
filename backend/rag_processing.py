from functools import lru_cache
from typing import Any

import pymupdf


EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
CHUNK_SIZE_TOKENS = 500
CHUNK_OVERLAP_TOKENS = 50


@lru_cache(maxsize=1)
def get_embedding_model() -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBEDDING_MODEL_NAME, device="cpu")


def extract_document_pages(content: bytes, extension: str) -> list[tuple[int | None, str]]:
    if extension == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("The uploaded file is not a valid PDF")
        with pymupdf.open(stream=content, filetype="pdf") as document:
            pages = [
                (page_index + 1, page.get_text("text"))
                for page_index, page in enumerate(document)
            ]
    elif extension == ".txt":
        text = content.decode("utf-8-sig")
        if "\x00" in text:
            raise ValueError("The text document contains invalid binary data")
        pages = [(None, text)]
    else:
        raise ValueError("Only PDF and TXT documents are supported")

    if not any(text.strip() for _, text in pages):
        raise ValueError("The document contains no extractable text")
    return pages


def chunk_pages(
    pages: list[tuple[int | None, str]],
    tokenizer: Any,
    max_tokens: int = CHUNK_SIZE_TOKENS,
    overlap_tokens: int = CHUNK_OVERLAP_TOKENS,
) -> list[dict[str, Any]]:
    if max_tokens <= 0 or overlap_tokens < 0 or overlap_tokens >= max_tokens:
        raise ValueError("Chunk size and overlap must be valid positive token counts")

    chunks: list[dict[str, Any]] = []
    for page_number, text in pages:
        token_ids = tokenizer.encode(text, add_special_tokens=False)
        start = 0
        while start < len(token_ids):
            end = min(start + max_tokens, len(token_ids))
            content = tokenizer.decode(
                token_ids[start:end],
                skip_special_tokens=True,
                clean_up_tokenization_spaces=True,
            ).strip()
            if content:
                chunks.append({"page_number": page_number, "content": content})
            if end == len(token_ids):
                break
            start = end - overlap_tokens
    return chunks


def encode_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = get_embedding_model()
    embeddings = model.encode(
        texts,
        batch_size=32,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    if embeddings.ndim != 2 or embeddings.shape != (len(texts), EMBEDDING_DIMENSION):
        raise RuntimeError(
            f"Embedding model returned an unexpected shape: {embeddings.shape}"
        )
    return embeddings.tolist()
