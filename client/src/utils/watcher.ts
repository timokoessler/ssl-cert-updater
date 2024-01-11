import chokidar from 'chokidar';
import { log } from './log';
import { getSocket } from '../websocket';

let watcher: chokidar.FSWatcher;
const watchedFiles: string[] = [];
let lastEvent = 0;

export default function initWatcher(path: string[] | string) {
    watcher = chokidar.watch(path, {
        ignoreInitial: true,
        disableGlobbing: true,
    });

    watchedFiles.push(...(Array.isArray(path) ? path : [path]));

    watcher.on('error', (err) => {
        log('error', `Error in file watcher: ${err.message}`);
    });

    watcher.on('ready', () => {
        watcher.on('all', onEvent);
    });
}

export function addFileToWatcher(path: string | string[]) {
    if (!watcher) {
        initWatcher(path);
        return;
    }
    watcher.add(path);
    watchedFiles.push(...(Array.isArray(path) ? path : [path]));
}

export function removeFileFromWatcher(path: string | string[]) {
    if (!watcher) return;
    watcher.unwatch(path);
    watchedFiles.push(...(Array.isArray(path) ? path : [path]));
}

export async function stopWatcher() {
    if (!watcher) return;
    watchedFiles.length = 0;
    await watcher.close();
}

export function getWatchedFiles() {
    return watchedFiles;
}

function onEvent(event_: unknown, path: string) {
    const now = Date.now();
    if (now - lastEvent < 10) return;
    lastEvent = now;
    log('info', `Watched file ${path} has been changed. Request update...`);
    const socket = getSocket();
    socket.emit('requestUpdateInfo');
}

export function pauseWatcher() {
    if (!watcher) return;
    watcher.removeListener('all', onEvent);
}

export function resumeWatcher() {
    if (!watcher) return;
    watcher.on('all', onEvent);
}
