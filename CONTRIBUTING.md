# Contributing

Any contribution is greatly appreciated 🥳.

To get an overview of the project, read the README and take a look at the source files. Below you find some notes that should help you to get started.

If you have any questions, please do not hesitate to contact me. You can find my contact information in the README and on my website.

## Security

If you would like to report a security vulnerability, please take a look at [SECURITY.md](SECURITY.md)

## Code of Conduct

Read our [Code of Conduct](CODE_OF_CONDUCT.md) to keep our community approachable and respectable.

## Running in development mode

-   The application requires a MongoDB instance to run.
-   Run the command `npm run dev-server` to start the backend and frontend in development mode.
-   In development mode (`NODE_ENV != production`), the frontend will **not** be served by the backend like in production
-   The frontend will be served by the Astro dev server on port 3001.
-   The backend port is configured in the .env file and defaults to 3000.
-   Before you can run the server, you need to create a .env file. For that you can use the CLI by running `npm run cli` in the backend directory.
-   The command `npm run dev` will run the backend, frontend and the client software. You must configure the client using the Web UI before you can run it successfully.
