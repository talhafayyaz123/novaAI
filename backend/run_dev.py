from pathlib import Path

import uvicorn


BACKEND_ROOT = Path(__file__).resolve().parent
VENV_ROOT = (BACKEND_ROOT / ".venv").resolve()


if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        host="127.0.0.1",
        port=8001,
        reload=True,
        reload_dirs=[str(BACKEND_ROOT)],
        reload_excludes=[str(VENV_ROOT)],
    )
