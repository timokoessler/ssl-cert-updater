/* eslint-disable security/detect-non-literal-fs-filename */
import cluster from 'cluster';
import { log } from './utils/log';
import { getConfig, initConfig } from './config';
import { getSocket, initWebSocket } from './websocket';
import { setTimeout } from 'timers/promises';
import { getCertificateInfo, readCertificate } from './utils/certs';
import { exec } from 'child_process';
import { fileExists } from './utils/files';
import { dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { addFileToWatcher, getWatchedFiles, pauseWatcher, removeFileFromWatcher, resumeWatcher } from './utils/watcher';

export async function startService() {
    if (cluster.isPrimary) {
        log('info', `Starting sslup service (PID: ${process.pid})`);
        cluster.fork();
        cluster.on('exit', function (worker) {
            log('error', `Subprocess ${worker.process.pid} died`);
            cluster.fork();
        });

        process.on('SIGINT', () => {
            log('info', 'Stopping sslup service');
            process.exit(0);
        });
    } else {
        log('info', `Subprocess ${process.pid} started`);

        await initConfig();
        const config = getConfig();
        initWebSocket(config, true, async () => {
            log('info', 'Started sslup service and connected to websocket server');
            const socket = getSocket();

            socket.off('update');
            socket.on('update', (info: ServerUpdateInfo) => {
                log('info', 'Checking for updates...');
                if (!info.certs.length) {
                    log('info', 'No certificates found. Update skipped.');
                    return;
                }
                updateCertificates(info);
            });
            socket.emit('requestUpdateInfo');
        });

        setInterval(
            () => {
                const socket = getSocket();
                if (!socket || !socket.connected) return;
                socket.emit('requestUpdateInfo');
            },
            1000 * 60 * 60,
        );

        process.on('SIGINT', async () => {
            log('info', `Stopping sslup service (subprocess ${process.pid})`);
            await setTimeout(100);
            process.exit(0);
        });
    }
}

async function updateCertificates(info: ServerUpdateInfo, socket = getSocket()) {
    try {
        const needsUpdate: ServerUpdateInfoSSLCert[] = [];

        const allPaths = info.certs.map((cert) => cert.fullchainPath);
        allPaths.push(...info.certs.map((cert) => cert.keyPath));

        const watchedFiles = getWatchedFiles();

        removeFileFromWatcher(watchedFiles.filter((path) => !allPaths.includes(path)));
        addFileToWatcher(allPaths.filter((path) => !watchedFiles.includes(path)));

        for (const certUpdateInfo of info.certs) {
            const currentCertInfo = await readCertificate(certUpdateInfo.fullchainPath);
            if (!currentCertInfo) {
                needsUpdate.push(certUpdateInfo);
                continue;
            }

            if (currentCertInfo.notAfter.getTime() >= certUpdateInfo.expiresAt) {
                //Check if key exists
                if (!(await fileExists(certUpdateInfo.keyPath))) {
                    needsUpdate.push(certUpdateInfo);
                }
                continue;
            }
            needsUpdate.push(certUpdateInfo);
        }

        if (!needsUpdate.length) {
            log('info', 'No certificates need updating');
            return;
        }

        pauseWatcher();
        log('info', `Updating ${needsUpdate.length} certificates...`);
        const updateCertIDs = needsUpdate.map((cert) => cert._id);
        socket.emit('getCertificates', updateCertIDs, async (certs: SSLCert[]) => {
            if (!Array.isArray(certs) || !certs.length) {
                resumeWatcher();
                log('error', 'Failed to get certificates from server (probably a server side error)');
                return;
            }

            if (Array.isArray(info.preCommands) && info.preCommands.length > 0) {
                log('info', 'Running pre-commands...');
                for (const cmd of info.preCommands) {
                    if (!(await runCommand(cmd, info.preCommands.indexOf(cmd)))) {
                        resumeWatcher();
                        log('error', 'Stopping update process due to error in pre-command');
                        return;
                    }
                }
            }

            for (const cert of certs) {
                const certInfo = needsUpdate.find((certInfo) => certInfo._id === cert._id);
                if (
                    !cert ||
                    typeof cert.cert !== 'string' ||
                    typeof cert.key !== 'string' ||
                    typeof cert.intermediateCert !== 'string' ||
                    typeof cert.rootCA !== 'string'
                ) {
                    log('error', `Failed to get certificate with ID ${certInfo._id} from server (probably a server side error)`);
                    continue;
                }

                const parsedCert = await getCertificateInfo(cert.cert);
                if (!parsedCert) {
                    log('error', `Failed to get certificate info for certificate with ID ${cert._id}`);
                    continue;
                }
                if (parsedCert.notAfter.getTime() < Date.now()) {
                    log('error', `Certificate with ID ${cert._id} has already expired`);
                    continue;
                }

                log('info', `Updating certificate for ${cert.altNames.join(',')}...`);

                const fullchainDir = dirname(certInfo.fullchainPath);
                const keyDir = dirname(certInfo.keyPath);

                for (const dir of [fullchainDir, keyDir]) {
                    if (!(await fileExists(dir))) {
                        try {
                            await mkdir(dir, { recursive: true });
                        } catch (err) {
                            log('error', `Failed to create directory ${dir}: ${err.message}`);
                            continue;
                        }
                    }
                }

                try {
                    await writeFile(certInfo.fullchainPath, `${cert.cert}${cert.intermediateCert}${cert.rootCA}`, 'ascii');
                } catch (err) {
                    // check if the file is modified
                    log('error', `Failed to write certificate to ${certInfo.fullchainPath}: ${err.message}`);
                    continue;
                }

                try {
                    await writeFile(certInfo.keyPath, cert.key, 'ascii');
                } catch (err) {
                    log('error', `Failed to write key to ${certInfo.keyPath}: ${err.message}`);
                    continue;
                }

                log('info', `Successfully updated certificate for ${cert.altNames.join(',')}`);
            }

            if (Array.isArray(info.postCommands) && info.postCommands.length > 0) {
                log('info', 'Running post-commands...');
                for (const cmd of info.postCommands) {
                    await runCommand(cmd, info.postCommands.indexOf(cmd));
                }
            }

            log('info', 'Finished updating certificates');
            resumeWatcher();
        });
    } catch (err) {
        log('error', `Error while updating certificates: ${err}`);
        resumeWatcher();
    }
}

async function runCommand(command: string, index: number): Promise<boolean> {
    return new Promise((resolve) => {
        // eslint-disable-next-line security/detect-child-process
        exec(command, (err, stdout, stderr) => {
            if (err) {
                log('error', `Error while running command ${index}: ${err.message}`);
                resolve(false);
                return;
            }
            if (stderr) {
                log('error', `Command ${index} returned error: ${stderr}`);
                resolve(false);
                return;
            }
            log('info', `Command ${index} output: ${stdout}`);
            resolve(true);
        });
    });
}
