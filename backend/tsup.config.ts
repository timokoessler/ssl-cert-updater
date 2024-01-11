import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['./src/app.ts', './src/cli.ts'],
    bundle: true,
    platform: 'node',
    outDir: 'dist',
    loader: {
        '.sh': 'text',
        '.service': 'text',
        '.ps1': 'text',
    },
    noExternal: [/.*/],
});
