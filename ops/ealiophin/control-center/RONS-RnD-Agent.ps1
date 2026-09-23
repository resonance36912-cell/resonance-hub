[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'Resonance\RONS-ControlCenter\rnd-agent.json'),
    [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'Resonance\RONS-ControlCenter\rnd-agent.credential.xml'),
    [switch]$Once
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

function Read-AgentConfig {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw "R&D agent config is missing: $ConfigPath"
    }
    if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
        throw "R&D agent credential is missing: $CredentialPath"
    }

    $config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    $credential = Import-Clixml -LiteralPath $CredentialPath
    if (-not ($credential -is [System.Management.Automation.PSCredential])) {
        throw 'R&D agent credential file did not contain a PSCredential.'
    }

    foreach ($required in @('supabase_url','publishable_key','device_id','workspace')) {
        if (-not ($config.PSObject.Properties.Name -contains $required) -or
            [string]::IsNullOrWhiteSpace([string]$config.$required)) {
            throw "R&D agent config is missing '$required'."
        }
    }

    return [pscustomobject]@{
        SupabaseUrl = ([string]$config.supabase_url).TrimEnd('/')
        PublishableKey = [string]$config.publishable_key
        DeviceId = [string]$config.device_id
        Workspace = [System.IO.Path]::GetFullPath([string]$config.workspace)
        MutationsEnabled = [bool]$config.mutations_enabled
        PollSeconds = if ($config.PSObject.Properties.Name -contains 'poll_seconds') {
            [Math]::Min(60, [Math]::Max(5, [int]$config.poll_seconds))
        } else { 10 }
        DeviceToken = $credential.GetNetworkCredential().Password
    }
}

function Invoke-BridgeRpc {
    param(
        [Parameter(Mandatory=$true)]$Agent,
        [Parameter(Mandatory=$true)][string]$Function,
        [Parameter(Mandatory=$true)][hashtable]$Payload
    )

    if ([string]::IsNullOrWhiteSpace([string]$Agent.DeviceToken)) {
        throw 'R&D agent device token is unavailable.'
    }
    $headers = @{
        apikey = $Agent.PublishableKey
        Authorization = "Bearer $($Agent.PublishableKey)"
        'Content-Type' = 'application/json'
    }
    $body = @{} + $Payload
    $body['_device_id'] = $Agent.DeviceId
    $body['_token'] = [string]$Agent.DeviceToken
    $request = @{
        Method = 'Post'
        Uri = "$($Agent.SupabaseUrl)/rest/v1/rpc/$Function"
        Headers = $headers
        Body = ($body | ConvertTo-Json -Depth 20 -Compress)
    }
    return Invoke-RestMethod @request
}

