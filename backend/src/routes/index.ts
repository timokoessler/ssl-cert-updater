import express from 'express';
import { default as initAuthRoutes } from './auth';
import { initPageRoutes } from './pages';
import { default as initWebAuthn } from './webAuthn';
import { default as initSettings } from './settings';
import { initScriptRoutes } from './scripts';
import { initCLIRoutes } from './cli';
import { initSentryRoutes } from './sentry';

export function initRoutes(app: express.Application) {
    initAuthRoutes(app);
    initWebAuthn(app);
    initSettings(app);
    initScriptRoutes(app);
    initCLIRoutes(app);
    initSentryRoutes(app);
    initPageRoutes(app);
}
