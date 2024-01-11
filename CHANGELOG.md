# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0]

### Added

-   Check licenses of dependencies using GitHub Actions
-   Add environment variable to set the Sentry DSN for the frontend (`SENTRY_DSN_FRONTEND`)

### Changed

-   Fix: crash on ocsp failure
-   Fix: wrong cron job time
-   Improve output when no client update is available
-   Update dependencies

## [1.1.0]

### Added

-   Graceful shutdown
-   Improved performance of page system
-   Add setting to disable offline notifications for a single server
-   Add arm64 client support
-   Check password complexity
-   Check OCSP status
-   Add cli option to run renewals

### Changed

-   Changes to autocomplete and spellcheck on input fields
-   Improve handling of busy ca server

## [1.0.0]

_This is the initial release._
