import acme from 'acme-client';
import { DnsChallenge } from 'acme-client/types/rfc8555';
import { newCertRequestLog } from '../sockets/browser-socket';
import { log } from './log';
import dns2 from 'dns2';
import isFQDN from 'validator/lib/isFQDN';
import { createDocument, deleteDocumentsQuery, getDocuments } from './dbHelper';
import { v4 as uuidv4 } from 'uuid';
import { resolveTxt } from 'node:dns/promises';
import { sha256 } from '../utils';

const dnsServerPort = 5333;

export async function initDNSServer() {
    const dnsServer = dns2.createServer({
        udp: true,
        tcp: true,
        handle: async (request, send) => {
            const response = dns2.Packet.createResponseFromRequest(request);

            for (const question of request.questions) {
                const { name, type } = question as dns2.DnsQuestion & {
                    type: number;
                };
                if (type !== dns2.Packet.TYPE.TXT) {
                    continue;
                }
                if (
                    !isFQDN(name, {
                        require_tld: true,
                        allow_underscores: true,
                        allow_trailing_dot: true,
                        allow_wildcard: false,
                    })
                ) {
                    continue;
                }
                const lookupName = name.endsWith('.') ? name.slice(0, -1).toLowerCase() : name.toLowerCase();

                response.answers.push({
                    name,
                    type: dns2.Packet.TYPE.TXT,
                    class: dns2.Packet.CLASS.IN,
                    ttl: 300,
                    data: `sslup-${sha256(process.env.URL)}`,
                });
                const dnsRecords = await getDocuments<DNSRecord>('DNSRecord', { name: lookupName, type });
                if (Array.isArray(dnsRecords)) {
                    for (const dnsRecord of dnsRecords) {
                        response.answers.push({
                            name,
                            type: dnsRecord.type,
                            class: dns2.Packet.CLASS.IN,
                            ttl: 10,
                            data: dnsRecord.data,
                        });
                    }
                }
            }
            send(response);
        },
    });

    dnsServer.on('requestError', (err) => {
        log('error', `Error on dns request: ${err.message}`);
    });

    dnsServer.on('listening', () => {
        log('info', `DNS server listening on port ${dnsServerPort}`);
    });

    dnsServer.on('close', () => {
        log('error', 'DNS server closed');
        throw new Error('FATAL: DNS server closed');
    });

    dnsServer.listen({
        udp: dnsServerPort,
        tcp: dnsServerPort,
    });
}

export async function createDNSChallenge(
    id: string,
    authz: acme.Authorization,
    challenge: DnsChallenge,
    keyAuthorization: string,
    index: number,
    total: number,
): Promise<{ success: boolean; errorMsg?: string }> {
    const name = getAcmeHost(authz.identifier.value);
    newCertRequestLog('info', `Erstelle DNS Record ${name} (${index + 1}/${total})`, id);

    const dnsRecordID = uuidv4();

    if (
        !(await createDocument<DNSRecord>('DNSRecord', {
            _id: dnsRecordID,
            certID: id,
            name,
            type: dns2.Packet.TYPE.TXT,
            data: keyAuthorization,
        }))
    ) {
        return { success: false, errorMsg: 'Speichern des DNS Records fehlgeschlagen' };
    }

    return { success: true };
}

export async function removeDNSChallenge(
    id: string,
    authz: acme.Authorization,
    challenge: DnsChallenge,
    keyAuthorization: string,
): Promise<{ success: boolean; errorMsg?: string }> {
    const name = getAcmeHost(authz.identifier.value);
    newCertRequestLog('info', `Entferne DNS Record ${name}`, id);

    if (!(await deleteDocumentsQuery<DNSRecord>('DNSRecord', { certID: id, name, data: keyAuthorization }))) {
        return { success: false, errorMsg: 'Entfernen des DNS Records fehlgeschlagen' };
    }

    return { success: true };
}

export async function checkDNSConfiguration(domain: string): Promise<{ success: boolean; errorMsg?: string }> {
    try {
        const name = getAcmeHost(domain);
        const txtRecords = await resolveTxt(name);
        if (!Array.isArray(txtRecords) || txtRecords.length === 0) {
            return { success: false };
        }

        for (const txtRecordChunks of txtRecords) {
            const txtRecord = txtRecordChunks.join('');
            if (txtRecord === `sslup-${sha256(process.env.URL)}`) {
                return { success: true };
            }
        }

        return { success: false };
    } catch (e) {
        return { success: false, errorMsg: e.message };
    }
}

export function domainToTLD(domain: string): string {
    const parts = domain.split('.');
    return parts[parts.length - 2] + '.' + parts[parts.length - 1];
}

export function domainHasSubdomain(domain: string): boolean {
    return domain.split('.').length > 2;
}

export function domainToSubdomain(domain: string): string {
    const parts = domain.split('.');
    return parts.slice(0, parts.length - 2).join('.');
}

function getAcmeHost(domain: string): string {
    return `_acme-challenge.${domain.startsWith('*.') ? domain.slice(2) : domain}`;
}
