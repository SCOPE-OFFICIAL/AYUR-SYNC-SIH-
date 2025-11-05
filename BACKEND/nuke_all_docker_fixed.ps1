<#
.SYNOPSIS
  Helper script to list and optionally remove all Docker resources used by this project,
  then restart the Docker Compose stack and show logs in the terminal.

.USAGE
  From PowerShell run:
    cd d:\AYUR-SYNC-API\BACKEND
    .\nuke_all_docker_fixed.ps1

  The script will:
    - show the docker-compose services, containers, images, volumes
    - ask for explicit confirmation (type 'yes')
    - run `docker compose down --rmi all -v --remove-orphans`
    - then run `docker compose up --build` (foreground, shows logs)

.NOTES
  - This script assumes Docker Desktop/Engine is installed and `docker` is on PATH.
  - It should be executed from the BACKEND directory, but it will work if launched from any path
    since it resolves its own script location.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Header($text){
    Write-Host "`n=== $text ===`n" -ForegroundColor Cyan
}

# Resolve script directory and compose file
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ScriptDir 'docker-compose.yml'

if (-not (Test-Path $ComposeFile)) {
    Write-Host "Could not find docker-compose.yml at expected path: $ComposeFile" -ForegroundColor Red
    Write-Host "Make sure you run this script from the BACKEND folder or move it there." -ForegroundColor Yellow
    exit 1
}

Write-Header "Project Docker summary (compose file: $ComposeFile)"

Push-Location $ScriptDir
try {
    Write-Host "Docker Compose services and current status:" -ForegroundColor Green
    & docker compose -f $ComposeFile ps --all | ForEach-Object { Write-Host $_ }

    Write-Host "`nDocker containers (all with name filter 'ayur-sync'):" -ForegroundColor Green
    & docker ps -a --filter 'name=ayur-sync' | ForEach-Object { Write-Host $_ }

    Write-Host "`nDocker images (full table) - filtering for project names:" -ForegroundColor Green
    $allImgs = & docker images
    $allImgs | Where-Object { $_ -match 'ayur-sync-api|ayur-sync' } | ForEach-Object { Write-Host $_ }
    if (-not ($allImgs | Where-Object { $_ -match 'ayur-sync-api|ayur-sync' })) { 
        Write-Host "  (no matching images found)" 
    }

    Write-Host "`nDocker volumes (project-related):" -ForegroundColor Green
    & docker volume ls | Where-Object { $_ -match 'postgres_data|ayur-sync' } | ForEach-Object { Write-Host $_ }

    Write-Host "`nDocker networks (project-related):" -ForegroundColor Green
    & docker network ls | Where-Object { $_ -match 'ayur-sync|default' } | ForEach-Object { Write-Host $_ }

    Write-Host "`nYou are about to DELETE the above containers, associated images built by compose, and named volumes (this will remove Postgres data).`n" -ForegroundColor Yellow

    $confirm = Read-Host "Type 'yes' to proceed with DELETE and restart the stack (case-sensitive)"
    if ($confirm -ne 'yes') {
        Write-Host "Aborting - nothing changed." -ForegroundColor Gray
        Pop-Location
        exit 0
    }

    Write-Header "Bringing docker compose down and removing images, volumes, and orphans"
    & docker compose -f $ComposeFile down --rmi all -v --remove-orphans
    Write-Host "Compose down completed." -ForegroundColor Green

    # Optional extra cleanup: remove any stray containers/images that match project naming
    Write-Header "Cleaning up stray containers and images (best-effort)"
    $projectImagePattern = 'ayur-sync-api'
    $extraImages = & docker images | Where-Object { $_ -match $projectImagePattern }
    foreach ($line in $extraImages) {
        # Attempt to extract the repository:tag from the image line (first column)
        $cols = -split $line
        if ($cols.Length -gt 0) {
            $imgRef = $cols[0]
            try { 
                & docker rmi -f $imgRef 
            } catch { 
                # Ignore errors
            }
        }
    }

    Write-Header "Restarting the stack (this will show logs in the terminal). Press Ctrl+C to stop logs when you want." 
    Write-Host "DEV MODE: Ensure BACKEND/.env contains DEV_MODE=1 for automatic reload." -ForegroundColor Cyan
    Write-Host "Compose mounts ./app by default so host edits appear inside the container." -ForegroundColor Cyan

    # Start compose in foreground so logs are visible
    & docker compose -f $ComposeFile up --build

}
finally {
    Pop-Location
}

# After compose up exits (user pressed Ctrl+C), print helpful instructions
Write-Header "How to view frontend with the updated backend"
Write-Host "1) Serve the admin MPA static files and open them in your browser so the UI origin matches allowed CORS origins." -ForegroundColor White
Write-Host "   Example (from PowerShell):" -ForegroundColor Green
Write-Host "   cd 'd:\AYUR-SYNC-API\BACKEND\admin panel mpa'" -ForegroundColor Yellow
Write-Host "   python -m http.server 5500" -ForegroundColor Yellow
Write-Host "   Then open: http://127.0.0.1:5500/rejections.html?api=local" -ForegroundColor Cyan

Write-Host "2) Ensure your backend is running at http://127.0.0.1:8000 and DEV_MODE=1 is set in BACKEND/.env for auto-reload." -ForegroundColor White
Write-Host "3) Login in the admin UI so localStorage.accessToken is set; then the page will call the local API." -ForegroundColor White

Write-Header "Finished nuke and restart helper"
Write-Host "If you want this script to also automatically open the browser or tail logs in a separate window, tell me and I can extend it." -ForegroundColor Cyan
