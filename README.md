# NOVA AI

NOVA is an AI assistant platform with conversation memory, document question answering, content generation, user profiles, and an administrator dashboard.

## Features

- **Chat:** multiple conversations, conversation rename/delete, clear-all, conversation summaries, Markdown responses, and a persistent light/dark theme.
- **Document intelligence:** upload PDF or TXT documents, process them into searchable chunks, and ask questions with document citations.
- **Study tools:** generate document-grounded summaries, notes, and multiple-choice quizzes; quiz answers are checked server-side and incorrect answers include an explanation.
- **Content generator:** create emails, social posts, business descriptions, project proposals, professional summaries, blog outlines, and product descriptions.
- **Authentication and profile:** register, sign in/out, and update account details.
- **Admin dashboard:** view usage statistics and manage user account status.

## Stack

- Frontend: Next.js 13, React 18, TypeScript, Tailwind CSS
- API: FastAPI, SQLAlchemy, Alembic
- Database: PostgreSQL with the `pgvector` extension
- AI: Google Gemini; local Sentence Transformers embeddings for document retrieval
- Background document processing: Celery and Redis in Docker Compose; API background tasks are available for local development

## Render deployment

For a Render Web Service using the repository root, use:

- Build command: `pip install -r backend/requirements.txt`
- Start command: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`

Set `DATABASE_URL`, `JWT_SECRET_KEY`, and `GEMINI_API_KEY` in the service's environment. Apply database migrations with `alembic upgrade head` before using the service. Document embedding is loaded on demand, so the API can start without importing the ML runtime; document processing and search still need extra memory and may require a larger instance.

## Local development


```powershell
python -m venv backend/.venv
source backend/.venv/Scripts/activate

pip install -r backend/requirements.txt
pip install alembic
alembic upgrade head
uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
```

In a second terminal, start the frontend:
npm install
$env:BACKEND_URL = "http://127.0.0.1:8001"
npm run dev
```

   credentials login
   admin123@example.com
   12345678