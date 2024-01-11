import express from 'express';
import { sendResponse } from '../utils';

export async function initSentryRoutes(app: express.Application) {
    let frontendSentryDSN = process.env.SENTRY_DSN_FRONTEND;
    if (frontendSentryDSN) {
        frontendSentryDSN = Buffer.from(frontendSentryDSN).toString('base64');
    }

    app.get('/api/sentry/frontend/dsn', (req, res) => {
        if (frontendSentryDSN) {
            sendResponse(res, 200, frontendSentryDSN);
        } else {
            sendResponse(res, 204, 'No Content');
        }
    });
}
