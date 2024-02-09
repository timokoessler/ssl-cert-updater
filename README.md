# SSL Cert Updater

A tool to automatically issue Let’s Encrypt wildcard SSL certificates and deploy them to multiple servers.

After the initial setup nearly any action can be done through the web UI.

> [!WARNING]  
> This software is still a work in progress and there is no stable release yet.

This software was previously a internal tool of a company and is now open source and may not be self-explanatory yet.

## Getting started

The application consists of a server and a client. The server is responsible for issuing and renewing SSL certificates and provides a web UI. The client is responsible for deploying the certificates to the servers and must be installed on each server that should receive SSL certificates.

You can use the provided `docker-compose.yml` file for installing the application. Please note that you need to provide a MongoDB instance and a SMTP server for the application to work.

The client software is provided as a binary for Linux, Windows and macOS and can be downloaded from the web UI during the setup of a new server (client).

For generating the .env file and required keys you can run the included CLI:

```bash
docker compose run -it --rm ssl-cert-updater cli
```

After first setup, you can use the CLI to invite users.

## Todos

-   Translate application from German to English
-   Improve dark mode
-   Add more configuration options through ENV variables
-   Create documentation
-   Add 2FA App support instead of email

## Contact

If a public GitHub issue or discussion is not the right choice for your concern, you can contact me directly:

-   E-Mail: [info@timokoessler.de](mailto:info@timokoessler.de)

## License

© [Timo Kössler](https://timokoessler.de) 2024  
Released under the [MIT license](https://github.com/timokoessler/ssl-cert-updater/blob/main/LICENSE)
