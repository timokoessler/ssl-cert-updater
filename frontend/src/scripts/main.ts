import { initRouter } from './router';
import { isDarkMode, setTheme, urlParams } from './utils';
import type { CustomWindow } from './utils';
import { navigate } from 'astro:transitions/client';
import * as Sentry from '@sentry/browser';

if (urlParams.get('debug')) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (window as CustomWindow).debug = true;
} else {
    initSentry();
}

const bc = new BroadcastChannel(import.meta.env.PUBLIC_BROADCAST_CHANNEL);

bc.addEventListener('message', (event) => {
    if (event.data === 'logout') {
        navigate('/login');
    } else if (event.data === 'enableDarkMode') {
        setTheme('dark');
    } else if (event.data === 'enableLightMode') {
        setTheme('light');
    }
});

checkLoggedIn();
initRouter();

document.addEventListener('astro:page-load', () => {
    const themeChangers = document.getElementsByClassName('theme-changer');
    for (const themeChanger of themeChangers) {
        themeChanger.addEventListener('click', () => {
            const theme = isDarkMode() ? 'light' : 'dark';
            localStorage.setItem('theme', theme);
            setTheme(theme);
            if (theme === 'dark') {
                bc.postMessage('enableDarkMode');
            } else {
                bc.postMessage('enableLightMode');
            }
        });
    }

    const logoutBtn = document.querySelectorAll('#logoutBtn');
    if (logoutBtn.length > 0) {
        logoutBtn.forEach((btn) => {
            btn.addEventListener('click', async () => {
                await fetch('/api/logout');
                bc.postMessage('logout');
                navigate('/login');
            });
        });
    }
});

function loginRequired() {
    const cancelIDs = ['loginForm', 'registerForm', 'errorPage', 'registerConfirmPage', 'forgotPasswordForm'];
    for (const id of cancelIDs) {
        if (document.getElementById(id)) {
            return false;
        }
    }
    return true;
}

async function checkLoggedIn() {
    if (!loginRequired()) {
        return;
    }
    try {
        const response = await fetch('/api/loggedIn');
        if (response.status !== 200) {
            if (response.status === 404 || (response.status >= 500 && response.status < 600)) {
                return;
            }
            navigate('/login');
            bc.postMessage('logout');
            return;
        }
    } catch (e) {
        console.error(e);
    }
}

async function initSentry() {
    const dnsResponse = await fetch('/api/sentry/frontend/dsn');
    if (dnsResponse.status !== 200) {
        return;
    }
    const dns = await dnsResponse.text();
    Sentry.init({
        dsn: atob(dns),
    });
}
