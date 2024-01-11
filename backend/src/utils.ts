import crypto from 'node:crypto';
import express from 'express';
import isUUID from 'validator/lib/isUUID';

export function sha512(txt: string) {
    return crypto.createHash('sha512').update(txt).digest('hex');
}

export function sendResponse(res: express.Response, statusCode: number, response: object | string | number) {
    if (!res.headersSent) {
        if (typeof response !== 'object') {
            return res.status(statusCode).send(response);
        }
        return res.status(statusCode).json(response);
    }
}

export function validateServerConfig(config: ServerConfig) {
    if (!config || typeof config !== 'object') {
        return false;
    }
    if (Object.keys(config).length !== 4) {
        return false;
    }
    if (!Array.isArray(config.certs) || !Array.isArray(config.preCommands) || !Array.isArray(config.postCommands)) {
        return false;
    }
    for (const cert of config.certs) {
        if (typeof cert !== 'object') {
            return false;
        }
        if (Object.keys(cert).length < 3 || Object.keys(cert).length > 4) {
            return false;
        }
        if (typeof cert._id !== 'string' || !isUUID(cert._id)) {
            return false;
        }
        if (typeof cert.fullchainPath !== 'string' || typeof cert.keyPath !== 'string') {
            return false;
        }
    }
    for (const command of config.preCommands) {
        if (typeof command !== 'string') {
            return false;
        }
    }
    for (const command of config.postCommands) {
        if (typeof command !== 'string') {
            return false;
        }
    }
    return true;
}

export function compareVersions(v1: string, v2: string) {
    const v1Parts = v1.split('.');
    const v2Parts = v2.split('.');

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const v1Part = Number(v1Parts[i]) || 0;
        // eslint-disable-next-line security/detect-object-injection
        const v2Part = Number(v2Parts[i]) || 0;

        if (v1Part > v2Part) {
            return 1;
        } else if (v1Part < v2Part) {
            return 2;
        }
    }

    return 0;
}

export function checkPasswordComplexity(password: string) {
    if (password.length < 12) return { valid: false, reason: 'Das Passwort muss mindestens 12 Zeichen lang sein.' };
    if (!/[a-z]/.test(password)) return { valid: false, reason: 'Das Passwort muss mindestens einen Kleinbuchstaben enthalten.' };
    if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Das Passwort muss mindestens einen Großbuchstaben enthalten.' };
    if (!/[0-9]/.test(password)) return { valid: false, reason: 'Das Passwort muss mindestens eine Zahl enthalten.' };
    if (password.length > 128) return { valid: false, reason: 'Das Passwort darf maximal 128 Zeichen lang sein.' };
    return { valid: true };
}
