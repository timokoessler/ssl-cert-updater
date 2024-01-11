import { access, constants } from 'fs/promises';

export async function fileExists(path: string) {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export async function canReadWriteFile(path: string) {
    try {
        await access(path, constants.W_OK | constants.R_OK);
        return true;
    } catch {
        return false;
    }
}
