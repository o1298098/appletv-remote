# Apple TV Remote · Web UI

Web client for controlling Apple TV on your LAN. In production the FastAPI backend serves the built SPA in the same process; 

![UI preview](frontend/docs/preview.png)

## Local development

1. Install frontend dependencies:
   - `cd frontend`
   - `npm ci` (or `npm install`)
2. Install backend dependencies in a Python virtual environment:
   - `cd ../backend`
   - `python -m venv .venv`
   - Activate venv:
     - PowerShell: `.venv\Scripts\Activate.ps1`
     - bash/zsh: `source .venv/bin/activate`
   - `pip install -r requirements.txt`
3. Start the API from `backend` (default port **8765**):
   - `uvicorn main:app --host 0.0.0.0 --port 8765`
4. In another terminal, start the frontend dev server from `frontend`:
   - `cd frontend`
   - `npm run dev`
   - Vite proxies `/api` to `http://127.0.0.1:8765` (see `frontend/vite.config.ts`).

## Production build

```bash
npm run build
```

Output goes to `dist/`. The root Docker image copies that folder into the container so `uvicorn` can serve both the SPA and `/api`.

## Deployment 

From the **repository root**:

```bash
docker build -t apple-tv-remote .
docker run --rm -p 8765:8765 -v atv-data:/data apple-tv-remote
```

Or with Compose:

```bash
docker compose up --build
```

Open **http://localhost:8765** in your browser. Pairing data is persisted under the container volume `/data` (see `PYATV_STORAGE`).

> **Note:** If the container cannot discover Apple TVs on your LAN (common on Linux with bridge networking), switch to `network_mode: host` in `docker-compose.yml` as described in the comments there (use either host networking or `ports`, not both).
