// @bun
// plugins/sonicboom/src/plugin.ts
import { mkdir } from "fs/promises";
import { join } from "path";
var plugin = {
  async activate(ctx) {
    if (!ctx.tts)
      throw new Error("SonicBoom requires the tts.output permission.");
    let child;
    const baseUrl = "http://127.0.0.1:3000";
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
      const response = await fetch(`${baseUrl}/api/status`);
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
      throw new Error(`SonicBoom did not become ready at ${baseUrl}.`);
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
        const format = ["wav", "mp3", "flac", "opus"].includes(request.format ?? "") ? request.format : "wav";
        const query = new URLSearchParams({ voice: request.voice ?? "M1", lang: request.language ?? request.lang ?? "en", format });
        const response = await fetch(`${baseUrl}/api/tts?${query}`, { method: "POST", headers: { "content-type": "text/plain; charset=utf-8" }, body: text });
        if (!response.ok)
          throw new Error(`SonicBoom TTS failed with HTTP ${response.status}: ${await response.text()}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const outputDirectory = join(ctx.plugin.dataDir, "audio");
        await mkdir(outputDirectory, { recursive: true });
        const path = join(outputDirectory, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`);
        await Bun.write(path, bytes);
        return { path, format, bytes: bytes.byteLength };
      },
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
