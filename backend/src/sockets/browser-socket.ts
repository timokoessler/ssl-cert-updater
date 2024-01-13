import { Namespace, Socket } from 'socket.io';
import * as Sentry from '@sentry/node';
import { checkAuthToken, generateRandomSalt } from '../core/auth';
import { createDocument, deleteDocument, deleteDocumentQuery, deleteSSLCertFromConfigs, getDocument, getDocuments, saveDocument } from '../core/dbHelper';
import { createLetsEncryptAccount, getSSLCertInfo, requestLetsEncryptCert, revokeCert } from '../core/acme';
import isEmail from 'validator/lib/isEmail';
import { v4 as uuidv4 } from 'uuid';
import { decryptLEAccount, encryptAES } from '../core/aes';
import isUUID from 'validator/lib/isUUID';
import { sha512, validateServerConfig } from '../utils';
import { latestClientVersion } from '../constants';
import { log } from '../core/log';
import { sendUpdateToServer } from './client-socket';
import { getSocketIP } from './server';
import { checkDNSConfiguration } from '../core/dns';
import isFQDN from 'validator/lib/isFQDN';

const lastCertRequestLogs = [];

interface ServerToClientEvents {
    certRequestStatus: (certID: string, success: boolean, errorMsg?: string) => void;
    certRequestLog: (log: CertRequestLog) => void;
    serversUpdate: (servers: SSLServer[]) => void;
    sslCertsUpdate: (certs: SSLCert[]) => void;
    letsEncryptAccountsUpdate: (accounts: LetsEncryptAccount[]) => void;
    serverLog: (log: ServerLog) => void;
    runningCertRequestsUpdate: (requests: RunningCertRequest[]) => void;
}

