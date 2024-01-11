import fetch from 'node-fetch';
import * as Sentry from '@sentry/node';
import { domainToTLD } from '../dns';
import { log } from '../log';

const endpointURL = 'https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON';

export class NetcupDNS {
    private customerNumber: string;
    private apiKey: string;
    private apiPassword: string;
    private apiSessionID: string;

    constructor(customerNumber: string, apiKey: string, apiPassword: string) {
        this.customerNumber = customerNumber;
        this.apiKey = apiKey;
        this.apiPassword = apiPassword;
    }

    private async httpPost(action: NetcupAPIAction, param: unknown): Promise<NetcupAPIResponse | undefined> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(endpointURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    param: param,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            return (await response.json()) as NetcupAPIResponse;
        } catch (err) {
            Sentry.captureException(err);
            log('error', `Error on NetcupDNS.httpPost: ${err.message}`);
            return undefined;
        }
    }

    public async login(): Promise<{ success: boolean; errorMsg?: string }> {
        const response = await this.httpPost('login', {
            customernumber: this.customerNumber,
            apikey: this.apiKey,
            apipassword: this.apiPassword,
        });

        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            this.apiSessionID = (response.responsedata as { apisessionid: string }).apisessionid;
            return { success: true };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }

    public async logout(): Promise<{ success: boolean; errorMsg?: string }> {
        const response = await this.httpPost('logout', {
            apisessionid: this.apiSessionID,
            customernumber: this.customerNumber,
            apikey: this.apiKey,
        });

        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            this.apiSessionID = '';
            return { success: true };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }

    public async infoDnsZone(domain: string): Promise<{ success: boolean; zone?: NetcupDNSZone; errorMsg?: string }> {
        const response = await this.httpPost('infoDnsZone', {
            apisessionid: this.apiSessionID,
            customernumber: this.customerNumber,
            apikey: this.apiKey,
            domainname: domainToTLD(domain),
        });

        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            return { success: true, zone: response.responsedata as NetcupDNSZone };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }

    public async infoDnsRecords(domain: string): Promise<{ success: boolean; records?: NetcupDNSRecord[]; errorMsg?: string }> {
        const response = await this.httpPost('infoDnsRecords', {
            apisessionid: this.apiSessionID,
            customernumber: this.customerNumber,
            apikey: this.apiKey,
            domainname: domainToTLD(domain),
        });

        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            return { success: true, records: (response.responsedata as { dnsrecords: NetcupDNSRecord[] }).dnsrecords };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }

    public async updateDnsZone(domain: string, zone: NetcupDNSZone): Promise<{ success: boolean; errorMsg?: string }> {
        const response = await this.httpPost('updateDnsZone', {
            apisessionid: this.apiSessionID,
            customernumber: this.customerNumber,
            apikey: this.apiKey,
            domainname: domainToTLD(domain),
            dnszone: zone,
        });
        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            return { success: true };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }

    public async updateDnsRecords(domain: string, records: NetcupDNSRecord[]): Promise<{ success: boolean; errorMsg?: string }> {
        const response = await this.httpPost('updateDnsRecords', {
            apisessionid: this.apiSessionID,
            customernumber: this.customerNumber,
            apikey: this.apiKey,
            domainname: domainToTLD(domain),
            dnsrecordset: {
                dnsrecords: records,
            },
        });
        if (!response) {
            return { success: false, errorMsg: 'Die Anfrage an die Netcup API ist fehlgeschlagen' };
        }
        if (response.status === 'success') {
            return { success: true };
        } else {
            return { success: false, errorMsg: response.longmessage };
        }
    }
}
