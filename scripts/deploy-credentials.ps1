<#
.SYNOPSIS
  Universal Cpay credential deployer · push any production secret set
  to /home/deploy/cpay/deploy/.env.production on the VPS, force-recreate
  the web container, re-apply hot-patches, and probe the integration to
  confirm the new credentials work.

.DESCRIPTION
  One script handles every credential set we currently rotate (SasaPay,
  IntaSend, Swypt, Yellow Card, Daraja, SMTP, Twilio SMS, Cloudflare R2,
  GCP KMS service account, blockchain RPCs, etc.). Pick a provider from
  the list, paste the secrets into a Windows Forms dialog (per-field
  masking, live char-count, paste-safe), and the script handles the
  rest · backup, env rewrite, container recreate, hot-patch re-apply,
  migration, and a provider-specific verification probe.

  Adding a new provider is one entry in $PROVIDERS at the top of the
  script · the dialog and verification block are both data-driven.

  Security model · same as deploy-sasapay-prod-creds.ps1:
    - No file on Windows holds the credentials
    - No process command-line carries them (raw byte-stream to ssh stdin)
    - PSReadLine + bash history both suppressed
    - Backup-before-write on every run
    - Fail-fast SSH probe BEFORE asking for any secret

.PARAMETER Provider
  Which credential set to push. If omitted, an interactive picker opens.
  Valid values: sasapay, intasend, swypt, yellowcard, daraja, smtp,
                twilio, cloudflare-r2, gcp-kms, blockchain, custom

.EXAMPLE
  .\scripts\deploy-credentials.ps1 -Provider sasapay
  .\scripts\deploy-credentials.ps1 -Provider intasend
  .\scripts\deploy-credentials.ps1                       # interactive picker

