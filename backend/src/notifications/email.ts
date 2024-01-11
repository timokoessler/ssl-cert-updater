import * as nodemailer from 'nodemailer';
import { default as baseTemplate } from './templates/email-base';
import { sha512 } from '../utils';
import * as Sentry from '@sentry/node';
import { log } from '../core/log';
import { createTOTPToken } from '../core/auth';
import { userAgentToDescription } from '../core/ua';

let mailTransport;

export function init() {
    mailTransport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

function sendMail(to: string, subject: string, html: string) {
    mailTransport.sendMail(
        {
            from: process.env.SMTP_FROM,
            to: to,
            subject: subject,
            html: html,
        },
        (err) => {
            if (err) {
                log('error', `Error on sendMail: ${err.message}`);
                Sentry.captureException(err);
            }
        },
    );
}

export function sendRegisterInviteEmail(email: string, token: string) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', 'Konto erstellen');
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    const confirmURL = `${process.env.URL}/register/${token}`;

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo,<br><br>
    Sie wurden von einem Administrator eingeladen, ein Konto für den ${process.env.APP_NAME} zu erstellen.<br>
    Bitte klicken Sie <a href="${confirmURL}" target="_blank">hier</a>, um ein Konto zu erstellen.<br><br>
    <small>Hinweis: Dieser Link ist nur 48h gültig. Falls er bereits abgelaufen ist, wenden Sie sich bitte an den Administrator.</small><br><br>`,
    );

    sendMail(email, `${process.env.APP_NAME} - Konto erstellen`, emailBody);
}

export function sendChangeEmailConfirmEmail(user: User, newEmail: string) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', 'Neue E-Mail Adresse bestätigen');
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    const confirmURL = `${process.env.URL}/changeEmail/confirm/${Buffer.from(user._id).toString('base64url')}/${sha512(
        user.salt + ';;' + new Date().toLocaleDateString() + ';;' + newEmail,
    )}/${Buffer.from(newEmail).toString('base64url')}`;

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
    bitte klicken Sie <a href="${confirmURL}" target="_blank">hier</a>, um die Änderung Ihrer E-Mail-Adresse zu bestätigen.<br><br>
    <small>Hinweis: Dieser Link ist nur heute gültig.</small><br><br>`,
    );

    sendMail(newEmail, `${process.env.APP_NAME} - Neue E-Mail Adresse bestätigen`, emailBody);
}

export function sendForgotPasswordEmail(user: User) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', 'Passwort zurücksetzen');
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    const url = `${process.env.URL}/forgotPassword/change/${Buffer.from(user.email).toString('base64url')}/${sha512(
        user._id + user.salt + new Date().toLocaleDateString() + 'cp',
    )}`;

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
    bitte klicken Sie <a href="${url}" target="_blank">hier</a>, um Ihr Passwort zurückzusetzen.<br><br>
    <small>Hinweis: Dieser Link ist nur heute gültig und kann nur einmal verwendet werden.</small><br><br>`,
    );

    sendMail(user.email, `${process.env.APP_NAME} - Passwort zurücksetzen`, emailBody);
}

export function sendNewDeviceToken(user: User, useragent: string, ip: string) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', 'Anmeldung von neuem Gerät bestätigen');
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    const uaDescription = userAgentToDescription(useragent);
    const token = createTOTPToken(user.totpSecret).generate();

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
    Sie haben sich von einem neuen Gerät angemeldet.
    Bitte geben Sie den folgenden Code ein, um die Anmeldung abzuschließen:<br>
    <h1>${token}</h1><br>
    ${uaDescription.browser ? `<small>Browser: ${uaDescription.browser}</small><br>` : ''}
    ${uaDescription.os ? `<small>Betriebssystem: ${uaDescription.os}</small><br>` : ''}
    ${uaDescription.device ? `<small>Gerät: ${uaDescription.device}</small><br>` : ''}
    <small>IP-Adresse: ${ip}</small><br>
    <br>
    <small>Hinweis: Dieser Code ist nur wenige Minuten gültig.</small><br><br>`,
    );

    sendMail(user.email, `${process.env.APP_NAME} - Anmeldung von neuem Gerät bestätigen`, emailBody);
}

