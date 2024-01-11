import { readFile } from 'fs/promises';
import { fileExists } from './files';
import { log } from './log';
import acme from 'acme-client';

export function splitFullchainCert(fullchain: string) {
    try {
        const certParts = acme.crypto.splitPemChain(fullchain);
        if (certParts.length !== 3) {
            throw new Error('Parts length is not 3');
        }
        return certParts;
    } catch (e) {
        log('error', `Error splitting certificate chain: ${e.message}`);
        return null;
    }
}

export function getCertificateInfo(cert: string) {
    try {
        const certInfo = acme.crypto.readCertificateInfo(cert);
        return certInfo;
    } catch (e) {
        log('error', `Error reading certificate info: ${e.message}`);
        return null;
    }
}

export async function readCertificate(fullchainPath: string) {
    try {
        if (!(await fileExists(fullchainPath))) {
            return null;
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const certData = await readFile(fullchainPath, 'ascii');
        if (!certData) {
            return null;
        }
        const certParts = splitFullchainCert(certData);
        if (!certParts || certParts.length !== 3) {
            return null;
        }
        return getCertificateInfo(certParts[0]);
    } catch (err) {
        return null;
    }
}
