# verify.ps1 - security configuration check for Claude Code (Module 3, HW 9).
# Windows equivalent of `make verify` from the course starter (no make on Windows).
#
# Usage:  .\verify.ps1
#
# NOTE: ASCII-only on purpose. PowerShell 5.1 reads .ps1 as ANSI, so Cyrillic
# without a BOM breaks the parser. Comments in Ukrainian live in the docs, not here.
#
# Checks all 4 protection layers:
#   1. Settings tier - three settings files in place
#   2. Permissions   - deny blocks secrets and destructive commands
#   3. Sandbox       - enabled, denyRead and allowedDomains filled
#   4. Devcontainer  - NET_ADMIN/NET_RAW present, firewall script valid
# Plus: whitelist sync between sandbox and firewall, .gitignore blocks secrets.

$ErrorActionPreference = "Stop"
$script:fails = 0
$script:checks = 0

function Test-Check {
    param([string]$Name, [bool]$Condition, [string]$Hint = "")
    $script:checks++
    if ($Condition) {
        Write-Host "  OK   " -ForegroundColor Green -NoNewline
        Write-Host $Name
    } else {
        Write-Host "  FAIL " -ForegroundColor Red -NoNewline
        Write-Host $Name
        if ($Hint) { Write-Host "       -> $Hint" -ForegroundColor DarkYellow }
        $script:fails++
    }
}

function Test-JsonFile {
    param([string]$Path)
    $script:checks++
    if (-not (Test-Path $Path)) {
        Write-Host "  FAIL " -ForegroundColor Red -NoNewline
        Write-Host "$Path - file missing"
        $script:fails++
        return $null
    }
    try {
        $obj = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "  OK   " -ForegroundColor Green -NoNewline
        Write-Host "$Path - valid JSON"
        return $obj
    } catch {
        Write-Host "  FAIL " -ForegroundColor Red -NoNewline
        Write-Host "$Path - broken JSON"
        $script:fails++
        return $null
    }
}

Write-Host ""
Write-Host "=== Layer 1: Settings tier ===" -ForegroundColor Cyan

$project = Test-JsonFile ".claude\settings.json"
$null    = Test-JsonFile ".claude\settings.local.json"
$null    = Test-JsonFile ".claude\settings.local.json.example"

Test-Check "User tier exists (~\.claude\settings.json)" (Test-Path "$HOME\.claude\settings.json") "Copy _setup\user-settings.json to $HOME\.claude\settings.json"

Write-Host ""
Write-Host "=== Layer 2: Permissions ===" -ForegroundColor Cyan

if ($project) {
    $deny  = @($project.permissions.deny)
    $allow = @($project.permissions.allow)

    Test-Check "deny blocks Read(.env)" ($deny -contains "Read(.env)")
    Test-Check "deny blocks rm -rf" ($deny -contains "Bash(rm -rf *)")
    Test-Check "deny blocks sudo" ($deny -contains "Bash(sudo *)")
    Test-Check "deny blocks git push --force" ($deny -contains "Bash(git push --force *)")
    Test-Check "deny blocks keys (*.pem / *.key)" (($deny -contains "Read(**/*.pem)") -and ($deny -contains "Read(**/*.key)"))
    Test-Check "deny blocks ~/.ssh" ($deny -contains "Read(~/.ssh/**)")
    Test-Check "allow list not empty ($($allow.Count) rules)" ($allow.Count -gt 0)
    Test-Check "defaultMode is not bypassPermissions" ($project.permissions.defaultMode -ne "bypassPermissions") "bypassPermissions disables all protection"
}

Write-Host ""
Write-Host "=== Layer 3: Sandbox ===" -ForegroundColor Cyan

if ($project) {
    Test-Check "sandbox.enabled = true" ($project.sandbox.enabled -eq $true)
    Test-Check "filesystem.denyRead not empty" (@($project.sandbox.filesystem.denyRead).Count -gt 0)
    Test-Check "network.allowedDomains not empty" (@($project.sandbox.network.allowedDomains).Count -gt 0)
    Test-Check "env: bash timeout is set" ($null -ne $project.env.BASH_DEFAULT_TIMEOUT_MS)
    Test-Check "env: subprocess secret scrub enabled" ($project.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB -eq "1")
}