export function sendSuccessfullCertRequestEmail(user: User, certs: SSLCert[], renew: boolean) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', `SSL-Zertifikat${certs.length > 1 ? 'e' : ''} erfolgreich ${renew ? 'erneuert' : 'ausgestellt'}`);
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
    ${certs.length > 1 ? 'Folgende SSL-Zertifikate wurden' : 'Das folgende SSL-Zertifikat wurde'} erfolgreich ${renew ? 'erneuert' : 'ausgestellt'}: <br>
    <ul>
        ${certs.map((cert) => `<li>${cert.altNames.join(',')}</li>`).join('')}
    </ul><br>`,
    );

    let subject;
    if (certs.length > 1) {
        subject = `${certs.length} SSL-Zertifikate erfolgreich ${renew ? 'erneuert' : 'ausgestellt'}`;
    } else {
        subject = `SSL-Zertifikat erfolgreich ${renew ? 'erneuert' : 'ausgestellt'}`;
    }

    sendMail(user.email, subject, emailBody);
}

export async function sendFailedCertRequestEmail(user: User, certs: SSLCert[], errorMsgs: string[]) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', `SSL-Zertifikat${certs.length > 1 ? 'e' : ''} konnte${certs.length > 1 ? 'n' : ''} nicht ausgestellt werden`);
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
        Beim ${certs.length > 1 ? 'erneuern' : 'ausstellen'} ${
            certs.length > 1 ? 'der folgenden SSL-Zertifikate' : 'des folgenden SSL-Zertifikats'
        } ist ein Fehler aufgetreten: <br>
        ${certs.map((cert) => `<li><strong>${cert.altNames.join(',')}:</strong><br>${errorMsgs[cert._id]}</li>`).join('')}
    </ul><br>
    <small>Weitere Informationen finden Sie in den Logs.</small><br><br>`,
    );

    sendMail(user.email, `${process.env.APP_NAME} - Fehler beim Austellen ${certs.length > 1 ? 'von SSL-Zertifikaten' : 'eines SSL-Zertifikats'}`, emailBody);
}

export async function sendOfflineServerEmail(user: User, server: SSLServer) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', `Server ${server.name} ist offline`);
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    const date = new Date(server.lastSeen);

    const os = server.osPlatform === 'win32' ? 'Windows' : server.osPlatform === 'linux' ? 'Linux' : server.osPlatform;

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br>
        Der Server ${server.name} ist seit dem ${date.toLocaleDateString('de-DE')} um ${date.toLocaleTimeString('de-DE')} offline.<br><br>
        <small>Letzte IP-Adresse: ${server.ip}</small><br>
        <small>Betriebssystem: ${os} ${server.osVersion}</small><br><br>`,
    );

    sendMail(user.email, `${process.env.APP_NAME} - Server ${server.name} ist offline`, emailBody);
}

export async function sendServerErrorEmail(user: User, server: SSLServer, errorMsg: string) {
    let emailBody = baseTemplate.replaceAll('$Title', process.env.APP_NAME);
    emailBody = emailBody.replaceAll('$SubTitle', `Fehler auf dem Server ${server.name}`);
    emailBody = emailBody.replaceAll('$Url', process.env.URL);

    emailBody = emailBody.replaceAll(
        '$MailContent',
        `Hallo ${user.fullName},<br><br>
        Beim Server ${server.name} ist ein Fehler aufgetreten: <br>
        <pre>${errorMsg}</pre><br>
        <small>Weitere Informationen finden Sie in den <a href="${process.env.URL}/server/${server._id}/logs" target="_blank">Logs</a>.</small><br><br>`,
    );

    sendMail(user.email, `${process.env.APP_NAME} - Fehler auf dem Server ${server.name}`, emailBody);
}
