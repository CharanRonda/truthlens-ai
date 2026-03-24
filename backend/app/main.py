from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .engine import SessionEngine
from .models import DashboardResponse, EndSessionResponse, EnvironmentUpdateRequest, SnapshotResponse, StartSessionRequest, StartSessionResponse

app = FastAPI(title="ThruthLens AI API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = SessionEngine()
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"


def _frontend_response(path: str = "") -> FileResponse:
    if not FRONTEND_INDEX.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    if path:
        candidate = (FRONTEND_DIST / path).resolve()
        if candidate.is_file() and (candidate == FRONTEND_DIST.resolve() or FRONTEND_DIST.resolve() in candidate.parents):
            return FileResponse(candidate)

    return FileResponse(FRONTEND_INDEX)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard() -> DashboardResponse:
    return engine.dashboard()


@app.post("/api/sessions/start", response_model=StartSessionResponse)
def create_session(payload: StartSessionRequest) -> StartSessionResponse:
    candidate_name = payload.candidate_name.strip()
    if not candidate_name:
        raise HTTPException(status_code=400, detail="Candidate name is required.")
    return engine.start_session(candidate_name)


@app.get("/api/sessions/{session_id}/snapshot", response_model=SnapshotResponse)
def get_snapshot(session_id: str) -> SnapshotResponse:
    try:
        return engine.get_snapshot(session_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Session not found.") from error


@app.post("/api/sessions/{session_id}/environment", response_model=SnapshotResponse)
def update_environment(session_id: str, payload: EnvironmentUpdateRequest) -> SnapshotResponse:
    try:
        return engine.update_environment(
            session_id,
            persons_detected=payload.persons_detected,
            phone_detected=payload.phone_detected,
        )
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Session not found.") from error


@app.post("/api/sessions/{session_id}/end", response_model=EndSessionResponse)
def finish_session(session_id: str) -> EndSessionResponse:
    try:
        return engine.end_session(session_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Session not found.") from error


@app.get("/", include_in_schema=False)
def serve_frontend_root() -> FileResponse:
    return _frontend_response()


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_asset(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found.")
    return _frontend_response(full_path)
