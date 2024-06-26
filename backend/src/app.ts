import * as dotenv from 'dotenv';
dotenv.config({ path: __dirname + '/config/.env' });
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: 0,
    });
}

import express from 'express';
import cookieParser from 'cookie-parser';
import { initSocketServer } from './sockets/server';
import http from 'node:http';
import db from './core/db';
import { initRoutes } from './routes';
import { initAuth } from './core/auth';
import { init as initNotifications } from './notifications';
import cluster from 'node:cluster';
import { setupPrimary } from '@socket.io/cluster-adapter';
import sirv from 'sirv';
import { log } from './core/log';
import { isDev } from './constants';
import { initCron } from './core/cron';
import { sendPage } from './routes/pages';
import { initDNSServer } from './core/dns';

if (cluster.isPrimary) {
    // Master
    const requiredEnvKeys = [
        'PORT',
        'IP',
        'URL',
        'NODE_ENV',
        'APP_NAME',
        'MONGODB_URI',
        'SMTP_USER',
        'SMTP_PASS',
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_FROM',
        'CLUSTER_WORKERS',
        'ENCRYPTION_TOKEN',
        'BEHIND_PROXY',
    ];

    for (const key of requiredEnvKeys) {
        // eslint-disable-next-line security/detect-object-injection
        if (process.env[key] === undefined) {
            log('error', `Missing environment variable: ${key}`);
            process.exit(1);
        }
    }

    setupPrimary();
    db.init();
    initDNSServer();

    const workerCount = Number(process.env.CLUSTER_WORKERS);
    if (isNaN(workerCount)) {
        throw new Error('Environment variable CLUSTER_WORKERS is NaN');
    }

    if (isDev()) {
        log('warn', 'Running in development mode, not serving frontend files');
    } else {
        log('info', 'Running in production mode, serving frontend files');
    }

    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(cluster.fork());
    }
    workers.sort((a, b) => a.process.pid - b.process.pid);
    workers[workers.length - 1].send('initialStartCron');

    cluster.on('exit', (worker) => {
        log('error', `Worker ${worker.process.pid} died`);
        workers.splice(workers.indexOf(worker), 1);
        workers.push(cluster.fork());
        workers.sort((a, b) => a.process.pid - b.process.pid);
        workers[workers.length - 1].send('startCron');
    });
} else {
    // Worker
    const app: express.Application = express();
    app.use(cookieParser());
    app.use(express.json({ limit: '5mb' }));
    app.disable('x-powered-by');

    if (process.env.BEHIND_PROXY === 'true') {
        app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    }

    process.on('message', (message) => {
        if (message === 'initialStartCron') {
            initCron(true);
        } else if (message === 'startCron') {
            initCron(false);
        }
    });

    app.use((req, res, next) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');

        if (!db.isConnected()) {
            if (req.url.match(/^(\/assets|\/img|\/favicon)/)) {
                next();
                return;
            }
            return sendPage(res, '500');
        }
        next();
    });

    const httpServer = http.createServer(app);

    db.init();
    initAuth();
    initNotifications();
    initRoutes(app);
    initSocketServer(httpServer);

    if (!isDev()) {
        app.use('/', sirv(__dirname + '/frontend'));
    }

    app.use((req, res) => {
        sendPage(res, '404');
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((error, req, res, next) => {
        log('error', error);
        sendPage(res, '500');
    });

    httpServer.listen(Number(process.env.PORT), process.env.IP, () => {
        log('info', `Listening on ${process.env.IP}:${process.env.PORT}`);
    });

    const gracefulShutdown = async (force = false) => {
        await db.close(force);
        httpServer.close((err) => {
            if (err) {
                log('error', `Error closing HTTP server: ${err.message}`);
                process.exit(1);
            }
            log('info', 'HTTP server and MongoDB connection closed. Stopping application...');
            process.exit(0);
        });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', () => gracefulShutdown(true));
    process.on('SIGQUIT', gracefulShutdown);
}
