import acme from 'acme-client';
import { getDocument, createDocument } from './dbHelper';
import * as Sentry from '@sentry/node';
import isFQDN from 'validator/lib/isFQDN';
import { v4 as uuidv4 } from 'uuid';
import { createDNSChallenge, removeDNSChallenge, verifyDnsChallenge } from './dns';
import { DnsChallenge } from 'acme-client/types/rfc8555';
import { encryptLEAccount } from './aes';
import { newCertRequestLog } from '../sockets/browser-socket';
import { log } from './log';
import { isDev } from '../constants';
import { setTimeout } from 'timers/promises';

export async function requestLetsEncryptCert(
    id: string,
    account: LetsEncryptAccount,
    domains: string[],
): Promise<{ success: boolean; errorMsg?: string; cert?: string; key?: string; intermediateCert?: string; rootCA?: string; commonName?: string }> {
    try {
        if (isDev()) {
            newCertRequestLog('warn', 'Verwende den LetsEncrypt Testserver, da die Anwendung nicht im Produktionsmodus läuft.', id);
        }

        if (domains.length === 0) {
            return { success: false, errorMsg: 'Keine Domains angegeben' };
        }

        // Validate domains
        for (const domain of domains) {
            if (
                !isFQDN(domain, {
                    require_tld: true,
                    allow_underscores: false,
                    allow_trailing_dot: false,
                    allow_wildcard: true,
                })
            ) {
                return { success: false, errorMsg: `Ungültige Domain: ${domain}` };
            }
        }

        // Remove duplicates
        const uniqueDomains = [...new Set(domains)];
        // Select root domain as commonName. If none, select first subdomain
        const commonName = uniqueDomains.find((domain) => domain.split('.').length === 2) || uniqueDomains[0];

        const client = new acme.Client({
            directoryUrl: !isDev() ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
            accountKey: Buffer.from(account.accountKey, 'base64'),
            accountUrl: account.accountUrl,
        });

        const order = await client.createOrder({
            identifiers: uniqueDomains.map((domain) => ({ type: 'dns', value: domain })),
        });

        const authorizations = await client.getAuthorizations(order);

        const promises = authorizations.map(async (authz, index) => {
            let challengeCompleted = false;

            try {
                const { challenges } = authz;

                // Get the dns-01 challenge
                const challenge = challenges.find((challenge) => challenge.type === 'dns-01');
                const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);

                try {
                    const createDNSChallengeSuccess = await createDNSChallenge(
                        id,
                        authz,
                        challenge as DnsChallenge,
                        keyAuthorization,
                        index,
                        authorizations.length,
                    );
                    if (!createDNSChallengeSuccess.success) {
                        newCertRequestLog(
                            'error',
                            `Fehler beim Erstellen des DNS Records für ${authz.identifier.value}: ${createDNSChallengeSuccess.errorMsg}`,
                            id,
                        );
                        throw new Error(createDNSChallengeSuccess.errorMsg);
                    }
                    // Wait for DNS to propagate
                    await setTimeout(10000);
                    const verifyDNS = await verifyDnsChallenge(id, authz, keyAuthorization, index, authorizations.length);
                    if (!verifyDNS.success) {
                        newCertRequestLog(
                            'error',
                            `Fehler beim Verifizieren des DNS Records für Challenge ${index + 1}/${authorizations.length}: ${verifyDNS.errorMsg}`,
                            id,
                        );
                        throw new Error(`Verify DNS: ${verifyDNS.errorMsg}`);
                    }
                    await client.completeChallenge(challenge);
                    challengeCompleted = true;
                    newCertRequestLog(
                        'info',
                        `Warte auf Validierung des DNS Records ${authz.identifier.value} (${index + 1}/${authorizations.length}) durch Lets Encrypt`,
                        id,
                    );
                    await client.waitForValidStatus(challenge);
                } finally {
                    // Clean up challenge response
                    try {
                        const rmRes = await removeDNSChallenge(id, authz, challenge as DnsChallenge, keyAuthorization);
                        if (!rmRes.success) {
                            newCertRequestLog('error', `Fehler beim Entfernen des DNS Records für ${authz.identifier.value}: ${rmRes.errorMsg}`, id);
                        }
                    } catch (e) {
                        /**
                         * Catch errors thrown by challengeRemoveFn() so the order can
                         * be finalized, even though something went wrong during cleanup
                         */
                        newCertRequestLog('error', `Fehler beim Entfernen des DNS Records für ${authz.identifier.value}: ${e.message}`, id);
                        Sentry.captureException(e);
                    }
                }
            } catch (e) {
                // Deactivate pending authz when unable to complete challenge
                if (!challengeCompleted) {
                    try {
                        await client.deactivateAuthorization(authz);
                    } catch (f) {
                        // Catch and suppress deactivateAuthorization() errors
                    }
                }
                throw e;
            }
            newCertRequestLog('info', `DNS-Challenge ${index + 1} von ${authorizations.length} abgeschlossen`, id);
        });

        // Wait for challenges to complete
        await Promise.all(promises);

        // Create CSR
        const [key, csr] = await acme.crypto.createCsr({
            commonName: commonName,
            altNames: uniqueDomains,
        });

        // eslint-disable-next-line quotes
        newCertRequestLog('info', "Sende finale Zertifikat-Anfrage an Let's Encrypt", id);

        // Finalize order with CSR
        const finalized = await client.finalizeOrder(order, csr);
        const cert = await client.getCertificate(finalized);

        newCertRequestLog('info', 'Zertifikat wurde erfolgreich heruntergeladen', id);

        const certParts = acme.crypto.splitPemChain(cert);
        if (certParts.length < 2 || certParts.length > 3) {
            return { success: false, errorMsg: 'Zertifikat konnte nicht geparsed werden' };
        }

        let rootCA = '';
        if (certParts.length === 3) {
            rootCA = certParts[2];
        } else {
            newCertRequestLog('warn', 'Die Zertifikatskette enthält kein Root-CA-Zertifikat. Verwende leeren String.', id);
        }

        return { success: true, cert: certParts[0], key: key.toString(), intermediateCert: certParts[1], rootCA: rootCA, commonName: commonName };
    } catch (err) {
        if (!err.message || !err.message.includes('busy')) {
            Sentry.captureException(err);
        }
        log('error', `Error on requestLetsEncryptCert: ${err.message}`);
        return { success: false, errorMsg: err.message };
    }
}

