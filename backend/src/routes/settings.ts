import express from 'express';
import isEmail from 'validator/lib/isEmail';
import isUUID from 'validator/lib/isUUID';
import { sendChangeEmailConfirmEmail } from '../notifications/email';
import { checkPasswordComplexity, sendResponse, sha512 } from '../utils';
import { timingSafeEqual } from 'node:crypto';
import { deleteUser, getUser, saveDocument } from '../core/dbHelper';
import { checkAuthMiddleware, generatePasswordHash, generateRandomSalt } from '../core/auth';

export default function (app: express.Application) {
    app.post('/api/changePass', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const oldPass: string = req.body.oldPass;
        const newPass: string = req.body.newPass;
        if (typeof oldPass !== 'string' || typeof newPass !== 'string') {
            return sendResponse(res, 400, 'Fehlende Daten.');
        }

        const passComplexity = checkPasswordComplexity(newPass);
        if (!passComplexity.valid) {
            return sendResponse(res, 400, passComplexity.reason);
        }

        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        let oldPasswordHash: string;
        try {
            oldPasswordHash = await generatePasswordHash(oldPass, user.salt);
        } catch (error) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        const correctHashBuffer = Buffer.from(user.password);
        const inputHashBuffer = Buffer.from(oldPasswordHash);

        if (correctHashBuffer.byteLength !== inputHashBuffer.byteLength) {
            return sendResponse(res, 400, 'Das eingegebene alte Passwort ist nicht korrekt.');
        }

        if (!timingSafeEqual(correctHashBuffer, inputHashBuffer)) {
            return sendResponse(res, 400, 'Das eingegebene alte Passwort ist nicht korrekt.');
        }

        let newPasswordHash: string;
        try {
            newPasswordHash = await generatePasswordHash(newPass, user.salt);
        } catch (error) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        const salt = generateRandomSalt();
        user.salt = salt;
        user.password = newPasswordHash;

        const success = await saveDocument(user);
        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        sendResponse(res, 200, 'OK');
    });

    app.post('/api/changeEmail', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const pass: string = req.body.pass;
        const newEmail: string = req.body.newEmail;
        if (typeof pass !== 'string' || typeof newEmail !== 'string') {
            return sendResponse(res, 400, 'Fehlende Daten.');
        }

        if (!isEmail(newEmail)) {
            return sendResponse(res, 400, 'Die neue E-Mail-Adresse ist ungültig.');
        }

        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        let currentPasswordHash: string;
        try {
            currentPasswordHash = await generatePasswordHash(pass, user.salt);
        } catch (error) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        const correctHashBuffer = Buffer.from(user.password);
        const inputHashBuffer = Buffer.from(currentPasswordHash);

        if (correctHashBuffer.byteLength !== inputHashBuffer.byteLength) {
            return sendResponse(res, 400, 'Das eingegebene Passwort ist nicht korrekt.');
        }

        if (!timingSafeEqual(correctHashBuffer, inputHashBuffer)) {
            return sendResponse(res, 400, 'Das eingegebene Passwort ist nicht korrekt.');
        }

        sendChangeEmailConfirmEmail(user, newEmail);
        return res.sendStatus(200);
    });

    app.get('/api/changeEmail/confirm/:userID/:hash/:newEmail', async (req, res) => {
        const userIDBase64: string = req.params.userID;
        const hash: string = req.params.hash;
        const newEmailBase64: string = req.params.newEmail;

        if (typeof userIDBase64 !== 'string' || typeof hash !== 'string' || typeof newEmailBase64 !== 'string') {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
        }
        let uuid: string;
        let newEmail: string;
        try {
            uuid = Buffer.from(userIDBase64, 'base64url').toString('utf-8');
            newEmail = Buffer.from(newEmailBase64, 'base64url').toString('utf-8');
        } catch (e) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x2)');
        }
        if (!isUUID(uuid)) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x3)');
        }
        if (!isEmail(newEmail)) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x3x2)');
        }

        const user = await getUser({ _id: uuid });
        if (!user) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x4)');
        }
        const correctHash = sha512(user.salt + ';;' + new Date().toLocaleDateString() + ';;' + newEmail);

        const correctHashBuffer = Buffer.from(correctHash);
        const hashBuffer = Buffer.from(hash);

        if (correctHashBuffer.byteLength !== hashBuffer.byteLength) {
            return sendResponse(res, 400, 'Der verwendete Link ist nicht mehr gültig. (0x5)');
        }

        if (!timingSafeEqual(correctHashBuffer, hashBuffer)) {
            return sendResponse(res, 400, 'Der verwendete Link ist nicht mehr gültig. (0x5)');
        }

        if (user.email === newEmail) {
            return sendResponse(res, 400, 'Die E-Mail-Adresse wurde bereits geändert.');
        }

        user.email = newEmail;

        const success = await saveDocument(user);
        if (!success) {
            return sendResponse(res, 500, 'Es ist ein kritischer Fehler aufgetreten.');
        }
        return sendResponse(res, 200, 'Ihre E-Mail-Adresse wurde erfolgreich geändert.');
    });

    app.post('/api/deleteAccount', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const pass: string = req.body.pass;
        if (typeof pass !== 'string') {
            return sendResponse(res, 400, 'Fehlende Daten.');
        }
        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        let currentPasswordHash: string;
        try {
            currentPasswordHash = await generatePasswordHash(pass, user.salt);
        } catch (error) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        const correctHashBuffer = Buffer.from(user.password);
        const inputHashBuffer = Buffer.from(currentPasswordHash);

        if (correctHashBuffer.byteLength !== inputHashBuffer.byteLength) {
            return sendResponse(res, 400, 'Das eingegebene Passwort ist nicht korrekt.');
        }

        if (!timingSafeEqual(correctHashBuffer, inputHashBuffer)) {
            return sendResponse(res, 400, 'Das eingegebene Passwort ist nicht korrekt.');
        }

        const result = await deleteUser(user._id);
        if (!result) {
            return sendResponse(res, 500, 'Interner Serverfehler. Bitte versuchen Sie es erneut.');
        }
        return res.sendStatus(200);
    });
    app.get('/api/notificationSettings', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        return res.json(user.notificationSettings);
    });
    app.post('/api/notificationSettings', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        const notificationSettings = req.body;
        if (typeof notificationSettings !== 'object') {
            return sendResponse(res, 400, 'Ungültige Anfrage.');
        }
        // Validate notificationSettings
        const settingsKeys = ['successfullCertRequest', 'failedCertRequest', 'serverOffline', 'updateAvailable', 'serverError'];
        for (const key of settingsKeys) {
            // eslint-disable-next-line security/detect-object-injection
            if (typeof notificationSettings[key] !== 'boolean') {
                return sendResponse(res, 400, 'Fehlerhafte Einstellungen.');
            }
        }
        if (Object.keys(notificationSettings).length !== settingsKeys.length) {
            return sendResponse(res, 400, 'Fehlerhafte Einstellungen.');
        }
        user.notificationSettings = notificationSettings;
        const success = await saveDocument(user);
        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        return res.sendStatus(200);
    });
}
