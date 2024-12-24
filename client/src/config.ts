/* eslint-disable security/detect-non-literal-fs-filename */
import { writeFile, readFile, mkdir } from 'fs/promises';
import { getOS, isCompiled } from './utils';
import { decryptAES, encryptAES } from './utils/aes';
import { log } from './utils/log';
import { fileExists } from './utils/files';

let config: Config;

export const getConfigPath = () => {
    const os = getOS();
    if (os === 'linux') {
        return '/etc/sslup/config';
    }
    if (os === 'win32') {
        return process.env.PROGRAMDATA + '\\sslup\\config';
    }
    if (isCompiled()) {
        return process.cwd() + '/config';
    }
    return __dirname + '/config';
};

export const getConfigDir = () => {
    const os = getOS();
    if (os === 'linux') {
        return '/etc/sslup';
    }
    if (os === 'win32') {
        return process.env.PROGRAMDATA + '\\sslup';
    }
    if (isCompiled()) {
        return process.cwd();
    }
    return __dirname;
};

export async function initConfig() {
    await loadConfig();
}

export async function loadConfig() {
    try {
        const configPath = getConfigPath();
        log('info', `Loading config from ${configPath}`);
        const encryptedConfig = await readFile(configPath, 'ascii');
        config = decryptConfig(encryptedConfig);
    } catch (err) {
        log('error', `Can not load config: ${err.message}`);
    }
}

export async function saveConfig(config_?: Config) {
    const configPath = getConfigPath();
    const configDir = getConfigDir();

    if (config_) {
        config = config_;
    }

    let writePossible = false;
    if (await fileExists(configPath)) {
        writePossible = true;
    }

    if (!writePossible) {
        try {
            await mkdir(configDir, { recursive: true });
            writePossible = true;
        } catch {
            writePossible = false;
        }
    }

    if (!writePossible) {
        log('error', `Can not save config: No write access to ${configDir}`);
        return;
    }

    try {
        await writeFile(configPath, encryptConfig(), 'ascii');
    } catch (err) {
        log('error', `Can not save config: ${err.message}`);
    }
}

export function getConfig() {
    return config;
}

export function encryptConfig() {
    return encryptAES(JSON.stringify(config));
}

export function decryptConfig(encryptedConfig: string): Config {
    return JSON.parse(decryptAES(encryptedConfig));
}