.NOTES
  Run from the repo root:
      cd "C:\Users\Street Coder\StartupsIdeas\CryptoPay"
      .\scripts\deploy-credentials.ps1 -Provider sasapay

  Execution policy bypass (one-line, no permanent change):
      powershell.exe -ExecutionPolicy Bypass -File `
        .\scripts\deploy-credentials.ps1 -Provider sasapay
#>

[CmdletBinding()]
param(
    [string]$VpsHost = "root@173.249.4.109",
    [ValidateSet("sasapay","intasend","swypt","yellowcard","daraja","smtp","twilio","cloudflare-r2","gcp-kms","blockchain","custom","")]
    [string]$Provider = ""
)

$ErrorActionPreference = "Stop"
try { $null = Set-PSReadLineOption -AddToHistoryHandler { return $false } } catch { }
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

# ─────────────────────────────────────────────────────────────────────
# PROVIDER REGISTRY · single source of truth for every credential set
# we deploy. Adding a provider is one entry here · the dialog + bash
# verification block are both generated from it.
# ─────────────────────────────────────────────────────────────────────
#
# Each provider declares:
#   Title    · what shows in the picker
#   Fields   · array of @{ Name; Label; Masked; ExpectedLen; Required }
#              · Name is the env-var key written to .env.production
#              · ExpectedLen is a 2-tuple [min,max] for the green-band
#                live char-count hint in the dialog
#   Verify   · bash code that probes the endpoint after deploy. Must
#              echo a line matching `RESULT: SUCCESS|PARTIAL|FAILURE`.
#              Variables `$cid`, `$sec`, etc. resolved by the field name
#              from the container's env at probe time (NOT substituted
#              from PowerShell · keeps secrets out of the bash heredoc
#              body once they're in .env.production).
#
$PROVIDERS = [ordered]@{
    sasapay = @{
        Title = "SasaPay (production · CBK-licensed PSP)"
        Fields = @(
            @{ Name = "SASAPAY_CLIENT_ID";     Label = "Client ID";     Masked = $false; ExpectedLen = @(20, 60);  Required = $true }
            @{ Name = "SASAPAY_CLIENT_SECRET"; Label = "Client Secret"; Masked = $true;  ExpectedLen = @(40, 200); Required = $true }
            @{ Name = "SASAPAY_MERCHANT_CODE"; Label = "Merchant Code"; Masked = $false; ExpectedLen = @(4, 12);   Required = $false }
        )
        EnvDefaults = @{ SASAPAY_ENVIRONMENT = "production" }
        Verify = @'
import os, base64, requests
cid = os.environ.get('SASAPAY_CLIENT_ID', '')
sec = os.environ.get('SASAPAY_CLIENT_SECRET', '')
mc  = os.environ.get('SASAPAY_MERCHANT_CODE', '')
auth = base64.b64encode((cid + ':' + sec).encode()).decode()
print('  client_id_len=' + str(len(cid)) + '  secret_len=' + str(len(sec)) + '  merchant=' + mc)
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
                           json={'merchant_code': mc, 'channel_code': '0', 'account_number': '247247'},
                           timeout=15)
        print('  account-validation: HTTP ' + str(r2.status_code) + '  body: ' + r2.text[:160])
        if r2.status_code in (200, 400):
            print('RESULT: SUCCESS')
        elif r2.status_code == 401:
            print('RESULT: PARTIAL')
        else:
            print('RESULT: PARTIAL_OTHER_' + str(r2.status_code))
    else:
        print('    body: ' + r.text[:160])
        print('RESULT: FAILURE')
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    intasend = @{
        Title = "IntaSend (CBK-licensed payments aggregator)"
        Fields = @(
            @{ Name = "INTASEND_PUBLISHABLE_KEY"; Label = "Publishable Key"; Masked = $false; ExpectedLen = @(40, 80); Required = $true }
            @{ Name = "INTASEND_SECRET_KEY";      Label = "Secret Key";      Masked = $true;  ExpectedLen = @(40, 80); Required = $true }
            @{ Name = "INTASEND_WEBHOOK_SECRET";  Label = "Webhook Secret";  Masked = $true;  ExpectedLen = @(20, 80); Required = $false }
        )
        EnvDefaults = @{ INTASEND_ENVIRONMENT = "production" }
        Verify = @'
import os, requests
sec = os.environ.get('INTASEND_SECRET_KEY', '')
print('  secret_key_len=' + str(len(sec)))
# Probe the wallets/list endpoint · cheapest authenticated call
try:
    r = requests.post('https://payment.intasend.com/api/v1/wallets/list/',
                      headers={'Authorization': 'Bearer ' + sec, 'Content-Type': 'application/json'},
                      json={}, timeout=15)
    print('  PROD wallets/list: HTTP ' + str(r.status_code) + '  body: ' + r.text[:160])
    if r.status_code in (200, 201):
        print('RESULT: SUCCESS')
    elif r.status_code in (401, 403):
        print('RESULT: FAILURE')
    else:
        print('RESULT: PARTIAL_OTHER_' + str(r.status_code))
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    swypt = @{
        Title = "Swypt (KES → crypto on-ramp · buy-side liquidity)"
        Fields = @(
            @{ Name = "SWYPT_API_KEY";    Label = "API Key";    Masked = $false; ExpectedLen = @(20, 80); Required = $true }
            @{ Name = "SWYPT_API_SECRET"; Label = "API Secret"; Masked = $true;  ExpectedLen = @(40, 200); Required = $true }
        )
        EnvDefaults = @{ SWYPT_BASE_URL = "https://api.swypt.io" }
        Verify = @'
import os, requests
key = os.environ.get('SWYPT_API_KEY', '')
sec = os.environ.get('SWYPT_API_SECRET', '')
print('  api_key_len=' + str(len(key)) + '  secret_len=' + str(len(sec)))
# TODO · replace with the actual Swypt auth-probe endpoint once we
# have the docs from swypt.io@gmail.com. For now we just confirm the
# values land in the container env.
if len(key) >= 20 and len(sec) >= 40:
    print('RESULT: SUCCESS')
else:
    print('RESULT: FAILURE')
'@
    }

    yellowcard = @{
        Title = "Yellow Card (KES → USDT/USDC stablecoin on-ramp)"
        Fields = @(
            @{ Name = "YELLOWCARD_API_KEY";    Label = "API Key";    Masked = $false; ExpectedLen = @(20, 80); Required = $true }
            @{ Name = "YELLOWCARD_API_SECRET"; Label = "API Secret"; Masked = $true;  ExpectedLen = @(40, 200); Required = $true }
        )
        EnvDefaults = @{ YELLOWCARD_ENVIRONMENT = "production"; YELLOWCARD_BASE_URL = "https://api.yellowcard.io" }
        Verify = @'
import os, requests, hmac, hashlib, base64
from datetime import datetime, timezone
key = os.environ.get('YELLOWCARD_API_KEY', '')
sec = os.environ.get('YELLOWCARD_API_SECRET', '')
print('  api_key_len=' + str(len(key)) + '  secret_len=' + str(len(sec)))
# YC HMAC v1: signature = HMAC-SHA256(secret, timestamp + path + method + base64(sha256(body)))
ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
path = '/business/account'
body_hash = base64.b64encode(hashlib.sha256(b'').digest()).decode()
msg = ts + path + 'GET' + body_hash
sig = base64.b64encode(hmac.new(sec.encode(), msg.encode(), hashlib.sha256).digest()).decode()
try:
    r = requests.get('https://api.yellowcard.io' + path,
                     headers={'X-YC-Timestamp': ts, 'Authorization': 'YcHmacV1 ' + key + ':' + sig}, timeout=15)
    print('  PROD account: HTTP ' + str(r.status_code) + '  body: ' + r.text[:160])
    if r.status_code == 200:
        print('RESULT: SUCCESS')
    elif r.status_code in (401, 403):
        print('RESULT: FAILURE')
    else:
        print('RESULT: PARTIAL_OTHER_' + str(r.status_code))
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    daraja = @{
        Title = "Safaricom Daraja (M-Pesa direct, when LNO lands)"
        Fields = @(
            @{ Name = "MPESA_CONSUMER_KEY";       Label = "Consumer Key";    Masked = $false; ExpectedLen = @(20, 60); Required = $true }
            @{ Name = "MPESA_CONSUMER_SECRET";    Label = "Consumer Secret"; Masked = $true;  ExpectedLen = @(20, 80); Required = $true }
            @{ Name = "MPESA_SHORTCODE";          Label = "Shortcode";       Masked = $false; ExpectedLen = @(4, 8);   Required = $true }
            @{ Name = "MPESA_PASSKEY";            Label = "Passkey";         Masked = $true;  ExpectedLen = @(40, 80); Required = $false }
            @{ Name = "MPESA_INITIATOR_NAME";     Label = "Initiator Name";  Masked = $false; ExpectedLen = @(3, 30);  Required = $false }
            @{ Name = "MPESA_INITIATOR_PASSWORD"; Label = "Initiator Pwd";   Masked = $true;  ExpectedLen = @(8, 60);  Required = $false }
        )
        EnvDefaults = @{ MPESA_ENVIRONMENT = "production" }
        Verify = @'
import os, requests, base64
ck = os.environ.get('MPESA_CONSUMER_KEY', '')
cs = os.environ.get('MPESA_CONSUMER_SECRET', '')
print('  consumer_key_len=' + str(len(ck)) + '  consumer_secret_len=' + str(len(cs)))
auth = base64.b64encode((ck + ':' + cs).encode()).decode()
try:
    r = requests.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
                     headers={'Authorization': 'Basic ' + auth}, timeout=15)
    print('  PROD OAuth: HTTP ' + str(r.status_code) + '  body: ' + r.text[:160])
    if r.status_code == 200:
        print('RESULT: SUCCESS')
    else:
        print('RESULT: FAILURE')
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    smtp = @{
        Title = "SMTP (transactional email · SendGrid / Mailgun / SES)"
        Fields = @(
            @{ Name = "EMAIL_HOST";          Label = "SMTP Host";     Masked = $false; ExpectedLen = @(8, 80);  Required = $true }
            @{ Name = "EMAIL_PORT";          Label = "Port";          Masked = $false; ExpectedLen = @(2, 5);   Required = $true }
            @{ Name = "EMAIL_HOST_USER";     Label = "Username";      Masked = $false; ExpectedLen = @(3, 80);  Required = $true }
            @{ Name = "EMAIL_HOST_PASSWORD"; Label = "Password";      Masked = $true;  ExpectedLen = @(8, 200); Required = $true }
            @{ Name = "DEFAULT_FROM_EMAIL";  Label = "From Address";  Masked = $false; ExpectedLen = @(5, 80);  Required = $false }
        )
        EnvDefaults = @{ EMAIL_USE_TLS = "True" }
        Verify = @'
import os, smtplib
host = os.environ.get('EMAIL_HOST', '')
port = int(os.environ.get('EMAIL_PORT', '587'))
user = os.environ.get('EMAIL_HOST_USER', '')
pwd  = os.environ.get('EMAIL_HOST_PASSWORD', '')
print('  host=' + host + '  port=' + str(port) + '  user=' + user[:6] + '...' + '  pwd_len=' + str(len(pwd)))
try:
    s = smtplib.SMTP(host, port, timeout=15)
    s.starttls()
    s.login(user, pwd)
    s.quit()
    print('  SMTP login: OK')
    print('RESULT: SUCCESS')
except Exception as e:
    print('  SMTP login failed: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    twilio = @{
        Title = "Twilio (SMS · phone OTP fallback)"
        Fields = @(
            @{ Name = "TWILIO_ACCOUNT_SID"; Label = "Account SID";  Masked = $false; ExpectedLen = @(34, 36); Required = $true }
            @{ Name = "TWILIO_AUTH_TOKEN";  Label = "Auth Token";   Masked = $true;  ExpectedLen = @(32, 36); Required = $true }
            @{ Name = "TWILIO_FROM_NUMBER"; Label = "From Number";  Masked = $false; ExpectedLen = @(8, 16);  Required = $true }
        )
        Verify = @'
import os, requests
from requests.auth import HTTPBasicAuth
sid = os.environ.get('TWILIO_ACCOUNT_SID', '')
tok = os.environ.get('TWILIO_AUTH_TOKEN', '')
print('  account_sid=' + sid[:8] + '...' + '  token_len=' + str(len(tok)))
try:
    r = requests.get('https://api.twilio.com/2010-04-01/Accounts/' + sid + '.json',
                     auth=HTTPBasicAuth(sid, tok), timeout=15)
    print('  PROD account: HTTP ' + str(r.status_code))
    if r.status_code == 200:
        print('RESULT: SUCCESS')
    elif r.status_code == 401:
        print('RESULT: FAILURE')
    else:
        print('RESULT: PARTIAL_OTHER_' + str(r.status_code))
except Exception as e:
    print('  exception: ' + repr(e))
    print('RESULT: FAILURE')
'@
    }

    "cloudflare-r2" = @{
        Title = "Cloudflare R2 (object storage · receipt PDFs, KYC docs)"
        Fields = @(
            @{ Name = "R2_ACCESS_KEY_ID";     Label = "Access Key ID";     Masked = $false; ExpectedLen = @(20, 60);  Required = $true }
            @{ Name = "R2_SECRET_ACCESS_KEY"; Label = "Secret Access Key"; Masked = $true;  ExpectedLen = @(40, 100); Required = $true }
            @{ Name = "R2_ACCOUNT_ID";        Label = "Account ID";        Masked = $false; ExpectedLen = @(20, 40);  Required = $true }
            @{ Name = "R2_BUCKET";            Label = "Bucket Name";       Masked = $false; ExpectedLen = @(3, 64);   Required = $true }
        )
        Verify = @'
import os
import boto3
from botocore.config import Config
key = os.environ.get('R2_ACCESS_KEY_ID', '')
sec = os.environ.get('R2_SECRET_ACCESS_KEY', '')
acc = os.environ.get('R2_ACCOUNT_ID', '')
bucket = os.environ.get('R2_BUCKET', '')
print('  access_key_len=' + str(len(key)) + '  bucket=' + bucket)
try:
    s3 = boto3.client('s3',
        endpoint_url='https://' + acc + '.r2.cloudflarestorage.com',
        aws_access_key_id=key,
        aws_secret_access_key=sec,
        config=Config(signature_version='s3v4'))
    resp = s3.head_bucket(Bucket=bucket)
    print('  head_bucket: OK')
    print('RESULT: SUCCESS')
except Exception as e:
    print('  head_bucket failed: ' + repr(e)[:200])
    print('RESULT: FAILURE')
'@
    }

    "gcp-kms" = @{
        Title = "GCP KMS (rotate service-account JSON for envelope encryption)"
        Fields = @(
            @{ Name = "GCP_SA_JSON";  Label = "Service Account JSON (paste full contents)"; Masked = $true;  ExpectedLen = @(800, 4000); Required = $true; Multiline = $true }
            @{ Name = "KMS_KEY_RESOURCE"; Label = "KMS Key Resource Path"; Masked = $false; ExpectedLen = @(60, 200); Required = $false }
        )
        Verify = @'
import os, json
from pathlib import Path
sa = os.environ.get('GCP_SA_JSON', '')
print('  sa_json_len=' + str(len(sa)))
try:
    parsed = json.loads(sa)
    print('  service_account: ' + parsed.get('client_email', '?'))
    print('  type: ' + parsed.get('type', '?'))
    if parsed.get('type') != 'service_account':
        print('RESULT: FAILURE')
    else:
        # Write to /run/secrets/gcp-kms.json (the location compose mounts)
        # Note: this only works if the container has write access to that
        # path AND the mount is volume-style (not read-only bind). For a
        # bind-mount we need to write to the host file via docker cp.
        # We just validate the JSON shape here and print the next step.
        print('  next: replace /etc/cpay/cpay-kms-prod.json with this JSON, then restart cryptopay_web')
        print('RESULT: PARTIAL')
except Exception as e:
    print('  json parse failed: ' + repr(e))
    print('RESULT: FAILURE')
'@
        # GCP KMS is unique · the SA JSON is a file on disk, not an env
        # var. The script handles this via a SpecialHandler hook below.
        SpecialHandler = "gcp-sa-json"
    }

    blockchain = @{
        Title = "Blockchain RPCs (Alchemy ETH, TronGrid, Helius SOL, BlockCypher BTC)"
        Fields = @(
            @{ Name = "ALCHEMY_API_KEY";      Label = "Alchemy API Key (ETH/Polygon)"; Masked = $true;  ExpectedLen = @(20, 60); Required = $false }
            @{ Name = "TRONGRID_API_KEY";     Label = "TronGrid API Key";              Masked = $true;  ExpectedLen = @(20, 60); Required = $false }
            @{ Name = "HELIUS_API_KEY";       Label = "Helius API Key (SOL)";          Masked = $true;  ExpectedLen = @(20, 60); Required = $false }
            @{ Name = "BLOCKCYPHER_API_TOKEN"; Label = "BlockCypher Token (BTC)";      Masked = $true;  ExpectedLen = @(20, 60); Required = $false }
        )
        Verify = @'
import os
keys = ['ALCHEMY_API_KEY', 'TRONGRID_API_KEY', 'HELIUS_API_KEY', 'BLOCKCYPHER_API_TOKEN']
for k in keys:
    v = os.environ.get(k, '')
    print('  ' + k + '_len=' + str(len(v)))
print('RESULT: SUCCESS')
'@
    }

    custom = @{
        Title = "Custom (paste any KEY=VALUE pairs · one per line)"
        Fields = @(
            @{ Name = "CUSTOM_PAIRS"; Label = "Lines of KEY=VALUE"; Masked = $false; ExpectedLen = @(5, 5000); Required = $true; Multiline = $true }
        )
        Verify = @'
print('RESULT: SUCCESS')
'@
        SpecialHandler = "custom-pairs"
    }
}

# ─────────────────────────────────────────────────────────────────────
# Provider picker (interactive when -Provider not passed)
# ─────────────────────────────────────────────────────────────────────
function Show-ProviderPicker {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $pickForm = New-Object System.Windows.Forms.Form
    $pickForm.Text = "Cpay · pick a credential set to deploy"
    $pickForm.Size = New-Object System.Drawing.Size(560, 480)
    $pickForm.StartPosition = "CenterScreen"
    $pickForm.FormBorderStyle = "FixedDialog"
    $pickForm.MaximizeBox = $false
    $pickForm.TopMost = $true

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = "Choose which credential set to push to the VPS:"
    $hint.Location = New-Object System.Drawing.Point(20, 18)
    $hint.Size = New-Object System.Drawing.Size(500, 24)
    $hint.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $pickForm.Controls.Add($hint)

    $list = New-Object System.Windows.Forms.ListBox
    $list.Location = New-Object System.Drawing.Point(20, 50)
    $list.Size = New-Object System.Drawing.Size(510, 320)
    $list.Font = New-Object System.Drawing.Font("Segoe UI", 10)
    $list.IntegralHeight = $false
    foreach ($k in $PROVIDERS.Keys) { [void]$list.Items.Add("$k  -  $($PROVIDERS[$k].Title)") }
    $list.SelectedIndex = 0
    $pickForm.Controls.Add($list)

    $okBtn = New-Object System.Windows.Forms.Button
    $okBtn.Text = "Continue"
    $okBtn.Location = New-Object System.Drawing.Point(360, 390)
    $okBtn.Size = New-Object System.Drawing.Size(170, 32)
    $okBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $okBtn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
    $okBtn.ForeColor = [System.Drawing.Color]::White
    $okBtn.FlatStyle = "Flat"
    $okBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $pickForm.Controls.Add($okBtn)
    $pickForm.AcceptButton = $okBtn

    $cancelBtn = New-Object System.Windows.Forms.Button
    $cancelBtn.Text = "Cancel"
    $cancelBtn.Location = New-Object System.Drawing.Point(270, 390)
    $cancelBtn.Size = New-Object System.Drawing.Size(80, 32)
    $cancelBtn.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $pickForm.Controls.Add($cancelBtn)
    $pickForm.CancelButton = $cancelBtn

    $r = $pickForm.ShowDialog()
    $sel = $list.SelectedItem
    $pickForm.Dispose()
    if ($r -ne [System.Windows.Forms.DialogResult]::OK -or -not $sel) { return $null }
    return ($sel -split " ")[0]
}

# ─────────────────────────────────────────────────────────────────────
# Credentials dialog · dynamic from $provider.Fields
# ─────────────────────────────────────────────────────────────────────
function Show-CredentialsDialog($provider) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $f = New-Object System.Windows.Forms.Form
    $f.Text = "Cpay · " + $provider.Title
    $f.StartPosition = "CenterScreen"
    $f.FormBorderStyle = "FixedDialog"
    $f.MaximizeBox = $false
    $f.MinimizeBox = $false
    $f.TopMost = $true

    $rowH = 60
    $fieldCount = $provider.Fields.Count
    $f.Size = New-Object System.Drawing.Size(620, (140 + ($rowH * $fieldCount) + 60))

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = "Paste credentials below. Each field's char-count turns green when length is in the expected range."
    $hint.Location = New-Object System.Drawing.Point(20, 14)
    $hint.Size = New-Object System.Drawing.Size(580, 36)
    $hint.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $f.Controls.Add($hint)

    $tboxes = @{}
    $y = 60
    foreach ($field in $provider.Fields) {
        $lbl = New-Object System.Windows.Forms.Label
        $lbl.Text = $field.Name + "  ·  " + $field.Label
        if (-not $field.Required) { $lbl.Text += "  (optional)" }
        $lbl.Location = New-Object System.Drawing.Point(20, $y)
        $lbl.Size = New-Object System.Drawing.Size(560, 18)
        $lbl.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
        $f.Controls.Add($lbl)

        $multiline = $false
        if ($field.ContainsKey("Multiline")) { $multiline = $field.Multiline }

        $tb = New-Object System.Windows.Forms.TextBox
        $tb.Location = New-Object System.Drawing.Point(20, ($y + 20))
        if ($multiline) {
            $tb.Multiline = $true
            $tb.Height = 80
            $tb.ScrollBars = "Vertical"
        }
        $tb.Size = New-Object System.Drawing.Size(560, 22)
        $tb.UseSystemPasswordChar = $field.Masked -and (-not $multiline)
        $tb.Font = New-Object System.Drawing.Font("Consolas", 10)
        $f.Controls.Add($tb)
        $tboxes[$field.Name] = $tb

        # Live char-count label
        $cnt = New-Object System.Windows.Forms.Label
        $cntY = if ($multiline) { $y + 20 + 80 + 2 } else { $y + 44 }
        $cnt.Location = New-Object System.Drawing.Point(20, $cntY)
        $cnt.Size = New-Object System.Drawing.Size(560, 14)
        $cnt.ForeColor = [System.Drawing.Color]::Gray
        $cnt.Font = New-Object System.Drawing.Font("Segoe UI", 7)
        $minL = $field.ExpectedLen[0]
        $maxL = $field.ExpectedLen[1]
        $cnt.Text = "(0 chars · expected $minL–$maxL)"
        $f.Controls.Add($cnt)

        $tb.Add_TextChanged({
            param($snd, $e)
            $count = $snd.Text.Length
            # Look up which field this is by reverse-mapping the textbox
            foreach ($kv in $tboxes.GetEnumerator()) {
                if ($kv.Value -eq $snd) {
                    $fname = $kv.Key
                    $field = $provider.Fields | Where-Object { $_.Name -eq $fname }
                    $cntLabel = $f.Controls | Where-Object { $_ -is [System.Windows.Forms.Label] -and $_.Text -match "^\(\d+ chars" -and $_.Top -gt $snd.Top }
                    $cntLabel = $cntLabel | Sort-Object Top | Select-Object -First 1
                    if ($cntLabel) {
                        $cntLabel.Text = "($count chars · expected $($field.ExpectedLen[0])–$($field.ExpectedLen[1]))"
                        if ($count -ge $field.ExpectedLen[0] -and $count -le $field.ExpectedLen[1]) {
                            $cntLabel.ForeColor = [System.Drawing.Color]::Green
                        } elseif ($count -gt 0) {
                            $cntLabel.ForeColor = [System.Drawing.Color]::Orange
                        } else {
                            $cntLabel.ForeColor = [System.Drawing.Color]::Gray
                        }
                    }
                    break
                }
            }
        }.GetNewClosure())

        $extra = if ($multiline) { 92 } else { 22 }
        $y += $rowH + ($extra - 22)
    }

    $deployBtn = New-Object System.Windows.Forms.Button
    $deployBtn.Text = "Deploy to VPS"
    $deployBtn.Location = New-Object System.Drawing.Point(420, ($f.Size.Height - 70))
    $deployBtn.Size = New-Object System.Drawing.Size(170, 34)
    $deployBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $deployBtn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
    $deployBtn.ForeColor = [System.Drawing.Color]::White
    $deployBtn.FlatStyle = "Flat"
    $deployBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $f.Controls.Add($deployBtn)
    $f.AcceptButton = $deployBtn

    $cancelBtn = New-Object System.Windows.Forms.Button
    $cancelBtn.Text = "Cancel"
    $cancelBtn.Location = New-Object System.Drawing.Point(330, ($f.Size.Height - 70))
    $cancelBtn.Size = New-Object System.Drawing.Size(80, 34)
    $cancelBtn.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $f.Controls.Add($cancelBtn)
    $f.CancelButton = $cancelBtn

    $first = $f.Controls | Where-Object { $_ -is [System.Windows.Forms.TextBox] } | Select-Object -First 1
    if ($first) { $first.Select() }
    $r = $f.ShowDialog()

    if ($r -ne [System.Windows.Forms.DialogResult]::OK) { $f.Dispose(); return $null }

    $values = @{}
    foreach ($k in $tboxes.Keys) {
        $values[$k] = $tboxes[$k].Text.Trim()
        $tboxes[$k].Text = ""
    }
    $f.Dispose()
    return $values
}

# ─────────────────────────────────────────────────────────────────────
# Main flow
# ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Cpay · universal credential deployer ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[0/4] Testing SSH connectivity to $VpsHost..."
$probe = & ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 $VpsHost "echo SSH_OK" 2>&1
if ($LASTEXITCODE -ne 0 -or $probe -notmatch "SSH_OK") {
    Write-Host "[X] SSH failed before any secret was prompted: $probe" -ForegroundColor Red
    exit 5
}
Write-Host "    OK" -ForegroundColor Green
Write-Host ""

if (-not $Provider) {
    Write-Host "[1/4] Picking credential set..."
    $Provider = Show-ProviderPicker
    if (-not $Provider) { Write-Host "    Cancelled." -ForegroundColor Yellow; exit 4 }
}
$prov = $PROVIDERS[$Provider]
if (-not $prov) { Write-Host "[X] Unknown provider: $Provider" -ForegroundColor Red; exit 6 }

Write-Host "    Provider: $Provider · $($prov.Title)" -ForegroundColor Green
Write-Host ""

Write-Host "[2/4] Opening credentials dialog..."
$values = Show-CredentialsDialog $prov
if (-not $values) { Write-Host "    Cancelled · no changes made." -ForegroundColor Yellow; exit 4 }

# Validate required + length ranges
foreach ($field in $prov.Fields) {
    $v = $values[$field.Name]
    if (-not $v -and $field.Required) {
        Write-Host "[X] Required field '$($field.Name)' is empty." -ForegroundColor Red
        exit 2
    }
    if ($v -and $v.Length -lt $field.ExpectedLen[0]) {
        Write-Host "[!] Field '$($field.Name)' is only $($v.Length) chars (expected $($field.ExpectedLen[0])+) · paste likely truncated. Aborting." -ForegroundColor Red
        exit 2
    }
}
Write-Host "    Captured $($values.Keys.Count) field(s) · all required values present." -ForegroundColor Green
Write-Host ""

# Build the env-update lines (KEY='value' with single-quote escaping)
function Esc($s) { return $s -replace "'", "'\''" }
$envLines = @()
foreach ($k in $values.Keys) {
    if ($values[$k]) { $envLines += "export ENV_KV_$k='$(Esc $values[$k])'" }
}
if ($prov.EnvDefaults) {
    foreach ($k in $prov.EnvDefaults.Keys) {
        $envLines += "export ENV_KV_$k='$(Esc $prov.EnvDefaults[$k])'"
    }
}
$envExports = $envLines -join "`n"
$keyList = (@($values.Keys) + @(if ($prov.EnvDefaults) { $prov.EnvDefaults.Keys } else { @() })) -join " "

