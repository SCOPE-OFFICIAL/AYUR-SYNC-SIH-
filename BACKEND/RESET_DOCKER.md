# Full Docker Stack Reset (Destructive)

This guide (and accompanying script `scripts/reset_stack.ps1`) lets you completely rebuild
all backend containers AND wipe the Postgres volume.

## WARNING
All database data (volume `postgres_data`) will be **deleted**. Only run this in development.

## One-Liner (PowerShell)
```powershell
pwsh ./scripts/reset_stack.ps1 -NoCache -FollowLogs
```

Common flags:
- `-NoCache`     Rebuild images without using layer cache.
- `-SkipBuild`   Skip image rebuild (just recreate containers/volumes).
- `-FollowLogs`  After startup, stream the API container logs.
- `-Prune`       Perform `docker system prune -f` after tearing down.

If you omit flags:
```powershell
pwsh ./scripts/reset_stack.ps1
```
(Will build with cache, not follow logs, no prune.)

## Manual Steps (If You Prefer Not Using Script)
```powershell
cd BACKEND
# Stop and remove containers + named volume
docker compose down --volumes --remove-orphans
# (Optional) prune dangling images/containers
# docker system prune -f
# Rebuild (optional --no-cache)
docker compose build --no-cache
# Start detached
docker compose up -d
# Watch DB health
docker inspect ayur-sync-db --format '{{json .State.Health.Status}}'
# Tail logs
docker logs -f ayur-sync-api
```

## What Happens on Startup
1. `entrypoint.sh` launches `scripts/run_setup.py` in the background.
2. `run_setup.py` waits for DB, runs `app.create_tables`, applies idempotent ingestion column migration, optional AI discovery/CSV seed.
3. Uvicorn starts immediately (may serve 500s briefly until tables exist).

## Verifying Success
- Visit: http://localhost:8000/docs (OpenAPI)
- Check health: `Invoke-RestMethod http://localhost:8000/api/status` (PowerShell)
- Confirm tables exist: `docker exec -it ayur-sync-db psql -U postgres -d ayursync_icd_db -c "\dt"`

## Re-Seeding Data
If `SKIP_AI_DISCOVERY=1` in `.env`, the setup script attempts CSV seeding via `scripts/load_suggestions_from_csv.py`.
You can trigger any additional migrations manually, e.g.:
```powershell
docker exec ayur-sync-api python scripts/migrate_add_ingestion_definitions.py
```

## Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| API container exits quickly | Syntax/import error | Run `docker logs ayur-sync-api` to inspect; fix code & rebuild |
| DB never healthy | Port clash / local Postgres interference | Ensure host port 5433 free; stop local service |
| Stale code not updating | Bind mount path mismatch | Verify `volumes` in compose and that you edit files under `BACKEND/app` |
| Missing new columns | Migration ran before code volume mounted | Re-run migration manually inside container |

## Fast Reset Without Volume Wipe
If you only need to rebuild containers but keep data:
```powershell
cd BACKEND
docker compose down
docker compose build
docker compose up -d
```

---
Generated helper file to standardize destructive reset procedure.



http://127.0.0.1:5500   -- local admin panel link