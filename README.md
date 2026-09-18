# OpenCrew App

The OpenCrew browser client. Talks to any OpenCrew server — self-hosted or
hosted — over the SDK.

```text
src/
  protocol/   vendored from opencrew-server  (do not edit here)
  sdk/        vendored from opencrew-server  (do not edit here)
  ui/         the design language            (owner; vendored by opencrew-cloud)
  lib/ components/ ...
```

## Develop

```sh
npm ci
npm run dev       # proxies /api to http://127.0.0.1:4000
npm run build
npm test
```

`@opencrew/sdk` and `@opencrew/ui` resolve to the vendored copies through
aliases in `vite.config.ts` and `tsconfig.json`. There is no workspace and
nothing is published to npm.

## Vendored code

```sh
npm run vendor:check    # CI: fails if a vendored copy drifted
npm run vendor:sync     # refresh from ../opencrew-server, then commit
```

## Releases

`npm run build` produces `dist/`. The server repository consumes it as
`opencrew-app-dist.tar.gz` from this repo's GitHub release.
