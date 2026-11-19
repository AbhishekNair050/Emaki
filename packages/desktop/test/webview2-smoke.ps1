# Run with Windows PowerShell 5.1 (STA). Exercise the shipped executable's
# form and pack in an isolated profile without enabling browser debugging.
param([Parameter(Mandatory)][string]$GameExe, [string]$LegacyProfile)
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $GameExe).Path
$app = Split-Path -Parent $exe
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('emaki-smoke-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($scratch)
$env:APPDATA = Join-Path $scratch 'roaming'
$env:LOCALAPPDATA = $scratch
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$coreLib = [Reflection.Assembly]::LoadFrom((Join-Path $app 'Microsoft.Web.WebView2.Core.dll'))
$formsLib = [Reflection.Assembly]::LoadFrom((Join-Path $app 'Microsoft.Web.WebView2.WinForms.dll'))
[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::SetLoaderDllFolderPath($app)
$assembly = [Reflection.Assembly]::LoadFrom($exe)
$packType = $assembly.GetType('Emaki.Pack', $true)
$playerType = $assembly.GetType('Emaki.Player', $true)
$bindings = [Reflection.BindingFlags]'NonPublic,Instance'
$key = New-Object byte[] 64
$stream = $assembly.GetManifestResourceStream('key')
try { if ($stream.Read($key, 0, 64) -ne 64) { throw 'Missing pack key' } } finally { $stream.Dispose() }
$reader = [IO.StreamReader]::new($assembly.GetManifestResourceStream('game.json'))
try { $meta = ConvertFrom-Json $reader.ReadToEnd() } finally { $reader.Dispose() }
if ($LegacyProfile) {
    $dest = Join-Path $env:APPDATA $meta[2]
    [void][IO.Directory]::CreateDirectory($dest)
    Copy-Item -LiteralPath $LegacyProfile -Destination (Join-Path $dest 'Local Storage') -Recurse
}

# What WebView2 did, printed when a step times out: a failure on a CI runner
# otherwise shows only a blank page.
$trace = [Collections.Generic.List[string]]::new()
function Note([string]$text) { $trace.Add(('{0:N1}s {1}' -f $script:started.Elapsed.TotalSeconds, $text)) }
$script:started = [Diagnostics.Stopwatch]::StartNew()
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
try { $runtime = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString() } catch { $runtime = "none ($($_.Exception.Message))" }
Note ("WebView2 runtime {0}; interactive {1}; elevated {2}; session {3}; temp {4}" -f $runtime, [Environment]::UserInteractive, $elevated, (Get-Process -Id $PID).SessionId, [IO.Path]::GetTempPath())

function Watch-View($view) {
    $view.add_CoreWebView2InitializationCompleted({
        param($s, $e)
        Note "initialized: success $($e.IsSuccess) $($e.InitializationException)"
        if (-not $e.IsSuccess) { return }
        $core = $s.CoreWebView2
        $core.add_NavigationStarting({ param($c, $a) Note "navigation starting: $($a.Uri)" })
        $core.add_NavigationCompleted({ param($c, $a) Note "navigation completed: success $($a.IsSuccess), $($a.WebErrorStatus), HTTP $($a.HttpStatusCode), at $($c.Source)" })
        $core.add_ProcessFailed({ param($c, $a) Note "process failed: $($a.ProcessFailedKind) $($a.Reason) exit $($a.ExitCode) $($a.ProcessDescription)" })
        $core.add_WebResourceRequested({ param($c, $a) Note "request: $($a.Request.Method) $($a.Request.Uri)" })
    })
}

function Wait-For($test, $description, $seconds = 30) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    do {
        [Windows.Forms.Application]::DoEvents()
        if (& $test) { return }
        Start-Sleep -Milliseconds 15
    } while ($clock.Elapsed.TotalSeconds -lt $seconds)
    $url = if ($view.CoreWebView2) { $view.CoreWebView2.Source } else { 'WebView2 did not initialize' }
    $failed = try { $playerType.GetField('failed', $bindings).GetValue($form) } catch { '?' }
    [Console]::Error.WriteLine("WebView2 trace (player failed: $failed; window open: $(-not $form.IsDisposed)):")
    foreach ($line in $trace) { [Console]::Error.WriteLine("  $line") }
    throw "Timed out waiting for $description ($url)"
}
function Js([string]$code) {
    $task = $view.CoreWebView2.ExecuteScriptAsync($code)
    Wait-For { $task.IsCompleted } 'JavaScript result'
    $task.GetAwaiter().GetResult()
}
function Check($actual, $expected, $name) {
    if ($actual -cne $expected) { throw "$name returned $actual (expected $expected)" }
}

try {
    foreach ($pass in 1,2) {
        $pack = $packType.GetConstructors($bindings)[0].Invoke(@([IO.Path]::Combine($app, 'game.emaki'), $key.PSObject.BaseObject))
        $form = $playerType.GetConstructors($bindings)[0].Invoke(@($pack, [IO.Path]::Combine($scratch, 'game'), [string]$meta[0], [string]$meta[1], [string]$meta[2], [int[]]@($meta[3..6] | ForEach-Object { [int]$_ })))
        try {
            $form.Opacity = 0
            $form.ShowInTaskbar = $false
            $view = $form.Controls[0]
            Watch-View $view
            $form.Show()
            # A fresh CI machine starts WebView2 cold: allow it a minute.
            Wait-For { $view.CoreWebView2 -and $view.CoreWebView2.Source -eq 'https://game.emaki.invalid/' } 'game navigation' 60
            Wait-For { (Js "!!document.querySelector('.title-menu button')") -eq 'true' } 'title menu'
            Check (Js 'emakiHost.platform') '"desktop"' 'host'
            if ($pass -eq 1) {
                if ($LegacyProfile) { Check (Js "localStorage.getItem('emaki:smoke:legacy')") '"from-electron"' 'imported save' }
                [void](Js "emakiHost.setFullscreen(true).then(v => window.fullResult=v); true")
                Wait-For { (Js 'window.fullResult') -eq 'true' } 'fullscreen'
                [void](Js "emakiHost.setFullscreen(false).then(v => window.fullResult=v); true")
                Wait-For { (Js 'window.fullResult') -eq 'false' } 'windowed mode'
                [void](Js "fetch('/audio/theme_forget_me_not.mp3',{headers:{Range:'bytes=262140-262150'}}).then(async r=>window.range=[r.status,r.headers.get('cache-control'),Array.from(new Uint8Array(await r.arrayBuffer()))])")
                Wait-For { (Js 'Array.isArray(window.range)') -eq 'true' } 'media range'
                $audio = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '../../../games/gullwing/assets/audio/theme_forget_me_not.mp3'))
                Check (Js 'window.range[0]') '206' 'partial response'
                Check (Js 'window.range[1]') '"no-store"' 'cache policy'
                Check (Js 'window.range[2]') ('[' + ($audio[262140..262150] -join ',') + ']') 'cross-chunk media bytes'
                [void](Js "fetch('/audio/theme_forget_me_not.mp3').then(r=>r.arrayBuffer()).then(b=>window.audioSize=b.byteLength)")
                Wait-For { (Js 'window.audioSize') -eq $audio.Length } 'whole audio response'
                [void](Js "document.querySelector('.title-menu button').click()")
                Wait-For { (Js "!document.querySelector('.textbox').hidden") -eq 'true' } 'dialogue'
                [void](Js "[...document.querySelectorAll('.quickmenu button')].find(b=>b.dataset.text==='ui.save').click()")
                [void](Js "document.querySelector('.slots button').click()")
                Check (Js "JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith(':slot0')))).block.label") '"arrival"' 'saved scene'
            } else {
                [void](Js "[...document.querySelectorAll('.title-menu button')].find(b=>b.textContent==='Load').click()")
                [void](Js "document.querySelector('.slots button').click()")
                Check (Js "!document.querySelector('.textbox').hidden") 'true' 'restored dialogue'
            }
            [void](Js 'setTimeout(()=>emakiHost.quit(),100); true')
            Wait-For { $form.IsDisposed } 'quit'
        } finally { $form.Dispose(); $pack.Dispose() }
    }
    $latin = [Text.Encoding]::GetEncoding(28591)
    $marker = $latin.GetString($audio, 65536, 256)
    foreach ($file in Get-ChildItem -LiteralPath $scratch -Recurse -File -Filter '*' | Where-Object FullName -Match '\\Cache_Data\\') {
        $data = $latin.GetString([IO.File]::ReadAllBytes($file.FullName))
        if ($data.IndexOf($marker, [StringComparison]::Ordinal) -ge 0) { throw 'Plaintext audio found in the HTTP disk cache.' }
    }
    # Launch the executable itself. WEBVIEW2_* variables must not reach the
    # browser (one would open a debugging port onto the decrypted game), and
    # the window must follow display scaling instead of being stretched.
    Add-Type -Namespace Emaki -Name Smoke -MemberDefinition @'
[DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr process, out int value);
'@
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9229'
    $game = Start-Process -FilePath $exe -PassThru
    try {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        do {
            Start-Sleep -Milliseconds 250
            $browsers = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($scratch) })
        } while ($browsers.Count -eq 0 -and $clock.Elapsed.TotalSeconds -lt 30)
        if ($browsers.Count -eq 0) { throw 'The exported game did not start WebView2.' }
        if ($browsers | Where-Object { $_.CommandLine -match 'remote-debugging' }) { throw 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS reached the exported game.' }
        $awareness = -1
        [void][Emaki.Smoke]::GetProcessDpiAwareness($game.Handle, [ref]$awareness)
        Check $awareness 2 'DPI awareness (2 = per monitor)'
    } finally {
        Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
        Stop-Process -Id $game.Id -Force -ErrorAction SilentlyContinue
        [void]$game.WaitForExit(10000)
    }
    'Packaged WebView2 player passed title, fullscreen, byte range, save, relaunch, load, quit, HTTP cache, environment and display scaling checks.'
} finally {
    $resolvedScratch = [IO.Path]::GetFullPath($scratch)
    if ([IO.Path]::GetDirectoryName($resolvedScratch) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($resolvedScratch) -match '^emaki-smoke-[a-f0-9]{32}$') {
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            try { Remove-Item -LiteralPath $resolvedScratch -Recurse -Force -ErrorAction Stop; break }
            catch { Start-Sleep -Milliseconds 250 }
        }
    }
}
