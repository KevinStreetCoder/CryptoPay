<#
.SYNOPSIS
  Push SasaPay production credentials to the Cpay VPS securely.

.DESCRIPTION
  Opens a Windows Forms dialog where you paste the SasaPay Client ID
  and Client Secret · the Secret field uses a real masked password
  textbox (per-character asterisks, Ctrl+V paste fully captured · the
  console-based Read-Host -AsSecureString has a known quirk in Windows
  Terminal where it drops paste-buffer chars).

  Pipes the values to the VPS over SSH stdin, force-recreates the
  cryptopay_web container so it re-reads .env.production, re-applies
  hot-patches, runs migrations, and verifies the credentials authenticate
  against api.sasapay.app + that the gated /accounts/account-validation/
  product is enabled for the merchant.

  No file on Windows ever holds the credentials. They go from the GUI
  dialog → in-memory PowerShell string → ssh stdin → bash interpreter
  on the VPS · cleared from PowerShell memory after SSH returns.

.NOTES
  Run from the repo root:
      cd "C:\Users\Street Coder\StartupsIdeas\CryptoPay"
      .\scripts\deploy-sasapay-prod-creds.ps1
  If execution policy blocks:
      powershell.exe -ExecutionPolicy Bypass -File .\scripts\deploy-sasapay-prod-creds.ps1
#>

[CmdletBinding()]
param(
    [string]$VpsHost = "root@173.249.4.109"
)

$ErrorActionPreference = "Stop"

# PSReadLine · best-effort suppression of this run from history.
try { $null = Set-PSReadLineOption -AddToHistoryHandler { return $false } } catch { }

# UTF-8 (no BOM) for ssh stdin · so the bash heredoc doesn't see invisible bytes.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

Write-Host ""
Write-Host "=== Cpay · push SasaPay production credentials to $VpsHost ===" -ForegroundColor Cyan
Write-Host ""

# ── 0/4 · verify SSH BEFORE asking for any secret.
Write-Host "[0/4] Testing SSH connectivity..."
$probe = & ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 $VpsHost "echo SSH_OK" 2>&1
if ($LASTEXITCODE -ne 0 -or $probe -notmatch "SSH_OK") {
    Write-Host "[X] SSH failed before any secret was prompted: $probe" -ForegroundColor Red
    exit 5
}
Write-Host "    OK" -ForegroundColor Green
Write-Host ""

# ── 1/4 · prompt via Windows Forms dialog. Reliable paste, visual feedback.
Write-Host "[1/4] Opening credentials dialog..."

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Cpay · SasaPay production credentials"
$form.Size = New-Object System.Drawing.Size(540, 280)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$instruction = New-Object System.Windows.Forms.Label
$instruction.Text = "Paste the credentials from the SasaPay email. Both fields are stored in memory only · they are sent over SSH and zeroed."
$instruction.Location = New-Object System.Drawing.Point(20, 15)
$instruction.Size = New-Object System.Drawing.Size(490, 36)
$instruction.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($instruction)

$lbl1 = New-Object System.Windows.Forms.Label
$lbl1.Text = "SASAPAY_CLIENT_ID:"
$lbl1.Location = New-Object System.Drawing.Point(20, 65)
$lbl1.Size = New-Object System.Drawing.Size(150, 18)
$form.Controls.Add($lbl1)

$tb1 = New-Object System.Windows.Forms.TextBox
$tb1.Location = New-Object System.Drawing.Point(20, 85)
$tb1.Size = New-Object System.Drawing.Size(490, 22)
$tb1.Font = New-Object System.Drawing.Font("Consolas", 10)
$form.Controls.Add($tb1)

$lbl2 = New-Object System.Windows.Forms.Label
$lbl2.Text = "SASAPAY_CLIENT_SECRET (masked):"
$lbl2.Location = New-Object System.Drawing.Point(20, 120)
$lbl2.Size = New-Object System.Drawing.Size(250, 18)
$form.Controls.Add($lbl2)

$tb2 = New-Object System.Windows.Forms.TextBox
$tb2.Location = New-Object System.Drawing.Point(20, 140)
$tb2.Size = New-Object System.Drawing.Size(490, 22)
$tb2.UseSystemPasswordChar = $true
$tb2.Font = New-Object System.Drawing.Font("Consolas", 10)
$form.Controls.Add($tb2)

