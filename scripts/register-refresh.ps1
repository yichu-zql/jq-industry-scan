param([switch]$Disable)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$name='Jiuqian Industry Scan - Daily Refresh'
if($Disable){Disable-ScheduledTask -TaskName $name | Out-Null;Remove-Item -LiteralPath (Join-Path $root '.private/schedule.json') -ErrorAction SilentlyContinue;exit}
if((Get-TimeZone).Id -ne 'China Standard Time'){throw 'This schedule requires Beijing time (China Standard Time)'}
$existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if($existing -and !($existing.Actions.Arguments -like "*$root*")){throw 'A task with this name belongs to another location'}
$pwsh=(Get-Command pwsh.exe).Source
$action=New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoProfile -WindowStyle Hidden -File "'+(Join-Path $root 'scripts/refresh.ps1')+'" -Publish') -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -Daily -At ((Get-Date).Date.AddDays(1).AddHours(17).AddMinutes(30))
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 20)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '北京时间每日17:30检查久谦源变化；无变化不发布；校验失败保留线上版本。需本机开机、当前用户登录及联网。' -Force | Out-Null
@{name=$name;description='本机已配置北京时间每日17:30检查源变化（首次从次日开始）。需要电脑开机、当前用户登录且联网；无变化不发布，校验失败保留上一线上版本。运行结果和失败原因记录在本机 .private/last-run.json 与日志；未配置外部消息通知。'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.private/schedule.json') -Encoding utf8NoBOM
Get-ScheduledTask -TaskName $name | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $name | Select-Object NextRunTime,LastTaskResult
