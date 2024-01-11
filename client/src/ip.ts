import { isIPv4, isIPv6 } from 'net';
import { log } from './utils/log';
import fetch from 'node-fetch';

const ipv4Apis = ['https://4.ident.me', 'https://api4.ipify.org', 'https://ipv4.seeip.org'];
const ipv6Apis = ['https://6.ident.me', 'https://api6.ipify.org', 'https://ipv6.seeip.org'];

export async function getPublicIPs() {
    const ipv4 = await getPublicIPv4();
    const ipv6 = await getPublicIPv6();

    return [ipv4, ipv6].filter((ip) => typeof ip === 'string');
}

async function getPublicIPv4() {
    for (const api of ipv4Apis) {
        try {
            const response = await fetch(api);
            if (response.ok) {
                const ip = await response.text();
                if (typeof ip === 'string' && isIPv4(ip)) {
                    return ip;
                }
            }
        } catch (err) {
            log('error', `Error on getPublicIPv4: ${err.message}`);
        }
    }
    return undefined;
}

async function getPublicIPv6() {
    for (const api of ipv6Apis) {
        try {
            const response = await fetch(api);
            if (response.ok) {
                const ip = await response.text();
                if (typeof ip === 'string' && isIPv6(ip)) {
                    return ip;
                }
            }
        } catch (err) {
            log('error', `Error on getPublicIPv6: ${err.message}`);
        }
    }
    return undefined;
}
