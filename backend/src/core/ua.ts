import { UAParser } from 'ua-parser-js';
import { sha512 } from '../utils';
import { log } from './log';
import * as Sentry from '@sentry/node';

export function generateBrowserFingerprint(useragent: string) {
    try {
        const { browser, cpu, device, os } = UAParser(useragent);
        return sha512([browser?.name, cpu?.architecture, device?.model, device?.type, os?.name].filter((e) => e !== undefined).join(''));
    } catch (error) {
        log('error', `Error generating browser fingerprint: ${error.message}`);
        Sentry.captureException(error);
        return '';
    }
}

export function userAgentToDescription(useragent: string) {
    try {
        const { browser, device, os } = UAParser(useragent);
        return {
            browser: browser?.name,
            device: device?.model,
            os: os?.name,
        };
    } catch (error) {
        log('error', `Error parsing useragent: ${error.message}`);
        Sentry.captureException(error);
        return {};
    }
}
