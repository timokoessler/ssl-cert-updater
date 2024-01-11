#!/usr/bin/env node
import inquirer from 'inquirer';
import * as dotenv from 'dotenv';
dotenv.config({ path: __dirname + '/config/.env' });
import { generateRegisterToken, initAuth } from './core/auth';
import { deleteUser, getDocuments, getUser } from './core/dbHelper';
import isEmail from 'validator/lib/isEmail';
import db from './core/db';
import { init as initEmail, sendRegisterInviteEmail } from './notifications/email';
import { log } from './core/log';
import { connect, disconnect } from 'mongoose';
import isURL from 'validator/lib/isURL';
import { isIP } from 'net';
import ora from 'ora';
import isFQDN from 'validator/lib/isFQDN';
import { KeyObject, generateKeyPair, randomBytes } from 'crypto';
import { access, constants, writeFile } from 'fs/promises';
import { platform } from 'os';
import { sha512 } from './utils';

const requiredEnvKeys = ['MONGODB_URI', 'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'IP', 'PORT', 'ENCRYPTION_TOKEN'];

if (!process.env.MONGODB_URI) {
    setup();
} else {
    for (const key of requiredEnvKeys) {
        // eslint-disable-next-line security/detect-object-injection
        if (process.env[key] === undefined) {
            log('error', `Missing environment variable: ${key}`);
            log('info', 'To setup the application, delete the .env file and run the cli again');
            process.exit(1);
        }
    }
    menu();
}

async function menu() {
    const action = await listInput('What do you want to do?', ['Invite a new user', 'Delete a user', 'Renew certs', 'Exit']);

    if (action === 'Invite a new user') {
        initAuth();
        initEmail();

        const email = await txtInput('Enter the email address of the user you want to invite:', undefined, (value) =>
            isEmail(value) ? true : 'Please enter an valid email address',
        );
        const spinner = ora('Creating user').start();

        await db.init(false);
        const user = await getUser({ email: email });
        if (user) {
            spinner.fail('User already exists');
            process.exit(1);
        }

        spinner.text = 'Sending invitation email';
        const token = await generateRegisterToken(email);
        sendRegisterInviteEmail(email, token);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        spinner.succeed('Invitation email sent');
        process.exit(0);
    }
    if (action === 'Delete a user') {
        await db.init(false);
        initAuth();

        const users = await getDocuments<User>('User', {});
        const choices = users.map((user) => user.email);

        if (choices.length === 0) {
            ora('No users found').fail();
            process.exit(1);
        }

        const email = await listInput('Select the user you want to delete:', choices);

        const user = await getUser({ email: email });
        if (!user) {
            ora('No users found').fail();
            process.exit(1);
        }

        await deleteUser(user._id);
        ora('User deleted. Active login sessions are still valid.').succeed();
        process.exit(0);
    }
    if (action === 'Exit') {
        process.exit(0);
    }
    if (action === 'Renew certs') {
        const spinner = ora('Sending renewal request to sslup server').start();
        const secret = sha512(`${process.env.ENCRYPTION_TOKEN}-${process.env.IP}-${process.env.PORT}-renew`);
        try {
            const request = await fetch(`http://${process.env.IP}:${process.env.PORT}/api/cli/renew`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: secret,
                },
            });
            if (request.ok) {
                spinner.succeed('Renewal request sent to sslup server. Check the web interface for more information.');
                process.exit(0);
            }
        } catch (err) {
            spinner.fail('Renewal request failed');
            log('error', err.message);
            log('info', 'Make sure the sslup server is running and reachable (you need to run the cli in the same container)');
            process.exit(1);
        }
        spinner.fail('Renewal request failed');
        log('info', 'Make sure the sslup server is running and reachable (you need to run the cli in the same container)');
        process.exit(1);
    }
    ora('Invalid action').fail();
    process.exit(1);
}

