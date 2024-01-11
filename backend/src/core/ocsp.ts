import { getCertStatus } from 'easy-ocsp';
import { log } from './log';

export async function getOcspStatus(cert: string, issuer: string) {
    try {
        return await getCertStatus(cert, {
            ca: issuer,
        });
    } catch (err) {
        log('error', `Error getting OCSP status: ${err.message}`);
        return undefined;
    }
}
