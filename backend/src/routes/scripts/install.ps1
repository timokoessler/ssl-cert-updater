$baseURL = "{url}"
$serverID = "{serverID}"
$token = "{token}"
$baseURLBase64 = "{urlBase64}"

$installDir = "$env:ProgramFiles\sslup"
$serviceName = "SSL-Cert Updater Client (sslup)"

Write-Host "Installing SSL-Cert Updater Client (sslup)"

# Check if running as Administrator
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Please run this script as Administrator"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check if the system is supported
if ([Environment]::OSVersion.Version -lt (new-object 'Version' 10,0)) {
    Write-Host "This installer only supports Windows 10 or higher functionality."
    Write-Host "You can still install sslup manually. Download the binary from $baseURL/install/$serverID/bin/windows/x64"
    Write-Host "Run 'sslup setup $baseURLBase64 $serverID $token' to setup sslup"
    Write-Host "You have to ensure that the background service is started on boot (sslup run)"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Get architecture
$architecture = (Get-WmiObject Win32_OperatingSystem).OSArchitecture

# Only support x64 and arm64
if ($architecture -ne "64-bit") {
    Write-Host "This software only supports x64."
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Create installation directory
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir | Out-Null
}

# Check if $installDir\sslup.exe exists
if (Test-Path "$installDir\sslup.exe") {
    Write-Host "sslup is already installed"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

Write-Host "Downloading software..."

# Download sslup executable
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile("$baseURL/install/$serverID/bin/windows/x64", "$installDir\sslup.exe")

#Download Windows Service Wrapper
Write-Host "Downloading Windows Service Wrapper..."
$webClient.DownloadFile("https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe", "$installDir\winsw.exe")

Write-Host "Setting up client..."

# Setup sslup
& "$installDir\sslup.exe" setup $baseURLBase64 $serverID $token

# Write service wrapper configuration to file
@"
<configuration>
    <id>sslup</id>
    <name>SSL-Cert Updater Client</name>
    <description>SSL-Cert Updater Client (sslup)</description>
    <executable>$installDir\sslup.exe</executable>
    <arguments>run</arguments>
    <startmode>Automatic</startmode>
    <logpath>$installDir\logs</logpath>
    <log mode="roll-by-size">
        <sizeThreshold>5120</sizeThreshold>
        <keepFiles>4</keepFiles>
    </log>
    <onfailure action="restart" delay="10 sec"/>
</configuration>
"@ | Out-File "$installDir\winsw.xml" -Encoding utf8

@"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Please run this script as Administrator"
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Stop sslup service
& "$installDir\winsw.exe" stop

# Uninstall sslup service
& "$installDir\winsw.exe" uninstall

# Unregister
sslup uninstall --remote

# Remove installation directory
Remove-Item -Recurse -Force "$installDir"

# Remove config dir
Remove-Item -Recurse -Force "$env:ProgramData\sslup"

# Remove sslup from PATH environment variable
#$updatedPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::Machine)
#$updatedPath = $updatedPath -replace [regex]::Escape("$installDir;"), ""
#[Environment]::SetEnvironmentVariable("Path", $updatedPath, [EnvironmentVariableTarget]::Machine)

Write-Host "Uninstallation completed successfully"
"@ | Out-File "$installDir\uninstall.ps1" -Encoding utf8

# Install sslup as a service using the service wrapper
& "$installDir\winsw.exe" install

# Start sslup service
& "$installDir\winsw.exe" start

$updatedPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::Machine)
if ($updatedPath -notlike "*$installDir*") {
    $updatedPath += ";$installDir"
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, [EnvironmentVariableTarget]::Machine)
}

Write-Host "Installation completed successfully"
Read-Host -Prompt "Press Enter to exit"