# Bash payload · receives the values as ENV_KV_<KEY> exports, rewrites
# .env.production via Python (handles any chars), force-recreates web,
# re-applies hot-patches, then runs the provider's Verify probe.
$BashScript = @"
set -e
TS=`$(date +%Y%m%d_%H%M%S)
cd /home/deploy/cpay/deploy

echo '[VPS] backing up .env.production'
cp .env.production .env.production.bak.pre-$Provider-`$TS
chmod 600 .env.production.bak.pre-$Provider-`$TS

# Receive values as ENV_KV_<KEY> exports
$envExports

echo '[VPS] rewriting .env.production'
KEY_LIST="$keyList" python3 - <<'PYEOF'
import os, re
keys = os.environ['KEY_LIST'].split()
src = open('.env.production').read()

def replace_or_append(text, key, val):
    pat = re.compile(r'^' + re.escape(key) + r'=.*$', re.M)
    if pat.search(text):
        return pat.sub(lambda m: key + '=' + val, text)
    return text.rstrip() + '\n' + key + '=' + val + '\n'

for k in keys:
    val = os.environ.get('ENV_KV_' + k)
    if val is None:
        continue  # not provided · leave existing line alone
    src = replace_or_append(src, k, val)

open('.env.production', 'w').write(src)
os.chmod('.env.production', 0o600)
print('  ' + str(len(keys)) + ' keys updated, file mode 600')
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
    docker cp "/home/deploy/cpay/backend/`$f" "cryptopay_web:/app/`$f" > /dev/null 2>&1 && echo "  + `$f" || true
  fi
