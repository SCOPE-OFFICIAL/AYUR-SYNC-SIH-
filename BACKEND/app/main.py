# File: app/main.py
# This file is updated to include a more robust and explicit CORS configuration.

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.api.router import api_router
from app.core.config import settings
import time, json, os
from app.db.session import engine
from app.db.models import Base, ConceptMapRelease, ConceptMapElement, Mapping, ICD11Code, TraditionalTerm
from app.services import who_sync
from sqlalchemy.orm import Session
from sqlalchemy import select

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# --- ROBUST CORS MIDDLEWARE CONFIGURATION ---
# This explicitly allows requests from typical development origins.
# --- 2. ADD THIS MIDDLEWARE BLOCK ---
# This allows your frontend (running in the browser) to communicate with your backend

"""
origins = [
    'http://127.0.0.1:5500',  # VS Code Live Server
    'http://localhost:5500',   # Also for Live Server
]
"""

# Allow list from env for production (comma-separated). Fallback to dev-friendly defaults.
_env_origins = os.getenv("ALLOW_ORIGINS")
dev_origins = [
    'http://127.0.0.1:5500', 'http://localhost:5500',
    'http://127.0.0.1:8000', 'http://localhost:8000',
    'http://127.0.0.1:3000', 'http://localhost:3000'
]
origins: list[str] = []
if _env_origins:
    origins.extend([o.strip() for o in _env_origins.split(',') if o.strip()])
# Always append dev origins so local workflows keep functioning even in prod
origins.extend(dev_origins)
# Deduplicate while preserving order
seen = set()
origins = [o for o in origins if not (o in seen or seen.add(o))]
print(f"[CORS] Final allowed origins: {origins}")

# Optional: allow preview branches with dynamic subdomains (e.g., Netlify)
# Provide a regex via env var ALLOW_ORIGIN_REGEX, e.g.:
#   ^https://[a-z0-9-]+--ayur-sync-admin-panel\.netlify\.app$
allow_origin_regex = os.getenv("ALLOW_ORIGIN_REGEX")
# If no explicit regex provided, allow any localhost/127.* port to simplify dev (e.g., Live Server random ports)
if not allow_origin_regex:
    allow_origin_regex = r"^http://(127\\.0\\.0\\.1|localhost):\\d+$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"], # Allows all methods (GET, POST, etc.)
    allow_headers=["*"], # Allows all headers
)


@app.on_event("startup")
def ensure_tables_exist_on_startup():
    """Ensure all ORM-defined tables exist at process start (idempotent)."""
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        # Non-fatal: app can still run; log to stderr
        try:
            print(f"[STARTUP] Failed to ensure tables: {e}", flush=True)
        except Exception:
            pass
    # Create initial ConceptMap release if none exists
    try:
        with Session(bind=engine) as db:
            existing = db.execute(select(ConceptMapRelease).limit(1)).scalar_one_or_none()
            if not existing:
                release = ConceptMapRelease(version="v1-submission", notes="Auto-created on startup")
                db.add(release)
                db.flush()
                # Build elements from verified mappings
                mappings = db.query(Mapping).join(ICD11Code).join(TraditionalTerm).filter(Mapping.status == 'verified').all()
                count = 0
                for m in mappings:
                    db.add(ConceptMapElement(
                        release_id=release.id,
                        icd_name=m.icd11_code.icd_name,
                        icd_code=m.icd11_code.icd_code,
                        system=m.traditional_term.system,
                        term=m.traditional_term.term,
                        equivalence='equivalent',
                        is_primary=m.is_primary
                    ))
                    count += 1
                db.commit()
                print(f"[STARTUP] Created initial ConceptMap release v1-submission with {count} elements", flush=True)
            else:
                print("[STARTUP] ConceptMap release already exists", flush=True)
    except Exception as e:
        print(f"[STARTUP] Failed to create initial ConceptMap release: {e}", flush=True)
    # Start WHO sync scheduler if enabled
    try:
        who_sync.start_scheduler()
        if settings.ENABLE_WHO_SYNC:
            print("[STARTUP] WHO sync scheduler started", flush=True)
    except Exception as e:
        print(f"[STARTUP] WHO sync scheduler failed to start: {e}", flush=True)


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        try:
            duration_ms = int((time.perf_counter() - start) * 1000)
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "method": request.method,
                "path": request.url.path,
                "status": getattr(response, 'status_code', 0),
                "duration_ms": duration_ms,
                "client": request.client.host if request.client else None,
                "has_auth": bool(request.headers.get('authorization')),
            }
            log_dir = "/app/logs"
            try:
                os.makedirs(log_dir, exist_ok=True)
            except Exception:
                pass
            with open(os.path.join(log_dir, "access.log"), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            # best effort only
            pass


@app.get("/")
def read_root():
    return {"message": "Welcome to the NAMASTE-ICD API"}

app.include_router(api_router, prefix=settings.API_V1_STR)

# Lightweight WHO sync status / trigger endpoints (under /api)
@app.get(f"{settings.API_V1_STR}/admin/who-sync/status")
def who_sync_status():
    return who_sync.status()

@app.post(f"{settings.API_V1_STR}/admin/who-sync/trigger")
def who_sync_trigger():
    return who_sync.trigger_once()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)