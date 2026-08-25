$ErrorActionPreference = 'Stop'

$repository = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $repository 'dist\TikTools.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Missing $executable. Run bun run build:exe first."
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('TikTools-compiled-smoke-' + [guid]::NewGuid().ToString('N'))
$appHome = Join-Path $root 'appdata'
$workingDirectory = Join-Path $root 'working-directory'
$pluginDirectory = Join-Path $appHome 'plugins\compiled-smoke'
$pluginId = 'dev.tiktools.compiled-smoke'
$logPath = Join-Path $appHome 'logs\TikTools.log'

New-Item -ItemType Directory -Path $pluginDirectory,$workingDirectory -Force | Out-Null

$manifest = [ordered]@{
  manifestVersion = 1
  id = $pluginId
  name = 'Compiled worker smoke test'
  version = '1.0.0'
  apiVersion = 1
  executionMode = 'sandbox'
  entry = 'index.js'
  permissions = [ordered]@{ capabilities = @() }
} | ConvertTo-Json -Compress
$source = @'
import { registerNode } from '@tiktools/sdk';
registerNode({
  definition: {
    type: 'compiled.smoke.node',
    version: 1,
    title: 'Compiled smoke node',
    category: 'Tests',
    kind: 'transform',
    inputs: [],
    outputs: [],
    configSchema: {}
  },
  handler: 'return { outputs: { ok: true } };'
});
'@

[System.IO.File]::WriteAllText((Join-Path $pluginDirectory 'plugin.json'), $manifest)
[System.IO.File]::WriteAllText((Join-Path $pluginDirectory 'index.js'), $source)

$oldHome = $env:TIKTOOLS_HOME
$oldPath = $env:PATH
$env:TIKTOOLS_HOME = $appHome
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
$process = $null
$passed = $false

try {
  $process = Start-Process -FilePath $executable -WorkingDirectory $workingDirectory -PassThru
  $deadline = (Get-Date).AddSeconds(20)
  $loaded = $false

  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "TikTools.exe exited with code $($process.ExitCode) before the compiled smoke test completed."
    }

    if (Test-Path -LiteralPath $logPath) {
      $log = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
      if ($log.Contains("[automation-plugins] loaded $pluginId@1.0.0")) {
        $loaded = $true
        break
      }
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $loaded) {
    throw "Compiled plugin worker did not load the fixture. See $logPath"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $appHome 'data\tiktok-points.db') -PathType Leaf)) {
    throw 'Compiled app did not initialize the points database.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $appHome 'data\tiktok-automation.db') -PathType Leaf)) {
    throw 'Compiled app did not initialize the automation database.'
  }
  if (Test-Path -LiteralPath (Join-Path $workingDirectory 'data')) {
    throw 'Compiled app wrote data under its working directory.'
  }

  $passed = $true
  Write-Output 'Compiled TikTools.exe smoke test passed.'
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
  }

  $env:PATH = $oldPath
  if ($null -eq $oldHome) {
    Remove-Item Env:TIKTOOLS_HOME -ErrorAction SilentlyContinue
  } else {
    $env:TIKTOOLS_HOME = $oldHome
  }

  if ($passed) {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Warning "Compiled smoke artifacts retained at $root"
  }
}
