param([switch]$Force,[switch]$Publish)
$ErrorActionPreference='Stop'
$env:GIT_TERMINAL_PROMPT='0'
$env:GCM_INTERACTIVE='never'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$privatePath=Join-Path $projectRoot '.private'
$lockPath=Join-Path $privatePath 'refresh.lock'
New-Item -ItemType Directory -Path $privatePath -Force | Out-Null
$lockStream=$null
$transcriptStarted=$false
try {
    $lockStream=[System.IO.File]::Open($lockPath,[System.IO.FileMode]::OpenOrCreate,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
    Start-Transcript -Path (Join-Path $privatePath ('refresh-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log')) | Out-Null
    $transcriptStarted=$true
    if($Publish){
        $branch=& git branch --show-current
        if($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'main'){throw 'Publish requires the main branch'}
        $dirty=& git status --porcelain
        if($dirty){throw 'Working tree has pending changes; preserve them and retry after review'}
        $ahead=& git rev-list --count '@{upstream}..HEAD'
        if($LASTEXITCODE -ne 0 -or [int]$ahead -gt 0){throw 'Unpublished local commits require review before automatic data refresh'}
    }
    $stored=Import-Clixml -LiteralPath (Join-Path $privatePath 'connection.xml')
    $python=$stored.Python
    $env:JQ_DEPENDENCIES=$stored.Dependencies
    $env:PYTHONIOENCODING='utf-8'
    $cfg=@{host=$stored.Host;port=3306;user=$stored.User;database='spider';password=([PSCredential]::new($stored.User,$stored.Password)).GetNetworkCredential().Password}
    $inputJson=$cfg | ConvertTo-Json -Compress
    $signature=$inputJson | & $python scripts/signature.py
    if($LASTEXITCODE -ne 0){throw 'Source signature query failed'}
    $sigPath=Join-Path $privatePath 'source-signature.json'
    if(!$Force -and (Test-Path -LiteralPath $sigPath) -and ((Get-Content -LiteralPath $sigPath -Raw).Trim() -eq $signature.Trim())){Write-Output 'No source changes; no publication.';exit 0}
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $env:JQ_CACHE_DIR=Join-Path $projectRoot ".cache/candidate-$stamp"
    foreach($kind in @('industry','brand','price','brandprice','shop','mapping')) {
        $inputJson | & $python scripts/extract.py $kind
        if($LASTEXITCODE -ne 0){throw "Extraction failed: $kind"}
    }
    $signatureAfter=$inputJson | & $python scripts/signature.py
    if($LASTEXITCODE -ne 0 -or $signature.Trim() -ne $signatureAfter.Trim()){throw 'Source changed during extraction; candidate was not published'}
    & $python scripts/build_insights.py
    if($LASTEXITCODE -ne 0){throw 'Overview summary build failed'}
    & $python scripts/build_scopes.py
    if($LASTEXITCODE -ne 0){throw 'Scope rollup build failed'}
    & $python scripts/build_leaders.py
    if($LASTEXITCODE -ne 0){throw 'Common-period summary build failed'}
    & $python scripts/build_price_leaders.py
    if($LASTEXITCODE -ne 0){throw 'Price and brand summary build failed'}
    & $python scripts/build_brand_details.py
    if($LASTEXITCODE -ne 0){throw "Brand detail build failed"}
    & $python scripts/package_data.py
    if($LASTEXITCODE -ne 0){throw 'Candidate validation failed'}
    & $python scripts/build_distribution.py
    if($LASTEXITCODE -ne 0){throw 'Distribution summary build failed'}
    & $python scripts/build_competition.py
    if($LASTEXITCODE -ne 0){throw 'Competition cube build failed'}
    & $python scripts/build_report.py
    if($LASTEXITCODE -ne 0){throw 'Report evidence build failed'}
    & npm.cmd run check
    if($LASTEXITCODE -ne 0){throw 'Application checks failed'}
    & node scripts/validate-release.mjs
    if($LASTEXITCODE -ne 0){throw 'Release checks failed'}
    if($Publish){
        & git add -- data
        if($LASTEXITCODE -ne 0){throw 'Staging data failed'}
        & git diff --cached --quiet -- data
        $diffCode=$LASTEXITCODE
        if($diffCode -notin @(0,1)){throw 'Checking staged data failed'}
        if($diffCode -eq 1){
            & $python scripts/bump_version.py patch
            if($LASTEXITCODE -ne 0){throw 'Version bump failed'}
            & git add -- lib/version.js lib/bubble-view.js lib/competition-worker.js lib/report-view.js lib/report-worker.js lib/trend-view.js lib/trend-worker.js lib/trend-chart.js lib/trend-export.js lib/trend-selection.js lib/trend-prices.js lib/trend-rules.js index.html app.js
            & git commit -m "Refresh Jiuqian validated data $stamp" -- data lib/version.js lib/bubble-view.js lib/competition-worker.js lib/report-view.js lib/report-worker.js lib/trend-view.js lib/trend-worker.js lib/trend-chart.js lib/trend-export.js lib/trend-selection.js lib/trend-prices.js lib/trend-rules.js index.html app.js
            if($LASTEXITCODE -ne 0){throw 'Commit failed'}
            & git push origin main
            if($LASTEXITCODE -ne 0){throw 'Push failed'}
        }
        & $python scripts/verify_live.py
        if($LASTEXITCODE -ne 0){throw 'Online verification failed'}
        $signature | Set-Content -LiteralPath $sigPath -Encoding utf8
    }
    @{status='success';time=(Get-Date -Format o);published=[bool]$Publish} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privatePath 'last-run.json')
} catch {
    @{status='failed';time=(Get-Date -Format o);reason=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privatePath 'last-run.json')
    Write-Error $_
    exit 1
} finally {
    $inputJson=$null;$cfg=$null
    if($transcriptStarted){Stop-Transcript | Out-Null}
    if($lockStream){$lockStream.Dispose()}
}