function Get-GitSnapshot {
    param([Parameter(Mandatory=$true)][string]$Workspace)

    $git = (Get-Command git.exe -ErrorAction Stop).Source
    $head = @(& $git -C $Workspace rev-parse HEAD 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read Git HEAD: $($head -join ' | ')" }
    $branch = @(& $git -C $Workspace branch --show-current 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read Git branch: $($branch -join ' | ')" }
    $status = @(& $git -C $Workspace status --porcelain=v1 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read Git status: $($status -join ' | ')" }

    return [ordered]@{
        head = ([string]($head | Select-Object -First 1)).Trim()
        branch = ([string]($branch | Select-Object -First 1)).Trim()
        dirty = ($status.Count -gt 0)
        changes = @($status | Select-Object -First 100)
    }
}

function Get-SystemDiagnostics {
    param([Parameter(Mandatory=$true)]$Agent)

    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        [string]$_.Name -match '^(powershell|pwsh|node|bun|cloudflared|git)\.exe$' -or
        [string]$_.CommandLine -match 'Runner\.(Listener|Worker)|RONS-Supervisor|RONS-RnD-Agent'
    } | Select-Object -First 80 ProcessId,Name,CommandLine)

    $supervisorPath = Join-Path $env:LOCALAPPDATA 'Resonance\RONS-ControlCenter\RONS-Supervisor.ps1'
    $launcherPath = Join-Path $Agent.Workspace 'ops\ealiophin\ci\START-RONSAS-ACTIONS-RUNNER.ps1'
    $installerPath = Join-Path $Agent.Workspace 'ops\ealiophin\ci\INSTALL-RONSAS-WINDOWS-RUNNER.ps1'

    $hashes = [ordered]@{}
    foreach ($entry in @{
        supervisor = $supervisorPath
        linux_launcher = $launcherPath
        windows_installer = $installerPath
    }.GetEnumerator()) {
        if (Test-Path -LiteralPath $entry.Value -PathType Leaf) {
            $hashes[$entry.Key] = (Get-FileHash -Algorithm SHA256 -LiteralPath $entry.Value).Hash.ToLowerInvariant()
        } else {
            $hashes[$entry.Key] = $null
        }
    }

    return [ordered]@{
        observed_at = (Get-Date).ToUniversalTime().ToString('o')
        computer = $env:COMPUTERNAME
        user = [Environment]::UserName
        os = [ordered]@{
            caption = $os.Caption
            version = $os.Version
            last_boot = $os.LastBootUpTime
            free_memory_kb = [long]$os.FreePhysicalMemory
            total_memory_kb = [long]$os.TotalVisibleMemorySize
        }
        disk_c = [ordered]@{
            free_bytes = [long]$drive.FreeSpace
            size_bytes = [long]$drive.Size
        }
        processes = $processes
        git = Get-GitSnapshot -Workspace $Agent.Workspace
        hashes = $hashes
        mutations_enabled = [bool]$Agent.MutationsEnabled
        recovery_hold = $true
    }
}

function Assert-Workspace {
    param([Parameter(Mandatory=$true)]$Agent,[Parameter(Mandatory=$true)][string]$JobWorkspace)

    $resolved = [System.IO.Path]::GetFullPath($JobWorkspace)
    if (-not [string]::Equals($resolved, $Agent.Workspace, [StringComparison]::OrdinalIgnoreCase)) {
        throw "R&D job workspace is not allowlisted: $resolved"
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "R&D workspace does not exist: $resolved"
    }
    return $resolved
}

function Test-PublicEndpoints {
    $endpoints = @(
        'https://reson8.life',
        'https://www.reson8.life',
        'https://epublisher.reson8.life',
        'https://creative.reson8.life',
        'https://sync.reson8.life',
        'https://youtube.reson8.life',
        'https://reson8.life/api/public/app-status/health',
        'https://reson8.life/api/sovereign/auth/session',
        'https://epublisher.reson8.life/_rons/session',
        'https://creative.reson8.life/_rons/session',
        'https://sync.reson8.life/_rons/session',
        'https://youtube.reson8.life/_rons/session'
    )

    $results = @()
    foreach ($url in $endpoints) {
        $watch = [Diagnostics.Stopwatch]::StartNew()
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
            $watch.Stop()
            $results += [ordered]@{
                url = $url
                ok = ($response.StatusCode -eq 200)
                status = [int]$response.StatusCode
                duration_ms = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                error = $null
            }
        } catch {
            $watch.Stop()
            $status = $null
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
                $status = [int]$_.Exception.Response.StatusCode
            }
            $results += [ordered]@{
                url = $url
                ok = $false
                status = $status
                duration_ms = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                error = $_.Exception.Message
            }
        }
    }

    return [ordered]@{
        checked_at = (Get-Date).ToUniversalTime().ToString('o')
        failures = @($results | Where-Object { -not $_.ok }).Count
        endpoints = $results
    }
}

