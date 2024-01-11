import express from 'express';
import { sendResponse, sha512 } from '../utils';
import { timingSafeEqual } from 'crypto';
import { renewCerts } from '../core/cron';
export async function initCLIRoutes(app: express.Application) {
    app.post('/api/cli/renew', async (req, res) => {
        if (typeof req.headers.authorization !== 'string') {
            return sendResponse(res, 401, 'Authorization failed');
        }

        const correctAuth = sha512(`${process.env.ENCRYPTION_TOKEN}-${process.env.IP}-${process.env.PORT}-renew`);
        const authHeaderBuffer = Buffer.from(req.headers.authorization);
        const authTokenBuffer = Buffer.from(correctAuth);

        if (authHeaderBuffer.byteLength !== authTokenBuffer.byteLength || !timingSafeEqual(authHeaderBuffer, authTokenBuffer)) {
            return sendResponse(res, 401, 'Authorization failed');
        }
        renewCerts();
        return sendResponse(res, 200, 'Renew started');
    });
}
