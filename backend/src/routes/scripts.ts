import express from 'express';
import isUUID from 'validator/lib/isUUID';
import { getDocument } from '../core/dbHelper';
import installScript from './scripts/install.sh';
import winInstallScript from './scripts/install.ps1';
import initScript from './scripts/init.sh';
import sslupService from './scripts/sslup.service';
import { isServerInSetupMode } from '../sockets/client-socket';
import { compareVersions, sendResponse } from '../utils';
import { latestClientVersion } from '../constants';
import updateScript from './scripts/update.sh';
import winUpdateScript from './scripts/update.ps1';

export async function initScriptRoutes(app: express.Application) {
    app.get(['/install/:serverID', '/install/:serverID/win'], async (req, res) => {
        const serverID = req.params.serverID;
        if (typeof serverID !== 'string' || !isUUID(serverID)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }
        const server = await getDocument<SSLServer>('Server', { _id: serverID });
        if (!isServerInSetupMode(server)) {
            sendResponse(res, 403, 'Forbidden');
            return;
        }

        let scr: string;
        if (req.path.endsWith('win')) {
            scr = winInstallScript;
        } else {
            scr = installScript;
        }
        scr = scr.replace(/{serverID}/g, serverID);
        scr = scr.replace(/{url}/g, process.env.URL);
        scr = scr.replace(/{token}/g, server.token);
        scr = scr.replace(/{urlBase64}/g, Buffer.from(process.env.URL).toString('base64'));

        res.set('Content-Type', 'text/plain');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (req.path.endsWith('win')) {
            res.set('Content-Disposition', 'attachment; filename="sslup-installer.ps1"');
        }
        res.send(scr);
    });

    app.get('/install/:serverID/bin/:os/:arch', async (req, res) => {
        const serverID = req.params.serverID;
        if (typeof serverID !== 'string' || !isUUID(serverID)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }

        const os = req.params.os;
        if (typeof os !== 'string' || !['linux', 'windows', 'macos'].includes(os)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }

        let arch = req.params.arch;
        if (typeof arch !== 'string' || !['x64', 'arm64', 'x86_64', 'aarch64'].includes(arch)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }
        if (arch === 'x86_64') arch = 'x64';
        if (arch === 'aarch64') arch = 'arm64';

        const server = await getDocument<SSLServer>('Server', { _id: serverID });
        if (!isServerInSetupMode(server) && compareVersions(server.version, latestClientVersion) !== 2) {
            sendResponse(res, 403, 'Forbidden');
            return;
        }
        const fileNames = {
            windows: {
                x64: 'client-win-x64.exe',
                arm64: null,
            },
            linux: {
                x64: 'client-linux-x64',
                arm64: 'client-linux-arm64',
            },
            macos: {
                x64: 'client-macos-x64',
                arm64: null,
            },
        };

        // eslint-disable-next-line security/detect-object-injection
        if (!fileNames[os][arch]) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }

        res.set('Content-Type', 'application/octet-stream');
        if (req.path.endsWith('macos')) {
            res.set('Content-Disposition', 'attachment; filename="sslup"');
        }
        // eslint-disable-next-line security/detect-object-injection
        res.sendFile(`${__dirname}/client/${fileNames[os][arch]}`);
    });

    app.get(['/install/:serverID/linux/systemd', '/install/:serverID/linux/init'], async (req, res) => {
        const serverID = req.params.serverID;
        if (typeof serverID !== 'string' || !isUUID(serverID)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }
        const server = await getDocument<SSLServer>('Server', { _id: serverID });
        if (!isServerInSetupMode(server)) {
            sendResponse(res, 403, 'echo "Access Forbidden"');
            return;
        }

        res.set('Content-Type', 'text/plain');
        if (req.path.endsWith('systemd')) {
            res.send(sslupService);
        } else {
            res.send(initScript);
        }
    });

    app.get(['/update/:serverID', '/update/:serverID/win'], async (req, res) => {
        const serverID = req.params.serverID;
        if (typeof serverID !== 'string' || !isUUID(serverID)) {
            sendResponse(res, 400, 'Bad Request');
            return;
        }
        const server = await getDocument<SSLServer>('Server', { _id: serverID });
        if (compareVersions(server.version, latestClientVersion) !== 2) {
            sendResponse(res, 404, 'echo "No update available"');
            return;
        }

        let scr: string;
        if (req.path.endsWith('win')) {
            scr = winUpdateScript;
        } else {
            scr = updateScript;
        }
        scr = scr.replace(/{serverID}/g, serverID);
        scr = scr.replace(/{url}/g, process.env.URL);

        res.set('Content-Type', 'text/plain');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (req.path.endsWith('win')) {
            res.set('Content-Disposition', 'attachment; filename="sslup-update.ps1"');
        }
        res.send(scr);
    });
}