function Assert-LiveMutationAuthorized {
    param(
        [Parameter(Mandatory=$true)]$Agent,
        [Parameter(Mandatory=$true)][bool]$DryRun,
        [string]$ApprovedAgentSha256,
        [Parameter(Mandatory=$true)][string]$ActualAgentSha256
    )

    if ($DryRun) { return }
    if (-not $Agent.MutationsEnabled) {
        throw 'Local R&D agent mutation kill switch is disabled.'
    }
    if ($ApprovedAgentSha256 -notmatch '^[0-9a-f]{64}

function Invoke-RndOperation {
    param(
        [Parameter(Mandatory=$true)]$Agent,
        [Parameter(Mandatory=$true)]$Job,
        [Parameter(Mandatory=$true)][string]$AgentSha256
    )

    if ([string]$Job.tool_name -ne 'job_start') {
        throw "Unsupported bridge tool: $($Job.tool_name)"
    }

    $payload = $Job.payload
    $operation = [string]$payload.operation
    $dryRun = [bool]$payload.dry_run
    $correlationId = [string]$payload.correlation_id
    $approvedAgentSha256 = [string]$payload.approved_agent_sha256
    $workspace = Assert-Workspace -Agent $Agent -JobWorkspace ([string]$Job.workspace)

    $allowed = @(
        'collect_diagnostics',
        'git_status',
        'verify_public_endpoints',
        'optimize_workspace',
        'sync_main_fast_forward',
        'restart_public_edge'
    )
    if ($allowed -notcontains $operation) {
        throw "Unsupported R&D operation: $operation"
    }
    if ($operation -match '(?i)recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle') {
        throw 'Runner recovery operations are blocked by the RONSAS recovery HOLD.'
    }

    $before = Get-GitSnapshot -Workspace $workspace
    $result = [ordered]@{
        operation = $operation
        dry_run = $dryRun
        correlation_id = $correlationId
        started_at = (Get-Date).ToUniversalTime().ToString('o')
        recovery_hold = $true
        before = $before
        output = $null
        after = $null
    }

    switch ($operation) {
        'collect_diagnostics' {
            $result.output = Get-SystemDiagnostics -Agent $Agent
        }

        'git_status' {
            $result.output = Get-GitSnapshot -Workspace $workspace
        }

        'verify_public_endpoints' {
            $result.output = Test-PublicEndpoints
            if ([int]$result.output.failures -gt 0) {
                throw "Public endpoint verification reported $($result.output.failures) failure(s)."
            }
        }

        'optimize_workspace' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            if ($before.dirty) {
                throw 'Workspace optimization refused because the Git worktree is dirty.'
            }

            $safeCaches = @(
                (Join-Path $workspace 'node_modules\.cache'),
                (Join-Path $workspace 'node_modules\.vite'),
                (Join-Path $workspace '.vite')
            )

            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = @(
                        'git fetch --prune origin',
                        'git gc --auto',
                        'remove allowlisted local build caches only'
                    )
                    caches = $safeCaches
                }
            } else {
                $git = (Get-Command git.exe -ErrorAction Stop).Source
                $fetch = @(& $git -C $workspace fetch --prune origin 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git fetch failed: $($fetch -join ' | ')" }
                $gc = @(& $git -C $workspace gc --auto 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git gc --auto failed: $($gc -join ' | ')" }

                $removed = @()
                foreach ($cache in $safeCaches) {
                    $full = [System.IO.Path]::GetFullPath($cache)
                    if (-not $full.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) {
                        throw "Cache path escaped the workspace: $full"
                    }
                    if (Test-Path -LiteralPath $full) {
                        Remove-Item -LiteralPath $full -Recurse -Force
                        $removed += $full
                    }
                }
                $result.output = [ordered]@{
                    fetch = @($fetch | Select-Object -Last 100)
                    gc = @($gc | Select-Object -Last 100)
                    removed_caches = $removed
                }
            }
        }

        'sync_main_fast_forward' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            if ($before.dirty) {
                throw 'Fast-forward sync refused because the Git worktree is dirty.'
            }
            if ($before.branch -ne 'main') {
                throw "Fast-forward sync refused because the current branch is '$($before.branch)', not main."
            }

            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = @('git fetch origin main', 'git merge --ff-only origin/main')
                    preconditions = 'clean worktree; already on main; local main may not diverge'
                }
            } else {
                $git = (Get-Command git.exe -ErrorAction Stop).Source
                $fetch = @(& $git -C $workspace fetch origin main 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed: $($fetch -join ' | ')" }

                $localHead = ((& $git -C $workspace rev-parse HEAD) | Select-Object -First 1).Trim()
                $remoteHead = ((& $git -C $workspace rev-parse origin/main) | Select-Object -First 1).Trim()
                $mergeBase = ((& $git -C $workspace merge-base HEAD origin/main) | Select-Object -First 1).Trim()
                if ($mergeBase -ne $localHead -and $localHead -ne $remoteHead) {
                    throw 'Fast-forward sync refused because local main is ahead or diverged from origin/main.'
                }

                $merge = @(& $git -C $workspace merge --ff-only origin/main 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git merge --ff-only failed: $($merge -join ' | ')" }
                $result.output = [ordered]@{
                    previous_head = $localHead
                    target_head = $remoteHead
                    merge = @($merge | Select-Object -Last 100)
                }
            }
        }

        'restart_public_edge' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            $script = Join-Path $workspace 'ops\ealiophin\control-center\RONS-Ensure-Public-Edge.ps1'
            if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
                throw "Public edge ensure script is missing: $script"
            }
            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = 'Invoke governed RONS-Ensure-Public-Edge.ps1'
                    script = $script
                    runner_recovery = 'blocked'
                }
            } else {
                $output = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script 2>&1)
                $exit = [int]$LASTEXITCODE
                if ($exit -ne 0) {
                    throw "Public edge ensure failed with exit code $exit: $($output -join ' | ')"
                }
                $verification = Test-PublicEndpoints
                if ([int]$verification.failures -gt 0) {
                    throw "Public edge ensure completed but endpoint verification still reports $($verification.failures) failure(s)."
                }
                $result.output = [ordered]@{
                    exit_code = $exit
                    output = @($output | Select-Object -Last 200)
                    verification = $verification
                }
            }
        }
    }

    $result.after = Get-GitSnapshot -Workspace $workspace
    $result.completed_at = (Get-Date).ToUniversalTime().ToString('o')
    return $result
}

