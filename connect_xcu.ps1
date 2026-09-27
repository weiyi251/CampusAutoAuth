param([switch]$Force, [string]$Portal)

[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }

$ErrorActionPreference = 'Continue'
$ssid = "XCU"
if ($PSScriptRoot) { $baseDir = $PSScriptRoot }
else { $baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $baseDir -or -not (Test-Path $baseDir)) { $baseDir = "$env:LOCALAPPDATA\connect_xcu" }
# Credentials are read from creds.json (saved by GUI); no built-in account here
$username = ""
$password = ""
$logFile = "$env:TEMP\xcu_connect.log"
$cfgFile = "$baseDir\enabled.cfg"
$credFile = "$baseDir\creds.json"
$portalUrl = $null

function Write-Log($msg){
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}
Write-Log "=== XCU auto-connect start ==="

if (Test-Path $credFile) {
    try {
        $raw = [System.IO.File]::ReadAllText($credFile, [System.Text.Encoding]::UTF8)
        $cred = $raw | ConvertFrom-Json
        if ($cred.username) { $username = [string]$cred.username }
        if ($cred.password) { $password = [string]$cred.password }
        if ($cred.portal) { $portalUrl = [string]$cred.portal }
        Write-Log "Credentials loaded from creds.json"
    } catch { Write-Log "Failed to read creds.json" }
} else {
    Write-Log "creds.json not found"
}

# Exit without any network action when credentials are missing (set them in GUI first)
if (-not $username -or -not $password) {
    Write-Log "Missing credentials: set account/password in GUI first (saved to creds.json)"
    exit 1
}

if (-not $Force) {
    $enabled = "1"
    if (Test-Path $cfgFile) { $enabled = (Get-Content $cfgFile -Raw).Trim() }
    if ($enabled -ne "1") {
        Write-Log "Auto-connect DISABLED by config; exiting without action"
        exit 0
    }
}

$iface = netsh wlan show interfaces | Out-String
if ($iface -notmatch "SSID\s+:\s+$ssid") {
    Write-Log "Not connected to $ssid, connecting"
    netsh wlan connect name="$ssid" | Out-String | ForEach-Object { Write-Log $_ }
    Start-Sleep -Seconds 10
} else {
    Write-Log "Already connected to $ssid"
}

function Test-Connectivity {
    try {
        $r = Invoke-WebRequest -Uri "http://www.msftconnecttest.com/connecttest.txt" -UseBasicParsing -TimeoutSec 12
        return ($r.StatusCode -eq 200 -and $r.Content -match "Microsoft Connect Test")
    } catch { return $false }
}

if (Test-Connectivity) { Write-Log "Already online, no auth needed"; exit 0 }
Write-Log "Not online, locating portal"

$customPortal = if ($Portal) { $Portal } elseif ($portalUrl) { $portalUrl } else { $null }
$portalHtml = $null
$portalBase = $null
try {
    if ($customPortal) {
        Write-Log "Using custom portal: $customPortal"
        $r = Invoke-WebRequest -Uri $customPortal -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 5
    } else {
        $r = Invoke-WebRequest -Uri "http://www.baidu.com" -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 5
    }
    $portalHtml = $r.Content
    $portalBase = $r.BaseResponse.ResponseUri.AbsoluteUri
    Write-Log "Portal: $portalBase"
    $portalHtml | Out-File "$env:TEMP\xcu_portal.html" -Encoding utf8
} catch { Write-Log "Failed to get portal: $_" }

if (-not $portalHtml) {
    Write-Log "Cannot get portal, open browser for manual login"
    Start-Process $(if ($customPortal) { $customPortal } else { "http://www.baidu.com" })
    exit 1
}

$action = ""
if ($portalHtml -match "(?is)<form[^>]*action\s*=\s*[""']([^""']+)") { $action = $matches[1] }
if ($action -and $action -notmatch "^https?://") {
    $u = [Uri]::new($portalBase)
    if ($action.StartsWith("/")) { $action = "$($u.Scheme)://$($u.Host)$action" }
    else { $action = "$($u.Scheme)://$($u.Host)/$action" }
} elseif (-not $action) { $action = $portalBase }
Write-Log "Submit URL: $action"

$fields = @{}
foreach ($m in [regex]::Matches($portalHtml, "(?is)<input[^>]*type\s*=\s*[""']hidden[""'][^>]*>")) {
    $inp = $m.Value
    $n = if ($inp -match "(?is)name\s*=\s*[""']([^""']+)") { $matches[1] } else { $null }
    $v = if ($inp -match "(?is)value\s*=\s*[""']([^""']*)") { $matches[1] } else { "" }
    if ($n) { $fields[$n] = $v }
}
$userField = $null; $passField = $null
foreach ($m in [regex]::Matches($portalHtml, "(?is)<input[^>]*name\s*=\s*[""']([^""']+)")) {
    $name = $matches[1]
    if ($name -match "(?i)user|name|account|uname|login") { $userField = $name }
    if ($name -match "(?i)pass|pwd") { $passField = $name }
}
if ($userField) { $fields[$userField] = $username }
if ($passField) { $fields[$passField] = $password }
Write-Log "userField=$userField passField=$passField"

if ($username -eq "REPLACE_USERNAME" -or $password -eq "REPLACE_PASSWORD") {
    Write-Log "Credentials not configured, open browser for manual login"
    Start-Process $portalBase
    exit 1
}

if ($userField -and $passField) {
    try {
        $body = @{}
        foreach ($k in $fields.Keys) { $body[$k] = $fields[$k] }
        $resp = Invoke-WebRequest -Uri $action -Method Post -Body $body -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 5 -SessionVariable sess
        Write-Log "Login submitted, status $($resp.StatusCode)"
        Start-Sleep -Seconds 5
        if (Test-Connectivity) { Write-Log "Auth success, online"; exit 0 }
        else { Write-Log "Still offline after auth" }
    } catch { Write-Log "Login POST failed: $_" }
} else { Write-Log "Cannot identify login fields" }

Write-Log "Auto login failed, open browser for manual"
Start-Process $portalBase
exit 1
