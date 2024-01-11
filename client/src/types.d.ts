export //
 {};

declare global {
    type Config = {
        url: string;
        id: string;
        token: string;
        _v: number;
    };

    type SSLCert = {
        _id: string;
        commonName: string;
        altNames: string[];
        type: 'letsencrypt' | 'custom';
        letsencryptAccountID?: string;
        cert: string;
        intermediateCert: string;
        rootCA: string;
        key: string;
        createdAt: number;
        renewedAt: number;
        expiresAt: number;
        autoRenew: boolean;
    };

    type LogLevel = 'debug' | 'info' | 'warn' | 'error';

    type ServerUpdateInfoSSLCert = {
        _id: string;
        fullchainPath: string;
        keyPath: string;
        commonName: string;
        altNames: string[];
        createdAt: number;
        renewedAt: number;
        expiresAt: number;
    };

    type ServerUpdateInfo = {
        preCommands: string[];
        certs: ServerUpdateInfoSSLCert[];
        postCommands: string[];
    };
}
