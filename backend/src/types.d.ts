import type express from 'express';

export //
 {};

declare global {
    type DBCollectionNames =
        | 'User'
        | 'Authenticator'
        | 'FailedLoginAttempt'
        | 'LetsEncryptAccount'
        | 'SSLCert'
        | 'Server'
        | 'DNSRecord'
        | 'ServerLog'
        | 'CertRequestLog'
        | 'RunningCertRequest';

    type User = {
        _id: string;
        email: string;
        password: string;
        fullName: string;
        salt: string;
        emailConfirmed: boolean;
        createdAt: number;
        totpSecret: string;
        notificationSettings: NotificationSettings;
        webAuthnChallenge: string;
    };

    type NotificationSettings = {
        successfullCertRequest: boolean;
        failedCertRequest: boolean;
        serverOffline: boolean;
        updateAvailable: boolean;
        serverError: boolean;
    };

    type SessionInfo = {
        uid: string;
        fullName?: string;
        email?: string;
        type: 'app';
        hash: string;
    };

    type FailedLoginAttempt = {
        _id: string; // IP address
        tries: number; // Number of tries
        lastAttempt: number; // Unix timestamp
    };

    type AuthTokenCB = (user: string | undefined) => void;
    type GenericCallback = (data: unknown) => void;

    interface RequestWithSessionInfo extends express.Request {
        sessionInfo?: SessionInfo;
    }

    type Authenticator = {
        credentialID: string;
        credentialPublicKey: Buffer;
        counter: number;
        // Ex: 'singleDevice' | 'multiDevice'
        credentialDeviceType: string;
        credentialBackedUp: boolean;
        userID: string;
        name: string;
    };

    type LetsEncryptAccount = {
        _id: string;
        email: string;
        accountKey: string;
        accountUrl: string;
        createdAt: number;
    };

    type DNSRecord = {
        _id: string;
        certID: string;
        name: string;
        type: number;
        data: string;
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

    type SSLServer = {
        _id: string;
        name: string;
        token: string;
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
        caPath?: string; // Not implemented
    };

    type UIUpdateEventType = 'server' | 'sslcert' | 'letsencryptaccount' | 'runningcertrequest';

    type ServerLog = {
        serverID: string;
        logLevel: LogLevel;
        content: string;
        createdAt: number;
    };

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
