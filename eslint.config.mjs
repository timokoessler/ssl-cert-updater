import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import pluginSecurity from 'eslint-plugin-security';

export default [
    { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx,astro}'] },
    {
        ignores: ['**/*.d.ts', '**/dist', '**/.turbo', '**/data', '**/node_modules'],
    },
    { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    ...eslintPluginAstro.configs.recommended,

    pluginSecurity.configs.recommended,
    {
        rules: {
            '@typescript-eslint/ban-ts-comment': 'off',
        },
    },
];