$agent = Read-AgentConfig
$agentSha256 = Get-NormalizedSha256 -Path $PSCommandPath

Write-Host "RONSAS R&D agent starting. device=$($agent.DeviceId) workspace=$($agent.Workspace) mutations=$($agent.MutationsEnabled) sha256=$agentSha256"

do {
    try {
        Invoke-BridgeRpc -Agent $agent -Function 'rnd_agent_heartbeat' -Payload @{
            _metadata = @{
                agent_version = '2'
                agent_sha256 = $agentSha256
                mutations_enabled = [bool]$agent.MutationsEnabled
                recovery_hold = $true
                workspace = $agent.Workspace
                computer = $env:COMPUTERNAME
            }
        } | Out-Null

        $job = Invoke-BridgeRpc -Agent $agent -Function 'rnd_agent_claim_job' -Payload @{}

        if ($null -ne $job -and -not [string]::IsNullOrWhiteSpace([string]$job.id)) {
            $jobId = [string]$job.id
            try {
                if ([bool]$job.cancel_requested) {
                    throw 'Job was already marked cancelled before execution.'
                }

                $result = Invoke-RndOperation -Agent $agent -Job $job -AgentSha256 $agentSha256
                Invoke-BridgeRpc -Agent $agent -Function 'rnd_agent_complete_job' -Payload @{
                    _job_id = $jobId
                    _ok = $true
                    _result = $result
                    _error = $null
                } | Out-Null
                Write-Host "R&D job succeeded: $jobId operation=$($job.payload.operation)"
            } catch {
                $message = $_.Exception.Message
                try {
                    Invoke-BridgeRpc -Agent $agent -Function 'rnd_agent_complete_job' -Payload @{
                        _job_id = $jobId
                        _ok = $false
                        _result = $null
                        _error = $message
                    } | Out-Null
                } catch {
                    Write-Warning "Unable to report failed job completion for $jobId because: $($_.Exception.Message)"
                }
                Write-Warning "R&D job failed: $jobId $message"
            }
        }
    } catch {
        Write-Warning "R&D agent loop error: $($_.Exception.Message)"
    }

    if (-not $Once) {
        Start-Sleep -Seconds $agent.PollSeconds
    }
} while (-not $Once)
) {
        throw 'Live R&D mutation refused because the approved agent SHA-256 is missing or invalid.'
    }
    if ($ActualAgentSha256 -ne $ApprovedAgentSha256) {
        throw "Live R&D mutation refused because the executing agent hash does not match approved main: approved=$ApprovedAgentSha256 actual=$ActualAgentSha256"
    }
}

