#!/usr/bin/env bun
/**
 * Run one isolated actual Wry/Vue synthetic case and record host/child
 * memory (Bun port of the retired `scripts/run-live-webview-benchmark.py`).
 * Build diagnostic assets and the native test binary first (see --help).
 * Never connects to TikTok; never equates RSS with retained heap.
 */

import { closeSync, copyFileSync, openSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  IS_WINDOWS,
  belongsToParentDefault,
  descendants,
  hostActivityDefault,
  processSampleDefault,
  sha256Hex,
  windowsProcessesDefault,
  windowsSnapshot,
} from './profile-live-memory.ts';

const ROOT = join(import.meta.dir, '..');
const CASES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'] as const;
const ROW_LIMITS = [0, 50, 100, 300] as const;

type BenchmarkOptions = {
  binary: string;
  benchCase: (typeof CASES)[number];
  output: string;
  warmup: number;
  load: number;
  cleanup: number;
  rate: number;
  rowLimit: (typeof ROW_LIMITS)[number];
  lifecycle: 'root' | 'reload';
  disableRowBlur: boolean;
};

function fail(message: string): never {
  console.error(`run-live-webview-benchmark: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);
  if (has('--help') || has('-h')) {
    console.log(
      'Run one isolated actual Wry/Vue synthetic case and record host/child memory.\n' +
        'Build: VITE_TIKTOOLS_DIAGNOSTICS=1 bun scripts/task.ts frontend-build; ' +
        'node scripts/cargo-with-linker.mjs test -p tiktools-desktop --release --features live-benchmark --no-run. ' +
        'Pass the emitted test executable via --binary. Run each case in its own process.\n' +
        'Options: --binary <path> (required) --case <ABCDEFGHJ> (required) --output <dir> (required, must not exist)\n' +
        '         [--warmup S] [--load S] [--cleanup S] [--rate N] [--row-limit 0|50|100|300]\n' +
        '         [--lifecycle root|reload] [--disable-row-blur]',
    );
    process.exit(0);
  }
  const binary = get('--binary');
  const benchCase = get('--case');
  const output = get('--output');
  if (!binary) fail('--binary <test executable> is required');
  if (!benchCase || !(CASES as readonly string[]).includes(benchCase)) {
    fail('--case must be one of ABCDEFGHJ');
  }
  if (!output) fail('--output <directory> is required');
  const warmup = Number(get('--warmup') ?? '30');
  const load = Number(get('--load') ?? '600');
  const cleanup = Number(get('--cleanup') ?? '120');
  const rate = Number(get('--rate') ?? '1000');
  const rowLimit = Number(get('--row-limit') ?? '0');
  const lifecycle = (get('--lifecycle') ?? 'root') as BenchmarkOptions['lifecycle'];
  if (
    ![warmup, load, cleanup].every((value) => Number.isInteger(value)) ||
    warmup < 1 ||
    warmup > 600 ||
    load < 1 ||
    load > 1800 ||
    cleanup < 1 ||
    cleanup > 600
  ) {
    fail('phase durations must be positive and bounded');
  }
  if (!Number.isInteger(rate) || rate < 10 || rate > 10000 || rate % 10 !== 0) {
    fail('rate must be a multiple of 10 between 10 and 10000');
  }
  if (!(ROW_LIMITS as readonly number[]).includes(rowLimit)) fail('--row-limit must be 0, 50, 100, or 300');
  if (lifecycle !== 'root' && lifecycle !== 'reload') fail('--lifecycle must be root or reload');
  return {
    binary: binary as string,
    benchCase: benchCase as BenchmarkOptions['benchCase'],
    output: output as string,
    warmup,
    load,
    cleanup,
    rate,
    rowLimit: rowLimit as BenchmarkOptions['rowLimit'],
    lifecycle,
    disableRowBlur: has('--disable-row-blur'),
  };
}

function gitOutput(args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (!result.success) fail(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

function sha256File(path: string): string {
  return sha256Hex(readFileSync(path));
}

function memorySample(pid: number): Record<string, unknown> {
  if (IS_WINDOWS) {
    const { tree, truncated } = windowsSnapshot(pid, windowsProcessesDefault());
    return {
      kind: 'rss-sum-shared-pages',
      rssKib: Object.values(tree).reduce((total, info) => total + info.rss, 0),
      processes: Object.keys(tree).length,
      truncated,
    };
  }
  const rss = descendants(pid);
  const pending = [pid];
  const seen = new Set<number>();
  let pss = 0;
  let uss = 0;
  let rendererCount = 0;
  let unavailable = false;
  while (pending.length > 0 && seen.size < 256) {
    const current = pending.pop() as number;
    if (seen.has(current)) continue;
    seen.add(current);
    const currentSample = processSampleDefault(current);
    if (!currentSample) continue;
    if (current !== pid && (currentSample.name.includes('webkit') || currentSample.name.includes('webview'))) {
      rendererCount += 1;
    }
    for (const child of currentSample.children) {
      if (belongsToParentDefault(child, current)) pending.push(child);
    }
    try {
      const values: Record<string, number> = {};
      for (const line of readFileSync(`/proc/${current}/smaps_rollup`, 'utf8').split('\n')) {
        const key = line.split(':')[0]?.trim();
        if (key === 'Pss' || key === 'Private_Clean' || key === 'Private_Dirty') {
          values[key] = Number(line.split(':')[1]?.trim().split(/\s+/)[0]);
        }
      }
      pss += values['Pss'] ?? 0;
      uss += (values['Private_Clean'] ?? 0) + (values['Private_Dirty'] ?? 0);
    } catch {
      unavailable = true;
    }
  }
  const [threads, cpuTicks] = hostActivityDefault(pid);
  return {
    hostRssKib: rss[0],
    pluginRssKib: rss[1],
    rendererRssKib: rss[2],
    otherChildrenRssKib: rss[3],
    rendererProcesses: rendererCount,
    treePssKib: unavailable ? null : pss,
    treeUssKib: unavailable ? null : uss,
    processes: seen.size,
    hostThreads: threads,
    hostCpuTicks: cpuTicks,
    truncated: rss[4],
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const output = join(process.cwd(), options.output);
  try {
    await mkdir(output, { recursive: false });
  } catch {
    fail(`output directory already exists or cannot be created: ${output}`);
  }
  const revision = gitOutput(['rev-parse', 'HEAD']).trim();
  const patch = gitOutput(['diff', '--binary', 'HEAD']);
  await Bun.write(join(output, 'candidate.patch'), patch);
  const identity = !patch ? revision : `${revision}+patch-sha256:${sha256Hex(patch)}`;

  const additions: Record<string, string> = {};
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard', '-z']);
  for (const name of untracked.split('\0')) {
    if (!name) continue;
    const top = name.split('/')[0] as string;
    if (!['crates', 'scripts', 'src', 'tests'].includes(top)) continue;
    const path = join(ROOT, name);
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    additions[name] = sha256File(path);
    const dest = join(output, 'source-additions', name);
    await mkdir(join(dest, '..'), { recursive: true });
    copyFileSync(path, dest);
  }

  const webAssets: Record<string, string> = {};
  const webRoot = join(ROOT, 'dist', 'web');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        webAssets[path.split(webRoot + sep)[1]?.split(sep).join('/') as string] = sha256File(path);
      }
    }
  };
  try {
    walk(webRoot);
  } catch {
    fail(`web assets missing under ${webRoot}; run VITE_TIKTOOLS_DIAGNOSTICS=1 bun scripts/task.ts frontend-build first`);
  }
  await Bun.write(
    join(output, 'manifest.json'),
    JSON.stringify(
      {
        revision,
        sourceAdditions: additions,
        dirtyPatchSha256: patch ? sha256Hex(patch) : null,
        binarySha256: sha256File(join(process.cwd(), options.binary)),
        webAssets,
      },
      null,
      2,
    ),
  );

  const home = await mkdtemp(join(tmpdir(), 'tiktools-live-benchmark-'));
  try {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    Object.assign(env, {
      TIKTOOLS_HOME: home,
      TIKTOOLS_BENCH_CASE: options.benchCase,
      TIKTOOLS_BENCH_WARMUP: String(options.warmup),
      TIKTOOLS_BENCH_LOAD: String(options.load),
      TIKTOOLS_BENCH_CLEANUP: String(options.cleanup),
      TIKTOOLS_BENCH_RATE: String(options.rate),
      TIKTOOLS_BENCH_REVISION: identity,
      TIKTOOLS_BENCH_LIFECYCLE: options.lifecycle,
      TIKTOOLS_BENCH_ROW_LIMIT: String(options.rowLimit),
      TIKTOOLS_BENCH_OUTPUT: join(output, 'host-ui.ndjson'),
    });
    if (options.disableRowBlur) env['TIKTOOLS_BENCH_DISABLE_ROW_BLUR'] = '1';

    const nativeLog = openSync(join(output, 'native.log'), 'w');
    const memoryLog = openSync(join(output, 'process-memory.ndjson'), 'w');
    const binaryPath = join(process.cwd(), options.binary);
    const child = Bun.spawn(
      [binaryPath, '--exact', 'window::live_benchmark::native_live_matrix', '--nocapture', '--test-threads=1'],
      { cwd: ROOT, env, stdout: nativeLog, stderr: nativeLog },
    );
    try {
      const began = performance.now() / 1000;
      const deadline = began + options.warmup + options.load + options.cleanup + 90;
      for (;;) {
        if (child.exitCode !== null) break;
        const elapsed = performance.now() / 1000 - began;
        if (performance.now() / 1000 > deadline) {
          throw new Error('native benchmark exceeded bounded deadline');
        }
        const phase = elapsed < options.warmup ? 'idle' : elapsed < options.warmup + options.load ? 'load' : 'cleanup';
        writeSync(memoryLog, `${JSON.stringify({ elapsedSeconds: elapsed, phase, ...memorySample(child.pid) })}\n`);
        await Bun.sleep(1000);
      }
      const code = await child.exited;
      if (code !== 0) {
        throw new Error(`native benchmark failed (${code}); inspect ${join(output, 'native.log')}`);
      }
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        const exited = await Promise.race([
          child.exited.then(() => true),
          Bun.sleep(10000).then(() => false),
        ]);
        if (!exited) {
          child.kill('SIGKILL');
          await Promise.race([child.exited, Bun.sleep(10000)]);
        }
      }
      closeSync(nativeLog);
      closeSync(memoryLog);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  console.log(output);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`run-live-webview-benchmark failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
