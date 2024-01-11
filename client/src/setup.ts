import isURL from 'validator/lib/isURL';
import { log } from './utils/log';
import isUUID from 'validator/lib/isUUID';
import { getOS, isRoot } from './utils';
import { getSocket, initWebSocket, isWSConnected } from './websocket';
import { setTimeout } from 'timers/promises';
import { saveConfig } from './config';
import { getPublicIPs } from './ip';

export async function setup(url: string, id: string, token: string) {
    if (typeof url !== 'string' || typeof id !== 'string' || typeof token !== 'string') {
        log('error', 'Invalid arguments');
        process.exit(1);
    }
    url = Buffer.from(url, 'base64').toString('ascii');

    if (!isURL(url, { protocols: ['http', 'https'], require_protocol: true, disallow_auth: true, require_tld: false })) {
        log('error', 'Invalid url');
        process.exit(1);
    }
    if (!isUUID(id)) {
        log('error', 'Invalid id');
        process.exit(1);
    }
    if (getOS() == 'linux' && !isRoot()) {
        log('error', 'You must run this command as root');
        process.exit(1);
    }

    const config: Config = {
        url,
        id: id,
        token: token,
        _v: 0,
    };

    log('info', 'Connecting to server...');
    initWebSocket(config, false);
    await setTimeout(1000);
    if (!isWSConnected()) {
        await setTimeout(3000);
        if (!isWSConnected()) {
            log('error', 'Can not connect to server (timeout)');
            process.exit(1);
        }
    }
    log('info', 'Connected to server');
    const socket = getSocket();

    const ips = await getPublicIPs();

    log('info', `Detected public IPs: ${ips.join(', ')}`);

    socket.emit('register', ips, async (token: string) => {
        if (typeof token !== 'string') {
            log('error', 'Registration failed');
            process.exit(1);
        }
        config.token = token;
        log('info', 'Registration successful');
        await saveConfig(config);
        socket.disconnect();
        process.exit(0);
    });
}
