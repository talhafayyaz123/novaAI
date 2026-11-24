import sys, os
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from backend.auth.routes import router as auth_router
from backend.auth.csrf import CSRFMiddleware
from backend.admin.routes import router as admin_router
from backend.chat.routes import router as chat_router
from backend.documents.routes import router as documents_router
from backend.generator.routes import router as generator_router
from backend.study.routes import router as study_router

app = FastAPI()

# app.add_middleware(CSRFMiddleware)  # Disabled for curl testing

# Include authentication routes
app.include_router(auth_router, prefix="/auth")
app.include_router(admin_router, prefix="/admin")
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(documents_router, prefix="/documents", tags=["documents"])
app.include_router(generator_router, prefix="/generate", tags=["generator"])
app.include_router(study_router, prefix="/study", tags=["study"])

@app.get("/")
async def root():
    return JSONResponse(content={"message": "NOVA backend ready"})
