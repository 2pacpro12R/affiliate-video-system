param(
  [string]$Url = "https://thumbnailcreator.com?atp=fHsill"
)

$ErrorActionPreference = "Stop"

$VpsHost = if ($env:VPS_HOST) { $env:VPS_HOST } else { "187.124.82.67" }
$VpsUser = if ($env:VPS_USER) { $env:VPS_USER } else { "root" }
$VpsDir = if ($env:VPS_DIR) { $env:VPS_DIR } else { "/root/.affiliate-video-system" }
$Target = "$VpsUser@$VpsHost"

Write-Host "[1/4] Preparing remote directory..."
ssh $Target "mkdir -p '$VpsDir'"

Write-Host "[2/4] Uploading project files..."
scp pipeline.js package.json package-lock.json .env.example "${Target}:${VpsDir}/"

Write-Host "[3/4] Installing dependencies on VPS..."
ssh $Target "cd '$VpsDir' && npm install"

Write-Host "[4/4] Running pipeline..."
ssh $Target "cd '$VpsDir' && node pipeline.js '$Url'"

Write-Host "[done] VPS pipeline run finished."
