$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$stored=Import-Clixml -LiteralPath '.private/connection.xml'
$env:JQ_DEPENDENCIES=$stored.Dependencies
$env:PYTHONIOENCODING='utf-8'
$cfg=@{host=$stored.Host;port=3306;user=$stored.User;database='ulike_tmp';password=([PSCredential]::new($stored.User,$stored.Password)).GetNetworkCredential().Password}
$cfg | ConvertTo-Json -Compress | & $stored.Python scripts/local_analysis.py
