import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isDev } from '../constants';

const pages = [
    { name: 'index', path: '', auth: true },
    { name: 'login', path: 'login', auth: false },
    { name: 'settings', path: 'settings', auth: true },
    { name: 'forgotPassword', path: 'forgotPassword', auth: false },
    { name: 'licenses', path: 'licenses', auth: true },
    { name: 'newCert', path: 'newCert', auth: true },
    { name: 'advanced', path: 'advanced', auth: true },
    { name: 'newServer', path: 'newServer', auth: true },
    { name: '404', path: '404', auth: false },
    { name: '500', path: '500', auth: false },
    { name: 'register', path: 'register/:token', auth: false },
    { name: 'changeEmailConfirm', path: 'changeEmail/confirm/:userID/:hash/:newEmail', auth: false },
    { name: 'forgotPasswordChange', path: 'forgotPassword/change/:email/:hash', auth: false },
    { name: 'server', path: 'server/:serverID', auth: true },
    { name: 'serverLogs', path: 'server/:serverID/logs', auth: true },
];

let pageCache: Map<string, string>;

export function sendPage(res: express.Response, pageName: string) {
    const page = pageCache.get(pageName);
    if (!page) {
        res.status(500).send('Internal Server Error');
        return;
    }
    res.header('Content-Type', 'text/html');
    res.header('Cache-Control', 'private, max-age=300');
    if (pageName === '404') {
        res.status(404);
    } else if (pageName === '500') {
        res.status(500);
    }
    res.send(page);
}

export async function initPageRoutes(app: express.Application) {
    pageCache = new Map();

    for (const page of pages) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const html = readFileSync(path.resolve(__dirname + `/frontend/${page.name}.html`), 'utf-8');
        pageCache.set(page.name, html);
    }

    if (!isDev()) {
        for (const page of pages) {
            app.get(`/${page.path}`, (req, res) => {
                if (page.auth && (!req.cookies || !req.cookies.auth)) {
                    res.redirect(302, '/login');
                    return;
                }
                if (req.path.slice(-1) === '/' && req.path.length > 1) {
                    const query = req.url.slice(req.path.length);
                    const safepath = req.path.slice(0, -1).replace(/\/+/g, '/');
                    return res.redirect(301, safepath + query);
                }
                sendPage(res, page.name);
            });
            app.get(`/${page.path}.html`, (req, res) => {
                res.redirect(302, `/${page.path}`);
            });
        }
    } else {
        app.get('*', (req, res) => {
            res.redirect(302, 'http://localhost:3001' + req.url);
        });
    }

    app.get('/index.html', (req, res) => {
        res.redirect(302, '/');
    });
}
