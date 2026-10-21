import { canonical, clone, validateProject, assertValid } from "./index.js";
import presetSchema from "./schemas/preset.schema.json" with { type: "json" };
export function exportPreset(project) {
  inspectProject(project);
  return canonical({
    contract: "universal-widget-preset",
    schemaVersion: 1,
    widget: project.widget,
    settings: project.settings,
    layout: project.layout,
    ...(project.editor ? { editor: project.editor } : {}),
  });
}
export function importPreset(project, value, settingsSchema) {
  const warnings = [];
  if (value.contract === undefined) {
    value = {
      contract: "universal-widget-preset",
      schemaVersion: 1,
      widget: project.widget,
      settings: value,
    };
    warnings.push("Legacy settings preset adapted; layout retained.");
  }
  assertValid(presetSchema, value);
  if (canonical(value.widget) !== canonical(project.widget))
    throw Error("WIDGET_VERSION_MISMATCH");
  if (settingsSchema) assertValid(settingsSchema, value.settings);
  const next = {
    ...clone(project),
    settings: clone(value.settings),
    layout: clone(value.layout ?? project.layout),
    ...(value.editor ? { editor: clone(value.editor) } : {}),
  };
  return { project: inspectProject(next), warnings };
}
export class EditorHistory {
  constructor(capacity = 50, copy = clone) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("INVALID_CAPACITY");
    this.capacity = capacity;
    this.copy = copy;
    this.past = [];
    this.future = [];
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get depth() {
    return this.past.length;
  }
  commit(before) {
    this.past.push(this.copy(before));
    if (this.past.length > this.capacity) this.past.shift();
    this.future.length = 0;
  }
  undo(current) {
    if (!this.canUndo) return null;
    this.future.push(this.copy(current));
    return this.past.pop();
  }
  redo(current) {
    if (!this.canRedo) return null;
    this.past.push(this.copy(current));
    return this.future.pop();
  }
}
function layers(project) {
  const out = [];
  const visit = (list, parent = null) =>
    list.forEach((node) => {
      out.push({ node, parent, list });
      visit(node.children ?? [], node);
    });
  visit(project.layout.layers);
  return out;
}
export function inspectProject(value) {
  validateProject(value);
  const ids = layers(value).map(({ node }) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_LAYER");
  return value;
}
export function applyCommand(before, command, settingsSchema) {
  const project = clone(inspectProject(before));
  const found = command.id
    ? layers(project).find(({ node }) => node.id === command.id)
    : undefined;
  switch (command.type) {
    case "settings":
      if (settingsSchema) assertValid(settingsSchema, command.value);
      project.settings = clone(command.value);
      break;
    case "editor":
      project.editor = clone(command.value);
      break;
    case "transform": {
      if (!found) throw new Error("LAYER_NOT_FOUND");
      const grid = command.snap ?? 1;
      if (!Number.isFinite(grid) || grid <= 0) throw new Error("INVALID_GRID");
      for (const [key, value] of Object.entries(command.value)) {
        if (
          !["x", "y", "width", "height", "rotation", "opacity"].includes(key) ||
          !Number.isFinite(value)
        )
          throw new Error("INVALID_TRANSFORM");
        found.node[key] = ["x", "y", "width", "height"].includes(key)
          ? Math.round(value / grid) * grid
          : value;
      }
      break;
    }
    case "insert": {
      const parent = command.parent
        ? layers(project).find(({ node }) => node.id === command.parent)?.node
        : null;
      if (command.parent && !parent) throw new Error("LAYER_NOT_FOUND");
      const list = parent ? (parent.children ??= []) : project.layout.layers;
      list.splice(command.index ?? list.length, 0, clone(command.layer));
      break;
    }
    case "remove":
      if (!found) throw new Error("LAYER_NOT_FOUND");
      found.list.splice(found.list.indexOf(found.node), 1);
      break;
    case "reorder": {
      if (
        !found ||
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= found.list.length
      )
        throw new Error("INVALID_REORDER");
      found.list.splice(found.list.indexOf(found.node), 1);
      found.list.splice(command.index, 0, found.node);
      break;
    }
    case "timeline":
      project.timeline = clone(command.value);
      break;
    default:
      throw new Error("UNKNOWN_COMMAND");
  }
  return inspectProject(project);
}
export class EditorSession {
  constructor(
    project,
    { save = () => {}, settingsSchema, editorSchema, capacity = 50 } = {},
  ) {
    this.project = clone(inspectProject(project));
    this.history = new EditorHistory(capacity);
    this.selection = [];
    this.save = save;
    this.settingsSchema = settingsSchema;
    this.editorSchema = editorSchema;
    this.commands = [];
  }
  select(ids) {
    const known = new Set(layers(this.project).map(({ node }) => node.id));
    if (ids.some((id) => !known.has(id))) throw new Error("LAYER_NOT_FOUND");
    this.selection = [...new Set(ids)];
  }
  execute(command) {
    if (command.type === "editor" && this.editorSchema)
      assertValid(this.editorSchema, command.value);
    const next = applyCommand(this.project, command, this.settingsSchema);
    this.history.commit(this.project);
    this.project = next;
    this.commands.push(clone(command));
    this.persist();
  }
  persist() {
    const known = new Set(layers(this.project).map(({ node }) => node.id));
    this.selection = this.selection.filter((id) => known.has(id));
    return this.save(this.export());
  }
  undo() {
    const value = this.history.undo(this.project);
    if (value) {
      this.project = value;
      this.persist();
    }
  }
  redo() {
    const value = this.history.redo(this.project);
    if (value) {
      this.project = value;
      this.persist();
    }
  }
  export() {
    return canonical(this.project);
  }
  import(text) {
    const value = inspectProject(JSON.parse(text));
    if (this.settingsSchema) assertValid(this.settingsSchema, value.settings);
    if (this.editorSchema) assertValid(this.editorSchema, value.editor ?? {});
    if (canonical(value.widget) !== canonical(this.project.widget))
      throw Error("WIDGET_VERSION_MISMATCH");
    this.history.commit(this.project);
    this.project = clone(value);
    this.persist();
  }
}
export function migrateManifest(legacy) {
  if (legacy.contract === "universal-widget")
    return { manifest: clone(legacy), warnings: [] };
  const manifest = {
    contract: "universal-widget",
    schemaVersion: 3,
    id: legacy.id,
    name: legacy.name,
    version: legacy.version || "1.0.0",
    engine: "web",
    entry: legacy.entry || "src/index.html",
    events: (legacy.events ?? []).map((type) =>
      type.includes(".")
        ? type
        : `tiktok.${type === "roomUser" ? "room_stats" : type}`,
    ),
    defaultSize: legacy.defaultSize || { width: 600, height: 400 },
    capabilities: ["events.subscribe", "assets.read", "settings.read"],
    schemas: legacy.configSchema ? { settings: legacy.configSchema } : {},
  };
  return {
    manifest,
    warnings: [
      "Legacy runtime retained; review visual bindings and event payload differences before opting into the universal runtime.",
    ],
  };
}
export function portableProject(
  widget,
  settings,
  layout = { width: 600, height: 400, layers: [] },
) {
  return inspectProject({
    contract: "universal-widget-project",
    schemaVersion: 1,
    widget,
    settings: clone(settings),
    layout: clone(layout),
  });
}
