import { buildAll, buildBinary, buildHost, buildPlugins, cleanOutputs, listTargets } from './build-lib.ts';
import { compileTargets } from './build-targets.ts';

const HELP = `Usage: bun run scripts/build.ts [command] [targets...]

Commands:
  binary [targets...]   Build standalone binaries (default; no targets = host)
  host                  Build the development host bundle (dist/host)
  plugins               Build the checked-in AppPlugin entries
  all                   plugins + host + every supported binary
  clean                 Remove generated build output
  list                  List known compile targets

Targets: ${compileTargets.map((target) => target.target.slice(4)).join(', ')}, all
A bare target also works: \`build.ts linux-x64\` means \`build.ts binary linux-x64\`.

Environment:
  TIKTOOLS_BINARY_OUTDIR (legacy TIKTOOLS_EXE_OUTDIR)   binary output directory
  TIKTOOLS_BINARY_TARGETS (legacy TIKTOOLS_EXE_TARGETS)  default targets
  TIKTOOLS_HOST_OUTDIR                                   host output directory`;

const [command = 'binary', ...rest] = process.argv.slice(2);

if (command === '-h' || command === '--help' || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case 'binary':
    await buildBinary(rest);
    break;
  case 'host':
    if (rest.length > 0) console.warn('Ignoring extra arguments for "host".');
    await buildHost();
    break;
  case 'plugins':
    if (rest.length > 0) console.warn('Ignoring extra arguments for "plugins".');
    await buildPlugins();
    break;
  case 'all':
    if (rest.length > 0) console.warn('Ignoring extra arguments for "all".');
    await buildAll();
    break;
  case 'clean':
    if (rest.length > 0) console.warn('Ignoring extra arguments for "clean".');
    await cleanOutputs();
    break;
  case 'list':
    if (rest.length > 0) console.warn('Ignoring extra arguments for "list".');
    listTargets();
    break;
  default: {
    const normalized = command.startsWith('bun-') ? command : `bun-${command}`;
    const looksLikeTarget =
      command === 'all' || compileTargets.some((target) => target.target === normalized);
    if (!looksLikeTarget) {
      throw new Error(
        `Unknown command "${command}". Expected binary|host|plugins|all|clean|list, a target name, or --help.`,
      );
    }
    await buildBinary([command, ...rest]);
    break;
  }
}
