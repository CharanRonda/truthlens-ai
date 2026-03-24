# ThruthLens AI

ThruthLens AI is a full-stack interview intelligence demo with a React frontend and a FastAPI backend. The production setup now supports a single-service deployment: FastAPI serves the built React app and the API from the same HTTPS domain.

## Stack

- Frontend: React + Vite + Chart.js + jsPDF
- Backend: FastAPI
- AI integration points: OpenCV, DeepFace, Librosa, YOLO
- Production deploy: Docker + Render

## Project Structure

- `frontend/` React application
- `backend/` FastAPI application
- `Dockerfile` production build for frontend + backend
- `render.yaml` one-click Render blueprint

## Local Development

### Backend

```bash
cd /Users/charanronda/Documents/HACK/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd /Users/charanronda/Documents/HACK/frontend
npm install
npm run dev
```

For local development, Vite proxies `/api/*` requests to `http://127.0.0.1:8000`.

## Deploy Online On Render

### Option 1: Blueprint deploy

1. Push this project to GitHub.
2. Sign in to Render and choose **New +** -> **Blueprint**.
3. Select the repository.
4. Render will detect `render.yaml` and create one web service.
5. Wait for the deploy to finish, then open the generated `onrender.com` URL.

### Option 2: Manual web service deploy

1. Push this project to GitHub.
2. In Render, create a new **Web Service**.
3. Connect the repo.
4. Set **Runtime** to `Docker`.
5. Keep the root `Dockerfile`.
6. Deploy.

### Production notes

- The app uses webcam and microphone access, so deploy it over HTTPS.
- Render provides HTTPS automatically on the generated public URL.
- Health check path: `/api/health`
- The frontend and backend are served from the same domain in production, so no extra API base URL is required.

## Current Behavior

- Candidate sessions use the local webcam on the frontend.
- Analysis data is still mock/simulated in the backend, with browser-side environment detection for live UI updates.
- The PDF report follows the same structure and feel as the reference HTML while adding analytic visuals.

## Where Real AI Models Plug In

Replace the mock generators in `backend/app/engine.py` with:

- OpenCV or DeepFace for emotion and face analysis
- Librosa for voice stress and audio feature extraction
- YOLO for phone, multiple-person, and suspicious-object detection

The frontend data contract is already shaped for that upgrade, so you can swap the mock layer without redesigning the UI.
