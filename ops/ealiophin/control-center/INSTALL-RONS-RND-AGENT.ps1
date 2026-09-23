[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SupabaseUrl,
    [Parameter(Mandatory=$true)][string]$PublishableKey,
    [Parameter(Mandatory=$true)][string]$DeviceToken,
    [Parameter(Mandatory=$true)][Guid]$DeviceId,
    [string]$Workspace = 'C:\Users\Ashley\Documents\GitHub\rons-sovereign-codebase',
    [switch]$EnableMutations
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedSha256 {
    param([Parameter(Mandatory=$true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Cannot hash missing file: $Path"
    }
    $source = Get-Content -Raw -LiteralPath $Path
    $normalized = $source.Replace("`r`n", "`n").Replace("`r", "`n")
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($utf8.GetBytes($normalized)) | ForEach-Object {
            $_.ToString('x2')
        }) -join '')
    } finally {
        $sha.Dispose()
    }
}

$workspaceFull = [System.IO.Path]::GetFullPath($Workspace)
$sourceAgent = Join-Path $workspaceFull 'ops\ealiophin\control-center\RONS-RnD-Agent.ps1'
if (-not (Test-Path -LiteralPath $sourceAgent -PathType Leaf)) {
    throw "R&D agent source is missing: $sourceAgent"
}

$controlRoot = Join-Path $env:LOCALAPPDATA 'Resonance\RONS-ControlCenter'
New-Item -ItemType Directory -Path $controlRoot -Force | Out-Null

$agentPath = Join-Path $controlRoot 'RONS-RnD-Agent.ps1'
$configPath = Join-Path $controlRoot 'rnd-agent.json'
$credentialPath = Join-Path $controlRoot 'rnd-agent.credential.xml'
$taskName = 'RONS R&D Ops Agent'

Copy-Item -LiteralPath $sourceAgent -Destination $agentPath -Force
$sourceHash = Get-NormalizedSha256 -Path $sourceAgent
$deployedHash = Get-NormalizedSha256 -Path $agentPath
if ($sourceHash -ne $deployedHash) {
    throw 'R&D agent deployment hash mismatch.'
}

if ($DeviceToken -notmatch '^[0-9a-f]{96}

$config = [ordered]@{
    supabase_url = $SupabaseUrl.TrimEnd('/')
    publishable_key = $PublishableKey
    device_id = $DeviceId.ToString()
    workspace = $workspaceFull
    mutations_enabled = [bool]$EnableMutations
    poll_seconds = 10
    recovery_hold = $true
    deployed_agent_sha256 = $deployedHash
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionParams = @{
    Execute = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    Argument = ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $agentPath + '"')
}
$action = New-ScheduledTaskAction @actionParams
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settingsParams = @{
    StartWhenAvailable = $true
    MultipleInstances = 'IgnoreNew'
    RestartCount = 5
    RestartInterval = (New-TimeSpan -Minutes 1)
    ExecutionTimeLimit = [TimeSpan]::Zero
}
$settings = New-ScheduledTaskSettingsSet @settingsParams
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

$registerParams = @{
    TaskName = $taskName
    Action = $action
    Trigger = $trigger
    Settings = $settings
    Principal = $principal
    Force = $true
}
Register-ScheduledTask @registerParams | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $taskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName

[pscustomobject]@{
    TaskName = $taskName
    State = $task.State
    UserId = $task.Principal.UserId
    LastResult = $taskInfo.LastTaskResult
    AgentPath = $agentPath
    AgentSha256 = $deployedHash
    ConfigPath = $configPath
    CredentialPath = $credentialPath
    MutationsEnabled = [bool]$EnableMutations
    RecoveryHold = $true
} | Format-List
) {
    throw 'The one-time R&D device token is invalid.'
}
$secureToken = ConvertTo-SecureString -String $DeviceToken -AsPlainText -Force
$credential = [PSCredential]::new('ronsas-rnd-device', $secureToken)
$credential | Export-Clixml -LiteralPath $credentialPath -Force
$DeviceToken = $null

$config = [ordered]@{
    supabase_url = $SupabaseUrl.TrimEnd('/')
    publishable_key = $PublishableKey
    device_id = $DeviceId.ToString()
    workspace = $workspaceFull
    mutations_enabled = [bool]$EnableMutations
    poll_seconds = 10
    recovery_hold = $true
    deployed_agent_sha256 = $deployedHash
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8

$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionParams = @{
    Execute = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    Argument = ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $agentPath + '"')
}
$action = New-ScheduledTaskAction @actionParams
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settingsParams = @{
    StartWhenAvailable = $true
    MultipleInstances = 'IgnoreNew'
    RestartCount = 5
    RestartInterval = (New-TimeSpan -Minutes 1)
    ExecutionTimeLimit = [TimeSpan]::Zero
}
$settings = New-ScheduledTaskSettingsSet @settingsParams
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

$registerParams = @{
    TaskName = $taskName
    Action = $action
    Trigger = $trigger
    Settings = $settings
    Principal = $principal
    Force = $true
}
Register-ScheduledTask @registerParams | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $taskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName

[pscustomobject]@{
    TaskName = $taskName
    State = $task.State
    UserId = $task.Principal.UserId
    LastResult = $taskInfo.LastTaskResult
    AgentPath = $agentPath
    AgentSha256 = $deployedHash
    ConfigPath = $configPath
    CredentialPath = $credentialPath
    MutationsEnabled = [bool]$EnableMutations
    RecoveryHold = $true
} | Format-List