function Invoke-RndOperation {
    param(
        [Parameter(Mandatory=$true)]$Agent,
        [Parameter(Mandatory=$true)]$Job
    )

    if ([string]$Job.tool_name -ne 'job_start') {
        throw "Unsupported bridge tool: $($Job.tool_name)"
    }

    $payload = $Job.payload
    $operation = [string]$payload.operation
    $dryRun = [bool]$payload.dry_run
    $correlationId = [string]$payload.correlation_id
    $workspace = Assert-Workspace -Agent $Agent -JobWorkspace ([string]$Job.workspace)

    $allowed = @(
        'collect_diagnostics',
        'git_status',
        'verify_public_endpoints',
        'optimize_workspace',
        'sync_main_fast_forward',
        'restart_public_edge'
    )
    if ($allowed -notcontains $operation) {
        throw "Unsupported R&D operation: $operation"
    }
    if ($operation -match '(?i)recover|recycle|runner[_-]?replace|runner[_-]?delete|force[_-]?recycle') {
        throw 'Runner recovery operations are blocked by the RONSAS recovery HOLD.'
    }

    $before = Get-GitSnapshot -Workspace $workspace
    $result = [ordered]@{
        operation = $operation
        dry_run = $dryRun
        correlation_id = $correlationId
        started_at = (Get-Date).ToUniversalTime().ToString('o')
        recovery_hold = $true
        before = $before
        output = $null
        after = $null
    }

    switch ($operation) {
        'collect_diagnostics' {
            $result.output = Get-SystemDiagnostics -Agent $Agent
        }

        'git_status' {
            $result.output = Get-GitSnapshot -Workspace $workspace
        }

        'verify_public_endpoints' {
            $result.output = Test-PublicEndpoints
            if ([int]$result.output.failures -gt 0) {
                throw "Public endpoint verification reported $($result.output.failures) failure(s)."
            }
        }

        'optimize_workspace' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            if ($before.dirty) {
                throw 'Workspace optimization refused because the Git worktree is dirty.'
            }

            $safeCaches = @(
                (Join-Path $workspace 'node_modules\.cache'),
                (Join-Path $workspace 'node_modules\.vite'),
                (Join-Path $workspace '.vite')
            )

            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = @(
                        'git fetch --prune origin',
                        'git gc --auto',
                        'remove allowlisted local build caches only'
                    )
                    caches = $safeCaches
                }
            } else {
                $git = (Get-Command git.exe -ErrorAction Stop).Source
                $fetch = @(& $git -C $workspace fetch --prune origin 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git fetch failed: $($fetch -join ' | ')" }
                $gc = @(& $git -C $workspace gc --auto 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git gc --auto failed: $($gc -join ' | ')" }

                $removed = @()
                foreach ($cache in $safeCaches) {
                    $full = [System.IO.Path]::GetFullPath($cache)
                    if (-not $full.StartsWith($workspace, [StringComparison]::OrdinalIgnoreCase)) {
                        throw "Cache path escaped the workspace: $full"
                    }
                    if (Test-Path -LiteralPath $full) {
                        Remove-Item -LiteralPath $full -Recurse -Force
                        $removed += $full
                    }
                }
                $result.output = [ordered]@{
                    fetch = @($fetch | Select-Object -Last 100)
                    gc = @($gc | Select-Object -Last 100)
                    removed_caches = $removed
                }
            }
        }

        'sync_main_fast_forward' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            if ($before.dirty) {
                throw 'Fast-forward sync refused because the Git worktree is dirty.'
            }
            if ($before.branch -ne 'main') {
                throw "Fast-forward sync refused because the current branch is '$($before.branch)', not main."
            }

            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = @('git fetch origin main', 'git merge --ff-only origin/main')
                    preconditions = 'clean worktree; already on main; local main may not diverge'
                }
            } else {
                $git = (Get-Command git.exe -ErrorAction Stop).Source
                $fetch = @(& $git -C $workspace fetch origin main 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed: $($fetch -join ' | ')" }

                $localHead = ((& $git -C $workspace rev-parse HEAD) | Select-Object -First 1).Trim()
                $remoteHead = ((& $git -C $workspace rev-parse origin/main) | Select-Object -First 1).Trim()
                $mergeBase = ((& $git -C $workspace merge-base HEAD origin/main) | Select-Object -First 1).Trim()
                if ($mergeBase -ne $localHead -and $localHead -ne $remoteHead) {
                    throw 'Fast-forward sync refused because local main is ahead or diverged from origin/main.'
                }

                $merge = @(& $git -C $workspace merge --ff-only origin/main 2>&1)
                if ($LASTEXITCODE -ne 0) { throw "git merge --ff-only failed: $($merge -join ' | ')" }
                $result.output = [ordered]@{
                    previous_head = $localHead
                    target_head = $remoteHead
                    merge = @($merge | Select-Object -Last 100)
                }
            }
        }

        'restart_public_edge' {
            Assert-LiveMutationAuthorized -Agent $Agent -DryRun $dryRun -ApprovedAgentSha256 $approvedAgentSha256 -ActualAgentSha256 $AgentSha256
            $script = Join-Path $workspace 'ops\ealiophin\control-center\RONS-Ensure-Public-Edge.ps1'
            if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
                throw "Public edge ensure script is missing: $script"
            }
            if ($dryRun) {
                $result.output = [ordered]@{
                    plan = 'Invoke governed RONS-Ensure-Public-Edge.ps1'
                    script = $script
                    runner_recovery = 'blocked'
                }
            } else {
                $output = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script 2>&1)
                $exit = [int]$LASTEXITCODE
                if ($exit -ne 0) {
                    throw "Public edge ensure failed with exit code $exit: $($output -join ' | ')"
                }
                $verification = Test-PublicEndpoints
                if ([int]$verification.failures -gt 0) {
                    throw "Public edge ensure completed but endpoint verification still reports $($verification.failures) failure(s)."
                }
                $result.output = [ordered]@{
                    exit_code = $exit
                    output = @($output | Select-Object -Last 200)
                    verification = $verification
                }
            }
        }
    }

    $result.after = Get-GitSnapshot -Workspace $workspace
    $result.completed_at = (Get-Date).ToUniversalTime().ToString('o')
    return $result
}

