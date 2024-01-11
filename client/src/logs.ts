import { spawn } from 'child_process';
import { log } from './utils/log';
import { getOS } from './utils';

export async function showLogs() {
    if (getOS() !== 'linux') {
        log('error', 'This command only works on linux');
        process.exit(1);
    }

    const journalctl = spawn('journalctl', ['-u', 'sslup', '-e', '-f', '--no-pager']);

    journalctl.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    journalctl.stderr.on('data', (data) => {
        console.error(data.toString());
    });

    journalctl.on('close', (code) => {
        process.exit(code);
    });

    // Listen to SIGINT and SIGTERM signals
    process.on('SIGINT', () => {
        console.log('Stopping...');
        journalctl.kill();
    });

    process.on('SIGTERM', () => {
        console.log('Stopping...');
        journalctl.kill();
    });
}
