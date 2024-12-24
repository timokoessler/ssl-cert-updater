import { Namespace, Socket } from 'socket.io';
import * as Sentry from '@sentry/node';
import { createDocument, deleteDocument, getDocument, getDocuments, saveDocument } from '../core/dbHelper';
import { sha512 } from '../utils';
import { generateRandomSalt } from '../core/auth';
import { isIP } from 'node:net';
import { sendNewServerLog } from './browser-socket';
import { log } from '../core/log';
import isUUID from 'validator/lib/isUUID';
import { decryptAES } from '../core/aes';
import { sendServerErrorEmail } from '../notifications/email';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { getSocketIP } from './server';

interface ServerToClientEvents {
    update: (updateInfo: ServerUpdateInfo) => void;
}

interface ClientToServerEvents {
    register: (ips: string[], cb: (token: string) => void) => void;
    uninstall: (cb: (ok: boolean) => void) => void;
    log: (level: LogLevel, content: string, time: number) => void;
    requestUpdateInfo: () => void;
    getCertificates: (certIDs: string[], cb: (certs: SSLCert[]) => void) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InterServerEvents {}

interface SocketData {
    id: string;
    updateStatus: boolean;
}

let ns: Namespace<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
let lastServerError: { serverID: string; time: number; content: string };

export function isServerInSetupMode(server: SSLServer) {
    return server.lastSeen === 0 && server.createdAt > Date.now() - 1000 * 60 * 60 * 24;
}

async function checkAuth(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    try {
        if (!socket.handshake.auth) {
            return false;
        }

        if (typeof socket.handshake.auth.id !== 'string' || typeof socket.handshake.auth.token !== 'string') {
            return false;
        }

        const server = await getDocument<SSLServer>('Server', { _id: socket.handshake.auth.id });
        if (!server) {
            return false;
        }
        if (server._id !== socket.handshake.auth.id) {
            return false;
        }

        if (isServerInSetupMode(server)) {
            if (server.token === socket.handshake.auth.token) {
                socket.data.id = server._id;
                socket.data.updateStatus = false;
                return true;
            }
        }

        if (server.token !== sha512(socket.handshake.auth.token)) {
            return false;
        }

        const ip = getSocketIP(socket);
        if (server.checkIP && server.authIPs && !server.authIPs.includes(ip)) {
            return false;
        }

        if (typeof socket.handshake.auth.updateStatus === 'boolean') {
            socket.data.updateStatus = socket.handshake.auth.updateStatus;
        } else {
            socket.data.updateStatus = true;
        }

        const requiredHeaders = ['x-os', 'x-os-version', 'x-version'];
        for (const header of requiredHeaders) {
            // eslint-disable-next-line security/detect-object-injection
            if (typeof socket.handshake.headers[header] !== 'string') {
                return false;
            }
        }

        socket.data.id = server._id;
        if (socket.data.updateStatus) {
            // Prevent unessessary db writes
            if (server.lastSeen > Date.now() - 1000) {
                return true;
            }
            server.online = true;
            server.lastSeen = Date.now();
            server.ip = ip;
            server.osPlatform = socket.handshake.headers['x-os'] as NodeJS.Platform;
            server.osVersion = socket.handshake.headers['x-os-version'] as string;
            server.version = socket.handshake.headers['x-version'] as string;
            saveDocument(server);
        }

        return true;
    } catch {
        return false;
    }
}

export function initClientSocket(ns_) {
    ns = ns_;

    ns.use(async (socket, next) => {
        if (!(await checkAuth(socket))) {
            next(new Error('Authentication failed'));
            return;
        }
        await socket.join(`client-${socket.data.id}`);
        next();
    });

    ns.on('connection', (socket) => {
        socket.prependAny(async () => {
            const auth = await checkAuth(socket);
            if (!auth) {
                socket.disconnect();
                return;
            }
        });
        socket.on('error', (err) => {
            log('error', `Client socket error: ${err.message}`);
            Sentry.captureException(err);
        });
        socket.on('register', async (ips: string[], cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: socket.data.id });
            if (!server) {
                cb(undefined);
                return;
            }
            if (server.lastSeen !== 0) {
                cb(undefined);
                return;
            }
            if (!Array.isArray(ips)) {
                cb(undefined);
                return;
            }
            for (const ip of ips) {
                if (typeof ip !== 'string' || !isIP(ip)) {
                    cb(undefined);
                    return;
                }
            }
            const newToken = sha512(generateRandomSalt());
            server.token = sha512(newToken);
            server.authIPs = ips;
            if (!saveDocument(server)) {
                cb(undefined);
                return;
            }
            cb(newToken);
        });
        socket.on('disconnect', async () => {
            if (!socket.data.updateStatus) {
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: socket.data.id });
            if (!server) {
                return;
            }
            server.online = false;
            server.lastSeen = Date.now();
            saveDocument(server);
        });
        socket.on('uninstall', async (cb) => {
            if (typeof cb !== 'function') {
                log('warn', `Server ${socket.data.id} sent uninstall event but did not send a callback`);
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: socket.data.id });
            if (!server) {
                cb(true);
                return;
            }
            await deleteDocument(server);
            cb(true);
        });
        socket.on('log', (level, content, time) => {
            if (typeof level !== 'string' || typeof content !== 'string' || typeof time !== 'number') {
                log('warn', `Server ${socket.data.id} sent invalid log data`);
                return;
            }
            if (!['debug', 'info', 'warn', 'error'].includes(level)) {
                log('warn', `Server ${socket.data.id} sent invalid log level ${level}`);
                return;
            }
            newServerLog(socket.data.id, level, content, time);
        });
        socket.on('requestUpdateInfo', async () => {
            const server = await getDocument<SSLServer>('Server', { _id: socket.data.id });
            if (!server) {
                log('warn', `Server ${socket.data.id} requested update info but does not exist`);
                return;
            }
            server.online = true;
            sendUpdateToServer(server);
        });
        socket.on('getCertificates', async (certIDs, cb) => {
            if (typeof cb !== 'function') {
                log('warn', `Server ${socket.data.id} requested certificates but did not send a callback`);
                return;
            }
            if (!Array.isArray(certIDs)) {
                log('warn', `Server ${socket.data.id} requested certificates but did not send an array with ids`);
                cb([]);
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: socket.data.id });
            if (!server) {
                log('warn', `Server ${socket.data.id} requested certificates but does not exist`);
                cb([]);
                return;
            }

            const allowedCertIDs = server.config.certs.map((cert) => cert._id);

            for (const certID of certIDs) {
                if (typeof certID !== 'string' || !isUUID(certID) || !allowedCertIDs.includes(certID)) {
                    log('warn', `Server ${server._id} requested invalid or forbidden certificate ${certID}`);
                    cb([]);
                    return;
                }
            }
            const certs = await getDocuments<SSLCert>('SSLCert', { _id: { $in: certIDs } });
            for (const cert of certs) {
                // Decrypt
                const decryptedKey = await decryptAES(cert.key, cert._id);
                cert.key = decryptedKey;
                if (!decryptedKey) {
                    log('warn', `Server ${server._id} requested certificate ${cert._id} but could not decrypt key`);
                    cb([]);
                    return;
                }
            }
            cb(certs);
        });
    });
}

