export {};

declare global {
    type UIUpdateEventType = 'servers' | 'sslcerts' | 'dnsprovider' | 'letsencryptaccounts';

    type LetsEncryptAccount = {
        _id: string;
        email: string;
        accountKey?: string;
        accountUrl?: string;
        createdAt: number;
    };

    type SupportedDNSProvider = 'netcup';

    type DNSProvider = {
        _id: string;
        type: SupportedDNSProvider;
        customerNumber: string;
        apiKey?: string;
        apiPassword?: string;
        createdAt: number;
    };

    type SSLCert = {
        _id: string;
        commonName: string;
        altNames: string[];
        type: 'letsencrypt' | 'custom';
        letsencryptAccountID?: string;
        createdAt: number;
        renewedAt: number;
        expiresAt: number;
        autoRenew: boolean;
    };

    type SSLServer = {
        _id: string;
        name: string;
        token?: string;
        config: ServerConfig;
        osPlatform?: NodeJS.Platform;
        osVersion?: string;
        ip?: string;
        checkIP: boolean;
        authIPs?: string[];
        version: string;
        lastSeen: number;
        online: boolean;
        offlineNotifications: boolean;
        createdAt: number;
    };

    type ServerConfig = {
        preCommands: string[];
        certs: ServerConfigSSLCert[];
        postCommands: string[];
        v: number;
    };

    type ServerConfigSSLCert = {
        _id: string;
        fullchainPath: string;
        keyPath: string;
        caPath?: string;
    };

    type ServerLog = {
        serverID: string;
        logLevel: LogLevel;
        content: string;
        createdAt: number;
    };

    type LogLevel = 'debug' | 'info' | 'warn' | 'error';

    type CertRequestLog = {
        certID: string;
        logLevel: LogLevel;
        content: string;
        createdAt: number;
    };

    type RunningCertRequest = {
        _id: string;
        altNames: string[];
        startedAt: number;
    };
}
