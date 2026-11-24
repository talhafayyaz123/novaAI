import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from fastapi import HTTPException
import numpy as np
import pymupdf

from backend.db.models import Document, DocumentChunk
from backend.documents.routes import _validate_upload, query_document
from backend.documents.schemas import DocumentQuery
from backend.gemini import GeminiBlockedError, GeminiError, _response_text
from backend.rag_processing import chunk_pages, encode_texts, extract_document_pages
from backend.storage import delete_file, download_bytes, upload_bytes


class WordTokenizer:
    def encode(self, text, **kwargs):
        del kwargs
        return text.split()

    def decode(self, tokens, **kwargs):
        del kwargs
        return " ".join(tokens)


class FakeQuery:
    def __init__(self, value):
        self.value = value
        self.filters = []

    def filter(self, *conditions):
        self.filters.extend(conditions)
        return self

    def order_by(self, *_):
        return self

    def limit(self, _):
        return self

    def first(self):
        return self.value

    def all(self):
        return self.value


class FakeDB:
    def __init__(self, document=None, chunks=None):
        self.document = document
        self.chunks = chunks or []
        self.queries = []
        self.added = []
        self.commits = 0

    def query(self, model):
        value = self.document if model is Document else self.chunks
        query = FakeQuery(value)
        self.queries.append((model, query))
        return query

    def add(self, item):
        self.added.append(item)

    def commit(self):
        self.commits += 1


class RagProcessingTests(unittest.TestCase):
    def test_chunks_overlap_and_keep_page_numbers(self):
        chunks = chunk_pages(
            [(3, "one two three four five six"), (4, "seven eight")],
            WordTokenizer(),
            max_tokens=4,
            overlap_tokens=1,
        )
        self.assertEqual(
            chunks,
            [
                {"page_number": 3, "content": "one two three four"},
                {"page_number": 3, "content": "four five six"},
                {"page_number": 4, "content": "seven eight"},
            ],
        )

    def test_embeddings_enforce_the_384_dimension_contract(self):
        model = Mock()
        model.encode.return_value = np.ones((1, 384), dtype=np.float32)
        with patch("backend.rag_processing.get_embedding_model", return_value=model):
            embeddings = encode_texts(["query"])
        self.assertEqual(len(embeddings), 1)
        self.assertEqual(len(embeddings[0]), 384)

        model.encode.return_value = np.ones((1, 1536), dtype=np.float32)
        with patch("backend.rag_processing.get_embedding_model", return_value=model):
            with self.assertRaises(RuntimeError):
                encode_texts(["query"])

    def test_extracts_utf8_text_and_rejects_empty_or_invalid_files(self):
        self.assertEqual(
            extract_document_pages(b"\xef\xbb\xbfHello", ".txt"),
            [(None, "Hello")],
        )
        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((72, 72), "PDF content")
        pdf_bytes = pdf.tobytes()
        pdf.close()
        self.assertIn(
            "PDF content",
            extract_document_pages(pdf_bytes, ".pdf")[0][1],
        )
        with self.assertRaises(ValueError):
            extract_document_pages(b"", ".txt")
        with self.assertRaises(ValueError):
            extract_document_pages(b"not a pdf", ".pdf")

    def test_upload_validation_checks_extension_and_file_content(self):
        self.assertEqual(
            _validate_upload(r"C:\fakepath\notes.txt", b"Hello"),
            ("notes.txt", "text/plain"),
        )
        with self.assertRaises(HTTPException):
            _validate_upload("notes.pdf", b"not a pdf")
        with self.assertRaises(HTTPException):
            _validate_upload("notes.exe", b"content")

    def test_s3_upload_is_owner_scoped_and_does_not_set_public_acl(self):
        client = Mock()
        with patch.dict(
            "os.environ",
            {
                "FILE_STORAGE_BACKEND": "s3",
                "S3_BUCKET": "private-documents",
            },
        ):
            with patch("backend.storage.boto3.client", return_value=client):
                key = upload_bytes(
                    b"contents",
                    "notes.txt",
                    owner_id=12,
                    content_type="text/plain",
                )
        self.assertTrue(key.startswith("documents/12/"))
        upload_args = client.put_object.call_args.kwargs
        self.assertEqual(upload_args["Bucket"], "private-documents")
        self.assertNotIn("ACL", upload_args)

    def test_local_storage_round_trip_and_path_traversal_protection(self):
        with TemporaryDirectory() as directory:
            with patch.dict(
                "os.environ",
                {
                    "FILE_STORAGE_BACKEND": "local",
                    "LOCAL_STORAGE_PATH": directory,
                },
                clear=True,
            ):
                key = upload_bytes(
                    b"local contents",
                    "notes.txt",
                    owner_id=12,
                    content_type="text/plain",
                )
                self.assertEqual(download_bytes(key), b"local contents")
                self.assertTrue((Path(directory) / key).is_file())
                with self.assertRaises(ValueError):
                    download_bytes("../../outside.txt")
                delete_file(key)
                self.assertFalse((Path(directory) / key).exists())

    def test_gemini_response_handles_success_block_and_empty(self):
        self.assertEqual(
            _response_text(
                {"candidates": [{"content": {"parts": [{"text": "Answer"}]}}]}
            ),
            "Answer",
        )
        with self.assertRaises(GeminiBlockedError):
            _response_text({"promptFeedback": {"blockReason": "SAFETY"}})
        with self.assertRaises(GeminiError):
            _response_text({"candidates": []})

    def test_query_does_not_expose_documents_owned_by_another_user(self):
        db = FakeDB()
        with self.assertRaises(HTTPException) as error:
            query_document(
                DocumentQuery(document_id=10, question="Question"),
                db=db,
                current_user=type("User", (), {"id": 5})(),
            )
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(len(db.queries[0][1].filters), 2)

    def test_query_returns_citations_for_owner_document(self):
        document = type("DocumentStub", (), {"id": 10, "status": "ready"})()
        chunks = [
            type(
                "ChunkStub",
                (),
                {"page_number": 2, "content": "Supporting passage"},
            )()
        ]
        db = FakeDB(document=document, chunks=chunks)
        with patch("backend.documents.routes.encode_texts", return_value=[[0.0] * 384]):
            with patch("backend.documents.routes.GeminiClient") as gemini:
                gemini.return_value.generate.return_value = "Answer [c1]"
                result = query_document(
                    DocumentQuery(document_id=10, question="Question"),
                    db=db,
                    current_user=type("User", (), {"id": 5})(),
                )
        self.assertEqual(result["answer"], "Answer [c1]")
        self.assertEqual(
            result["citations"],
            [{"id": "c1", "page_number": 2, "content": "Supporting passage"}],
        )
        self.assertEqual(len(db.added), 2)
        self.assertEqual(db.added[0].endpoint, "document_query")
        self.assertEqual(db.added[1].action, "ai.document_query")
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.queries[0][0], Document)
        self.assertEqual(db.queries[1][0], DocumentChunk)


if __name__ == "__main__":
    unittest.main()
