import { io, Socket } from 'socket.io-client';
import { log } from './utils/log';
import { getOS, getOSVersion } from './utils';
import { version } from './constants';

let socket: Socket;

export function initWebSocket(config: Config, updateStatus = true, connectCallback?: () => void) {
    try {
        socket = io(config.url + '/client', {
            path: '/socket',
            autoConnect: true,
            auth: {
                id: config.id,
                token: config.token,
                updateStatus: updateStatus,
            },
            extraHeaders: {
                'X-OS': getOS(),
                'X-OS-Version': getOSVersion(),
                'X-Version': version,
            },
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
        });

        socket.on('error', (err) => {
            log('error', err.message);
        });
        socket.on('connect_error', (err) => {
            log('error', `Can not connect to websocket server: ${err.message}`, false);
        });

        socket.on('connect', () => {
            if (typeof connectCallback === 'function') {
                connectCallback();
            }
        });

        socket.on('disconnect', () => {
            log('warn', 'Disconnected from websocket server', false);
        });

        socket.io.on('reconnect', () => {
            log('info', 'Reconnected to websocket server');
        });

        return true;
    } catch (err) {
        log('error', `Can not connect to websocket server: ${err.message}`, false);
        return false;
    }
}

export function getSocket() {
    return socket;
}

export function isWSConnected() {
    return socket && socket.connected;
}
