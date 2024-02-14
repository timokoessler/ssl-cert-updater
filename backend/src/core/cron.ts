import { Document } from 'mongoose';
import { newCertRequestLog } from '../sockets/browser-socket';
import { cleanUpOnlineServers, sendUpdateToServer } from '../sockets/client-socket';
import { getSSLCertInfo, requestLetsEncryptCert } from './acme';
import { decryptLEAccount, encryptAES } from './aes';
import { clearAllFailedLoginAttempts } from './auth';
import { createDocument, deleteDocumentQuery, deleteDocumentsQuery, getDocument, getDocuments, saveDocument } from './dbHelper';
import { log } from './log';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { CronJob } from 'cron';
import { sendFailedCertRequestEmail, sendOfflineServerEmail, sendSuccessfullCertRequestEmail } from '../notifications/email';
import { getOcspStatus } from './ocsp';

let initialized = false;
export async function initCron(firstStart: boolean) {
    if (initialized) {
        return;
    }
    initialized = true;
    if (firstStart) {
        log('info', 'Setting up cronjobs (initial application start)');
    } else {
        log('info', 'Setting up cronjobs (worker restart)');
    }

    CronJob.from({
        cronTime: '0 * * * * *',
        onTick: everyMinute,
        start: true,
    });
    CronJob.from({
        cronTime: '0 0 * * * *',
        onTick: everyHour,
        start: true,
    });
    CronJob.from({
        cronTime: '0 15 3 * * *',
        onTick: () => {
            renewCerts();
        },
        start: true,
    });

    if (firstStart) {
        log('info', 'Cleaning up database after initial application start');
        deleteDocumentsQuery('RunningCertRequest', {});
        deleteDocumentsQuery('DNSRecord', {});
    }
}

function everyMinute() {
    cleanUpOnlineServers();
    deleteDocumentsQuery('RunningCertRequest', { startedAt: { $lt: Date.now() - 60 * 60 * 1000 } });
}

function everyHour() {
    clearAllFailedLoginAttempts();
    checkOfflineServers();
    deleteDocumentsQuery('CertRequestLog', { createdAt: { $lt: Date.now() - 7 * 24 * 60 * 60 * 1000 } });
    deleteDocumentsQuery('ServerLog', { createdAt: { $lt: Date.now() - 14 * 24 * 60 * 60 * 1000 } });
}

export async function renewCerts() {
    const sslCerts = await getDocuments<SSLCert>('SSLCert', { autoRenew: true });
    const users = await getDocuments<User>('User', {});

    const successFullRenewals: SSLCert[] = [];
    const failedRenewals: SSLCert[] = [];
    const errorMsgs: string[] = [];

    log('info', `Checking ${sslCerts.length} certificates for renewal`);
    for (const cert of sslCerts) {
        let shouldRenew = false;
        // Check if cert expires in less than 30 days
        if (cert.expiresAt < Date.now() + 30 * 24 * 60 * 60 * 1000) {
            shouldRenew = true;
        } else {
            const ocspStatus = await getOcspStatus(cert.cert, cert.intermediateCert);
            if (ocspStatus && ocspStatus.status === 'revoked') {
                shouldRenew = true;
            }
        }
        if (shouldRenew) {
            newCertRequestLog('info', `Erneuere Zertifikat ${cert.commonName}`, cert._id);
            const result = await renewCert(cert);
            if (!result.success) {
                newCertRequestLog('error', `Fehler bei der Erneuerung des Zertifikats ${cert.commonName}: ${result.errorMsg}`, cert._id);
                failedRenewals.push(cert);
                errorMsgs[cert._id] = result.errorMsg;
                continue;
            }
            newCertRequestLog('info', `Zertifikat ${cert.commonName} erfolgreich erneuert`, cert._id);
            successFullRenewals.push(cert);
        }
    }

    if (successFullRenewals.length !== 0) {
        log('info', 'Finished checking certificates for renewal');
        const servers = await getDocuments<SSLServer>('Server', {});
        for (const server of servers) {
            await sendUpdateToServer(server);
        }
        log('info', 'Finished sending updates to servers');

        for (const user of users) {
            if (user.notificationSettings.successfullCertRequest) {
                sendSuccessfullCertRequestEmail(user, successFullRenewals, true);
                await setTimeoutPromise(500);
            }
        }
    }
    if (failedRenewals.length !== 0) {
        for (const user of users) {
            if (user.notificationSettings.failedCertRequest) {
                sendFailedCertRequestEmail(user, failedRenewals, errorMsgs);
                await setTimeoutPromise(500);
            }
        }
        return false;
    }

    if (!successFullRenewals.length && !failedRenewals.length) {
        log('info', 'No certificates needed to be renewed');
    }

    return true;
}

