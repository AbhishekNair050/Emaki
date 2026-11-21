param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$scratch = Join-Path $env:RUNNER_TEMP ('emaki-studio-smoke-' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $scratch 'emaki-studio'
New-Item -ItemType Directory -Path $scratch | Out-Null

# NSIS requires /D= to come last, with an unquoted path even when it contains spaces.
$setup = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installDir" -WindowStyle Hidden -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Installation failed with exit code $($setup.ExitCode)." }
$exe = Join-Path $installDir 'Emaki Studio.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Studio was not installed at $exe." }

$env:EMAKI_LAUNCHER_STATE = Join-Path $scratch 'launcher.json'
$base = 'http://127.0.0.1:5185/__launcher'
$studio = Start-Process -FilePath $exe -WorkingDirectory $installDir -WindowStyle Hidden -PassThru

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($studio.HasExited) { throw "Studio exited with code $($studio.ExitCode) before starting the launcher." }
        try {
            Invoke-RestMethod "$base/state" -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) { throw 'The installed Studio did not start its launcher.' }

    $project = Invoke-RestMethod "$base/example" -Method Post -ContentType 'application/json' -Body '{}'
    $request = @{ path = $project.path; target = 'web' } | ConvertTo-Json -Compress
    $job = Invoke-RestMethod "$base/export" -Method Post -ContentType 'application/json' -Body $request
    for ($attempt = 0; $job.status -eq 'running' -and $attempt -lt 90; $attempt++) {
        Start-Sleep -Seconds 1
        $state = Invoke-RestMethod "$base/state" -TimeoutSec 5
        $job = $state.jobs | Where-Object id -eq $job.id
        if (-not $job) { throw 'The export job disappeared.' }
    }
    if ($job.status -ne 'done') { throw "Studio web export ended in '$($job.status)'. Logs:`n$($job.log)" }
    if (-not (Test-Path -LiteralPath (Join-Path $job.output 'index.html') -PathType Leaf)) {
        throw 'The web export has no index.html.'
    }
    Write-Host 'The installed Studio opened Gullwing and exported it for the web.'
} finally {
    if (-not $studio.HasExited) { Stop-Process -Id $studio.Id }
    Remove-Item Env:EMAKI_LAUNCHER_STATE
}
