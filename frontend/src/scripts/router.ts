/* eslint-disable @typescript-eslint/no-explicit-any */

import { isDarkMode, setTheme } from './utils';

const getCurrentPage = () => window.location.pathname;

export function initRouter() {
    document.addEventListener('astro:after-swap', onPageSwap);
}

export function registerLocalDocumentEvent(event: string, callback: (...args: any[]) => void) {
    const page = getCurrentPage();
    document.addEventListener(event, (e) => {
        if (getCurrentPage() === page) {
            callback(e);
        }
    });
}

export function onPageLoad(callback: () => void, once = false) {
    const page = getCurrentPage();
    document.addEventListener(
        'astro:page-load',
        () => {
            if (getCurrentPage() === page) {
                callback();
            }
        },
        { once },
    );
}

export function onAnyPageLoad(callback: () => void, once = false) {
    document.addEventListener(
        'astro:page-load',
        () => {
            callback();
        },
        { once },
    );
}

export function onFirstPageLoad(callback: () => void) {
    onPageLoad(callback, true);
}

// Run callback when the user leaves the current page (only once)
export function onPageLeave(callback: () => void) {
    const page = getCurrentPage();
    document.addEventListener(
        'astro:after-swap',
        () => {
            if (getCurrentPage() !== page) {
                callback();
            }
        },
        { once: true },
    );
}

// https://docs.astro.build/de/guides/view-transitions/#astroafter-swap
function onPageSwap() {
    setTheme(isDarkMode() ? 'dark' : 'light');

    const runColorMode = (fn: CallableFunction) => {
        if (!window.matchMedia) {
            return;
        }
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        fn(query.matches);
        query.addEventListener('change', (event) => fn(event.matches));
    };

    let runColorModeFirst = true;
    runColorMode(() => {
        if (!runColorModeFirst) {
            localStorage.removeItem('theme');
        } else {
            runColorModeFirst = false;
        }
        setTheme(isDarkMode() ? 'dark' : 'light');
    });
}
