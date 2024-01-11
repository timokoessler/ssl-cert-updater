import * as crypto from 'crypto';
import { log } from './log';

const aesKey = 'ba9b8e96ffcdd3d2221c4c2540d58ee285f28f36367ca43d418b5a187ba98988';

export function encryptAES(data: string): string | undefined {
    try {
        const key = Buffer.from(aesKey, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encryptedData = cipher.update(data, 'utf8', 'base64');
        encryptedData += cipher.final('base64');
        return `${iv.toString('base64')}:${encryptedData}`;
    } catch (err) {
        log('error', `Error on encryptAES: ${err.message}`);
        return undefined;
    }
}

export function decryptAES(encryptedData: string): string | undefined {
    try {
        const [ivString, encryptedString] = encryptedData.split(':');
        const iv = Buffer.from(ivString, 'base64');
        const key = Buffer.from(aesKey, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decryptedData = decipher.update(encryptedString, 'base64', 'utf8');
        decryptedData += decipher.final('utf8');
        return decryptedData;
    } catch (err) {
        log('error', `Error on decryptAES: ${err.message}`);
        return undefined;
    }
}
