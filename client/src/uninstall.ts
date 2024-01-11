import chalk from 'chalk';
import { copyFile, writeFile } from 'fs/promises';
import inquirer from 'inquirer';
import { getOS } from './utils';
import { log } from './utils/log';
import { getConfig, initConfig } from './config';
import { getSocket, initWebSocket, isWSConnected } from './websocket';
import { setTimeout } from 'timers/promises';

const uninstallScript = `#!/bin/bash
set -e

echo -e ${chalk.red('Uninstalling SSL-Cert Updater Client')}

if [ "$EUID" -ne 0 ]; then
  echo -e ${chalk.red('Please run as root')}
  exit 1
fi

# Check if using debian based system
if ! [ -f "/etc/debian_version" ]; then
  echo echo -e ${chalk.red('This script only supports debian based systems')}
  exit 1
fi

if [ -d "/run/systemd/system/" ]; then
    systemctl stop sslup
    systemctl disable sslup
    rm -r /etc/systemd/system/sslup.service
    systemctl daemon-reload
elif [ -d "/etc/init.d/" ]; then
    service sslup stop
    rm -r /etc/init.d/sslup
    update-rc.d sslup remove
else
    echo -e ${chalk.red('Could not detect init system')}
    exit 1
fi

sslup uninstall --remote

if [ -d "/etc/sslup" ]; then
    rm -r /etc/sslup
fi

if [ -f "/usr/bin/sslup" ]; then
    rm /usr/bin/sslup
fi

echo -e ${chalk.green('Uninstall successful')}
`;

export async function uninstall(options: { remote?: boolean }) {
    if (options.remote) {
        log('info', 'Connecting to remote server');
        await initConfig();
        const config = getConfig();
        if (!config) {
            log('error', 'No config found');
            process.exit(1);
        }
        initWebSocket(config, false);
        await setTimeout(1000);
        if (!isWSConnected()) {
            log('error', 'Can not connect to server');
            process.exit(1);
        }
        log('info', 'Connected to server');
        const socket = getSocket();

        socket.emit('uninstall', async (ok: boolean) => {
            if (!ok) {
                log('error', 'Server responded with error on uninstall');
                process.exit(1);
            }
            log('info', 'Server responded with success on uninstall');
            socket.disconnect();
            process.exit(0);
        });
        return;
    }

    if (getOS() !== 'linux' && getOS() !== 'win32') {
        console.error(chalk.red('Currently only linux and windows are supported'));
        process.exit(1);
    }

    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to uninstall sslup?',
            default: false,
        },
    ]);

    if (!answers.confirm) {
        console.log('Aborting');
        process.exit(0);
    }

    if (getOS() === 'win32') {
        if (!process.env.PROGRAMFILES) {
            console.error(chalk.red('Can not find %PROGRAMFILES% env variable'));
            process.exit(1);
        }
        if (!process.env.TEMP) {
            console.error(chalk.red('Can not find %TEMP% env variable'));
            process.exit(1);
        }

        await copyFile(process.env.PROGRAMFILES + '\\sslup\\uninstall.ps1', process.env.TEMP + '\\sslup-uninstall.ps1');

        console.info('Run & $env:TEMP\\sslup-uninstall.ps1 as admin to uninstall sslup.');
        return;
    }

    try {
        const uninstallScriptPath = '/tmp/sslup-uninstall.sh';
        await writeFile(uninstallScriptPath, uninstallScript, { mode: 0o755 });
        console.log(`Run ${chalk.green(uninstallScriptPath)} as root to uninstall sslup`);
        process.exit(0);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
