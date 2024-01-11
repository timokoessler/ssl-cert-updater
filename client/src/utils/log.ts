import chalk from 'chalk';
import { getSocket, isWSConnected } from '../websocket';

export function log(level: LogLevel, content: string | object, logToServer = true) {
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

    const dateStr = new Date().toISOString();

    if (level === 'error') {
        console.error(`${dateStr} - ${chalk.red('ERROR')}: ${txt}`);
    } else if (level === 'warn') {
        console.warn(`${dateStr} - ${chalk.yellow('WARN')}: ${txt}`);
    } else if (level === 'info') {
        console.info(`${dateStr} - ${chalk.blue('INFO')}: ${txt}`);
    } else {
        console.log(`${dateStr} - DEBUG: ${txt}`);
    }

    if (logToServer && isWSConnected()) {
        getSocket().emit('log', level, txt, Date.now());
    }
}
