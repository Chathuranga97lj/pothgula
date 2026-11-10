<#
  NFR-08: copies the server's backups to a computer the library owns.
  Run weekly on that computer (Windows 10 or 11 already has ssh and scp), for
  example from Task Scheduler. Only backups not already copied are fetched.

    powershell -ExecutionPolicy Bypass -File copy-off-server.ps1 `
      -Server pothgula@203.0.113.10 -RemoteDir /opt/pothgula/infra/backups `
      -LocalDir D:\PothgulaBackups

  The server account needs this computer's SSH key (docs/setup.md, "Copying
  backups off the server"). Copies here are never deleted by this script.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Server,
  [Parameter(Mandatory = $true)] [string] $RemoteDir,
  [Parameter(Mandatory = $true)] [string] $LocalDir
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

$remote = & ssh $Server "ls -1 $RemoteDir/pothgula-*.dump"
if ($LASTEXITCODE -ne 0) { throw "Could not list the backups on $Server" }

$copied = 0
foreach ($path in $remote) {
  $name = Split-Path $path -Leaf
  $target = Join-Path $LocalDir $name
  if (Test-Path $target) { continue }
  & scp "${Server}:$path" "$target.part"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $name" }
  Move-Item "$target.part" $target
  $copied++
  Write-Output "Copied $name"
}
# FR-LOG-11: the activity log archive files kept beside the backups.
$archiveDir = Join-Path $LocalDir 'log-archive'
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
$archives = & ssh $Server "ls -1 $RemoteDir/log-archive/activity-log-* 2>/dev/null"
foreach ($path in $archives) {
  $name = Split-Path $path -Leaf
  $target = Join-Path $archiveDir $name
  if (Test-Path $target) { continue }
  & scp "${Server}:$path" "$target.part"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy $name" }
  Move-Item "$target.part" $target
  Write-Output "Copied log-archive/$name"
}

$newest = Get-ChildItem $LocalDir -Filter 'pothgula-*.dump' | Sort-Object Name | Select-Object -Last 1
Write-Output "$copied new backup(s). Newest here: $($newest.Name)"
