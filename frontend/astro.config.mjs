import { defineConfig } from 'astro/config';
import proxyMiddleware from './plugins/proxy.ts';
import urlRewrite from './plugins/url-rewrite.ts';

// https://astro.build/config
export default defineConfig({
    integrations: [
        // --- Only used for development ---
        urlRewrite([
            {
                from: /^\/server\/[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\/logs$/i,
                to: '/serverLogs',
            },
            {
                from: /^\/server\/[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}.*$/i,
                to: '/server',
            },
            {
                from: /^\/register\/.*$/i,
                to: '/register',
            },
            {
                from: /^\/changeEmail\/confirm\/.*$/i,
                to: '/changeEmailConfirm',
            },
            {
                from: /^\/forgotPassword\/change\/.*$/i,
                to: '/forgotPasswordChange',
            },
        ]),
        proxyMiddleware(['/api', '/socket', '/install', '/update'], {
            target: 'http://127.0.0.1:3000',
            changeOrigin: true,
            cookieDomainRewrite: '',
            ws: true,
            logLevel: 'warn',
        }),
        // ----------------------------------
    ],
    server: {
        port: 3001,
    },
    output: 'static',
    outDir: '../backend/dist/frontend',
    build: {
        assets: 'assets',
        format: 'file',
    },
});
