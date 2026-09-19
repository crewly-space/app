# Crewly App

The Crewly browser client. Talks to any Crewly server — self-hosted or
hosted — over the SDK.

```text
src/
  protocol/   vendored from crewly-server  (do not edit here)
  sdk/        vendored from crewly-server  (do not edit here)
  ui/         the design language            (owner; vendored by crewly-cloud)
  lib/ components/ ...
```

## Develop

```sh
npm ci
npm run dev       # proxies /api to http://127.0.0.1:4000
npm run build
npm test
```

`@crewly/sdk` and `@crewly/ui` resolve to the vendored copies through
aliases in `vite.config.ts` and `tsconfig.json`. There is no workspace and
nothing is published to npm.

## Vendored code

```sh
npm run vendor:check    # CI: fails if a vendored copy drifted
npm run vendor:sync     # refresh from ../server, then commit
```

## Releases

`npm run build` produces `dist/`. The server repository consumes it as
`crewly-app-dist.tar.gz` from this repo's GitHub release.
