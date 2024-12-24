import { platform, release } from 'os';

export function isCompiled() {
    // @ts-ignore
    return process.pkg !== undefined;
}

export function getOS() {
    return platform();
}

export function getOSVersion() {
    return release();
}

export function isRoot() {
    return process.getuid && process.getuid() === 0;
}