async function renewCert(sslCert: Document<unknown, null, SSLCert> & SSLCert): Promise<{ success: boolean; errorMsg?: string }> {
    try {
        const account = await getDocument<LetsEncryptAccount>('LetsEncryptAccount', { _id: sslCert.letsencryptAccountID });
        if (!account) {
            return { success: false, errorMsg: 'LetsEncryptAccount konnte nicht gefunden werden' };
        }
        const decryptedLetsEncryptAccount = await decryptLEAccount(account);
        if (!decryptedLetsEncryptAccount) {
            return { success: false, errorMsg: 'Entschlüsselung des LetsEncryptAccounts ist fehlgeschlagen' };
        }

        await createDocument<RunningCertRequest>('RunningCertRequest', {
            _id: sslCert._id,
            altNames: sslCert.altNames,
            startedAt: Date.now(),
        });

        const requestResult = await requestLetsEncryptCert(sslCert._id, decryptedLetsEncryptAccount, sslCert.altNames);

        await deleteDocumentQuery('RunningCertRequest', { _id: sslCert._id });

        if (!requestResult.success) {
            if (requestResult.errorMsg.includes('busy')) {
                return {
                    success: false,
                    errorMsg:
                        'Die Zertifizierungsstelle ist momentan ausgelastet, da sie zu viele Anfragen erhält. Dieser Vorgang wird in 24 Stunden wiederholt.',
                };
            }
            return { success: false, errorMsg: requestResult.errorMsg };
        }

        const certInfo = getSSLCertInfo(requestResult.cert);
        if (!certInfo.success) {
            return { success: false, errorMsg: certInfo.errorMsg };
        }
        const encryptedKey = await encryptAES(requestResult.key, sslCert._id);

        sslCert.cert = requestResult.cert;
        sslCert.intermediateCert = requestResult.intermediateCert;
        sslCert.rootCA = requestResult.rootCA;
        sslCert.key = encryptedKey;
        sslCert.renewedAt = Date.now();
        sslCert.expiresAt = certInfo.info.notAfter.getTime();

        await saveDocument(sslCert);

        return { success: true };
    } catch (err) {
        log('error', `Failed to renew certificate for ${sslCert.commonName}: ${err.message}`);
        return { success: false, errorMsg: err.message };
    }
}

async function checkOfflineServers() {
    const servers = await getDocuments<SSLServer>('Server', { online: false, offlineNotifications: true });
    if (servers.length === 0) {
        return;
    }
    const users = await getDocuments<User>('User', { 'notificationSettings.serverOffline': true });
    if (users.length === 0) {
        return;
    }
    const now = Date.now();
    for (const server of servers) {
        const diff = now - server.lastSeen;
        if (
            (diff > hoursToMs(1) && diff < hoursToMs(2)) ||
            (diff > hoursToMs(24) && diff < hoursToMs(25)) ||
            (diff > hoursToMs(168) && diff < hoursToMs(169))
        ) {
            for (const user of users) {
                sendOfflineServerEmail(user, server);
                await setTimeoutPromise(500);
            }
        }
    }
}

function hoursToMs(hours: number) {
    return hours * 60 * 60 * 1000;
}
