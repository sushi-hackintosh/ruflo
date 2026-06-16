#!/usr/bin/env node
// mcp-scan.mjs — wrapper around `harness mcp-scan <path>`.
//
// Static security scan of the harness's declared MCP surface. Reads
// .mcp/servers.json + .harness/claims.json. Pure-read, no dispatch.
//
// USAGE
//   node scripts/mcp-scan.mjs                           # current dir
//   node scripts/mcp-scan.mjs --path <dir>
//   node scripts/mcp-scan.mjs --fail-on high            # exit 1 if any HIGH finding (default)
//   node scripts/mcp-scan.mjs --fail-on medium          # also fail on MEDIUM
//   node scripts/mcp-scan.mjs --format json
//
// EXIT CODES
//   0  no findings at or above --fail-on (or degraded)
//   1  at least one finding ≥ --fail-on severity
//   2  config error or scan failure

import { runHarness, emitDegradedJsonAndExit } from './_harness.mjs';

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

const ARGS = (() => {
  const a = { path: '.', format: 'json', failOn: 'high' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--fail-on') a.failOn = String(process.argv[++i] || 'high').toLowerCase();
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  if (!SEVERITY_RANK[ARGS.failOn]) {
    console.error(`mcp-scan: --fail-on must be one of low|medium|high; got ${ARGS.failOn}`);
    process.exit(2);
  }
  const r = runHarness(['mcp-scan', ARGS.path]);
  if (r.degraded) { emitDegradedJsonAndExit(r.reason); return; }
  if (r.exitCode !== 0 && r.exitCode !== 1) {
    // exit 1 from harness can be "findings present"; only treat other
    // non-zero as a real failure.
    console.error(`mcp-scan: harness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  // The JSON output shape from `harness mcp-scan` includes findings[].
  const payload = r.json ?? { rawStdout: r.stdout.slice(0, 400) };
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const threshold = SEVERITY_RANK[ARGS.failOn];
  const offending = findings.filter((f) => SEVERITY_RANK[String(f.severity || 'low').toLowerCase()] >= threshold);

  const alert = {
    threshold: ARGS.failOn,
    triggered: offending.length > 0,
    offendingCount: offending.length,
    reason: offending.length > 0
      ? `${offending.length} finding(s) at or above ${ARGS.failOn} severity`
      : `no findings at or above ${ARGS.failOn} severity — OK`,
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({ ...payload, durationMs: r.durationMs, alert }, null, 2));
  } else {
    console.log(`# harness mcp-scan — ${ARGS.path}`);
    console.log('');
    console.log(`Total findings: ${findings.length}`);
    console.log(`| Severity | ID | Server | Tool | Message |`);
    console.log(`|---|---|---|---|---|`);
    for (const f of findings.slice(0, 50)) {
      console.log(`| ${f.severity} | ${f.id ?? '—'} | ${f.server ?? '—'} | ${f.tool ?? '—'} | ${f.message ?? ''} |`);
    }
    console.log('');
    console.log(alert.triggered ? `⚠ **ALERT**: ${alert.reason}` : `✓ ${alert.reason}`);
  }

  if (alert.triggered) process.exit(1);
}

main();
