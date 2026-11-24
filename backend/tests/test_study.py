import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from backend.db.models import (
    AIUsage,
    AuditLog,
    Document,
    DocumentChunk,
    StudyAnswer,
    StudyQuestion,
    StudySession,
)
from backend.gemini import GeminiClient
from backend.study.routes import generate_study_material, submit_study_answer
from backend.study.schemas import StudyAnswerRequest, StudyGenerateRequest


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
    def __init__(self, document=None, chunks=None, session=None, question=None):
        self.document = document
        self.chunks = chunks or []
        self.session = session
        self.question = question
        self.queries = []
        self.added = []
        self.commits = 0
        self._next_id = 1

    def query(self, model):
        values = {
            Document: self.document,
            DocumentChunk: self.chunks,
            StudySession: self.session,
            StudyQuestion: self.question,
        }
        query = FakeQuery(values[model])
        self.queries.append((model, query))
        return query

    def add(self, item):
        self.added.append(item)

    def flush(self):
        for item in self.added:
            if isinstance(item, (StudySession, StudyQuestion)) and item.id is None:
                item.id = self._next_id
                self._next_id += 1

    def commit(self):
        self.commits += 1


class StudyToolsTests(unittest.TestCase):
    def setUp(self):
        self.document = type("DocumentStub", (), {"id": 7, "status": "ready"})()
        self.chunks = [
            type(
                "ChunkStub",
                (),
                {"page_number": 2, "content": "Relevant source passage"},
            )()
        ]
        self.user = type("UserStub", (), {"id": 12})()

    def test_quiz_generation_hides_answers_until_submission(self):
        db = FakeDB(document=self.document, chunks=self.chunks)
        generated = (
            '{"questions":[{"question":"Which fact is supported?",'
            '"options":["A","B","C","D"],"correct_option":1,'
            '"explanation":"The passage directly supports B.",'
            '"citation_ids":["c1"]}]}'
        )
        with patch("backend.study.routes.enforce_rate_limit"):
            with patch("backend.study.routes.encode_texts", return_value=[[0.0] * 384]):
                with patch("backend.study.routes.GeminiClient") as gemini:
                    gemini.return_value.generate.return_value = generated
                    gemini.return_value.last_usage_tokens = 20
                    result = generate_study_material(
                        StudyGenerateRequest(document_id=7, kind="quiz", question_count=1),
                        db=db,
                        current_user=self.user,
                    )

        self.assertEqual(result["kind"], "quiz")
        self.assertEqual(len(result["questions"]), 1)
        self.assertNotIn("correct_option", result["questions"][0])
        self.assertNotIn("explanation", result["questions"][0])
        question = next(item for item in db.added if isinstance(item, StudyQuestion))
        self.assertEqual(question.correct_option, 1)
        self.assertEqual(question.explanation, "The passage directly supports B.")
        self.assertEqual(db.commits, 1)
        self.assertTrue(any(isinstance(item, AIUsage) for item in db.added))
        self.assertTrue(any(isinstance(item, AuditLog) for item in db.added))

    def test_summary_generation_returns_source_citations(self):
        db = FakeDB(document=self.document, chunks=self.chunks)
        with patch("backend.study.routes.enforce_rate_limit"):
            with patch("backend.study.routes.encode_texts", return_value=[[0.0] * 384]):
                with patch("backend.study.routes.GeminiClient") as gemini:
                    gemini.return_value.generate.return_value = (
                        '```json\n'
                        '{"content":"Key point from the file.","citation_ids":["c1"]}'
                        '\n```'
                    )
                    result = generate_study_material(
                        StudyGenerateRequest(document_id=7, kind="summary"),
                        db=db,
                        current_user=self.user,
                    )

        self.assertEqual(result["content"], "Key point from the file.")
        self.assertEqual(result["citations"][0]["page_number"], 2)
        gemini.return_value.generate.assert_called_once()
        self.assertEqual(
            gemini.return_value.generate.call_args.kwargs["response_mime_type"],
            "application/json",
        )

    def test_gemini_request_can_enforce_json_output(self):
        body = GeminiClient._body("study prompt", "application/json")
        self.assertEqual(
            body["generationConfig"],
            {"responseMimeType": "application/json"},
        )

    def test_generation_rejects_documents_not_owned_by_the_user(self):
        db = FakeDB(document=None)
        with patch("backend.study.routes.enforce_rate_limit"):
            with self.assertRaises(HTTPException) as error:
                generate_study_material(
                    StudyGenerateRequest(document_id=7, kind="summary"),
                    db=db,
                    current_user=self.user,
                )
        self.assertEqual(error.exception.status_code, 404)

    def test_generation_rejects_invalid_quiz_shape(self):
        db = FakeDB(document=self.document, chunks=self.chunks)
        with patch("backend.study.routes.enforce_rate_limit"):
            with patch("backend.study.routes.encode_texts", return_value=[[0.0] * 384]):
                with patch("backend.study.routes.GeminiClient") as gemini:
                    gemini.return_value.generate.return_value = '{"questions":[]}'
                    with self.assertRaises(HTTPException) as error:
                        generate_study_material(
                            StudyGenerateRequest(document_id=7, kind="quiz", question_count=1),
                            db=db,
                            current_user=self.user,
                        )
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(db.commits, 0)

    def test_wrong_answer_returns_correct_choice_and_explanation(self):
        session = type("SessionStub", (), {"id": 8})()
        question = type(
            "QuestionStub",
            (),
            {
                "id": 9,
                "session_id": 8,
                "correct_option": 1,
                "options": ["A", "B", "C", "D"],
                "explanation": "The source supports B.",
            },
        )()
        db = FakeDB(session=session, question=question)
        result = submit_study_answer(
            session_id=8,
            question_id=9,
            payload=StudyAnswerRequest(selected_option=0),
            db=db,
            current_user=self.user,
        )

        self.assertFalse(result["is_correct"])
        self.assertEqual(result["correct_answer"], "B")
        self.assertEqual(result["explanation"], "The source supports B.")
        self.assertTrue(any(isinstance(item, StudyAnswer) for item in db.added))
        self.assertEqual(db.commits, 1)

    def test_correct_answer_does_not_repeat_the_hidden_answer(self):
        session = type("SessionStub", (), {"id": 8})()
        question = type(
            "QuestionStub",
            (),
            {
                "id": 9,
                "session_id": 8,
                "correct_option": 1,
                "options": ["A", "B", "C", "D"],
                "explanation": "The source supports B.",
            },
        )()
        result = submit_study_answer(
            session_id=8,
            question_id=9,
            payload=StudyAnswerRequest(selected_option=1),
            db=FakeDB(session=session, question=question),
            current_user=self.user,
        )

        self.assertEqual(result, {"is_correct": True})

    def test_answer_submission_cannot_access_another_users_quiz(self):
        with self.assertRaises(HTTPException) as error:
            submit_study_answer(
                session_id=8,
                question_id=9,
                payload=StudyAnswerRequest(selected_option=0),
                db=FakeDB(session=None),
                current_user=self.user,
            )
        self.assertEqual(error.exception.status_code, 404)

    def test_request_schemas_enforce_quiz_and_option_limits(self):
        with self.assertRaises(ValidationError):
            StudyGenerateRequest(document_id=7, kind="quiz", question_count=11)
        with self.assertRaises(ValidationError):
            StudyAnswerRequest(selected_option=4)


if __name__ == "__main__":
    unittest.main()
