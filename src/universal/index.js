// Portable browser code. The schemas in ./schemas are the contract authority.
import eventSchema from "./schemas/event.schema.json" with { type: "json" };
import manifestSchema from "./schemas/manifest.schema.json" with { type: "json" };
import projectSchema from "./schemas/project.schema.json" with { type: "json" };
import { renderLayout } from "./layout.js";
import { normalizeData } from "./normalize.js";
import payloads from "./schemas/payloads.schema.json" with { type: "json" };
export const protocolVersion = 1;
let nativeSequence = 0;
export const capabilities = Object.freeze([
  "events.subscribe",
  "assets.read",
  "settings.read",
  "preview.inject",
]);
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  const result = JSON.stringify(value);
  if (
    result === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new Error("NON_JSON_VALUE");
  return result;
}
// Deliberately bounded schema vocabulary, shared with generated native validators.
// Reject unsupported schema keywords at registration rather than ignoring them.
export function validate(schema, value, path = "$", root = schema, depth = 0) {
  if (depth > 64) return [`${path}: schema depth limit`];
  const errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);
  if (schema === true) return errors;
  if (schema === false) return [`${path}: forbidden`];
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/"))
      return [`${path}: external schema reference unsupported`];
    const target = schema.$ref
      .slice(2)
      .split("/")
      .reduce((v, k) => v?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], root);
    return target
      ? validate(target, value, path, root, depth + 1)
      : [`${path}: unresolved reference`];
  }
  const types = {
    object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === "string",
    integer: Number.isInteger,
    number: (v) => typeof v === "number" && Number.isFinite(v),
    boolean: (v) => typeof v === "boolean",
    null: (v) => v === null,
  };
  if (schema.type && ![schema.type].flat().some((type) => types[type]?.(value)))
    return [`${path}: expected ${schema.type}`];
  if ("const" in schema && canonical(value) !== canonical(schema.const))
    fail("const");
  if (
    schema.enum &&
    !schema.enum.some((v) => canonical(v) === canonical(value))
  )
    fail("enum");
  if (typeof value === "string") {
    const length = [...value].length;
    if (
      length < (schema.minLength ?? 0) ||
      length > (schema.maxLength ?? Infinity)
    )
      fail("string length");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      fail("pattern");
  }
  if (
    typeof value === "number" &&
    (value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    fail("number range");
  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity)
    )
      fail("array length");
    if (
      schema.uniqueItems &&
      new Set(value.map(canonical)).size !== value.length
    )
      fail("duplicate items");
    if ("items" in schema)
      value.forEach((v, i) =>
        errors.push(
          ...validate(schema.items, v, `${path}/${i}`, root, depth + 1),
        ),
      );
  } else if (value && typeof value === "object") {
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        fail("unsafe key");
        continue;
      }
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      if (child !== undefined)
        errors.push(...validate(child, v, `${path}/${key}`, root, depth + 1));
    }
  }
  return errors;
}
export function assertValid(schema, value) {
  const errors = validate(schema, value);
  if (errors.length) throw new Error("INVALID_SCHEMA: " + errors.join("; "));
  return value;
}
export function validateEvent(value) {
  assertValid(eventSchema, value);
  // pattern alone cannot reject impossible calendar dates.
  if (
    value.timestamp.startsWith("0000") ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    new Date(value.timestamp).toISOString().replace(".000Z", "Z") !==
      value.timestamp.replace(/\.000Z$/, "Z")
  )
    throw new Error("INVALID_TIMESTAMP");
  if (payloads.definitions[value.type])
    assertValid(payloads.definitions[value.type], value.data);
  return value;
}
export function assertSupportedSchema(schema, depth = 0) {
  if (depth > 64) throw Error("SCHEMA_DEPTH_LIMIT");
  if (typeof schema === "boolean") return;
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw Error("INVALID_SCHEMA_DEFINITION");
  const allowed = [
    "$schema",
    "$id",
    "$ref",
    "$comment",
    "$defs",
    "definitions",
    "type",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "const",
    "enum",
    "title",
    "description",
    "default",
    "examples",
    "readOnly",
    "writeOnly",
    "deprecated",
  ];
  for (const key of Object.keys(schema))
    if (!allowed.includes(key) && !key.startsWith("x-"))
      throw Error("UNSUPPORTED_SCHEMA_KEYWORD: " + key);
  if (schema.type && typeof schema.type !== "string")
    throw Error("UNSUPPORTED_SCHEMA_UNION");
  if (schema.$ref && !schema.$ref.startsWith("#/"))
    throw Error("EXTERNAL_SCHEMA_REFERENCE");
  if (schema.pattern) new RegExp(schema.pattern, "u");
  for (const group of ["properties", "definitions", "$defs"])
    for (const child of Object.values(schema[group] ?? {}))
      assertSupportedSchema(child, depth + 1);
  for (const key of ["items", "additionalProperties"])
    if (key in schema) assertSupportedSchema(schema[key], depth + 1);
}
export function safePath(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (p) =>
          p &&
          p !== "." &&
          p !== ".." &&
          !p.endsWith(".") &&
          !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p),
      )
  );
}
export function validateManifest(value, supported = capabilities) {
  assertValid(manifestSchema, value);
  const prerelease = value.version.split("+")[0].split("-").slice(1).join("-");
  if (prerelease.split(".").some((part) => /^0[0-9]+$/.test(part)))
    throw Error("INVALID_SEMVER");
  for (const path of [value.entry, ...Object.values(value.schemas ?? {})])
    if (!safePath(path)) throw new Error("UNSAFE_PATH");
  for (const capability of value.capabilities)
    if (!supported.includes(capability))
      throw new Error(`UNSUPPORTED_CAPABILITY: ${capability}`);
  if (Object.keys(value.dependencies ?? {}).length)
    throw new Error(
      "UNSUPPORTED_DEPENDENCY: bundle dependencies in the package",
    );
  return value;
}
export function validateProject(value) {
  assertValid(projectSchema, value);
  const ids = new Set();
  function visit(layers, depth = 0) {
    if (depth > 32) throw Error("LAYOUT_DEPTH_LIMIT");
    for (const layer of layers) {
      if (ids.has(layer.id)) throw Error("DUPLICATE_LAYER");
      ids.add(layer.id);
      if (ids.size > 1024) throw Error("LAYER_LIMIT");
      if (layer.asset && !safePath(layer.asset)) throw Error("UNSAFE_ASSET");
      if (layer.kind === "image" && !layer.asset)
        throw Error("IMAGE_ASSET_REQUIRED");
      visit(layer.children ?? [], depth + 1);
    }
  }
  visit(value.layout.layers);
  return value;
}
export function fromOBS(event, instance = "obs.native") {
  const display = event.native?.data?.common?.displayText?.key ?? "";
  const type =
    event.type === "roomUser"
      ? "room_stats"
      : event.type === "social" &&
          /follow/i.test(display) &&
          !/unfollow/i.test(display)
        ? "follow"
        : event.type;
  const id =
    event.messageId && event.messageId !== "0"
      ? `${event.room || ""}:${event.messageId}`
      : `${instance}:${event.receivedTimestamp}:${++nativeSequence}`;
  return {
    version: 1,
    id,
    source: "tiktok.native",
    type: `tiktok.${type}`,
    timestamp: new Date(Number(event.receivedTimestamp)).toISOString(),
    data: normalizeData(
      `tiktok.${type}`,
      event.data ?? {},
      event.data?.user,
      0,
    ),
    metadata: {
      originInstance: instance,
      hopCount: 0,
      room: event.room || "",
      legacy: clone(event),
    },
  };
}
export function fromTikTools(envelope, instance = "tiktools.local") {
  if (envelope.topic !== "live.event") return null;
  const event = envelope.data?.event;
  if (!event || typeof event.type !== "string") return null;
  if (
    event.source?.startsWith("obs.") ||
    event.metadata?.originInstance?.startsWith("obs.")
  )
    return null;
  const msg = event.data?.msgId;
  const id =
    typeof msg === "string" && msg && msg !== "0"
      ? `${event.creator?.roomId || ""}:${msg}`
      : event.id;
  return validateEvent({
    version: 1,
    id,
    source: "tiktools.bridge",
    type: event.type,
    timestamp: new Date(event.timestamp).toISOString(),
    data: normalizeData(event.type, event.data ?? {}, event.user, 1),
    metadata: {
      originInstance: event.metadata?.originInstance ?? instance,
      hopCount: event.metadata?.hopCount ?? 0,
      room: event.creator?.roomId || "",
      legacy: clone(event),
    },
  });
}
export class EventRouter {
  constructor({ capacity = 8192, instance = "widget", maxHop = 4 } = {}) {
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 65536 ||
      !Number.isInteger(maxHop) ||
      maxHop < 1 ||
      maxHop > 4
    )
      throw Error("INVALID_ROUTER_LIMIT");
    this.capacity = capacity;
    this.instance = instance;
    this.maxHop = maxHop;
    this.seen = new Map();
    this.handlers = new Set();
    this.stats = {
      accepted: 0,
      duplicate: 0,
      rejected: 0,
      delivered: 0,
      failed: 0,
    };
  }
  subscribe(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  push(event) {
    try {
      validateEvent(event);
    } catch {
      this.stats.rejected++;
      return "invalid";
    }
    if (
      event.metadata?.originInstance === this.instance ||
      (event.metadata?.hopCount ?? 0) >= this.maxHop
    ) {
      this.stats.rejected++;
      return "loop";
    }
    const key = `${event.type}:${event.type.startsWith("tiktok.") ? "" : event.source + ":"}${event.id}`;
    if (this.seen.has(key)) {
      this.stats.duplicate++;
      return "duplicate";
    }
    this.seen.set(key, true);
    if (this.seen.size > this.capacity)
      this.seen.delete(this.seen.keys().next().value);
    this.stats.accepted++;
    for (const fn of this.handlers) {
      try {
        fn(clone(event));
        this.stats.delivered++;
      } catch {
        this.stats.failed++;
      }
    }
    return "accepted";
  }
}
export class WidgetRuntime {
  constructor(widget, host, manifest) {
    validateManifest(manifest, host.capabilities);
    this.widget = widget;
    this.host = host;
    this.manifest = manifest;
    this.state = "new";
    this.router = new EventRouter({ instance: host.instance });
    this.pending = Promise.resolve();
    this.pendingCount = 0;
    this.dropped = 0;
  }
  async initialize(settings = {}) {
    if (this.state !== "new") throw new Error("INVALID_LIFECYCLE");
    this.state = "initializing";
    this.initialization = (async () => {
      try {
        if (this.host.settingsSchema)
          assertValid(this.host.settingsSchema, settings);
        await this.widget.initialize?.({
          settings: clone(settings),
          capabilities: [...this.manifest.capabilities],
        });
        if (this.state !== "initializing") return;
        await this.widget.mount?.(this.host.root);
        if (this.state !== "initializing") return;
        const project =
          this.host.project ?? globalThis.window?.UniversalWidgetProject;
        if (project) {
          validateProject(project);
          const base =
            this.host.assetBase ??
            new URL(
              "../".repeat(this.manifest.entry.split("/").length - 1),
              document.baseURI,
            ).href;
          this.removeLayout = renderLayout(
            project,
            this.host.root.parentElement,
            base,
          );
        }
        this.state = "mounted";
        this.router.subscribe((event) => {
          if (this.manifest.events.includes(event.type))
            this.enqueue(() => this.widget.onEvent?.(event));
        });
        if (this.manifest.capabilities.includes("events.subscribe"))
          this.off = this.host.subscribe(
            (event) => this.state === "mounted" && this.router.push(event),
          );
      } catch (error) {
        if (this.state !== "disposed") {
          this.state = "failed";
          await this.cleanup();
        }
        throw error;
      }
    })();
    return this.initialization;
  }
  enqueue(fn) {
    if (this.pendingCount >= 256) {
      this.dropped++;
      return Promise.resolve();
    }
    this.pendingCount++;
    this.pending = this.pending
      .then(fn)
      .catch((error) => {
        try {
          this.host.onError?.(error);
        } catch {
          /* Error reporting cannot break delivery. */
        }
      })
      .finally(() => this.pendingCount--);
    return this.pending;
  }
  async updateSettings(settings) {
    if (this.state !== "mounted") throw new Error("INVALID_LIFECYCLE");
    if (this.host.settingsSchema)
      assertValid(this.host.settingsSchema, settings);
    return this.enqueue(() => this.widget.updateSettings?.(clone(settings)));
  }
  preview(event) {
    if (
      this.state !== "mounted" ||
      !this.host.preview ||
      !this.manifest.capabilities.includes("preview.inject")
    )
      throw new Error("PREVIEW_ONLY");
    return this.router.push(event);
  }
  async dispose() {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.off?.();
    await this.initialization?.catch(() => {});
    await this.pending;
    await this.cleanup();
  }
  async cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    this.removeLayout?.();
    await this.widget.dispose?.();
  }
}
export function browserHost(
  root,
  {
    preview = false,
    instance = "browser",
    settingsSchema,
    onError = console.error,
  } = {},
) {
  return {
    root,
    instance,
    preview,
    settingsSchema,
    onError,
    capabilities,
    subscribe(fn) {
      const canonicalHandler = (e) => fn(e.detail);
      // New OBS versions emit the canonical channel exactly once. Old versions
      // can opt into fromOBS explicitly; never subscribe to both implicitly.
      window.addEventListener("universal:event", canonicalHandler);
      return () =>
        window.removeEventListener("universal:event", canonicalHandler);
    },
  };
}
export function replay(
  events,
  emit,
  { speed = 1, schedule = setTimeout, cancel = clearTimeout } = {},
) {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new Error("INVALID_SPEED");
  events.forEach(validateEvent);
  const start = events.length ? Date.parse(events[0].timestamp) : 0;
  const timers = events.map((e) =>
    schedule(
      () => emit(clone(e)),
      Math.max(0, (Date.parse(e.timestamp) - start) / speed),
    ),
  );
  return () => timers.forEach(cancel);
}
