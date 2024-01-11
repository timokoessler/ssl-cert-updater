import acme from 'acme-client';
import { DnsChallenge } from 'acme-client/types/rfc8555';
import { NetcupDNS } from './dns-api/netcup';
// Type definitions for dns2 are incorrect, so they are not installed
// @ts-expect-error Wrong type definitions
import { UDPClient } from 'dns2';
import { newCertRequestLog } from '../sockets/browser-socket';
import { setTimeout } from 'timers/promises';
import { log } from './log';

export async function createDNSChallenge(
    id: string,
    authz: acme.Authorization,
    challenge: DnsChallenge,
    keyAuthorization: string,
    dnsProvider: DNSProvider,
    index: number,
    total: number,
): Promise<{ success: boolean; errorMsg?: string }> {
    const domain = authz.identifier.value;
    newCertRequestLog('info', `Erstelle DNS Record _acme-challenge.${domain} mit Wert ${keyAuthorization} (${index + 1}/${total})`, id);

    if (dnsProvider.type !== 'netcup') {
        return { success: false, errorMsg: 'DNS Provider wird nicht unterstützt' };
    }
    const netcupDNS = new NetcupDNS(dnsProvider.customerNumber, dnsProvider.apiKey, dnsProvider.apiPassword);
    const loginResult = await netcupDNS.login();
    if (!loginResult.success) {
        return { success: false, errorMsg: loginResult.errorMsg };
    }

    const hostname = domainHasSubdomain(domain) ? `_acme-challenge.${domainToSubdomain(domain)}` : '_acme-challenge';

    const createResult = await netcupDNS.updateDnsRecords(domain, [
        {
            hostname: hostname,
            type: 'TXT',
            destination: keyAuthorization,
            deleterecord: false,
        },
    ]);

    if (!createResult.success) {
        netcupDNS.logout();
        return { success: false, errorMsg: createResult.errorMsg };
    }

    netcupDNS.logout();

    return { success: true };
}

export async function removeDNSChallenge(
    id: string,
    authz: acme.Authorization,
    challenge: DnsChallenge,
    keyAuthorization: string,
    dnsProvider: DNSProvider,
): Promise<{ success: boolean; errorMsg?: string }> {
    const domain = authz.identifier.value;
    newCertRequestLog('info', `Entferne DNS Record _acme-challenge.${domain}`, id);

    if (dnsProvider.type !== 'netcup') {
        return { success: false, errorMsg: 'DNS Provider wird nicht unterstützt' };
    }
    const netcupDNS = new NetcupDNS(dnsProvider.customerNumber, dnsProvider.apiKey, dnsProvider.apiPassword);
    const loginResult = await netcupDNS.login();
    if (!loginResult.success) {
        return { success: false, errorMsg: loginResult.errorMsg };
    }

    const dnsRecords = await netcupDNS.infoDnsRecords(domain);
    if (!dnsRecords.success) {
        netcupDNS.logout();
        return { success: false, errorMsg: dnsRecords.errorMsg };
    }

    const hostname = domainHasSubdomain(domain) ? `_acme-challenge.${domainToSubdomain(domain)}` : '_acme-challenge';

    const record = dnsRecords.records.find((record) => record.hostname === hostname && record.destination === keyAuthorization);
    if (!record) {
        netcupDNS.logout();
        return { success: false, errorMsg: 'DNS Record nicht gefunden' };
    }

    const deleteResult = await netcupDNS.updateDnsRecords(domain, [
        {
            id: record.id,
            hostname: record.hostname,
            type: record.type,
            destination: record.destination,
            deleterecord: true,
        },
    ]);
    if (!deleteResult.success) {
        netcupDNS.logout();
        return { success: false, errorMsg: deleteResult.errorMsg };
    }

    netcupDNS.logout();

    return { success: true };
}