interface ClientToServerEvents {
    getLetsEncryptAccounts: (cb: (accounts: LetsEncryptAccount[]) => void) => void;
    createLetsEncryptAccount: (email: string, cb: (success: boolean, data: string) => void) => void;
    requestLetsEncryptCert: (accountID: string, domains: string[], cb: (success: boolean, errorMsg?: string, id?: string) => void) => void;
    checkDNSConfig: (domains: string[], cb: (status: { domain: string; success: boolean }[], destination: string) => void) => void;
    getRunningCertRequests: (cb: (requests: RunningCertRequest[]) => void) => void;
    getCertRequestLogs: (certID: string, cb: (logs: CertRequestLog[]) => void) => void;
    getSSLCertList: (cb: (certs: SSLCert[]) => void) => void;
    createServer: (name: string, checkIP: boolean, cb: (url: string, id: string, token: string) => void) => void;
    getServerList: (cb: (servers: SSLServer[], latestClientVersion: string) => void) => void;
    joinUIUpdates: (type: UIUpdateEventType | UIUpdateEventType[]) => void;
    leaveUIUpdates: (type: UIUpdateEventType | UIUpdateEventType[]) => void;
    requestUIUpdate: (type: UIUpdateEventType | UIUpdateEventType[]) => void;
    getServer: (id: string, cb: (server: SSLServer) => void) => void;
    getServerLogs: (id: string, cb: (logs: ServerLog[]) => void) => void;
    joinServerLogsUpdates: (id: string) => void;
    leaveServerLogsUpdates: (id: string) => void;
    updateServerConfig: (
        id: string,
        name: string,
        checkIP: boolean,
        authIPs: string[],
        offlineNotifications: boolean,
        config: ServerConfig,
        cb: (responseCode: number) => void,
    ) => void;
    deleteServer: (id: string, cb: (error: string) => void) => void;
    removeSSLCert: (id: string, revoke: boolean, revokeReason: number, cb: (success: boolean, errorMsg?: string) => void) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface InterServerEvents {}

interface SocketData {
    sessionInfo: SessionInfo;
}

let ns: Namespace<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

async function checkAuth(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    try {
        if (socket.request.headers.cookie && socket.request.headers.cookie.includes('auth=')) {
            const authToken = socket.request.headers.cookie.split('auth=')[1].split(';')[0];
            const sessionInfo = await checkAuthToken(authToken, getSocketIP(socket));
            if (!sessionInfo || sessionInfo.type !== 'app') {
                return false;
            }
            if (!socket.data.sessionInfo) {
                socket.data.sessionInfo = sessionInfo;
                return true;
            } else if (socket.data.sessionInfo.uid === sessionInfo.uid) {
                return true;
            }
        }
        return false;
    } catch (err) {
        return false;
    }
}

export function initWebSocket(ns_) {
    ns = ns_;

    ns.use(async (socket, next) => {
        if (!(await checkAuth(socket))) {
            next(new Error('Authentication failed'));
            return;
        }
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
            log('error', `Socket error: ${err.message}`);
            Sentry.captureException(err);
        });
        socket.on('getLetsEncryptAccounts', async (cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            const accounts = await getDocuments<LetsEncryptAccount>('LetsEncryptAccount', {});
            for (const account of accounts) {
                account.accountKey = undefined;
                account.accountUrl = undefined;
            }
            cb(accounts);
        });
        socket.on('createLetsEncryptAccount', async (email, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof email !== 'string' || !isEmail(email)) {
                cb(false, 'Ungültige E-Mail Adresse');
                return;
            }
            const account = await createLetsEncryptAccount(email);
            if (!account.success) {
                cb(account.success, account.errorMsg);
                return;
            }
            cb(account.success, account.id);
        });
        socket.on('requestLetsEncryptCert', async (accountID, domains, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof accountID !== 'string' || !accountID.length) {
                cb(false, 'Ungültige LetsEncrypt Account ID');
                return;
            }
            if (!Array.isArray(domains)) {
                cb(false, 'Keine Domains angegeben');
                return;
            }
            const account = await getDocument<LetsEncryptAccount>('LetsEncryptAccount', { _id: accountID });
            if (!account) {
                cb(false, 'Account nicht gefunden');
                return;
            }

            const decryptLetsEncryptAccount = await decryptLEAccount(account);
            if (!decryptLetsEncryptAccount) {
                cb(false, 'Entschlüsselung des LetsEncrypt Accounts fehlgeschlagen');
                return;
            }

            const id = uuidv4();
            await createDocument<RunningCertRequest>('RunningCertRequest', {
                _id: id,
                altNames: domains,
                startedAt: Date.now(),
            });
            cb(true, '', id);

            newCertRequestLog('info', `Starte die Zertifikatsanfrage für ${domains.join(', ')}`, id);

            const requestResult = await requestLetsEncryptCert(id, decryptLetsEncryptAccount, domains);

            await deleteDocumentQuery('RunningCertRequest', { _id: id });

            if (!requestResult.success) {
                let errMsg = requestResult.errorMsg;
                if (requestResult.errorMsg.includes('busy')) {
                    errMsg = 'Die Zertifikatsanfrage ist fehlgeschlagen, da LetsEncrypt aktuell zu viele Anfragen erhält. Bitte versuche es später erneut.';
                }
                newCertRequestLog('error', `Es ist ein Fehler beim Anfordern des Zertifikats aufgetreten : ${errMsg}`, id);
                socket.emit('certRequestStatus', id, false, errMsg);
                return;
            }

            const certInfo = getSSLCertInfo(requestResult.cert);
            if (!certInfo.success) {
                newCertRequestLog('error', `Es ist ein Fehler beim Analysieren des Zertifikats aufgetreten : ${certInfo.errorMsg}`, id);
                socket.emit('certRequestStatus', id, false, certInfo.errorMsg);
                return;
            }
            const encryptedKey = await encryptAES(requestResult.key, id);

            const sslcert: SSLCert = {
                _id: id,
                commonName: requestResult.commonName,
                altNames: domains,
                type: 'letsencrypt',
                letsencryptAccountID: accountID,
                cert: requestResult.cert,
                intermediateCert: requestResult.intermediateCert,
                rootCA: requestResult.rootCA,
                key: encryptedKey,
                createdAt: Date.now(),
                renewedAt: Date.now(),
                expiresAt: certInfo.info.notAfter.getTime(),
                autoRenew: true,
            };

            const dbResult = await createDocument('SSLCert', sslcert);
            if (!dbResult) {
                newCertRequestLog('error', 'Es ist ein Datenbankfehler aufgetreten', id);
                socket.emit('certRequestStatus', id, false, 'Es ist ein Datenbankfehler aufgetreten');
                return;
            }

            newCertRequestLog('info', 'Ausstellung des Zertifikats erfolgreich', id);
            socket.emit('certRequestStatus', id, true);
        });
        socket.on('getRunningCertRequests', async (cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            cb(await getDocuments<RunningCertRequest>('RunningCertRequest', {}));
        });
        socket.on('getCertRequestLogs', async (certID, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof certID !== 'string' || !isUUID(certID)) {
                cb([]);
                return;
            }
            cb(await getDocuments<CertRequestLog>('CertRequestLog', { certID }));
        });
        socket.on('getSSLCertList', async (cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            const certs = await getDocuments<SSLCert>('SSLCert', {});
            for (const cert of certs) {
                cert.key = undefined;
                cert.cert = undefined;
                cert.intermediateCert = undefined;
                cert.rootCA = undefined;
            }
            cb(certs);
            return;
        });
        socket.on('createServer', async (name, checkIP, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof name !== 'string' || name.length < 3 || name.length > 32) {
                cb(undefined, undefined, undefined);
                return;
            }
            const id = uuidv4();
            const token = sha512(generateRandomSalt());
            const createDocSuccess = await createDocument<SSLServer>('Server', {
                _id: id,
                name,
                token,
                config: {
                    preCommands: [],
                    certs: [],
                    postCommands: [],
                    v: 0,
                },
                checkIP,
                lastSeen: 0,
                online: false,
                version: '???',
                offlineNotifications: true,
                createdAt: Date.now(),
            });

            if (!createDocSuccess) {
                cb(undefined, undefined, undefined);
                return;
            }

            cb(process.env.URL, id, token);
            return;
        });
        socket.on('getServerList', async (cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            const servers = await getDocuments<SSLServer>('Server', {});
            for (const server of servers) {
                server.token = undefined;
            }
            cb(servers, latestClientVersion);
            return;
        });
        socket.on('joinUIUpdates', async (type) => {
            if (typeof type === 'string') {
                if (getUpdateUIEventTypes().includes(type)) {
                    socket.join(`ui-updates-${type}`);
                    return;
                }
            }
            if (Array.isArray(type)) {
                for (const t of type) {
                    if (typeof t === 'string' && getUpdateUIEventTypes().includes(t)) {
                        socket.join(`ui-updates-${t}`);
                    }
                }
            }
        });
        socket.on('leaveUIUpdates', async (type) => {
            if (typeof type === 'string') {
                if (getUpdateUIEventTypes().includes(type)) {
                    socket.leave(`ui-updates-${type}`);
                    return;
                }
            }
            if (Array.isArray(type)) {
                for (const t of type) {
                    if (typeof t === 'string' && getUpdateUIEventTypes().includes(t)) {
                        socket.leave(`ui-updates-${t}`);
                    }
                }
            }
        });
        socket.on('requestUIUpdate', async (type) => {
            if (typeof type === 'string') {
                if (getUpdateUIEventTypes().includes(type)) {
                    updateUIEvent(type);
                    return;
                }
            }
            if (Array.isArray(type)) {
                for (const t of type) {
                    if (typeof t === 'string' && getUpdateUIEventTypes().includes(t)) {
                        updateUIEvent(t);
                    }
                }
            }
        });
        socket.on('getServer', async (id, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof id !== 'string' || !isUUID(id)) {
                cb(undefined);
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: id });
            if (!server) {
                cb(undefined);
                return;
            }
            server.token = undefined;
            cb(server);
            return;
        });
        socket.on('getServerLogs', async (id, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof id !== 'string' || !isUUID(id)) {
                cb(undefined);
                return;
            }
            const logs = await getDocuments<ServerLog>('ServerLog', { serverID: id });
            cb(logs);
            return;
        });
        socket.on('joinServerLogsUpdates', async (id) => {
            if (typeof id !== 'string' || !isUUID(id)) {
                return;
            }
            socket.join(`server-logs-${id}`);
        });
        socket.on('leaveServerLogsUpdates', async (id) => {
            if (typeof id !== 'string' || !isUUID(id)) {
                return;
            }
            socket.leave(`server-logs-${id}`);
        });
        socket.on('updateServerConfig', async (id, name, checkIP, authIPs, offlineNotifications, config, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof id !== 'string' || !isUUID(id)) {
                cb(1);
                return;
            }
            if (typeof name !== 'string' || name.length < 3 || name.length > 32) {
                cb(1);
                return;
            }
            if (typeof checkIP !== 'boolean') {
                cb(1);
                return;
            }
            if (checkIP && (!Array.isArray(authIPs) || !authIPs.length)) {
                cb(1);
                return;
            }
            if (!validateServerConfig(config)) {
                cb(1);
                return;
            }
            if (typeof offlineNotifications !== 'boolean') {
                cb(1);
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: id });
            if (!server) {
                cb(2);
                return;
            }
            if (server.config.v + 1 !== config.v) {
                cb(3);
                return;
            }
            server.name = name;
            server.checkIP = checkIP;
            if (server.checkIP) server.authIPs = authIPs;
            server.config = config;
            server.offlineNotifications = offlineNotifications;
            const dbResult = await saveDocument(server);
            if (!dbResult) {
                cb(4);
                return;
            }
            sendUpdateToServer(server);
            cb(0);
        });
        socket.on('deleteServer', async (id, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof id !== 'string' || !isUUID(id)) {
                cb('Ungültige ID');
                return;
            }
            const server = await getDocument<SSLServer>('Server', { _id: id });
            if (!server) {
                cb('Server nicht gefunden');
                return;
            }
            const dbResult = await deleteDocument(server);
            if (!dbResult) {
                cb('Datenbankfehler');
                return;
            }
            cb(undefined);
            return;
        });
        socket.on('removeSSLCert', async (id, revoke, revokeReason, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            if (typeof id !== 'string' || !isUUID(id)) {
                cb(false, 'Ungültige ID');
                return;
            }
            const cert = await getDocument<SSLCert>('SSLCert', { _id: id });
            if (!cert) {
                cb(false, 'Das Zertifikat konnte nicht gefunden werden');
                return;
            }
            if (typeof revoke !== 'boolean') {
                cb(false, 'Ungültige Eingabe');
                return;
            }
            if (revoke) {
                if (cert.expiresAt < Date.now()) {
                    cb(false, 'Das Zertifikat kann nicht widerrufen werden, da es bereits abgelaufen ist.');
                    return;
                }
                if (cert.type !== 'letsencrypt') {
                    cb(false, 'Das Zertifikat kann nicht widerrufen werden, da es nicht von LetsEncrypt ausgestellt wurde.');
                    return;
                }
                if (typeof revokeReason !== 'number') {
                    cb(false, 'Revoke-Grund fehlt');
                    return;
                }
                if (![0, 1, 3, 4, 5].includes(revokeReason)) {
                    cb(false, 'Ungültiger Revoke-Grund');
                    return;
                }
                const account = await getDocument<LetsEncryptAccount>('LetsEncryptAccount', { _id: cert.letsencryptAccountID });
                if (!account) {
                    return { success: false, errorMsg: 'LetsEncryptAccount konnte nicht gefunden werden' };
                }
                const decryptedLetsEncryptAccount = await decryptLEAccount(account);
                if (!decryptedLetsEncryptAccount) {
                    return { success: false, errorMsg: 'Entschlüsselung des LetsEncryptAccounts ist fehlgeschlagen' };
                }
                const res = await revokeCert(cert, decryptedLetsEncryptAccount, revokeReason);
                if (!res.success) {
                    cb(false, res.errorMsg);
                    return;
                }
            }
            const dbResult = await deleteDocument(cert);
            if (!dbResult) {
                cb(false, 'Datenbankfehler');
                return;
            }
            await deleteSSLCertFromConfigs(cert._id);
            cb(true);
        });

        socket.on('checkDNSConfig', async (domains, cb) => {
            if (typeof cb !== 'function') {
                return;
            }
            const hostname = process.env.URL.split('//')[1];
            if (!Array.isArray(domains)) {
                cb(undefined, hostname);
                return;
            }
            const results = [];
            for (const domain of domains) {
                if (
                    typeof domain !== 'string' ||
                    !isFQDN(domain, {
                        require_tld: true,
                        allow_underscores: false,
                        allow_trailing_dot: false,
                        allow_wildcard: true,
                    })
                ) {
                    cb(undefined, hostname);
                    return;
                }
                results.push({
                    domain,
                    success: (await checkDNSConfiguration(domain)).success,
                });
            }
            cb(results, hostname);
        });
    });
}