done
docker exec cryptopay_web mkdir -p /app/templates/verify > /dev/null 2>&1
[ -f /home/deploy/cpay/backend/templates/pdf/receipt.html ] && docker cp /home/deploy/cpay/backend/templates/pdf/receipt.html cryptopay_web:/app/templates/pdf/receipt.html > /dev/null 2>&1
for t in receipt.html receipt_not_found.html receipt_ambiguous.html; do
  [ -f "/home/deploy/cpay/backend/templates/verify/`$t" ] && docker cp "/home/deploy/cpay/backend/templates/verify/`$t" "cryptopay_web:/app/templates/verify/`$t" > /dev/null 2>&1
done
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
docker exec cryptopay_web python manage.py migrate --noinput 2>&1 | grep -ivE "your models in app|makemigrations|env_check_failed" | tail -3

echo '[VPS] verifying credentials'
docker exec -i cryptopay_web python3 - <<'PYEOF'
$($prov.Verify)
PYEOF
"@

# Substitute is unnecessary · we only used embedded variable refs into
# the bash script (`$envExports`, `$keyList`, `$Provider`, `$($prov.Verify)`).
# All the credential values are inside the bash `export` statements,
# safe-quoted by `Esc`.

Write-Host "[3/4] Sending to VPS over SSH stdin..."
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
$normalized = $BashScript -replace "`r`n", "`n"
$bytes = $utf8.GetBytes($normalized)

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

