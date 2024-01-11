import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/cluster-adapter';
import { initClientSocket } from './client-socket';
import { initWebSocket } from './browser-socket';
import { log } from '../core/log';

let io: Server;

export async function initSocketServer(http) {
    io = new Server(http, {
        path: '/socket',
        serveClient: false,
    });

    io.adapter(createAdapter());

    initClientSocket(io.of('/client'));
    initWebSocket(io.of('/browser'));

    io.use((socket, next) => {
        if (socket.nsp.name !== '/client' && socket.nsp.name !== '/browser') {
            socket.disconnect();
            return;
        }
        next();
    });
}

export function getSocketIP(socket: Socket) {
    if (process.env.BEHIND_PROXY === 'true') {
        const xRealIP = socket.request.headers['x-real-ip'];
        if (typeof xRealIP === 'string') {
            return xRealIP;
        }
        const forwardedFor = socket.request.headers['x-forwarded-for'];
        if (forwardedFor) {
            let ips: string[];
            if (Array.isArray(forwardedFor)) {
                ips = forwardedFor[0].split(',');
            } else if (typeof forwardedFor === 'string') {
                ips = forwardedFor.split(',');
            }
            if (ips.length) {
                return ips[ips.length - 1].trim();
            }
        }
        log('error', 'Could not get IP from socket, because X-Real-IP and X-Forwarded-For headers are missing or invalid and BEHIND_PROXY is set to true.');
        return socket.handshake.address;
    }
    return socket.handshake.address;
}