export async function verifyDnsChallenge(
    id: string,
    authz: acme.Authorization,
    keyAuthorization: string,
    ac: AbortController,
    index: number,
    total: number,
): Promise<{ success: boolean; errorMsg?: string }> {
    const domain = authz.identifier.value;
    log('debug', `Verifying DNS record _acme-challenge.${domain} with value ${keyAuthorization}`);
    const resolve = UDPClient();

    let nsRecords = await resolve(domain, 'NS');
    if (nsRecords.answers.length === 0) {
        nsRecords = await resolve(domainToTLD(domain), 'NS');
        if (nsRecords.answers.length === 0) {
            return { success: false, errorMsg: `NS Record für ${domain} nicht gefunden` };
        }
    }
    const nameServers: string[] = nsRecords.answers.map((answer) => answer.ns);
    newCertRequestLog('info', `Verwende Nameserver ${nameServers.sort().join(', ')} zur Überprüfung von Challenge ${index + 1}/${total}`, id);

    let retryCount = 0;

    while (nameServers.length && retryCount < 80 && !ac.signal.aborted) {
        for (const nameServer of nameServers) {
            const resolveTxt = UDPClient({ dns: nameServer });
            const txtDNSRecords = await resolveTxt(`_acme-challenge.${domain}`, 'TXT');
            if (txtDNSRecords.answers.length > 0) {
                log('debug', `Found ${txtDNSRecords.answers.length} TXT records for _acme-challenge.${domain} on NS ${nameServer} (${keyAuthorization})`);
                for (const answer of txtDNSRecords.answers) {
                    if (answer.name === `_acme-challenge.${domain}` && answer.data === keyAuthorization) {
                        log('debug', `Found TXT record _acme-challenge.${domain} with value ${answer.data} on NS ${nameServer}`);
                        newCertRequestLog('info', `DNS Eintrag _acme-challenge.${domain} auf Nameserver ${nameServer} gefunden (${index + 1}/${total})`, id);
                        nameServers.splice(nameServers.indexOf(nameServer), 1);
                        if (!nameServers.length) {
                            break;
                        }
                    }
                }
            }
        }
        if (nameServers.length && retryCount < 80 && !ac.signal.aborted) {
            retryCount++;
            if (retryCount === 1 || retryCount % 4 === 0) {
                newCertRequestLog('info', `Warte auf DNS-Einträge für ${domain}. Wartezeit: ${((retryCount - 1) * 0.5).toFixed(0)}min von max. 40min`, id);
            }
            await setTimeout(30000, null, { signal: ac.signal });
        }
    }

    if (nameServers.length > 0) {
        return { success: false, errorMsg: 'TXT Record nicht gefunden' };
    }
    newCertRequestLog('info', `Alle DNS-Einträge für ${domain} gefunden (Challenge ${index + 1}/${total})`, id);

    await setTimeout(5000, null, { signal: ac.signal });

    return { success: true };
}

export async function testDNSProvider(dnsProvider: DNSProvider): Promise<{ success: boolean; errorMsg?: string }> {
    if (dnsProvider.type !== 'netcup') {
        return { success: false, errorMsg: 'DNS Provider wird nicht unterstützt' };
    }
    const netcupDNS = new NetcupDNS(dnsProvider.customerNumber, dnsProvider.apiKey, dnsProvider.apiPassword);
    const loginResult = await netcupDNS.login();
    if (!loginResult.success) {
        return { success: false, errorMsg: loginResult.errorMsg };
    }
    netcupDNS.logout();
    return { success: true };
}

export function domainToTLD(domain: string): string {
    const parts = domain.split('.');
    return parts[parts.length - 2] + '.' + parts[parts.length - 1];
}

export function domainHasSubdomain(domain: string): boolean {
    const parts = domain.split('.');
    return parts.length > 2;
}

export function domainToSubdomain(domain: string): string {
    const parts = domain.split('.');
    return parts.slice(0, parts.length - 2).join('.');
}
