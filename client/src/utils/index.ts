import { platform, release } from 'os';

export function isCompiled() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
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
