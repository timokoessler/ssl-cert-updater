/* eslint-disable @typescript-eslint/ban-ts-comment */
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import express from 'express';
import base64url from 'base64url';
import { getDocuments, getDocument, getUser, saveDocument, deleteDocumentQuery, createDocument } from '../core/dbHelper';
import { checkAuthMiddleware, generateAuthToken } from '../core/auth';
import { sendResponse, sha512 } from '../utils';
import { log } from '../core/log';
import { isDev } from '../constants';

export default function (app: express.Application) {
    const rpName = process.env.APP_NAME;
    const rpID = new URL(process.env.URL).hostname;
    const origin = process.env.URL;

    app.get('/api/webAuthn/getRegistrationOptions', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        if (!req.sessionInfo.uid) {
            return sendResponse(res, 401, 'Unauthorized');
        }
        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }

        let authenticators = await getDocuments<Authenticator>('Authenticator', { userID: user._id });
        if (!Array.isArray(authenticators)) {
            // @ts-ignore
            authenticators = [];
        }

        const options = await generateRegistrationOptions({
            rpName: rpName,
            rpID: rpID,
            userID: req.sessionInfo.uid,
            userName: req.sessionInfo.email,
            residentKey: 'required',
            userVerification: 'preferred',
            // @ts-ignore
            excludeCredentials: authenticators.map((authenticator) => ({
                id: authenticator.credentialID,
                type: 'public-key',
            })),
        });

        user.webAuthnChallenge = options.challenge;

        const success = await saveDocument(user);
        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        res.json(options);
    });

    app.post('/api/webAuthn/verifyRegistration', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        if (typeof req.body !== 'object' || typeof req.query.deviceName !== 'string') {
            return sendResponse(res, 400, 'Missing data');
        }
        const user = await getUser({ _id: req.sessionInfo.uid });
        if (!user) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response: req.body,
                expectedChallenge: user.webAuthnChallenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                requireUserVerification: true,
            });
        } catch (error) {
            log('error', `Error on verifyRegistrationResponse: ${error.message}`);
            return sendResponse(res, 400, { error: error.message });
        }

        const { verified, registrationInfo } = verification;
        const { credentialPublicKey, credentialID, counter, credentialDeviceType, credentialBackedUp } = registrationInfo;

        const credentialIDBase64 = base64url(Buffer.from(credentialID));
        const success = await createDocument('Authenticator', {
            credentialID: credentialIDBase64,
            userID: user._id,
            name: req.query.deviceName,
            credentialPublicKey: Buffer.from(credentialPublicKey),
            credentialDeviceType: credentialDeviceType,
            credentialBackedUp: credentialBackedUp,
            counter: counter,
        });

        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        res.json({ verified });
    });

    app.get('/api/webAuthn/getAuthenticationOptions', async (req, res) => {
        const email = req.query.email;
        if (typeof email !== 'string') {
            return sendResponse(res, 404, 'Email required');
        }
        const user = await getUser({ email: email });
        if (!user) {
            return sendResponse(res, 404, 'User not found');
        }

        const authenticators = await getDocuments<Authenticator>('Authenticator', { userID: user._id });

        const options = await generateAuthenticationOptions({
            allowCredentials: authenticators.map((authenticator) => ({
                id: base64url.toBuffer(authenticator.credentialID),
                type: 'public-key',
            })),
            userVerification: 'preferred',
        });

        user.webAuthnChallenge = options.challenge;

        const success = await saveDocument(user);

        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
        res.json(options);
    });

    app.post('/api/webAuthn/verifyAuthentication', async (req, res) => {
        const email = req.query.email;
        if (typeof email !== 'string' || !req.body?.id) {
            return sendResponse(res, 404, 'Missing data');
        }
        const user = await getUser({ email: email });
        if (!user) {
            return sendResponse(res, 404, 'User not found');
        }
        if (!user.emailConfirmed) {
            return sendResponse(res, 400, 'Die E-Mail Adresse wurde noch nicht bestätigt.');
        }

        const authenticator = await getDocument<Authenticator>('Authenticator', { userID: user._id, credentialID: req.body.id });

        if (!authenticator) {
            return sendResponse(res, 404, 'Authenticator not found');
        }
        let verification;

        try {
            verification = await verifyAuthenticationResponse({
                response: req.body,
                expectedChallenge: user.webAuthnChallenge,
                expectedOrigin: origin,
                expectedRPID: rpID,
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                authenticator: authenticator,
                requireUserVerification: true,
            });
        } catch (error) {
            log('error', `Error on verifyAuthenticationResponse: ${error.message}`);
            return sendResponse(res, 400, { error: error.message });
        }

        user.webAuthnChallenge = undefined;
        saveDocument(user);

        const { verified } = verification;
        if (verified !== true) {
            return sendResponse(res, 401, 'Verification failed');
        }
        const { authenticationInfo } = verification;
        const { newCounter } = authenticationInfo;
        authenticator.counter = newCounter;

        const success = await saveDocument(authenticator);

        if (!success) {
            return sendResponse(res, 500, 'Internal Server Error');
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
            res.json({ verified });
        } catch (error) {
            return sendResponse(res, 500, 'Internal Server Error');
        }
    });

    app.get('/api/webAuthn/getAuthenticators', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        let authenticators = await getDocuments<Authenticator>('Authenticator', { userID: req.sessionInfo.uid });

        if (!Array.isArray(authenticators)) {
            // @ts-ignore
            authenticators = [];
        }

        for (const e of authenticators) {
            e.credentialID = undefined;
            e.userID = undefined;
            e.credentialBackedUp = undefined;
            e.credentialDeviceType = undefined;
            e.credentialPublicKey = undefined;
            e.__v = undefined;
        }

        res.json(authenticators);
    });

    app.post('/api/webAuthn/removeDevice', checkAuthMiddleware, async (req: RequestWithSessionInfo, res) => {
        const id = req.body.id;
        if (typeof id !== 'string') {
            return sendResponse(res, 400, 'Invalid data');
        }
        const authenticator = await getDocument<Authenticator>('Authenticator', { userID: req.sessionInfo.uid, _id: id });

        if (!authenticator) {
            return sendResponse(res, 404, 'Can not find Authenticator');
        }
        try {
            await deleteDocumentQuery('Authenticator', { _id: id, userID: req.sessionInfo.uid });
        } catch (error) {
            log('error', `Error on webAuthn removeDevice: ${error.message}`);
            return sendResponse(res, 500, 'Internal Server Error');
        }

        return sendResponse(res, 200, 'OK');
    });
}
