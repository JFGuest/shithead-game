$ErrorActionPreference = "Stop"

$gameDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }

function Get-LocalIPv4 {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object InterfaceMetric

  return ($addresses | Select-Object -First 1 -ExpandProperty IPAddress)
}

function Test-Server {
  param([int]$Port)
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-PortProcess {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $processId = $connection.OwningProcess
    if ($processId) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -match "node") {
        Write-Host "Restarting existing Node server on port $Port..."
        Stop-Process -Id $processId -Force
      }
    }
  }
}

Set-Location $gameDir

if (-not (Test-Path "$gameDir\node_modules")) {
  Write-Host "Installing game server packages..."
  npm install
}

if (Test-Server -Port $port) {
  Stop-PortProcess -Port $port
  Start-Sleep -Milliseconds 700
}

Write-Host "Starting Shithead server on port $port..."
Start-Process -FilePath "node.exe" -ArgumentList "server.js" -WorkingDirectory $gameDir -WindowStyle Hidden

$started = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Server -Port $port) {
    $started = $true
    break
  }
}

if (-not $started) {
  throw "The server did not start on port $port."
}

$ip = Get-LocalIPv4
$localUrl = "http://localhost:$port"
$phoneUrl = if ($ip) { "http://$ip`:$port" } else { $localUrl }

Write-Host ""
Write-Host "Shithead is ready." -ForegroundColor Green
Write-Host "PC:    $localUrl"
Write-Host "Phone: $phoneUrl"
Write-Host ""
Write-Host "Use the Phone URL on iPhones connected to the same Wi-Fi."
Write-Host "If the phone does not load, allow Node.js through Windows Firewall."
Write-Host ""

Start-Process $localUrl
