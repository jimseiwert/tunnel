# Conduit CLI installer for Windows (PowerShell)
# Usage: irm https://get.conduitrelay.com/conduit/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "jimseiwert/conduit"
$Binary = "conduit"
$InstallDir = "$env:LOCALAPPDATA\Programs\conduit"

# Get latest release
Write-Host "Fetching latest release..."
$Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$Tag = $Release.tag_name

$Url = "https://github.com/$Repo/releases/download/$Tag/$Binary-windows-x64.exe"
$TmpPath = "$env:TEMP\$Binary.exe"

Write-Host "Downloading $Binary $Tag for Windows x64..."
Invoke-WebRequest -Uri $Url -OutFile $TmpPath -UseBasicParsing

# Verify SHA256 against the published SHA256SUMS
$SumsUrl = "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS"
Write-Host "Verifying checksum..."
$Sums = (Invoke-WebRequest -UseBasicParsing -Uri $SumsUrl).Content
$AssetName = "$Binary-windows-x64.exe"
$Expected = ($Sums -split "`n" | Where-Object { $_ -match [regex]::Escape($AssetName) + '$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (-not $Expected) { Write-Error "No checksum for $AssetName in SHA256SUMS"; exit 1 }
$Actual = (Get-FileHash -Algorithm SHA256 -Path $TmpPath).Hash.ToLower()
if ($Expected.ToLower() -ne $Actual) { Remove-Item $TmpPath -Force; Write-Error "Checksum mismatch for $AssetName"; exit 1 }

# Create install dir
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

Move-Item -Force $TmpPath "$InstallDir\$Binary.exe"

# Add to PATH if not already present
$CurrentPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
  [System.Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to PATH"
}

Write-Host ""
Write-Host "Conduit CLI installed successfully!"
Write-Host "Restart your terminal, then run: conduit --help"
