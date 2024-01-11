export function debug(output: string | number | object, level = 'default') {
    if ((window as CustomWindow).debug) {
        if (level === 'warning' || level === 'warn') {
            console.warn(output);
        } else if (level === 'error') {
            console.error(output);
        } else {
            console.log(output);
        }
    }
}

export function humanFileSize(bytes: number, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

    // eslint-disable-next-line security/detect-object-injection
    return bytes.toFixed(dp).toString().replace('.', ',') + ' ' + units[u];
}

export function isDarkMode() {
    if (localStorage.getItem('theme') === 'dark') {
        return true;
    } else if (localStorage.getItem('theme') === 'light') {
        return false;
    }

    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
    }
    return false;
}

export function setTheme(theme: 'dark' | 'light') {
    document.body.dataset.bsTheme = theme;
    const headerImg = document.getElementById('header-img');
    if (headerImg === null) return;
    if (theme === 'dark') {
        headerImg.setAttribute('src', '/img/logo-text-white.svg');
    } else {
        headerImg.setAttribute('src', '/img/logo-text.svg');
    }
}

export function capitalizeFirstLetter(txt: string) {
    return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export const urlParams = new URLSearchParams(window.location.search);

export type CustomWindow = Window &
    typeof globalThis & {
        debug: boolean | undefined;
    };

export async function getSessionInfo(): Promise<{ uid: string; fullName: string; email: string; iat: number; exp: number } | undefined> {
    const response = await fetch('/api/loggedIn');
    if (response.status !== 200) {
        return;
    }
    const json = await response.json();
    return json as { uid: string; fullName: string; email: string; iat: number; exp: number };
}

export function humanTimeDiffNow(time: number, addN = false) {
    let diff = Date.now() - time;
    if (diff < 0) diff = diff * -1;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);

    const buildString = (num: number, unit: string) => {
        if (num === 1) {
            return `${num} ${unit.slice(0, -1)}`;
        }
        if (addN && (unit === 'Tage' || unit === 'Monate')) {
            return `${num} ${unit}n`;
        }
        return `${num} ${unit}`;
    };

    if (seconds < 60) {
        return buildString(seconds, 'Sekunden');
    } else if (minutes < 60) {
        return buildString(minutes, 'Minuten');
    } else if (hours < 24) {
        return buildString(hours, 'Stunden');
    } else if (days < 30) {
        return buildString(days, 'Tage');
    } else {
        return buildString(months, 'Monate');
    }
}

export function compareVersions(v1: string, v2: string) {
    const v1Parts = v1.split('.');
    const v2Parts = v2.split('.');

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const v1Part = Number(v1Parts[i]) || 0;
        // eslint-disable-next-line security/detect-object-injection
        const v2Part = Number(v2Parts[i]) || 0;

        if (v1Part > v2Part) {
            return 1;
        } else if (v1Part < v2Part) {
            return 2;
        }
    }

    return 0;
}
