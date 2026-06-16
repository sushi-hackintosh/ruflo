// _harness.mjs — shared invocation helper for the metaharness/harness CLIs.
//
// All ruflo-metaharness skills shell out to the upstream CLI rather than
// linking the library — this honors ADR-150's architectural constraint
// (MetaHarness must remain a removable augmentation, never a required
// runtime dep) while still giving us "deep integration" through a single
// vetted bridge that every skill imports from.
//
// CONTRACT
//   - `runMetaharness(args, opts)` — invoke `npx metaharness <args>`
//   - `runHarness(args, opts)`     — invoke `npx -p metaharness harness <args>`
//   - both return `{ stdout, stderr, exitCode, json|null, durationMs }`
//   - `--json` flag is appended automatically when `opts.json !== false`
//   - subprocess hard timeout (default 60s) — captured in opts.timeoutMs
//   - on MODULE_NOT_FOUND or "not installed", returns degraded result with
//     `degraded: true, reason: 'metaharness-not-available'` — never throws
//     (ADR-150 graceful-degradation rule #3)

import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;

function execCli(bin, args, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantJson = opts.json !== false;
  const argv = wantJson && !args.includes('--json') ? [...args, '--json'] : [...args];
  const r = spawnSync('npx', [bin, ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - start;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  // Graceful degradation — npx couldn't find the binary.
  if (r.status === null || /could not determine executable|404|not installed|MODULE_NOT_FOUND/i.test(stderr)) {
    return {
      stdout, stderr,
      exitCode: r.status ?? 127,
      json: null,
      durationMs,
      degraded: true,
      reason: 'metaharness-not-available',
    };
  }
  let json = null;
  if (wantJson) {
    const m = /\{[\s\S]*\}/.exec(stdout);
    if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
  }
  return { stdout, stderr, exitCode: r.status ?? 0, json, durationMs, degraded: false };
}

export function runMetaharness(args, opts) {
  return execCli('-y metaharness@latest', args, opts);
}

export function runHarness(args, opts) {
  // The `harness` binary ships inside the `metaharness` package, so we
  // need `npx -p metaharness@latest harness <args>`. spawnSync receives
  // a single argv array, so encode the `-p` flag as its own argument.
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantJson = opts?.json !== false;
  const argv = wantJson && !args.includes('--json') ? [...args, '--json'] : [...args];
  const r = spawnSync('npx', ['-y', '-p', 'metaharness@latest', 'harness', ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - start;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  if (r.status === null || /could not determine executable|404|not installed|MODULE_NOT_FOUND/i.test(stderr)) {
    return {
      stdout, stderr,
      exitCode: r.status ?? 127,
      json: null,
      durationMs,
      degraded: true,
      reason: 'metaharness-not-available',
    };
  }
  let json = null;
  if (wantJson) {
    const m = /\{[\s\S]*\}/.exec(stdout);
    if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
  }
  return { stdout, stderr, exitCode: r.status ?? 0, json, durationMs, degraded: false };
}

// Convenience emitters for skill scripts — keep the boilerplate out of
// each skill so they focus on argument parsing + exit-code semantics.
export function emitDegradedJsonAndExit(reason) {
  const payload = {
    degraded: true,
    reason,
    hint: 'Install metaharness manually with `npm i -D metaharness` or run `npx metaharness@latest --version` to verify network access.',
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload, null, 2));
  // Exit 0 — ADR-150 architectural constraint says ruflo continues to
  // function when MetaHarness is absent. Skills emit a structured
  // degraded payload rather than failing.
  process.exit(0);
}
