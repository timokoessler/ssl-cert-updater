#!/bin/bash
baseURL="{url}"
serverID="{serverID}"
initSystem=""

set -e

echo -e "\033[0;32m"Updating SSL-Cert Updater Client \(sslup\)"\033[0m"

if [ "$EUID" -ne 0 ]; then
  echo -e "\033[0;31mPlease run as root\033[0m"
  exit 1
fi

# Get architecture
arch=$(uname -m)

# Only support x64 and arm64
if ! [ "$arch" == "x86_64" ] && ! [ "$arch" == "aarch64" ]; then
  echo -e "\033[0;31mCurrently only x64 and arm64 are supported\033[0m"
  exit 1
fi

# Check if using debian based system
if ! [ -f "/etc/debian_version" ]; then
  echo echo -e "\033[0;31mCurrently only debian based systems are supported by this installer\033[0m"
  echo "You can still install the update manually. Download the binary from $baseURL/install/$serverID/bin/linux/$arch"
  echo "You have to ensure that the background service is started on boot (sslup run)"
  exit 1
fi

if ! [ -f "/usr/bin/sslup" ]; then
  echo -e "\033[0;31mSSL-Cert Updater Client (sslup) is already installed in /usr/bin\033[0m"
  exit 1
fi

if ! [ -d "/etc/sslup" ]; then
  echo echo -e "\033[0;31mCould not find sslup config directory\033[0m"
  exit 1
fi

echo -e "\033[0;32mDownloading update...\033[0m"

if [ -d "/run/systemd/system/" ]; then
    initSystem="systemd"
elif [ -d "/etc/init.d/" ]; then
    initSystem="sysvinit"
else
    echo -e "\033[0;31mCould not detect init system\033[0m"
      echo "You can still update sslup manually. Download the binary from $baseURL/install/$serverID/bin/linux/$arch"
      echo "You have to ensure that the background service is started on boot (sslup run)"
    exit 1
fi

if [ "$initSystem" == "systemd" ]; then
  systemctl stop sslup
elif [ "$initSystem" == "sysvinit" ]; then
  service sslup stop
fi

curl -s -o /usr/bin/sslup $baseURL/install/$serverID/bin/linux/$arch
chmod +x /usr/bin/sslup

if [ "$initSystem" == "systemd" ]; then
  systemctl start sslup
elif [ "$initSystem" == "sysvinit" ]; then
  service sslup start
fi

echo -e "\033[0;32mUpdate completed successfully\033[0m"