Write-Host ""
Write-Host "=== Layer 4: Devcontainer + Docker ===" -ForegroundColor Cyan

$dev = Test-JsonFile ".devcontainer\devcontainer.json"

if ($dev) {
    $runArgs = @($dev.runArgs)
    Test-Check "runArgs has --cap-add=NET_ADMIN" ($runArgs -contains "--cap-add=NET_ADMIN") "without it iptables cannot start in the container"
    Test-Check "runArgs has --cap-add=NET_RAW" ($runArgs -contains "--cap-add=NET_RAW")
    Test-Check "postStartCommand starts firewall" ($dev.postStartCommand -like "*init-firewall.sh*")
}

Test-Check "Dockerfile exists" (Test-Path ".devcontainer\Dockerfile")
Test-Check "init-firewall.sh exists" (Test-Path ".devcontainer\init-firewall.sh")
Test-Check "docker-compose.yml exists" (Test-Path "docker-compose.yml")

if (Test-Path ".devcontainer\Dockerfile") {
    $dockerfile = Get-Content ".devcontainer\Dockerfile" -Raw
    Test-Check "Dockerfile installs iptables" ($dockerfile -match "iptables")
    Test-Check "Dockerfile installs ipset" ($dockerfile -match "ipset")
}

if (Test-Path "docker-compose.yml") {
    $compose = Get-Content "docker-compose.yml" -Raw
    Test-Check "docker-compose has cap_add NET_ADMIN" ($compose -match "NET_ADMIN")
    Test-Check "docker-compose starts firewall on boot" ($compose -match "init-firewall\.sh")
}

if (Test-Path ".devcontainer\init-firewall.sh") {
    $fw = Get-Content ".devcontainer\init-firewall.sh" -Raw
    Test-Check "firewall: default-deny on OUTPUT" ($fw -match "iptables -P OUTPUT DROP")
    Test-Check "firewall: default-deny on IPv6" ($fw -match "ip6tables -P OUTPUT DROP")
    Test-Check "firewall: has self-validation" ($fw -match "self-validation")
    $hasCrlf = $fw -match "`r`n"
    Test-Check "firewall: LF line endings (not CRLF)" (-not $hasCrlf) "CRLF breaks the script inside a Linux container; check .gitattributes"
}

Write-Host ""
Write-Host "=== Whitelist sync (sandbox vs firewall) ===" -ForegroundColor Cyan

if ($project -and (Test-Path ".devcontainer\init-firewall.sh")) {
    $sandboxDomains = @($project.sandbox.network.allowedDomains)
    $fwText = Get-Content ".devcontainer\init-firewall.sh" -Raw
    $missing = @()
    foreach ($d in $sandboxDomains) {
        if ($fwText -notmatch [regex]::Escape($d)) { $missing += $d }
    }
    $joined = $missing -join ", "
    Test-Check "all sandbox domains present in firewall ($($sandboxDomains.Count) total)" ($missing.Count -eq 0) "missing in firewall: $joined"
}

Write-Host ""
Write-Host "=== Secrets stay out of git ===" -ForegroundColor Cyan

if (Test-Path ".gitignore") {
    $gi = Get-Content ".gitignore" -Raw
    Test-Check ".gitignore hides .env" ($gi -match "(?m)^\.env\s*$")
    Test-Check ".gitignore hides settings.local.json" ($gi -match "settings\.local\.json")
} else {
    Test-Check ".gitignore exists" $false
}

Test-Check ".env.example exists (template without secrets)" (Test-Path ".env.example")

$envTracked = $false
try {
    git ls-files --error-unmatch .env 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $envTracked = $true }
} catch { $envTracked = $false }
Test-Check "real .env is NOT tracked by git" (-not $envTracked) "if .env is in git - remove it and rotate the keys"

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
if ($script:fails -eq 0) {
    Write-Host " PASSED: $($script:checks) checks" -ForegroundColor Green
} else {
    Write-Host " FAILED: $($script:fails) of $($script:checks)" -ForegroundColor Red
}
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

if ($script:fails -gt 0) { exit 1 }
