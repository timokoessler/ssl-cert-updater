import { Option, program } from 'commander';
import { setup } from './setup';
import { startService } from './service';
import { showLogs } from './logs';
import { getOS, isRoot } from './utils';
import { log } from './utils/log';
import { uninstall } from './uninstall';
import { getConfig, loadConfig } from './config';
import { version } from './constants';

if (getOS() == 'linux' && !isRoot()) {
    log('error', 'You must run this command as root');
    process.exit(1);
}

program.name('sslup').version(version).description('A tool to automatically deploy SSL certificates on multiple servers');

program
    .command('setup')
    .description('This command is executed during setup.')
    .argument('<url>', 'Base64 encoded url')
    .argument('<id>', 'The server id')
    .argument('<token>', 'A secret token')
    .action(setup);

program.command('run').description('This runs the background service and must normally not be called manually.').action(startService);

program.command('logs').description('This command shows the logs of the background service. This only works with systemd.').action(showLogs);

program.command('uninstall').description('Uninstall this tool').addOption(new Option('--remote').hideHelp()).action(uninstall);

program
    .command('update')
    .description('View the update command')
    .action(async () => {
        await loadConfig();
        const config = getConfig();
        if (getOS() == 'linux') {
            log('info', `Run the following command to update: bash <(curl -s ${config.url}/update/${config.id})`);
            process.exit(0);
        }
        if (getOS() == 'win32') {
            log('info', `Download the following file and run it to update: ${config.url}/update/${config.id}/win`);
            process.exit(0);
        }
        log('error', 'This command is not supported on this platform');
        process.exit(1);
    });

program.parse();