export async function newCertRequestLog(logLevel: LogLevel, content: string, certID: string) {
    // eslint-disable-next-line security/detect-object-injection
    if (lastCertRequestLogs && lastCertRequestLogs[certID] === content) {
        return;
    }
    // eslint-disable-next-line security/detect-object-injection
    lastCertRequestLogs[certID] = content;
    const certRequestLog: CertRequestLog = {
        certID,
        content,
        logLevel,
        createdAt: Date.now(),
    };
    createDocument('CertRequestLog', certRequestLog);
    ns.emit('certRequestLog', certRequestLog);
    log(logLevel, `Cert Request Log: ${content}`);
}

async function getSocketsForGroup(roomID: string) {
    return (await ns.in(roomID).fetchSockets()).length;
}

export function getUpdateUIEventTypes(): UIUpdateEventType[] {
    return ['server', 'sslcert', 'letsencryptaccount', 'runningcertrequest'];
}

export async function updateUIEvent(type: UIUpdateEventType) {
    try {
        if (type === 'server') {
            if (!(await getSocketsForGroup('ui-updates-server'))) {
                return;
            }
            const servers = await getDocuments<SSLServer>('Server', {});
            ns.to('ui-updates-server').emit('serversUpdate', servers);
            return;
        }
        if (type === 'sslcert') {
            if (!(await getSocketsForGroup('ui-updates-sslcert'))) {
                return;
            }
            const certs = await getDocuments<SSLCert>('SSLCert', {});
            ns.to('ui-updates-sslcert').emit('sslCertsUpdate', certs);
            return;
        }
        if (type === 'letsencryptaccount') {
            if (!(await getSocketsForGroup('ui-updates-letsencryptaccount'))) {
                return;
            }
            const accounts = await getDocuments<LetsEncryptAccount>('LetsEncryptAccount', {});
            ns.to('ui-updates-letsencryptaccount').emit('letsEncryptAccountsUpdate', accounts);
            return;
        }
        if (type === 'runningcertrequest') {
            if (!(await getSocketsForGroup('ui-updates-runningcertrequest'))) {
                return;
            }
            const requests = await getDocuments<RunningCertRequest>('RunningCertRequest', {});
            ns.to('ui-updates-runningcertrequest').emit('runningCertRequestsUpdate', requests);
            return;
        }
        log('warn', `Unknown UIUpdateEventType: ${type}`);
    } catch (err) {
        log('error', `Error on updateUIEvent: ${err.message}`);
        Sentry.captureException(err);
    }
}

export async function sendNewServerLog(log: ServerLog) {
    ns.to(`server-logs-${log.serverID}`).emit('serverLog', log);
}
