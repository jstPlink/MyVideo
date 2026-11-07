# Crea il keystore di firma dell'APK e lo registra nei secrets del repository GitHub.
# Da eseguire UNA volta, a mano, da PowerShell:   .\scripts\setup-android-signing.ps1
# Richiede: JDK (keytool) e GitHub CLI autenticata (gh auth login).
param(
  [string]$Repo = 'jstPlink/MyVideo',
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'MyVideo-keystore')
)
$ErrorActionPreference = 'Stop'

$store = Join-Path $OutDir 'myvideo-release.keystore'
if (Test-Path $store) { throw "Esiste gia' $store: non lo sovrascrivo. Usa quello (e reimposta i secrets a mano) o cancellalo di proposito." }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
keytool -genkeypair -keystore $store -alias myvideo -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $pw -keypass $pw -dname 'CN=MyVideo, O=fplinio, C=IT'
if ($LASTEXITCODE -ne 0) { throw 'keytool fallito' }

Set-Content -Encoding utf8 (Join-Path $OutDir 'PASSWORD.txt') "alias: myvideo`npassword store/chiave: $pw`nConserva questa cartella: serve per firmare gli aggiornamenti dell'APK."

[Convert]::ToBase64String([IO.File]::ReadAllBytes($store)) | gh secret set ANDROID_KEYSTORE_B64 --repo $Repo
$pw | gh secret set ANDROID_KEYSTORE_PASSWORD --repo $Repo
$pw | gh secret set ANDROID_KEY_PASSWORD --repo $Repo
'myvideo' | gh secret set ANDROID_KEY_ALIAS --repo $Repo

Write-Host "Fatto. Keystore e password in: $OutDir  (fanne una copia di sicurezza, NON metterla nel repository)"
