import type { ViteDevServer } from 'vite';

type RewriteRule = {
    from: RegExp;
    to: string;
};

export default (rewriteRules: RewriteRule[]) => {
    return {
        name: 'url-rewrite',
        hooks: {
            'astro:server:setup': ({ server }: { server: ViteDevServer }) => {
                server.middlewares.use((req, res, next) => {
                    if (typeof req.url !== 'string') return next();
                    for (const rule of rewriteRules) {
                        if (rule.from.test(req.url)) {
                            req.url = req.url.replace(rule.from, rule.to);
                        }
                    }
                    next();
                });
            },
        },
    };
};
