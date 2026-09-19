# Crewly app instructions

GitHub organization: crewly-space. One of four repositories:
`server`, `app` (this), `cli`, `cloud`.

`src/protocol` and `src/sdk` are **vendored copies owned by the server repo**.
Do not edit them here. Change them in the server repo, then run
`npm run vendor:sync` and commit the refresh. CI runs `vendor:check`.

This repo **owns** `src/ui`, the design language. The cloud console and the
marketing site vendor it. Never restate a raw colour in a consumer — add a
token in `src/ui` instead.

The app is not built by the server's Docker image. Shipping a UI change to
self-hosters means cutting a release here, then the server picking it up.

Architecture rule: Agent != Model != Runtime != Runtime Session.
Runtime Session = Agent + Conversation + Runtime + Workspace.