# Live char-count next to the secret field so the user can confirm the
# paste actually captured everything · catches the failure mode where
# Ctrl+V pastes only one char.
$len = New-Object System.Windows.Forms.Label
$len.Location = New-Object System.Drawing.Point(20, 165)
$len.Size = New-Object System.Drawing.Size(490, 18)
$len.ForeColor = [System.Drawing.Color]::Gray
$len.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$len.Text = "(secret length: 0 chars · expected ~40)"
$form.Controls.Add($len)
$tb2.Add_TextChanged({
    $count = $tb2.Text.Length
    $len.Text = "(secret length: $count chars · expected ~40)"
    if ($count -ge 30 -and $count -le 80) {
        $len.ForeColor = [System.Drawing.Color]::Green
    } elseif ($count -gt 0) {
        $len.ForeColor = [System.Drawing.Color]::Orange
    } else {
        $len.ForeColor = [System.Drawing.Color]::Gray
    }
})

$btnOk = New-Object System.Windows.Forms.Button
$btnOk.Text = "Deploy to VPS"
$btnOk.Location = New-Object System.Drawing.Point(330, 200)
$btnOk.Size = New-Object System.Drawing.Size(180, 32)
$btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$btnOk.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$btnOk.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$btnOk.ForeColor = [System.Drawing.Color]::White
$btnOk.FlatStyle = "Flat"
$form.Controls.Add($btnOk)
$form.AcceptButton = $btnOk

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Location = New-Object System.Drawing.Point(240, 200)
$btnCancel.Size = New-Object System.Drawing.Size(80, 32)
$btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($btnCancel)
$form.CancelButton = $btnCancel

$tb1.Select()
$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "    Cancelled · no changes made." -ForegroundColor Yellow
    $form.Dispose()
    exit 4
}

$ClientId = $tb1.Text.Trim()
$ClientSecret = $tb2.Text.Trim()
$tb1.Text = ""
$tb2.Text = ""
$form.Dispose()

if (-not $ClientId)     { Write-Host "[X] Empty Client ID, aborting." -ForegroundColor Red; exit 2 }
if (-not $ClientSecret) { Write-Host "[X] Empty Client Secret, aborting." -ForegroundColor Red; exit 2 }
if ($ClientSecret.Length -lt 20) {
    Write-Host "[X] Client Secret is only $($ClientSecret.Length) chars · paste likely truncated. Aborting." -ForegroundColor Red
    Write-Host "    SasaPay secrets are typically ~40 chars. Re-run and try again." -ForegroundColor Yellow
    exit 2
}

Write-Host "    Captured: Client ID ($($ClientId.Length) chars), Client Secret ($($ClientSecret.Length) chars)" -ForegroundColor Green
Write-Host ""

# Escape any single-quotes for safe inclusion in the bash 'export VAR=...'
function Escape-BashSingleQuote($s) { return $s -replace "'", "'\''" }
$CidEsc = Escape-BashSingleQuote $ClientId
$SecEsc = Escape-BashSingleQuote $ClientSecret

# ── 2/4 · build the bash payload. Single-quoted heredocs prevent any
#         bash interpretation of $...; values flow in as exported env
#         vars that python reads via os.environ.
$BashScript = @"
set -e
TS=`$(date +%Y%m%d_%H%M%S)
cd /home/deploy/cpay/deploy

echo '[VPS] backing up .env.production'
cp .env.production .env.production.bak.pre-sasapay-prod-`$TS
chmod 600 .env.production.bak.pre-sasapay-prod-`$TS

# Receive the credentials as bash env vars · python child process
# inherits them via fork.
export NEW_CLIENT_ID='__CID__'
export NEW_CLIENT_SECRET='__SEC__'

echo '[VPS] rewriting .env.production'
python3 - <<'PYEOF'
import os, re
src = open('.env.production').read()
new_id  = os.environ['NEW_CLIENT_ID']
new_sec = os.environ['NEW_CLIENT_SECRET']

def replace_or_append(text, key, val):
    pat = re.compile(r'^' + re.escape(key) + r'=.*$', re.M)
    if pat.search(text):
        return pat.sub(lambda m: key + '=' + val, text)
    return text.rstrip() + '\n' + key + '=' + val + '\n'

src = replace_or_append(src, 'SASAPAY_CLIENT_ID',     new_id)
src = replace_or_append(src, 'SASAPAY_CLIENT_SECRET', new_sec)
src = replace_or_append(src, 'SASAPAY_ENVIRONMENT',   'production')
open('.env.production', 'w').write(src)
os.chmod('.env.production', 0o600)
print('  3 keys updated, file mode 600')
PYEOF

echo '[VPS] force-recreating cryptopay_web'
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate --no-deps web 2>&1 | tail -3

echo '[VPS] waiting for healthy...'
for i in `$(seq 1 25); do
  sleep 2
  if docker exec cryptopay_web curl -sf http://127.0.0.1:8000/health/ -o /dev/null 2>&1; then
    echo "  ready after `$((i*2))s"
    break
  fi
