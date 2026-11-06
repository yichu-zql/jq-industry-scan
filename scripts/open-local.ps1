$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
try {$health=Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 2} catch {$health=$null}
if (!$health) {
    Start-Process pwsh -ArgumentList @('-NoProfile','-File',('"'+(Join-Path $PSScriptRoot 'start-local.ps1')+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.private/local-service.log') -RedirectStandardError (Join-Path $projectRoot '.private/local-service-error.log')
    for($i=0;$i -lt 20;$i++) {
        Start-Sleep -Milliseconds 500
        try {$health=Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 2;break} catch {}
    }
}
if (!$health -or $health.mode -ne 'local-sql') {throw 'Local analysis service did not start. Check .private/local-service-error.log'}
Start-Process 'http://127.0.0.1:8765/#trends'
