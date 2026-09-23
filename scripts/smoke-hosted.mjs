#!/usr/bin/env node
// Checks a deployed hosted app (app.crewly.space by default) boots as the
// hosted client rather than as some server's own UI.
//
//   node scripts/smoke-hosted.mjs [https://app.crewly.space]
//
// A self-hosted build served there would show a server login and "Start the
// server and reload" to every visitor (CRE-95); this catches that, and a
// Cloud that is not answering account requests, before anyone else does.
const base = (process.argv[2] ?? 'https://app.crewly.space').replace(/\/+$/, '');
const failures = [];
const check = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`); if (!ok) failures.push(message); };

async function get(path) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.text() };
}

try {
  const index = await get('/');
  check(index.status === 200, `GET / -> ${index.status}`);
  const scripts = [...index.body.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  check(scripts.length > 0, 'index.html loads an app bundle');
  let bundle = '';
  for (const script of scripts) bundle += (await get(script)).body;
  // Vite inlines VITE_CREWLY_CLOUD_URL; a hosted build carries its own address.
  check(bundle.includes(base), `bundle was built with VITE_CREWLY_CLOUD_URL=${base}`);

  const account = await get('/api/v1/account');
  check(account.status === 401 || account.status === 200, `GET /api/v1/account -> ${account.status} (401 or 200 expected)`);
  const servers = await get('/api/v1/account/servers');
  check(servers.status === 401 || servers.status === 200, `GET /api/v1/account/servers -> ${servers.status}`);
  const ready = await get('/readyz');
  check(ready.status === 200, `GET /readyz -> ${ready.status}`);
} catch (error) {
  check(false, `could not reach ${base}: ${error.message}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed for ${base}`);
  process.exit(1);
}
console.log(`\n${base} boots as the hosted app`);