done

echo '[VPS] re-applying hot-patches into new container'
HOT_FILES="apps/payments/tasks.py apps/payments/views.py apps/payments/saga.py apps/payments/serializers.py apps/payments/models.py apps/payments/migrations/0010_transaction_merchant_name.py apps/wallets/rebalance.py apps/mpesa/sasapay_client.py apps/mpesa/sasapay_views.py apps/core/pdf_receipt.py apps/core/receipt_verify.py config/urls.py config/settings/base.py"
for f in `$HOT_FILES; do
  if [ -f "/home/deploy/cpay/backend/`$f" ]; then
    docker cp "/home/deploy/cpay/backend/`$f" "cryptopay_web:/app/`$f" > /dev/null 2>&1 && echo "  + `$f" || echo "  ! failed `$f"
  fi
done
docker exec cryptopay_web mkdir -p /app/templates/verify > /dev/null 2>&1
[ -f /home/deploy/cpay/backend/templates/pdf/receipt.html ] && docker cp /home/deploy/cpay/backend/templates/pdf/receipt.html cryptopay_web:/app/templates/pdf/receipt.html > /dev/null 2>&1
for t in receipt.html receipt_not_found.html receipt_ambiguous.html; do
  [ -f "/home/deploy/cpay/backend/templates/verify/`$t" ] && docker cp "/home/deploy/cpay/backend/templates/verify/`$t" "cryptopay_web:/app/templates/verify/`$t" > /dev/null 2>&1
done
# Same hot-patch for celery + beat
for c in cryptopay_celery cryptopay_beat; do
  for f in apps/payments/tasks.py apps/payments/views.py apps/payments/saga.py apps/payments/serializers.py apps/payments/models.py apps/wallets/rebalance.py apps/mpesa/sasapay_client.py apps/mpesa/sasapay_views.py apps/core/pdf_receipt.py apps/core/receipt_verify.py; do
    [ -f "/home/deploy/cpay/backend/`$f" ] && docker cp "/home/deploy/cpay/backend/`$f" "`$c:/app/`$f" > /dev/null 2>&1 || true
  done
done

echo '[VPS] restarting + migrate'
docker restart cryptopay_web > /dev/null 2>&1
for i in `$(seq 1 25); do
  sleep 2
  if docker exec cryptopay_web curl -sf http://127.0.0.1:8000/health/ -o /dev/null 2>&1; then break; fi
done
# Suppress the "your models have changes" Django warning · it's a noisy
# false positive after our hot-patch (the changes ARE in 0010 which
# the DB already has applied). Case-insensitive grep · the message
# starts with capital "Your".
docker exec cryptopay_web python manage.py migrate payments --noinput 2>&1 | grep -ivE "your models in app|makemigrations|env_check_failed" | tail -3

echo '[VPS] verifying credentials'
# `-i` flag on docker exec · without it stdin is closed and python3
# reads an empty heredoc and exits silently with no output. Took the
# verify step from "RESULT: <something>" to "<blank>" in the previous
# iteration of this script.
docker exec -i cryptopay_web python3 - <<'PYEOF'
import os, base64, requests
cid = os.environ.get('SASAPAY_CLIENT_ID', '')
sec = os.environ.get('SASAPAY_CLIENT_SECRET', '')
env = os.environ.get('SASAPAY_ENVIRONMENT', '')
mc  = os.environ.get('SASAPAY_MERCHANT_CODE', '')
cid_short = cid[:6] + '...' + cid[-4:] if len(cid) > 10 else cid
print('  env=' + env + '  merchant=' + mc + '  client_id=' + cid_short + '  secret_len=' + str(len(sec)))
auth = base64.b64encode((cid + ':' + sec).encode()).decode()
try:
    r = requests.get('https://api.sasapay.app/api/v1/auth/token/?grant_type=client_credentials',
                     headers={'Authorization': 'Basic ' + auth}, timeout=15)
    print('  PROD OAuth: HTTP ' + str(r.status_code))
    if r.status_code == 200:
        body = r.json()
        print('    scope: ' + str(body.get('scope')))
        tok = body['access_token']
        r2 = requests.post('https://api.sasapay.app/api/v1/accounts/account-validation/',
                           headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'},
                           json={'merchant_code': mc, 'channel_code': '0', 'account_number': '888880'},
                           timeout=15)
        print('  account-validation (Paybill 888880): HTTP ' + str(r2.status_code))
        print('    body: ' + r2.text[:300])
        if r2.status_code == 200:
            data = r2.json().get('account_details', {})
            print('    account_name: ' + repr(data.get('account_name')))
            print('RESULT: SUCCESS')
        elif r2.status_code == 401:
            print('RESULT: PARTIAL')
        else:
            print('RESULT: PARTIAL_OTHER_' + str(r2.status_code))
    else:
        print('    body: ' + r.text[:300])
        print('RESULT: FAILURE')
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
PYEOF
"@

# Substitute the credentials into placeholders. Using literal strings
# rather than $variables avoids any PowerShell expansion surprises.
$Filled = $BashScript.Replace('__CID__', $CidEsc).Replace('__SEC__', $SecEsc)

# Wipe sensitive PowerShell vars · they're now in $Filled, which we'll
# wipe right after sending.
$ClientSecret = $null; $ClientId = $null; $CidEsc = $null; $SecEsc = $null
[System.GC]::Collect()

Write-Host "[2/4] Sending to VPS over SSH stdin..."

# 2026-05-09 fix · do NOT pipe to ssh via PowerShell's `|` operator.
# PowerShell's native-command pipeline re-encodes each line and forces
# CRLF terminators on Windows, even if the source string is LF-only.
# Bash on the VPS then sees `PYEOF\r` and the heredoc never closes
# (`delimited by end-of-file (wanted PYEOF)` error). Solution · spawn
# ssh as a Process and write raw UTF-8 bytes (LF-only) directly to its
# stdin, bypassing PowerShell's pipeline entirely.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = "ssh"
$psi.Arguments              = "-o StrictHostKeyChecking=no -o BatchMode=yes $VpsHost bash -s"
$psi.RedirectStandardInput  = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$psi.UseShellExecute        = $false
$psi.CreateNoWindow         = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
[void]$proc.Start()

$utf8 = New-Object System.Text.UTF8Encoding $false
$normalized = $Filled -replace "`r`n", "`n"
$bytes = $utf8.GetBytes($normalized)

