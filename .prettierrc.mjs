/** @type {import("prettier").Options} */
export default {
    singleQuote: true,
    tabWidth: 4,
    printWidth: 160,
    plugins: ['prettier-plugin-astro'],
    overrides: [
        {
            files: '*.astro',
            options: {
                parser: 'astro',
            },
        },
    ],
};
