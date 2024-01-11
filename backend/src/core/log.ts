import chalk from 'chalk';
import { isDev } from '../constants';

export function log(level: LogLevel, content: string | object) {
    let txt: string;
    if (typeof content === 'string') {
        txt = content;
    } else {
        try {
            txt = JSON.stringify(content);
        } catch (error) {
            txt = content.toString();
        }
    }

    // Remove newline characters to protect against crlf injection
    txt = txt.replace(/(\r\n|\n|\r)/gm, '');

    const dateStr = new Date().toISOString();

    if (level === 'error') {
        console.error(`${dateStr} - ${chalk.bgRed('ERROR')}: ${txt}`);
    } else if (level === 'warn') {
        console.warn(`${dateStr} - ${chalk.yellow('WARN')}: ${txt}`);
    } else if (level === 'info') {
        console.info(`${dateStr} - ${chalk.blue('INFO')}: ${txt}`);
    } else if (isDev()) {
        console.log(`${dateStr} - DEBUG: ${txt}`);
    }
}
