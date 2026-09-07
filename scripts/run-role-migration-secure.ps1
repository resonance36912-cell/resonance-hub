param([switch]$Apply)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$previousUrl = $env:SUPABASE_URL
$previousRole = $env:SUPABASE_SERVICE_ROLE_KEY
$previousConfirm = $env:RONS_ROLE_MIGRATION_CONFIRM
$bstr = [IntPtr]::Zero
try {
  $url = Read-Host "Hosted Supabase URL"
  if ([string]::IsNullOrWhiteSpace($url) -or $url -match "127\.0\.0\.1|localhost") { throw "A real hosted Supabase URL is required." }
  $secureRole = Read-Host "Hosted Supabase service-role key" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRole)
  $role = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($role)) { throw "Service-role key is required." }
  $env:SUPABASE_URL = $url.Trim()
  $env:SUPABASE_SERVICE_ROLE_KEY = $role
  $env:RESONANCE_SOVEREIGN_GATEWAY_URL = "http://127.0.0.1:58600"
  $args = @("run", "scripts/migrate-user-roles-to-sovereign.ts")
  if ($Apply) {
    $confirm = Read-Host "Type YES to write the verified role mirror to local sovereign Postgres"
    if ($confirm -cne "YES") { throw "Apply cancelled." }
    $env:RONS_ROLE_MIGRATION_CONFIRM = "YES"
    $args += "--apply"
  }
  Push-Location $root
  try { & bun @args; if ($LASTEXITCODE -ne 0) { throw "Migration command failed." } }
  finally { Pop-Location }
}
finally {
  $env:SUPABASE_URL = $previousUrl
  $env:SUPABASE_SERVICE_ROLE_KEY = $previousRole
  $env:RONS_ROLE_MIGRATION_CONFIRM = $previousConfirm
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable role,secureRole -ErrorAction SilentlyContinue
}