$agent = Read-AgentConfig
$session = $null
$agentSha256 = Get-NormalizedSha256 -Path $PSCommandPath

Write-Host "RONSAS R&D agent starting. device=$($agent.DeviceId) workspace=$($agent.Workspace) mutations=$($agent.MutationsEnabled) sha256=$agentSha256"

do {
    try {
        if ($null -eq $session -or (Get-Date).ToUniversalTime() -ge $session.ExpiresAt) {
            $session = Get-AgentAccessToken -Agent $agent
        }

        Invoke-BridgeRpc -Agent $agent -Session $session -Function 'bridge_rnd_agent_heartbeat' -Payload @{
            _device_id = $agent.DeviceId
            _metadata = @{
                agent_version = '1'
                agent_sha256 = $agentSha256
                mutations_enabled = [bool]$agent.MutationsEnabled
                recovery_hold = $true
                workspace = $agent.Workspace
                computer = $env:COMPUTERNAME
            }
        } | Out-Null

        $job = Invoke-BridgeRpc -Agent $agent -Session $session -Function 'bridge_rnd_agent_claim_job' -Payload @{
            _device_id = $agent.DeviceId
        }

        if ($null -ne $job -and -not [string]::IsNullOrWhiteSpace([string]$job.id)) {
            $jobId = [string]$job.id
            try {
                if ([bool]$job.cancel_requested) {
                    throw 'Job was already marked cancelled before execution.'
                }

                $result = Invoke-RndOperation -Agent $agent -Job $job
                Invoke-BridgeRpc -Agent $agent -Session $session -Function 'bridge_rnd_agent_complete_job' -Payload @{
                    _device_id = $agent.DeviceId
                    _job_id = $jobId
                    _ok = $true
                    _result = $result
                    _error = $null
                } | Out-Null
                Write-Host "R&D job succeeded: $jobId operation=$($job.payload.operation)"
            } catch {
                $message = $_.Exception.Message
                try {
                    Invoke-BridgeRpc -Agent $agent -Session $session -Function 'bridge_rnd_agent_complete_job' -Payload @{
                        _device_id = $agent.DeviceId
                        _job_id = $jobId
                        _ok = $false
                        _result = $null
                        _error = $message
                    } | Out-Null
                } catch {
                    Write-Warning "Unable to report failed job completion for $jobId because: $($_.Exception.Message)"
                }
                Write-Warning "R&D job failed: $jobId $message"
            }
        }
    } catch {
        $session = $null
        Write-Warning "R&D agent loop error: $($_.Exception.Message)"
    }

    if (-not $Once) {
        Start-Sleep -Seconds $agent.PollSeconds
    }
} while (-not $Once)