export async function newServerLog(serverID: string, logLevel: LogLevel, content: string, createdAt?: number) {
    const log: ServerLog = {
        serverID: serverID,
        logLevel: logLevel,
        content: content,
        createdAt: createdAt || Date.now(),
    };
    createDocument('ServerLog', log);
    sendNewServerLog(log);

    if (lastServerError && lastServerError.serverID === serverID && lastServerError.content === content && lastServerError.time > Date.now() - 1000 * 60) {
        return;
    }
    lastServerError = {
        serverID: serverID,
        time: Date.now(),
        content: content,
    };
    const users = await getDocuments<User>('User', { 'notifications.serverError': true });
    if (users.length === 0) {
        return;
    }
    const server = await getDocument<SSLServer>('Server', { _id: serverID });
    if (!server) {
        return;
    }
    for (const user of users) {
        sendServerErrorEmail(user, server, content);
        await setTimeoutPromise(200);
    }
}

export async function sendUpdateToServer(server: SSLServer) {
    if (!server.online) {
        newServerLog(server._id, 'warn', 'Cannot send certifcate update info to server because it is offline');
        return false;
    }
    const updateInfo: ServerUpdateInfo = {
        preCommands: server.config.preCommands,
        certs: [],
        postCommands: server.config.postCommands,
    };
    for (const cert of server.config.certs) {
        const sslCert = await getDocument<SSLCert>('SSLCert', { _id: cert._id });
        if (!sslCert) {
            newServerLog(server._id, 'error', `Cannot send certifcate update info to server because certificate ${cert._id} does not exist`);
            return false;
        }
        const updateInfoSSLCert: ServerUpdateInfoSSLCert = {
            _id: sslCert._id,
            fullchainPath: cert.fullchainPath,
            keyPath: cert.keyPath,
            commonName: sslCert.commonName,
            altNames: sslCert.altNames,
            createdAt: sslCert.createdAt,
            renewedAt: sslCert.renewedAt,
            expiresAt: sslCert.expiresAt,
        };
        updateInfo.certs.push(updateInfoSSLCert);
    }
    ns.to(`client-${server._id}`).emit('update', updateInfo);
}

async function getSocketsForGroup(roomID: string) {
    const sockets = await ns.in(roomID).fetchSockets();
    return sockets.length;
}

export async function cleanUpOnlineServers() {
    const now = Date.now();
    try {
        const servers = await getDocuments<SSLServer>('Server', { online: true, lastSeen: { $lt: now - 1000 * 30 } });
        for (const server of servers) {
            const socketCount = await getSocketsForGroup(`client-${server._id}`);
            if (socketCount === 0) {
                log('debug', `Cleaning up online server ${server._id}`);
                server.online = false;
                server.lastSeen = now;
                saveDocument(server);
            } else if (socketCount > 1) {
                log('warn', `Found ${socketCount} sockets for server ${server._id}`);
            }
        }
    } catch (err) {
        log('error', `Error while cleaning up online servers: ${err.message}`);
        Sentry.captureException(err);
    }
}
