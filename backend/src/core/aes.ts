import * as crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { Document } from 'mongoose';
import { log } from './log';

export async function encryptAES(data: string, secret: string): Promise<string | undefined> {
    try {
        const iterations = 100000;
        const keyLength = 32; // 256 bits
        const key = await new Promise<Buffer>((resolve, reject) => {
            crypto.pbkdf2(secret, process.env.ENCRYPTION_TOKEN, iterations, keyLength, 'sha256', (err, derivedKey) => {
                if (err) reject(err);
                else resolve(derivedKey);
            });
        });
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encryptedData = cipher.update(data, 'utf8', 'base64');
        encryptedData += cipher.final('base64');
        return `${iv.toString('base64')}:${encryptedData}`;
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on encryptAES: ${err.message}`);
        return undefined;
    }
}

export async function decryptAES(encryptedData: string, secret: string): Promise<string | undefined> {
    try {
        const iterations = 100000;
        const keyLength = 32; // 256 bits
        const [ivString, encryptedString] = encryptedData.split(':');
        const iv = Buffer.from(ivString, 'base64');
        const key = await new Promise<Buffer>((resolve, reject) => {
            crypto.pbkdf2(secret, process.env.ENCRYPTION_TOKEN, iterations, keyLength, 'sha256', (err, derivedKey) => {
                if (err) reject(err);
                else resolve(derivedKey);
            });
        });
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decryptedData = decipher.update(encryptedString, 'base64', 'utf8');
        decryptedData += decipher.final('utf8');
        return decryptedData;
    } catch (err) {
        Sentry.captureException(err);
        log('error', `Error on decryptAES: ${err.message}`);
        return undefined;
    }
}

export async function encryptLEAccount(letsencryptAccount: LetsEncryptAccount): Promise<LetsEncryptAccount | undefined> {
    const account = { ...letsencryptAccount };
    account.accountKey = await encryptAES(account.accountKey, account._id);
    if (!account.accountKey) {
        return undefined;
    }
    return account;
}

export async function decryptLEAccount(
    letsencryptAccount: Document<unknown, null, LetsEncryptAccount> & LetsEncryptAccount,
): Promise<LetsEncryptAccount | undefined> {
    const account = { ...letsencryptAccount.toObject() };
    account.accountKey = await decryptAES(account.accountKey, account._id);
    if (!account.accountKey) {
        return undefined;
    }
    return account;
}
