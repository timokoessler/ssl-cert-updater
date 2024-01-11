import pkg from 'http-proxy-middleware';
const { createProxyMiddleware } = pkg;
import type { Options, Filter } from 'http-proxy-middleware';

import type { ViteDevServer } from 'vite';

export default (context: Options | Filter, options: Options) => {
    return {
        name: 'proxy',
        hooks: {
            'astro:server:setup': ({ server }: { server: ViteDevServer }) => {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                server.middlewares.use(createProxyMiddleware(context, options));
            },
        },
    };
};
