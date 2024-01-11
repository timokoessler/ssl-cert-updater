$baseURL = "{url}"
$serverID = "{serverID}"

$installDir = "$env:ProgramFiles\sslup"

Write-Host "Updating SSL-Cert Updater Client (sslup)"

# Check if running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Please run this script as Administrator"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check if the system is supported
if ([Environment]::OSVersion.Version -lt (new-object 'Version' 10,0)) {
    Write-Host "This updater only supports Windows 10 or higher functionality."
    Write-Host "You can still update sslup manually. Download the binary from $baseURL/install/$serverID/bin/windows/x64"
    Write-Host "You have to ensure that the background service is started on boot (sslup run)"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Create installation directory
if (-not (Test-Path $installDir)) {
    Write-Host "Installation directory not found. Please install sslup first."
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check if $installDir\sslup.exe exists
if (-not (Test-Path "$installDir\sslup.exe")) {
    Write-Host "sslup is not installed"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Stop sslup service
& "$installDir\winsw.exe" stop

Write-Host "Downloading update..."

Remove-Item "$installDir\sslup.exe"

# Download sslup executable
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile("$baseURL/install/$serverID/bin/windows/x64", "$installDir\sslup.exe")

# Start sslup service
& "$installDir\winsw.exe" start

Write-Host "Update completed successfully"
Read-Host -Prompt "Press Enter to exit"