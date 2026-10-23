# Crewly 0.2.0 release candidate

The supported first experience is a single app: create your account, connect a
model provider, choose a model, and talk to one assistant. The assistant can read
attached text files and schedule reminders or future work in that conversation.
People and additional agents can be added later.

## Reproduce the checks

Use Node 24. Clone the server at the `serverRef` in `release.json` as the sibling
`../server`. Run `npm ci && npm run build` there, then in this repository:

```sh
npm ci
npm run vendor:check
npm run build
npm test
npx playwright install --with-deps chromium
npm run test:release
```

The browser check uses the production bundle and a real server. Its loopback
model fixture exercises provider HTTP requests, tool calls and persistence; it
is not a benchmark of a live commercial model. It checks setup, provider
connection, assistant creation, reply, reload, scheduled delivery and phone
layouts at 390 and 320 pixels. A failed check blocks release publication.

## Publish in order

1. Merge the coordinated server and app changes after their checks pass. The
   version in both repositories is `0.2.0`.
2. Tag this app commit `v0.2.0` and run the Release workflow. It checks the pinned
   server, builds and tests the UI, then publishes `crewly-app-dist.tar.gz`,
   including version and asset hashes in `crewly-app.json`.
3. Publish the server release after the app workflow succeeds. The server fetches
   app `0.2.0`; a missing, truncated or mismatched UI blocks its release. See the
   server's `RELEASE.md` for signed binaries and deployment.

No Cloud account, subscription gateway or paired computer is required when
using your own model API key. Reminders require the server to remain online.
For local models, pair the computer that runs them. A hosting URL is not a
substitute for that computer's localhost.
