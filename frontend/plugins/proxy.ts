import { createProxyMiddleware, type Options } from 'http-proxy-middleware';

import type { ViteDevServer } from 'vite';

export default function proxy(options: Options) {
    return {
        name: 'proxy',
        hooks: {
            'astro:server:setup': ({ server }: { server: ViteDevServer }) => {
                server.middlewares.use(createProxyMiddleware(options));
            },
        },
    };
}