export async function createLetsEncryptAccount(email: string): Promise<{ success: boolean; errorMsg?: string; id?: string }> {
    try {
        if (isDev()) {
            log('warn', 'Using staging LetsEncrypt server because NODE_ENV is not production');
        }

        const hasAccount = await getDocument<LetsEncryptAccount>('LetsEncryptAccount', { email: email });
        if (hasAccount) {
            return { success: false, errorMsg: 'Account existiert bereits' };
        }

        const privateKey = await acme.crypto.createPrivateRsaKey(4096);

        const client = new acme.Client({
            directoryUrl: !isDev() ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
            accountKey: privateKey,
        });

        const account = await client.createAccount({
            termsOfServiceAgreed: true,
            contact: [`mailto:${email}`],
        });

        if (account.status !== 'valid') {
            log('error', `Error on createLetsEncryptAccount account.status: ${account.status}`);
            return { success: false, errorMsg: 'Account konnte nicht erstellt werden' };
        }

        const letsencryptAccount: LetsEncryptAccount = {
            _id: uuidv4(),
            email: email,
            accountKey: privateKey.toString('base64'),
            accountUrl: client.getAccountUrl(),
            createdAt: Date.now(),
        };

        const encryptedAccount = await encryptLEAccount(letsencryptAccount);
        if (!encryptedAccount) {
            return { success: false, errorMsg: 'Account konnte nicht erstellt werden (Verschlüsselungsfehler)' };
        }

        const dbResult = await createDocument('LetsEncryptAccount', encryptedAccount);
        if (!dbResult) {
            return { success: false, errorMsg: 'Account konnte nicht erstellt werden (Datenbankfehler)' };
        }

        return { success: true, id: letsencryptAccount._id };
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on createLetsEncryptAccount: ${err.message}`);
        return { success: false, errorMsg: err.message };
    }
}

export function getSSLCertInfo(cert: string): { success: boolean; errorMsg?: string; info?: acme.CertificateInfo } {
    try {
        const info = acme.crypto.readCertificateInfo(cert);
        return { success: true, info: info };
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on getSSLCertInfo: ${err.message}`);
        return { success: false, errorMsg: err.message };
    }
}

export async function revokeCert(cert: SSLCert, account: LetsEncryptAccount, reason: number): Promise<{ success: boolean; errorMsg?: string }> {
    try {
        const client = new acme.Client({
            directoryUrl: !isDev() ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
            accountKey: Buffer.from(account.accountKey, 'base64'),
            accountUrl: account.accountUrl,
        });
        await client.revokeCertificate(cert.cert, {
            reason: reason,
        });
        return { success: true };
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on revokeCert: ${err.message}`);
        return { success: false, errorMsg: err.message };
    }
}