async function setup() {
    const startSetup = await confirmInput('Do you want to setup the application?', false);
    if (!startSetup) {
        process.exit(0);
    }

    try {
        await access(__dirname + '/config', constants.W_OK | constants.R_OK | constants.F_OK);
    } catch {
        if (platform() === 'win32') {
            ora('Accessing config directory failed. Please make sure it exists and user has write permissions').fail();
            process.exit(1);
        }
        const userID = process.getuid();
        ora(`Accessing config directory failed. Please make sure it exists and user with id ${userID} has write permissions`).fail();
        process.exit(1);
    }

    // MONGODB_URI
    const mongoDBUri = await txtInput('Enter the MongoDB Connection URI:', 'mongodb://127.0.0.1:27017/sslup?authSource=admin', (value) =>
        isURL(value, {
            protocols: ['mongodb'],
            require_protocol: true,
            require_tld: false,
        })
            ? true
            : 'Please enter a valid MongoDB Connection URI',
    );

    const mongoSpinner = ora('Connecting to MongoDB').start();

    // Try to connect to MongoDB
    try {
        await connect(mongoDBUri, {
            appName: 'SSL-Cert Updater Setup',
            connectTimeoutMS: 3000,
            socketTimeoutMS: 3000,
            serverSelectionTimeoutMS: 1000,
        });
    } catch (err) {
        mongoSpinner.fail('MongoDB connection failed');
        process.exit(1);
    }
    disconnect();
    mongoSpinner.succeed('MongoDB connection successful');

    // NODE_ENV
    const nodeEnv = await listInput('Select the environment the application should run in:', ['production', 'development']);

    // URL
    const publicUrl = await txtInput('Enter the public url of the application:', undefined, (value) => (isURL(value) ? true : 'Please enter a valid url'));

    // PORT
    const port = await txtInput('Enter the port the application should listen on:', 3000, (value) =>
        !isNaN(Number(value)) ? true : 'Please enter a valid port number',
    );

    // IP
    const ip = await txtInput('Enter the IP the application should listen on:', '0.0.0.0', (value) =>
        value.length && isIP(value) ? true : 'Please enter a valid IP',
    );

    // BEHIND_PROXY
    const behindProxy = await confirmInput('Is the application running behind a reverse proxy like nginx?', true);

    // CLUSTER_WORKERS
    const clusterWorkers = await txtInput('How many instances of the application should be started (clustering)?', nodeEnv === 'production' ? 4 : 2, (value) =>
        !isNaN(Number(value)) ? true : 'Please enter a valid number',
    );

    // SENTRY
    const sentry = await confirmInput('Do you want to use Sentry for error reporting?', false);

    // SENTRY_DSN
    let sentryDsn = '';
    if (sentry) {
        sentryDsn = await txtInput('Enter your Sentry DSN for the backend:', undefined, (value) => (isURL(value) ? true : 'Please enter a valid DSN'));
    }

    // SENTRY_DSN_FRONTEND
    let sentryDsnFrontend = '';
    if (sentry) {
        sentryDsnFrontend = await txtInput('Enter your Sentry DSN for the frontend:', undefined, (value) => (isURL(value) ? true : 'Please enter a valid DSN'));
    }

    // SMTP_USER
    const smtpUser = await txtInput('Enter your SMTP username:', undefined, (value) => (value.length ? true : 'Please enter a valid username'));

    // SMTP_PASS
    const smtpPass = await txtInput('Enter your SMTP password:', undefined, (value) => (value.length ? true : 'Please enter a valid password'));

    // SMTP_HOST
    const smtpHost = await txtInput('Enter your SMTP host:', undefined, (value) => (isFQDN(value) ? true : 'Please enter a valid host'));

    // SMTP_PORT
    const smtpPort = await txtInput('Enter your SMTP port:', 587, (value) => (!isNaN(Number(value)) ? true : 'Please enter a valid port number'));

    // SMTP_FROM
    let smtpFrom;
    if (isEmail(smtpUser)) {
        smtpFrom = `"SSL-Zertifikat Updater" <${smtpUser}>`;
    } else {
        smtpFrom = `"SSL-Zertifikat Updater" <${await txtInput('Enter your SMTP from address:', undefined, (value) =>
            isEmail(value) ? true : 'Please enter a valid email address',
        )}>`;
    }

    const cryptoSpinner = ora('Generating secrets and keys').start();

    // generate random ENCRYPTION_TOKEN (secure)
    const encryptionToken = randomBytes(64).toString('hex');

    try {
        const { publicKey, privateKey } = await generateKeys();

        await writeFile(
            __dirname + '/config/private-key.pem',
            privateKey.export({
                format: 'pem',
                type: 'pkcs8',
            }),
        );

        await writeFile(
            __dirname + '/config/public-key.pem',
            publicKey.export({
                format: 'pem',
                type: 'spki',
            }),
        );
    } catch (err) {
        cryptoSpinner.fail(`Error while generating keys: ${err.message}`);
    }

    cryptoSpinner.succeed('Secrets and keys generated');

    const writingSpinner = ora('Writing .env').start();

    const envFile = `URL=${publicUrl}
IP=${ip}
PORT=${port}
APP_NAME=SSL-Zertifikat Updater
NODE_ENV=${nodeEnv}
BEHIND_PROXY=${behindProxy}
CLUSTER_WORKERS=${clusterWorkers}
MONGODB_URI=${mongoDBUri}

ENCRYPTION_TOKEN=${encryptionToken}

SMTP_USER=${smtpUser}
SMTP_PASS=${smtpPass}
SMTP_HOST=${smtpHost}
SMTP_PORT=${smtpPort}
SMTP_FROM=${smtpFrom}

SENTRY_DSN=${sentryDsn}
SENTRY_DSN_FRONTEND=${sentryDsnFrontend}
`;
    try {
        await writeFile(__dirname + '/config/.env', envFile);
    } catch (err) {
        writingSpinner.fail(`Writing files failed: ${err.message}`);
        process.exit(1);
    }
    writingSpinner.succeed('Setup completed. You can configure the application further by editing the .env file.');
    process.exit(0);
}

async function txtInput(message: string, defaultValue: string | number | boolean, validate: (value: string) => boolean | string) {
    const result = await inquirer.prompt([
        {
            type: 'input',
            name: 'value',
            message,
            default: defaultValue,
            validate,
        },
    ]);
    return result.value as string;
}

async function confirmInput(message: string, defaultValue: boolean) {
    const result = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'value',
            message,
            default: defaultValue,
        },
    ]);
    return result.value as boolean;
}

async function listInput(message: string, choices: string[], defaultValue = choices[0]) {
    const result = await inquirer.prompt([
        {
            type: 'list',
            name: 'value',
            message,
            choices,
            default: defaultValue,
        },
    ]);
    return result.value as string;
}

async function generateKeys(): Promise<{ publicKey: KeyObject; privateKey: KeyObject }> {
    return new Promise((resolve, reject) => {
        generateKeyPair(
            'ec',
            {
                namedCurve: 'secp521r1',
            },
            (err, publicKey, privateKey) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ publicKey, privateKey });
            },
        );
    });
}
