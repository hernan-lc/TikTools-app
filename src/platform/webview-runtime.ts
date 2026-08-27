import type { WebviewRuntime as WebviewRuntimeApi } from 'webview-napi/runtime';

/**
 * `webview-napi/runtime` resolves its CommonJS implementation through
 * `createRequire(import.meta.url)`, which `bun build --compile` cannot follow:
 * the compiled binary fails at startup with "Cannot find module './runtime.cjs'"
 * and never embeds the native addon. Importing the CommonJS entry directly keeps
 * the bundler's static graph intact so the `.node` binding is embedded for the
 * build target. The package ships no `.d.cts` beside it, hence the cast.
 */
// @ts-expect-error -- untyped CommonJS entry, typed through WebviewRuntimeApi below.
import runtime from '../../node_modules/webview-napi/runtime.cjs';

export const WebviewRuntime: typeof WebviewRuntimeApi = runtime.WebviewRuntime;
