// @bun
// src/plugin.ts
import { mkdir } from "fs/promises";
import { join } from "path";

// src/settings.ts
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 3000;
function normalizeHost(value) {
  if (typeof value !== "string")
    return DEFAULT_HOST;
  const host = value.trim();
  if (!host || host.length > 253 || /\s/.test(host))
    return DEFAULT_HOST;
  return host;
}
function normalizePort(value) {
  const port = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return DEFAULT_PORT;
  return port;
}
function buildBaseUrl(host, port) {
  return `http://${normalizeHost(host)}:${normalizePort(port)}`;
}
function parseVoices(payload) {
  const candidates = Array.isArray(payload) ? payload : payload && typeof payload === "object" && !Array.isArray(payload) ? payload.data ?? payload.voices : undefined;
  if (!Array.isArray(candidates))
    return [];
  const voices = [];
  for (const entry of candidates.slice(0, 100)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      continue;
    const record = entry;
    if (typeof record.id !== "string" || !record.id.trim())
      continue;
    const voice = { id: record.id };
    if (typeof record.name === "string" && record.name.trim())
      voice.name = record.name;
    voices.push(voice);
  }
  return voices;
}

// src/plugin.ts
var plugin = {
  async activate(ctx) {
    if (!ctx.tts)
      throw new Error("SonicBoom requires the tts.output permission.");
    let child;
    const baseUrl = async () => buildBaseUrl(await ctx.storage.get("host"), await ctx.storage.get("port"));
    const stop = async () => {
      const processHandle = child;
      child = undefined;
      if (!processHandle)
        return;
      processHandle.kill();
      await processHandle.exited.catch(() => {
        return;
      });
    };
    const health = async () => {
      const response = await fetch(`${await baseUrl()}/api/status`);
      const body = await response.json();
      if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error(`SonicBoom health check failed with HTTP ${response.status}.`);
      }
      return body;
    };
    const start = async () => {
      if (child)
        return;
      child = Bun.spawn(["SonicBoom"], { stdout: "ignore", stderr: "pipe", windowsHide: true });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const status = await health();
          if (status.status === "ready")
            return;
          if (status.status === "failed")
            throw new Error(String(status.error ?? "SonicBoom model failed to load."));
        } catch {}
        await wait(250);
      }
      await stop();
      throw new Error(`SonicBoom did not become ready at ${await baseUrl()}.`);
    };
    const listVoices = async () => {
      try {
        const controller = new AbortController;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(`${await baseUrl()}/v1/voices`, { signal: controller.signal });
          if (!response.ok)
            return [];
          return parseVoices(await response.json());
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return [];
      }
    };
    const provider = {
      id: "sonicboom",
      name: "SonicBoom",
      priority: 10,
      async synthesize(request) {
        const text = request.text.trim();
        if (!text)
          throw new Error("TTS text cannot be empty.");
        await start();
        const url = await baseUrl();
        const format = ["wav", "mp3", "flac", "opus"].includes(request.format ?? "") ? request.format : "wav";
        const query = new URLSearchParams({ voice: request.voice ?? "M1", lang: request.language ?? request.lang ?? "en", format });
        const response = await fetch(`${url}/api/tts?${query}`, { method: "POST", headers: { "content-type": "text/plain; charset=utf-8" }, body: text });
        if (!response.ok)
          throw new Error(`SonicBoom TTS failed with HTTP ${response.status}: ${await response.text()}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const outputDirectory = join(ctx.plugin.dataDir, "audio");
        await mkdir(outputDirectory, { recursive: true });
        const path = join(outputDirectory, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`);
        await Bun.write(path, bytes);
        return { path, format, bytes: bytes.byteLength };
      },
      listVoices,
      stop
    };
    ctx.tts.registerProvider(provider);
    ctx.logger.info("SonicBoom provider activated.");
  }
};
var plugin_default = plugin;
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export {
  plugin_default as default
};
