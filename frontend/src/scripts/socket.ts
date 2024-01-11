import { io, Socket } from 'socket.io-client';
import { showErrorToast } from './toasts';
import { navigate } from 'astro:transitions/client';

let socket: Socket;

export function getWS() {
    if (socket) return socket;
    socket = io('/browser', {
        path: '/socket',
        transports: ['websocket'],
    });
    socket.on('error', function (err) {
        console.error(err.message);
        showErrorToast('Die Verbindung zum Server wurde unterbrochen.');
    });
    socket.on('connect_error', function (err) {
        if (err.message === 'Authentication failed') {
            navigate('/login');
            return;
        }
        console.error(err.message);
        showErrorToast('Die Verbindung zum Server konnte nicht hergestellt werden.');
    });
    return socket;
}