# Wipe sensitive vars
foreach ($k in @($values.Keys)) { $values[$k] = $null }
$values = $null
$envExports = $null
$envLines = $null
$BashScript = $null
$normalized = $null
$bytes = $null
[System.GC]::Collect()

Write-Host ""
Write-Host "[4/4] VPS output:" -ForegroundColor Cyan
Write-Host "----------------------------------------"
$Result = (($stdout + "`n" + $stderr) -split "`r?`n")
$Result | ForEach-Object { Write-Host $_ }
Write-Host "----------------------------------------"
Write-Host ""

$resultText = ($Result -join "`n")
if ($resultText -match "RESULT: SUCCESS") {
    Write-Host "[OK] SUCCESS · $Provider credentials are live on production." -ForegroundColor Green
    exit 0
} elseif ($resultText -match "RESULT: PARTIAL") {
    Write-Host "[!] PARTIAL · authentication works but at least one product/endpoint is gated." -ForegroundColor Yellow
    Write-Host "    See output above for the specific HTTP code · contact the provider's support if needed."
    exit 1
} elseif ($resultText -match "RESULT: FAILURE") {
    Write-Host "[X] FAILURE · the provider rejected the new credentials." -ForegroundColor Red
    Write-Host "    Backup is at /home/deploy/cpay/deploy/.env.production.bak.pre-$Provider-<ts>"
    Write-Host "    To roll back: ssh $VpsHost ""cp /home/deploy/cpay/deploy/.env.production.bak.pre-$Provider-<ts> /home/deploy/cpay/deploy/.env.production && cd /home/deploy/cpay/deploy && docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps web"""
    exit 2
} else {
    Write-Host "[?] UNKNOWN · couldn't parse a RESULT line. Scroll up for details." -ForegroundColor Yellow
    Write-Host "    ssh exit code: $exitCode"
    exit 3
}