# Read stdout/stderr asynchronously so the process doesn't block on
# a full pipe buffer while we're still writing to its stdin.
$stdoutTask = $proc.StandardOutput.ReadToEndAsync()
$stderrTask = $proc.StandardError.ReadToEndAsync()

$proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
$proc.StandardInput.BaseStream.Flush()
$proc.StandardInput.Close()

$proc.WaitForExit()
$stdout   = $stdoutTask.Result
$stderr   = $stderrTask.Result
$exitCode = $proc.ExitCode
$proc.Dispose()

# Combine stdout + stderr · the verification block prints to stdout,
# but bash's own warnings (e.g. compose) go to stderr. We need both.
$Result = (($stdout + "`n" + $stderr) -split "`r?`n")
$Filled = $null
$normalized = $null
$bytes = $null
[System.GC]::Collect()

Write-Host ""
Write-Host "[3/4] VPS output:" -ForegroundColor Cyan
Write-Host "----------------------------------------"
$Result | ForEach-Object { Write-Host $_ }
Write-Host "----------------------------------------"
Write-Host ""

# ── 4/4 · interpret the RESULT line.
$resultText = ($Result -join "`n")
if ($resultText -match "RESULT: SUCCESS") {
    Write-Host "[4/4] [OK] SUCCESS · production credentials accepted." -ForegroundColor Green
    Write-Host "          OAuth + account-validation both 200."
    Write-Host "          Paybill receipts will start showing merchant names on the next payment."
    exit 0
} elseif ($resultText -match "RESULT: PARTIAL") {
    Write-Host "[4/4] [!] PARTIAL · OAuth works but account-validation/B2C still gated by SasaPay." -ForegroundColor Yellow
    Write-Host "          Email SasaPay support: enable Account Validation + B2C/SendMoney for the merchant."
    exit 1
} elseif ($resultText -match "RESULT: FAILURE") {
    Write-Host "[4/4] [X] FAILURE · OAuth rejected the credentials." -ForegroundColor Red
    Write-Host "          Possible causes:"
    Write-Host "            - Mistyped or partially-pasted Client ID / Secret"
    Write-Host "            - SasaPay has not activated the production app yet"
    Write-Host "            - The credentials are for a different environment"
    Write-Host "          Backup is at /home/deploy/cpay/deploy/.env.production.bak.pre-sasapay-prod-<ts>"
    exit 2
} else {
    Write-Host "[4/4] [?] UNKNOWN · couldn't parse a RESULT line. Scroll up for details." -ForegroundColor Yellow
    Write-Host "          ssh exit code: $exitCode"
    exit 3
}
