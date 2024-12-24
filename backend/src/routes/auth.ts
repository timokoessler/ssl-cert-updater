import express from 'express';
import isEmail from 'validator/lib/isEmail';
import normalizeEmail from 'validator/lib/normalizeEmail';
import { v4 as uuidv4 } from 'uuid';
import { sendForgotPasswordEmail, sendNewDeviceToken } from '../notifications/email';
import { checkPasswordComplexity, sendResponse, sha512 } from '../utils';
import { timingSafeEqual } from 'node:crypto';
import { createDocument, getUser, saveDocument } from '../core/dbHelper';
import * as Sentry from '@sentry/node';
import {
    checkAuthMiddleware,
    checkKnownDeviceToken,
    checkRegisterToken,
    createTOTPToken,
    generateAuthToken,
    generateKnownDeviceToken,
    generatePasswordHash,
    generateRandomSalt,
    generateTOTPSecret,
    hasFailedLoginAttempts,
    newFailedLoginAttempt,
} from '../core/auth';
import { log } from '../core/log';
import { isDev } from '../constants';
import { generateBrowserFingerprint } from '../core/ua';

export default function (app: express.Application) {
    app.get('/api/loggedIn', checkAuthMiddleware, (req: RequestWithSessionInfo, res) => {
        res.status(200).json(req.sessionInfo);
    });

    app.post('/api/login', async (req, res) => {
        let email: string = req.body.email;
        const password: string = req.body.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
            return sendResponse(res, 401, 'E-Mail Adresse oder Passwort ungültig oder nicht vorhanden.');
        }

        if (await hasFailedLoginAttempts(req.ip)) {
            return sendResponse(res, 403, 'Ihre IP-Adresse wurde aufgrund zahlreicher fehlgeschlagener Anmeldeversuche vorübergehend gesperrt.');
        }

        if (!isEmail(email)) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig.');
        }

        email = normalizeEmail(email) as string;
        if (!email) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig.');
        }

        const user = await getUser({ email: email });
        if (!user) {
            newFailedLoginAttempt(req.ip);
            return sendResponse(res, 403, 'Die eingegebene E-Mail Adresse oder das Passwort ist falsch.');
        }
        if (!user.emailConfirmed) {
            return sendResponse(res, 400, 'Die E-Mail Adresse wurde noch nicht bestätigt. Bitte überprüfen Sie Ihr E-Mail Postfach.');
        }
        let passwordHash: string;
        try {
            passwordHash = await generatePasswordHash(password, user.salt);
        } catch {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        const correctHashBuffer = Buffer.from(user.password);
        const inputHashBuffer = Buffer.from(passwordHash);

        if (correctHashBuffer.byteLength !== inputHashBuffer.byteLength) {
            newFailedLoginAttempt(req.ip);
            return sendResponse(res, 403, 'Die eingegebene E-Mail Adresse und das Passwort stimmen nicht überein.');
        }

        if (!timingSafeEqual(correctHashBuffer, inputHashBuffer)) {
            newFailedLoginAttempt(req.ip);
            return sendResponse(res, 403, 'Die eingegebene E-Mail Adresse und das Passwort stimmen nicht überein.');
        }

        const ua = req.get('User-Agent');
        if (typeof ua !== 'string') {
            return sendResponse(res, 403, 'Missing User-Agent header');
        }

        const browserFingerprint = generateBrowserFingerprint(ua);

        const deviceToken: string = req.body.deviceToken;
        if (typeof deviceToken === 'string') {
            if (!/^\d+$/.test(deviceToken)) {
                return sendResponse(res, 400, 'Der eingegbene Code ist ungültig.');
            }
            const totpToken = createTOTPToken(user.totpSecret);
            if (
                totpToken.validate({
                    token: deviceToken,
                    window: 1,
                }) === null
            ) {
                return sendResponse(res, 400, 'Der eingegbene Code ist ungültig.');
            }

            const trustDevice = req.body.trustDevice;

            if (trustDevice === true) {
                const knownDeviceTokenExpires = 60 * 60 * 24 * 180; //180 days in s
                const knownDeviceToken = await generateKnownDeviceToken(user._id, browserFingerprint, knownDeviceTokenExpires);
                res.cookie('knownDevice', knownDeviceToken, {
                    domain: '',
                    path: '/',
                    maxAge: knownDeviceTokenExpires * 1000,
                    httpOnly: true,
                    secure: !isDev() ? true : false,
                });
            }
        } else {
            const knownDevice = req.cookies.knownDevice;
            if (typeof knownDevice !== 'string') {
                sendNewDeviceToken(user, ua, req.ip);
                return sendResponse(res, 418, "I'm a teapot");
            }

            if (!(await checkKnownDeviceToken(knownDevice, user._id, browserFingerprint))) {
                res.clearCookie('knownDevice', {
                    domain: '',
                    path: '/',
                    httpOnly: true,
                    secure: !isDev() ? true : false,
                });
                sendNewDeviceToken(user, ua, req.ip);
                return sendResponse(res, 418, "I'm a teapot");
            }
        }

        const expiresIn = 60 * 60 * 3; //3h in s

        try {
            const authToken = await generateAuthToken(
                {
                    uid: user._id,
                    fullName: user.fullName,
                    email: user.email,
                    type: 'app',
                    hash: sha512(req.ip),
                },
                expiresIn,
            );
            res.cookie('auth', authToken, {
                domain: '',
                path: '/',
                maxAge: expiresIn * 1000,
                httpOnly: true,
                secure: !isDev() ? true : false,
            });
            sendResponse(res, 200, 'Logged in.');
        } catch {
            return sendResponse(res, 500, 'Internal Server Error');
        }
    });

    app.get('/api/logout', (req, res) => {
        res.clearCookie('auth', {
            domain: '',
            path: '/',
            httpOnly: true,
            secure: !isDev() ? true : false,
        });
        res.redirect(302, '/login?logout=true');
    });

    app.post('/api/register', async (req, res) => {
        const fullName: string = req.body.fullName;
        const password: string = req.body.password;
        const token: string = req.body.token;
        if (typeof password !== 'string' || typeof fullName !== 'string' || typeof token !== 'string') {
            return sendResponse(res, 400, 'E-Mail Adresse oder Passwort ungültig oder nicht vorhanden.');
        }

        let email: string;
        try {
            email = await checkRegisterToken(token);
            if (!email) {
                return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
            }
        } catch {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
        }

        if (!isEmail(email)) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig');
        }

        const passComplexity = checkPasswordComplexity(password);
        if (!passComplexity.valid) {
            return sendResponse(res, 400, passComplexity.reason);
        }

        email = normalizeEmail(email) as string;
        if (!email) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig.');
        }

        const oldUser = await getUser({ email: email });
        if (oldUser) {
            return sendResponse(res, 400, 'Es existiert bereits ein Konto mit dieser E-Mail-Adresse.');
        }
        const salt = generateRandomSalt();
        const id = uuidv4();

        let passwordHash: string;
        try {
            passwordHash = await generatePasswordHash(password, salt);
        } catch (error) {
            log('error', `Error on register generatePasswordHash: ${error.message}`);
            Sentry.captureException(error);
            return sendResponse(res, 500, 'Internal Server Error. Error Code: 0xF1A8');
        }

        const totpSecret = generateTOTPSecret();

        const userData: User = {
            _id: id,
            email: email,
            fullName: fullName,
            password: passwordHash,
            salt: salt,
            webAuthnChallenge: '',
            emailConfirmed: true,
            notificationSettings: {
                successfullCertRequest: true,
                failedCertRequest: true,
                serverOffline: true,
                updateAvailable: true,
                serverError: true,
            },
            totpSecret: totpSecret,
            createdAt: Date.now(),
        };

        const user = await createDocument('User', userData);
        if (!user) {
            return sendResponse(res, 500, 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut oder wenden Sie sich an den Support. (0xF1A9)');
        }
        return sendResponse(res, 200, 'Ihr Konto wurde erfolgreich erstellt. Sie können sich nun anmelden.');
    });

    app.post('/api/forgotPassword', async (req, res) => {
        let email: string = req.body.email;

        if (typeof email !== 'string' || !isEmail(email)) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig.');
        }

        email = normalizeEmail(email) as string;
        if (!email) {
            return sendResponse(res, 400, 'Die E-Mail Adresse ist ungültig.');
        }

        if (await hasFailedLoginAttempts(req.ip)) {
            return sendResponse(res, 403, 'Ihre IP-Adresse wurde aufgrund zahlreicher verdächtiger Aktivitäten vorübergehend gesperrt.');
        }

        const successTxt = 'Wenn ein Konto unter dieser E-Mail-Adresse existiert, erhalten Sie eine E-Mail mit einem Bestätigungslink.';

        const user = await getUser({ email: email });
        if (!user || !user.emailConfirmed) {
            newFailedLoginAttempt(req.ip);
            return sendResponse(res, 200, successTxt);
        }

        sendForgotPasswordEmail(user);
        return sendResponse(res, 200, successTxt);
    });

    app.post('/api/forgotPassword/change/:email/:hash', async (req, res) => {
        const emailBase64: string = req.params.email;
        const hash: string = req.params.hash;

        if (typeof req.body !== 'object') {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0xb)');
        }

        const pass: string = req.body.password;

        if (typeof emailBase64 !== 'string' || typeof hash !== 'string') {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
        }
        let email: string;
        try {
            email = Buffer.from(emailBase64, 'base64url').toString('utf-8');
        } catch {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x2)');
        }
        if (!isEmail(email)) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x3)');
        }

        const user = await getUser({ email: email });
        if (!user) {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig. (0x4)');
        }
        const correctHash = sha512(user._id + user.salt + new Date().toLocaleDateString() + 'cp');

        const correctHashBuffer = Buffer.from(correctHash);
        const hashBuffer = Buffer.from(hash);

        if (correctHashBuffer.byteLength !== hashBuffer.byteLength) {
            return sendResponse(res, 400, 'Der verwendete Link ist nicht mehr gültig. (0x5)');
        }

        if (!timingSafeEqual(correctHashBuffer, hashBuffer)) {
            return sendResponse(res, 400, 'Der verwendete Link ist nicht mehr gültig. (0x5)');
        }

        if (typeof pass !== 'string') {
            return sendResponse(res, 400, 'Das eingegebene Passwort ist nicht erlaubt.');
        }

        const passComplexity = checkPasswordComplexity(pass);
        if (!passComplexity.valid) {
            return sendResponse(res, 400, passComplexity.reason);
        }

        const salt = generateRandomSalt();
        let passwordHash: string;
        try {
            passwordHash = await generatePasswordHash(pass, salt);
        } catch {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        user.salt = salt;
        user.password = passwordHash;

        if (await saveDocument(user)) {
            return sendResponse(res, 200, 'Ihr Passwort wurde erfolgreich geändert.');
        } else {
            return sendResponse(res, 500, 'Es ist ein kritischer Fehler aufgetreten.');
        }
    });

    app.post('/api/register/check-token', async (req, res) => {
        const token: string = req.body.token;
        if (typeof token !== 'string') {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
        }
        try {
            const valid = await checkRegisterToken(token);
            if (!valid) {
                return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
            }
            return sendResponse(res, 200, 'Der Link ist gültig.');
        } catch {
            return sendResponse(res, 400, 'Der verwendete Link ist ungültig.');
        }
    });
}
