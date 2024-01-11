import { verify as verifyJWT, sign as signJWT } from 'jsonwebtoken';
import crypto from 'node:crypto';
import express from 'express';
import db from './db';
import { readFileSync } from 'node:fs';
import * as Sentry from '@sentry/node';
import { sendResponse, sha512 } from '../utils';
import { log } from './log';
import * as OTPAuth from 'otpauth';
import { deleteDocumentQuery, deleteDocumentsQuery } from './dbHelper';

let privateKey: string;

export function generateAuthToken(sessionInfo: SessionInfo, expiresIn: number | string) {
    return new Promise<string>((resolve, reject) => {
        signJWT(sessionInfo, privateKey, { expiresIn: expiresIn, algorithm: 'ES512' }, (err, token) => {
            if (err) {
                log('error', `Error generating auth token: ${err.message}`);
                Sentry.captureException(err);
                reject(err);
                return;
            }
            resolve(token);
        });
    });
}

export function generateRegisterToken(email: string) {
    return new Promise<string>((resolve, reject) => {
        signJWT({ email, type: 'register' }, privateKey, { expiresIn: '48h', algorithm: 'ES512' }, (err, token) => {
            if (err) {
                log('error', `Error generating register token: ${err.message}`);
                Sentry.captureException(err);
                reject(err);
                return;
            }
            resolve(token);
        });
    });
}

export function generateKnownDeviceToken(uid: string, browserFingerprint: string, expiresIn: number | string) {
    return new Promise<string>((resolve, reject) => {
        signJWT(
            { uid: sha512(uid), hash: sha512(browserFingerprint), type: 'knownDevice' },
            privateKey,
            { expiresIn: expiresIn, algorithm: 'ES512' },
            (err, token) => {
                if (err) {
                    log('error', `Error generating known device token: ${err.message}`);
                    Sentry.captureException(err);
                    reject(err);
                    return;
                }
                resolve(token);
            },
        );
    });
}

export function checkAuthToken(auth: string, ip: string) {
    return new Promise<SessionInfo>((resolve, reject) => {
        verifyJWT(auth, privateKey, { algorithms: ['ES512'] }, (err, sessionInfo: SessionInfo) => {
            if (err || sessionInfo.type !== 'app' || sessionInfo.hash !== sha512(ip)) {
                reject(undefined);
                return;
            }
            resolve(sessionInfo);
        });
    });
}

export function checkRegisterToken(auth: string) {
    return new Promise<string>((resolve, reject) => {
        verifyJWT(auth, privateKey, { algorithms: ['ES512'] }, (err, content: { email: string; type: string }) => {
            if (err || content.type !== 'register') {
                reject(undefined);
                return;
            }
            resolve(content.email);
        });
    });
}

export function checkKnownDeviceToken(token: string, uid: string, browserFingerprint: string) {
    return new Promise<boolean>((resolve) => {
        verifyJWT(token, privateKey, { algorithms: ['ES512'] }, (err, content: { uid: string; hash: string; type: string }) => {
            if (err || content.type !== 'knownDevice' || content.uid !== sha512(uid) || content.hash !== sha512(browserFingerprint)) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

export async function checkAuthMiddleware(req: RequestWithSessionInfo, res: express.Response, next: express.NextFunction) {
    try {
        const authCookie = req.cookies.auth;
        if (typeof authCookie !== 'string') {
            return sendResponse(res, 401, 'Unauthorized');
        }

        const valid = await checkAuthToken(authCookie, req.ip);
        if (!valid || valid.type !== 'app') {
            return sendResponse(res, 403, 'Forbidden');
        }

        req.sessionInfo = valid;
        return next();
    } catch (err) {
        return sendResponse(res, 403, 'Forbidden');
    }
}

export async function generatePasswordHash(pass: string, salt: string) {
    return new Promise<string>((resolve, reject) => {
        crypto.scrypt(pass, salt, 64, (err, derivedKey) => {
            if (err) {
                reject(err);
                Sentry.captureException(err);
                return;
            }
            resolve(derivedKey.toString('base64'));
        });
    });
}

export function generateRandomSalt() {
    return crypto.randomBytes(22).toString('base64');
}

export async function newFailedLoginAttempt(ip: string) {
    // If there is already a failed login attempt for this IP, increment the tries and update the time
    // Otherwise, create a new failed login attempt for this IP
    try {
        await db.FailedLoginAttempt().updateOne({ _id: ip }, { $inc: { tries: 1 }, $set: { lastAttempt: new Date() } }, { upsert: true });
        return true;
    } catch (err) {
        log('error', err.message);
        Sentry.captureException(err);
        return false;
    }
}

export async function hasFailedLoginAttempts(ip: string) {
    try {
        const failedLoginAttempt = await db.FailedLoginAttempt().findOne({ _id: ip });
        if (!failedLoginAttempt) {
            return false;
        }
        const lastAttempt = failedLoginAttempt.lastAttempt;
        const timeDiff = Date.now() - lastAttempt;
        if (timeDiff > 300000 || failedLoginAttempt.tries < 8) {
            return false;
        }
        return true;
    } catch (err) {
        log('error', err.message);
        Sentry.captureException(err);
        return false;
    }
}

export async function clearFailedLoginAttempts(ip: string) {
    try {
        await deleteDocumentQuery('FailedLoginAttempt', { _id: ip });
        return true;
    } catch (err) {
        log('error', err.message);
        Sentry.captureException(err);
        return false;
    }
}

export async function clearAllFailedLoginAttempts() {
    try {
        await deleteDocumentsQuery('FailedLoginAttempt', {});
        return true;
    } catch (err) {
        log('error', err.message);
        Sentry.captureException(err);
        return false;
    }
}

export function initAuth() {
    try {
        privateKey = readFileSync(`${__dirname}/config/private-key.pem`, 'utf8');
    } catch (err) {
        log('error', `Error reading private key: ${err.message}`);
        Sentry.captureException(err);
        process.exit(1);
    }
}

export function generateTOTPSecret() {
    return crypto.randomBytes(20).toString('hex');
}

export function createTOTPToken(hexSecret: string) {
    const secret = OTPAuth.Secret.fromHex(hexSecret);
    return new OTPAuth.TOTP({
        issuer: process.env.APP_NAME,
        digits: 6,
        algorithm: 'SHA512',
        period: 120,
        secret: secret,
    });
}
