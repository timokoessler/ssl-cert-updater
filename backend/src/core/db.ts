import { Schema, Model, model, connect, connection, set as mongooseSet } from 'mongoose';
import * as Sentry from '@sentry/node';
import { log } from './log';

let User: Model<User>;
let Authenticator: Model<Authenticator>;
let FailedLoginAttempt: Model<FailedLoginAttempt>;
let LetsEncryptAccount: Model<LetsEncryptAccount>;
let SSLCert: Model<SSLCert>;
let Server: Model<SSLServer>;
let ServerLog: Model<ServerLog>;
let CertRequestLog: Model<CertRequestLog>;
let RunningCertRequest: Model<RunningCertRequest>;
let DNSRecord: Model<DNSRecord>;

let isConnected = false;

async function init(logConnected = true) {
    mongooseSet('strictQuery', false);

    // Allow empty strings for required fields
    Schema.Types.String.checkRequired((v) => v != null);

    const notificationSettingsSchema = new Schema<NotificationSettings>(
        {
            successfullCertRequest: { type: Boolean, required: true },
            failedCertRequest: { type: Boolean, required: true },
            serverOffline: { type: Boolean, required: true },
            updateAvailable: { type: Boolean, required: true },
            serverError: { type: Boolean, required: true },
        },
        { _id: false },
    );

    const userSchema = new Schema<User>({
        _id: { type: String, required: true },
        fullName: { type: String, required: true },
        password: { type: String, required: true },
        salt: { type: String, required: true },
        email: { type: String, required: true, unique: true, index: true },
        emailConfirmed: { type: Boolean, required: true },
        totpSecret: { type: String, required: true },
        notificationSettings: { type: notificationSettingsSchema, required: true },
        createdAt: { type: Number, required: true },
        webAuthnChallenge: { type: String, required: false },
    });
    User = model<User>('User', userSchema);

    const authenticatorSchema = new Schema<Authenticator>({
        credentialID: { type: String, required: true },
        userID: { type: String, required: true },
        name: { type: String, required: true },
        credentialPublicKey: { type: Buffer, required: true },
        counter: { type: Number, required: true },
        // Ex: 'singleDevice' | 'multiDevice'
        credentialDeviceType: { type: String, required: true },
        credentialBackedUp: { type: Boolean, required: true },
    });
    Authenticator = model<Authenticator>('Authenticator', authenticatorSchema);

    const FailedLoginAttemptSchema = new Schema<FailedLoginAttempt>({
        _id: { type: String, required: true },
        tries: { type: Number, required: true },
        lastAttempt: { type: Number, required: true },
    });
    FailedLoginAttempt = model<FailedLoginAttempt>('FailedLoginAttempt', FailedLoginAttemptSchema);

    const LetsEncryptAccountSchema = new Schema<LetsEncryptAccount>({
        _id: { type: String, required: true },
        email: { type: String, required: true },
        accountKey: { type: String, required: true },
        accountUrl: { type: String, required: true },
        createdAt: { type: Number, required: true },
    });
    LetsEncryptAccount = model<LetsEncryptAccount>('LetsEncryptAccount', LetsEncryptAccountSchema);

    const SSLCertSchema = new Schema<SSLCert>({
        _id: { type: String, required: true },
        commonName: { type: String, required: true },
        altNames: { type: [String], required: true },
        type: { type: String, required: true },
        letsencryptAccountID: { type: String, required: false },
        cert: { type: String, required: true },
        key: { type: String, required: true },
        intermediateCert: { type: String, required: true },
        rootCA: { type: String, required: true },
        autoRenew: { type: Boolean, required: true },
        createdAt: { type: Number, required: true },
        expiresAt: { type: Number, required: true },
        renewedAt: { type: Number, required: false },
    });
    SSLCert = model<SSLCert>('SSLCert', SSLCertSchema);

    const dnsRecordSchema = new Schema<DNSRecord>({
        _id: { type: String, required: true },
        certID: { type: String, required: true },
        name: { type: String, required: true },
        type: { type: Number, required: true },
        data: { type: String, required: true },
    });
    DNSRecord = model<DNSRecord>('DNSRecord', dnsRecordSchema);

    const ServerConfigSSLCertSchema = new Schema<ServerConfigSSLCert>({
        _id: { type: String, required: true },
        fullchainPath: { type: String, required: true },
        keyPath: { type: String, required: true },
        caPath: { type: String, required: false },
    });

    const ServerConfigSchema = new Schema<ServerConfig>(
        {
            preCommands: { type: [String], required: true },
            certs: { type: [ServerConfigSSLCertSchema], required: true },
            postCommands: { type: [String], required: true },
            v: { type: Number, required: true },
        },
        { _id: false },
    );

    const ServerSchema = new Schema<SSLServer>({
        _id: { type: String, required: true },
        name: { type: String, required: true },
        token: { type: String, required: true },
        config: { type: ServerConfigSchema, required: true },
        osPlatform: { type: String, required: false },
        osVersion: { type: String, required: false },
        ip: { type: String, required: false },
        authIPs: { type: [String], required: false },
        checkIP: { type: Boolean, required: true },
        version: { type: String, required: true },
        lastSeen: { type: Number, required: true },
        online: { type: Boolean, required: true },
        offlineNotifications: { type: Boolean, required: false },
        createdAt: { type: Number, required: true },
    });
    Server = model<SSLServer>('Server', ServerSchema);

    const ServerLogSchema = new Schema<ServerLog>({
        serverID: { type: String, required: true },
        logLevel: { type: String, required: true },
        content: { type: String, required: true },
        createdAt: { type: Number, required: true },
    });
    ServerLog = model<ServerLog>('ServerLog', ServerLogSchema);

    const CertRequestLogSchema = new Schema<CertRequestLog>({
        certID: { type: String, required: true },
        logLevel: { type: String, required: true },
        content: { type: String, required: true },
        createdAt: { type: Number, required: true },
    });
    CertRequestLog = model<CertRequestLog>('CertRequestLog', CertRequestLogSchema);

    const RunningCertRequestSchema = new Schema<RunningCertRequest>({
        _id: { type: String, required: true },
        altNames: { type: [String], required: true },
        startedAt: { type: Number, required: true },
    });
    RunningCertRequest = model<RunningCertRequest>('RunningCertRequest', RunningCertRequestSchema);

    connection.on('connected', () => {
        isConnected = true;
        if (logConnected) log('info', `Worker ${process.pid} connected to MongoDB`);
    });

    connection.on('disconnected', () => {
        isConnected = false;
        log('error', `Worker ${process.pid} disconnected from MongoDB`);
    });

    connection.on('reconnected', () => {
        isConnected = true;
        log('info', `Worker ${process.pid} reconnected to MongoDB`);
    });

    connection.on('error', (err) => {
        log('error', `MongoDB error: ${err.message}`);
        Sentry.captureException(err);
    });

    try {
        await connect(process.env.MONGODB_URI, {
            appName: 'SSL-Cert Updater',
        });
    } catch (err) {
        log('error', `MongoDB connection error: ${err.message}`);
        Sentry.captureException(err);
        process.exit(1);
    }
}

export default {
    init: init,
    User: () => {
        return User;
    },
    Authenticator: () => {
        return Authenticator;
    },
    FailedLoginAttempt: () => {
        return FailedLoginAttempt;
    },
    LetsEncryptAccount: () => {
        return LetsEncryptAccount;
    },
    SSLCert: () => {
        return SSLCert;
    },
    Server: () => {
        return Server;
    },
    ServerLog: () => {
        return ServerLog;
    },
    isConnected: () => {
        return isConnected;
    },
    CertRequestLog: () => {
        return CertRequestLog;
    },
    RunningCertRequest: () => {
        return RunningCertRequest;
    },
    DNSRecord: () => {
        return DNSRecord;
    },
    close: async (force = false) => {
        await connection.close(force);
        console.log('Closed MongoDB connection...');
    },
};
