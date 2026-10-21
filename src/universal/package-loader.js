import {
  validateManifest,
  safePath,
  assertValid,
  canonical,
  assertSupportedSchema,
} from "./index.js";
import defaultEditorSchema from "./schemas/editor.schema.json" with { type: "json" };
// Trusted, precompiled static packages. Author JavaScript is never executed in
// the editor origin. This is containment, not hostile-code sandbox certification.
export async function readPackage(files) {
  const entries = new Map();
  let total = 0;
  if (files.length > 512) throw new Error("PACKAGE_FILE_LIMIT");
  for (const file of files) {
    const original = file.webkitRelativePath || file.name;
    const path = original.includes("/")
      ? original.slice(original.indexOf("/") + 1)
      : original;
    if (!safePath(path) || entries.has(path.toLowerCase()))
      throw new Error("UNSAFE_PACKAGE_PATH");
    if (
      !["manifest.json", "checksums.json"].includes(path) &&
      !/^(src|assets|schema|presets)\//.test(path)
    )
      throw new Error("PACKAGE_ALLOWLIST");
    total += file.size;
    if (total > 16 * 1024 * 1024 || file.size > 8 * 1024 * 1024)
      throw new Error("PACKAGE_SIZE_LIMIT");
    entries.set(path.toLowerCase(), { path, file });
  }
  const manifestFile = entries.get("manifest.json");
  if (!manifestFile) throw new Error("MANIFEST_REQUIRED");
  const manifest = validateManifest(JSON.parse(await manifestFile.file.text()));
  for (const path of [manifest.entry, ...Object.values(manifest.schemas ?? {})])
    if (!entries.has(path.toLowerCase()))
      throw new Error("MISSING_PACKAGE_RESOURCE: " + path);
  const settingsSchema = manifest.schemas?.settings
    ? JSON.parse(
        await entries.get(manifest.schemas.settings.toLowerCase()).file.text(),
      )
    : { type: "object" };
  assertSupportedSchema(settingsSchema);
  const editorSchema = manifest.schemas?.editor
    ? JSON.parse(
        await entries.get(manifest.schemas.editor.toLowerCase()).file.text(),
      )
    : defaultEditorSchema;
  assertSupportedSchema(editorSchema);
  const settings = {};
  for (const [key, rule] of Object.entries(settingsSchema.properties ?? {}))
    if ("default" in rule) settings[key] = rule.default;
  assertValid(settingsSchema, settings);
  return { manifest, entries, settingsSchema, settings, editorSchema };
}
function relativePath(from, path) {
  if (/^[a-z]+:|^\/|[?#\\]/i.test(path))
    throw new Error("EXTERNAL_PACKAGE_RESOURCE");
  const parts = from.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part) parts.push(part);
  }
  const result = parts.join("/");
  if (!safePath(result)) throw new Error("UNSAFE_PACKAGE_RESOURCE");
  return result;
}
export async function packageDocument(pkg, settings, session) {
  assertValid(pkg.settingsSchema, settings);
  const read = async (path) => {
    const item = pkg.entries.get(path.toLowerCase());
    if (!item) throw new Error("MISSING_PACKAGE_RESOURCE: " + path);
    return item.file;
  };
  const asset = async (from, path) => {
    if (path.startsWith("data:")) return path;
    const file = await read(relativePath(from, path));
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    const mime =
      file.type ||
      (/\.png$/i.test(path)
        ? "image/png"
        : /\.svg$/i.test(path)
          ? "image/svg+xml"
          : "application/octet-stream");
    return `data:${mime};base64,${btoa(text)}`;
  };
  const css = async (from, text) => {
    if (/@import\b/i.test(text)) throw new Error("BUNDLE_STYLESHEET_IMPORTS");
    const matches = [...text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)];
    for (const match of matches)
      text = text.replace(match[0], `url("${await asset(from, match[1])}")`);
    return text;
  };
  const html = await (await read(pkg.manifest.entry)).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("base,meta[http-equiv],iframe,object,embed,form")
    .forEach((node) => node.remove());
  for (const link of [...doc.querySelectorAll("link")]) {
    if (link.rel === "stylesheet") {
      const path = relativePath(pkg.manifest.entry, link.getAttribute("href"));
      const style = doc.createElement("style");
      style.textContent = await css(path, await (await read(path)).text());
      link.replaceWith(style);
    } else link.remove();
  }
  for (const script of [...doc.querySelectorAll("script")]) {
    if (script.type === "module")
      throw new Error("BUNDLE_MODULES_BEFORE_IMPORT");
    if (script.hasAttribute("src")) {
      script.textContent = (
        await (
          await read(
            relativePath(pkg.manifest.entry, script.getAttribute("src")),
          )
        ).text()
      ).replace(/<\/script/gi, "<\\/script");
      script.removeAttribute("src");
    }
  }
  for (const img of [
    ...doc.querySelectorAll("img[src],audio[src],video[src],source[src]"),
  ])
    img.setAttribute(
      "src",
      await asset(pkg.manifest.entry, img.getAttribute("src")),
    );
  const bootstrap = doc.createElement("script");
  bootstrap.textContent = `window.TikTokWidgetConfig=${canonical(settings).replace(/</g, "\\u003c")};const session=${JSON.stringify(session)};window.addEventListener('message',e=>{if(e.source!==parent||e.data?.session!==session||e.data?.channel!=='universal-widget-host')return;if(e.data.kind==='event')window.dispatchEvent(new CustomEvent('universal:event',{detail:e.data.event}));if(e.data.kind==='settings')location.reload();});`;
  doc.head.prepend(bootstrap);
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  doc.head.prepend(csp);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
