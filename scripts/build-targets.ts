import { resolve } from 'node:path';

/** A `bun build --compile` target we ship binaries for. */
type BunCompileTarget = NonNullable<Extract<Parameters<typeof Bun.build>[0]['compile'], object>['target']>;

export interface CompileTarget {
  /** Value passed to `Bun.build({ compile: { target } })`. */
  target: BunCompileTarget;
  /** Basename of the produced artifact, extension included. */
  artifact: string;
  platform: NodeJS.Platform;
  arch: string;
  /**
   * Targets excluded from `all` because a native dependency has no binary for
   * them yet. They still build when named explicitly.
   */
  unsupported?: string;
}

export const compileTargets: readonly CompileTarget[] = [
  { target: 'bun-windows-x64', artifact: 'TikTools-windows-x64.exe', platform: 'win32', arch: 'x64' },
  { target: 'bun-windows-arm64', artifact: 'TikTools-windows-arm64.exe', platform: 'win32', arch: 'arm64' },
  { target: 'bun-linux-x64', artifact: 'TikTools-linux-x64', platform: 'linux', arch: 'x64' },
  { target: 'bun-linux-arm64', artifact: 'TikTools-linux-arm64', platform: 'linux', arch: 'arm64' },
  {
    target: 'bun-darwin-x64',
    artifact: 'TikTools-darwin-x64',
    platform: 'darwin',
    arch: 'x64',
    unsupported: 'tray-icon-node ships no darwin binary',
  },
  {
    target: 'bun-darwin-arm64',
    artifact: 'TikTools-darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    unsupported: 'tray-icon-node ships no darwin binary',
  },
];

export const outputDirectory = resolve(process.cwd(), process.env.TIKTOOLS_EXE_OUTDIR ?? 'dist');

/** The target matching the machine running the build, used by the smoke tests. */
export function hostTarget(): CompileTarget {
  const match = compileTargets.find(
    (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
  );
  if (!match) {
    throw new Error(`No compile target for ${process.platform}-${process.arch}.`);
  }
  return match;
}

/** Absolute path of a target's artifact inside the output directory. */
export function artifactPath(target: CompileTarget = hostTarget()): string {
  return resolve(outputDirectory, target.artifact);
}

/**
 * Targets requested on the command line (`bun run build:exe linux-x64 windows-x64`)
 * or through `TIKTOOLS_EXE_TARGETS`. `all` expands to every target; the default is
 * the host platform, which is the only one the local smoke tests can run.
 */
export function resolveTargets(requested: readonly string[]): CompileTarget[] {
  const names = requested.length > 0
    ? requested
    : (process.env.TIKTOOLS_EXE_TARGETS?.split(/[\s,]+/).filter(Boolean) ?? []);
  if (names.length === 0) return [hostTarget()];
  if (names.includes('all')) return compileTargets.filter((candidate) => !candidate.unsupported);

  return names.map((name) => {
    const normalized = name.startsWith('bun-') ? name : `bun-${name}`;
    const match = compileTargets.find((candidate) => candidate.target === normalized);
    if (!match) {
      const known = compileTargets.map((candidate) => candidate.target.slice(4)).join(', ');
      throw new Error(`Unknown build target "${name}". Known targets: ${known}, all.`);
    }
    return match;
  });
}
