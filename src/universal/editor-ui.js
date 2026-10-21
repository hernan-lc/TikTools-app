import { clone, validateEvent, assertValid, replay } from "./index.js";
import {
  EditorSession,
  portableProject,
  exportPreset,
  importPreset,
} from "./editor.js";
import { readPackage, packageDocument } from "./package-loader.js";
const labels = {
  en: {
    title: "Portable widgets",
    import: "Import compiled widget folder",
    project: "Import project",
    export: "Export project",
    undo: "Undo",
    redo: "Redo",
    sample: "Test alert",
    events: "Replay event fixtures",
    settings: "Settings",
    editor: "Editor settings",
    apply: "Apply settings",
    layers: "Layers",
    add: "Add text layer",
    remove: "Remove layer",
    assets: "Assets",
    live: "Live events",
    reset: "Reset",
    preset: "Import preset",
    exportPreset: "Export preset",
    presets: "Presets",
    group: "Add group",
    up: "Move layer up",
    down: "Move layer down",
    status: "Import a trusted compiled widget package to begin.",
  },
  es: {
    title: "Widgets portables",
    import: "Importar carpeta del widget compilado",
    project: "Importar proyecto",
    export: "Exportar proyecto",
    undo: "Deshacer",
    redo: "Rehacer",
    sample: "Probar alerta",
    events: "Reproducir eventos de prueba",
    settings: "Ajustes",
    editor: "Ajustes del editor",
    apply: "Aplicar ajustes",
    layers: "Capas",
    add: "Añadir capa de texto",
    remove: "Eliminar capa",
    assets: "Recursos",
    live: "Eventos en directo",
    reset: "Restablecer",
    preset: "Importar preset",
    exportPreset: "Exportar preset",
    presets: "Presets",
    group: "Añadir grupo",
    up: "Subir capa",
    down: "Bajar capa",
    status:
      "Importa un paquete compilado de un autor de confianza para empezar.",
  },
};
// A small additive panel shared by framework wrappers. Original app editors
// remain responsible for their existing project models and persistence.
export function mountEditor(
  root,
  { locale = "en", storage = globalThis.localStorage, subscribe, onSave } = {},
) {
  const tr = labels[locale] ?? labels.en;
  let pkg,
    editor,
    frame,
    session,
    generation = 0,
    disposed = false,
    live = false,
    stopReplay = () => {},
    off = () => {},
    gesture;
  let assetURLs = [];
  const make = (tag, parent, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  root.classList.add("universal-editor");
  const style = make("style", root);
  style.textContent =
    ".universal-editor{padding:16px;max-width:100%;box-sizing:border-box}.universal-editor .uw-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.universal-editor .uw-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,280px);gap:12px}.universal-editor .uw-stage{position:relative;overflow:auto;max-width:100%;background:#171720}.universal-editor iframe{border:0;background:transparent;position:absolute;inset:0}.universal-editor .uw-layer{position:absolute;box-sizing:border-box;touch-action:none;white-space:pre-wrap;overflow:hidden;color:white;outline:1px dashed #888}.universal-editor .uw-layer[aria-selected=true]{outline:2px solid #ff416c}.universal-editor label{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.universal-editor textarea{width:100%;min-height:100px;box-sizing:border-box}.universal-editor input[type=number]{width:80px}.universal-editor button:disabled{opacity:.5}@media(max-width:680px){.universal-editor .uw-columns{grid-template-columns:1fr}}";
  make("h2", root, tr.title);
  const toolbar = make("div", root);
  toolbar.className = "uw-toolbar";
  const status = make("p", root, tr.status);
  status.setAttribute("role", "status");
  const columns = make("div", root);
  columns.className = "uw-columns";
  const stage = make("div", columns);
  stage.className = "uw-stage";
  const inspector = make("div", columns);
  const report = (error) => {
    if (!disposed)
      status.textContent =
        error instanceof Error ? error.message : String(error);
  };
  const action = (parent, text, fn) => {
    const b = make("button", parent, text);
    b.type = "button";
    b.onclick = () => Promise.resolve().then(fn).catch(report);
    return b;
  };
  const input = (parent, text, accept, fn, directory = false) => {
    const label = make("label", parent, text);
    const field = make("input", label);
    field.type = "file";
    field.accept = accept;
    if (directory) {
      field.multiple = true;
      field.setAttribute("webkitdirectory", "");
    }
    field.onchange = () =>
      Promise.resolve(fn([...field.files]))
        .catch(report)
        .finally(() => (field.value = ""));
    return field;
  };
  const notify = () => {
    onSave?.(editor.export());
    try {
      storage?.setItem("universal-project:" + pkg.manifest.id, editor.export());
    } catch {
      status.textContent = "Autosave unavailable";
    }
  };
  async function load(files) {
    const ticket = ++generation;
    const next = await readPackage(files);
    if (disposed || ticket !== generation) return;
    pkg = next;
    const initial = portableProject(
      { id: pkg.manifest.id, version: pkg.manifest.version },
      pkg.settings,
      { ...pkg.manifest.defaultSize, layers: [] },
    );
    editor = new EditorSession(initial, {
      settingsSchema: pkg.settingsSchema,
      editorSchema: pkg.editorSchema,
      save: notify,
    });
    try {
      const saved = storage?.getItem("universal-project:" + pkg.manifest.id);
      if (saved) {
        const value = JSON.parse(saved);
        if (value.widget.version === pkg.manifest.version) editor.import(saved);
      }
    } catch (error) {
      report(error);
    }
    await render();
    status.textContent = pkg.manifest.name + " @ " + pkg.manifest.version;
  }
  input(toolbar, tr.import, "", load, true);
  input(toolbar, tr.project, ".json", async (files) => {
    if (!editor || !files[0]) throw Error("PACKAGE_REQUIRED");
    const text = await files[0].text();
    const value = JSON.parse(text);
    if (
      value.widget?.id !== pkg.manifest.id ||
      value.widget?.version !== pkg.manifest.version
    )
      throw Error("WIDGET_VERSION_MISMATCH");
    assertValid(pkg.settingsSchema, value.settings);
    editor.import(text);
    await render();
  });
  action(toolbar, tr.export, () => {
    if (!editor) throw Error("PACKAGE_REQUIRED");
    const url = URL.createObjectURL(
      new Blob([editor.export()], { type: "application/json" }),
    );
    const a = make("a", root);
    a.href = url;
    a.download = pkg.manifest.id + ".project.json";
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  action(toolbar, tr.undo, async () => {
    editor?.undo();
    await render();
  });
  const applyPreset = async (value) => {
    if (!editor) throw Error("PACKAGE_REQUIRED");
    const result = importPreset(editor.project, value, pkg.settingsSchema);
    editor.import(JSON.stringify(result.project));
    await render();
    if (result.warnings.length) status.textContent = result.warnings.join(" ");
  };
  input(toolbar, tr.preset, ".preset.json", async (files) => {
    if (!files[0]) return;
    if (files[0].size > 1024 * 1024) throw Error("PRESET_SIZE_LIMIT");
    await applyPreset(JSON.parse(await files[0].text()));
  });
  action(toolbar, tr.exportPreset, () => {
    if (!editor) throw Error("PACKAGE_REQUIRED");
    const url = URL.createObjectURL(
      new Blob([exportPreset(editor.project)], { type: "application/json" }),
    );
    const a = make("a", root);
    a.href = url;
    a.download = pkg.manifest.id + ".preset.json";
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  action(toolbar, tr.redo, async () => {
    editor?.redo();
    await render();
  });
  action(toolbar, tr.reset, () => render());
  const send = (event) => {
    validateEvent(event);
    frame?.contentWindow?.postMessage(
      { channel: "universal-widget-host", session, kind: "event", event },
      "*",
    );
  };
  action(toolbar, tr.sample, () =>
    send({
      version: 1,
      id: crypto.randomUUID(),
      source: "external.preview",
      type: "custom.alert",
      timestamp: new Date().toISOString(),
      data: {
        title: editor?.project.settings.title || "Test alert",
        message: "Viewer <script> — 23 Rose",
      },
      metadata: { originInstance: "preview.local", hopCount: 0 },
    }),
  );
  input(toolbar, tr.events, ".json", async (files) => {
    if (!files[0]) return;
    const events = JSON.parse(await files[0].text());
    if (!Array.isArray(events) || events.length > 1000)
      throw Error("FIXTURE_LIMIT");
    stopReplay();
    stopReplay = replay(events, send);
  });
  if (subscribe) {
    const label = make("label", toolbar, tr.live);
    const checkbox = make("input", label);
    checkbox.type = "checkbox";
    checkbox.onchange = () => {
      live = checkbox.checked;
    };
    off = subscribe((event) => {
      if (live)
        try {
          send(event);
        } catch (error) {
          report(error);
        }
    });
  }
  const update = async (command) => {
    editor.execute(command);
    await render();
  };
  async function render() {
    if (!editor || disposed) return;
    const ticket = ++generation;
    const nextSession = crypto.randomUUID();
    const html = await packageDocument(
      pkg,
      editor.project.settings,
      nextSession,
    );
    if (disposed || ticket !== generation) return;
    stopReplay();
    assetURLs.forEach(URL.revokeObjectURL);
    assetURLs = [];
    session = nextSession;
    stage.replaceChildren();
    inspector.replaceChildren();
    stage.style.height = Math.min(editor.project.layout.height, 720) + "px";
    stage.style.minHeight = "200px";
    const canvas = make("div", stage);
    canvas.style.cssText = `position:relative;width:${editor.project.layout.width}px;height:${editor.project.layout.height}px;max-width:none`;
    frame = make("iframe", canvas);
    frame.title = pkg.manifest.name;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.width = editor.project.layout.width + "px";
    frame.style.height = editor.project.layout.height + "px";
    frame.srcdoc = html;
    const tree = make("div", inspector);
    make("h3", tree, tr.layers);
    const visit = (layers, parent = canvas) =>
      layers.forEach((layer) => {
        const node = make("div", parent, layer.text || "");
        node.className = "uw-layer";
        node.dataset.layer = layer.id;
        node.setAttribute("role", "button");
        node.tabIndex = 0;
        node.setAttribute("aria-label", layer.name || layer.id);
        node.setAttribute(
          "aria-selected",
          String(editor.selection.includes(layer.id)),
        );
        node.style.cssText = `left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;transform:rotate(${layer.rotation || 0}deg);opacity:${layer.opacity ?? 1}`;
        if (layer.kind === "image" && layer.asset) {
          const entry = pkg.entries.get(layer.asset.toLowerCase());
          if (entry) {
            const img = make("img", node);
            const url = URL.createObjectURL(entry.file);
            assetURLs.push(url);
            img.src = url;
            img.alt = layer.name || "";
            img.style.cssText =
              "width:100%;height:100%;object-fit:contain;pointer-events:none";
          }
        }
        const select = () => {
          editor.select([layer.id]);
          root
            .querySelectorAll(".uw-layer")
            .forEach((el) =>
              el.setAttribute(
                "aria-selected",
                String(el.dataset.layer === layer.id),
              ),
            );
          properties(layer);
        };
        action(tree, layer.name || layer.id, select);
        node.onkeydown = (e) => {
          if (e.key === "Enter") select();
        };
        node.onpointerdown = (e) => {
          e.stopPropagation();
          select();
          node.setPointerCapture(e.pointerId);
          gesture = {
            id: layer.id,
            x: e.clientX,
            y: e.clientY,
            before: clone(layer),
            node,
          };
        };
        node.onpointermove = (e) => {
          if (gesture?.node !== node) return;
          node.style.left = gesture.before.x + e.clientX - gesture.x + "px";
          node.style.top = gesture.before.y + e.clientY - gesture.y + "px";
        };
        node.onpointerup = (e) => {
          if (gesture?.node !== node) return;
          const g = gesture;
          gesture = null;
          void update({
            type: "transform",
            id: g.id,
            snap: editor.project.editor?.grid ?? 8,
            value: {
              x: g.before.x + e.clientX - g.x,
              y: g.before.y + e.clientY - g.y,
            },
          }).catch(report);
        };
        node.onpointercancel = () => {
          gesture = null;
          void render().catch(report);
        };
        visit(layer.children ?? [], node);
      });
    visit(editor.project.layout.layers);
    action(tree, tr.add, () =>
      update({
        type: "insert",
        layer: {
          id: crypto.randomUUID(),
          kind: "text",
          name: "Text",
          text: "Text",
          x: 16,
          y: 16,
          width: 200,
          height: 40,
        },
      }),
    );
    action(tree, tr.remove, () => {
      if (editor.selection[0])
        return update({ type: "remove", id: editor.selection[0] });
    });
    const props = make("div", inspector);
    function properties(layer) {
      props.replaceChildren();
      const find = (layers) => {
        for (const node of layers) {
          if (node.id === layer.id) return layers;
          const result = find(node.children ?? []);
          if (result) return result;
        }
      };
      const siblings = find(editor.project.layout.layers);
      const index = siblings.indexOf(layer);
      if (index > 0)
        action(props, tr.up, () =>
          update({ type: "reorder", id: layer.id, index: index - 1 }),
        );
      if (index < siblings.length - 1)
        action(props, tr.down, () =>
          update({ type: "reorder", id: layer.id, index: index + 1 }),
        );
      for (const key of ["x", "y", "width", "height", "rotation", "opacity"]) {
        const label = make("label", props, key);
        const field = make("input", label);
        field.type = "number";
        field.value = String(layer[key] ?? (key === "opacity" ? 1 : 0));
        field.onchange = () =>
          void update({
            type: "transform",
            id: layer.id,
            value: { [key]: Number(field.value) },
          }).catch(report);
      }
    }
    make("h3", inspector, tr.settings);
    controls(pkg.settingsSchema, editor.project.settings, "settings");
    make("h3", inspector, tr.editor);
    controls(pkg.editorSchema, editor.project.editor ?? {}, "editor");
    function controls(schema, value, command) {
      const draft = clone(value);
      for (const [key, rule] of Object.entries(schema.properties ?? {})) {
        const label = make("label", inspector, rule.title || key);
        if (rule.description) label.title = rule.description;
        if (rule.enum) {
          const field = make("select", label);
          rule.enum.forEach((value, index) => {
            const option = make("option", field, String(value));
            option.value = String(index);
          });
          field.value = String(
            rule.enum.findIndex(
              (value) => JSON.stringify(value) === JSON.stringify(draft[key]),
            ),
          );
          field.disabled = Boolean(rule.readOnly);
          field.onchange = () =>
            (draft[key] = clone(rule.enum[Number(field.value)]));
          continue;
        }
        if (rule.type === "object" || rule.type === "array" || rule.$ref) {
          const field = make("textarea", label);
          field.value = JSON.stringify(
            draft[key] ?? (rule.type === "array" ? [] : {}),
            null,
            2,
          );
          field.readOnly = Boolean(rule.readOnly);
          field.onchange = () => {
            try {
              draft[key] = JSON.parse(field.value);
              field.setCustomValidity("");
            } catch (error) {
              field.setCustomValidity(error.message);
              report(error);
            }
          };
          continue;
        }
        if (!["string", "number", "integer", "boolean"].includes(rule.type))
          continue;
        const field = make("input", label);
        field.disabled = Boolean(rule.readOnly);
        field.type =
          rule.type === "boolean"
            ? "checkbox"
            : ["number", "integer"].includes(rule.type)
              ? "number"
              : "text";
        if (field.type === "checkbox") field.checked = Boolean(draft[key]);
        else field.value = String(draft[key] ?? "");
        if (rule.minimum !== undefined) field.min = String(rule.minimum);
        if (rule.maximum !== undefined) field.max = String(rule.maximum);
        if (rule.maxLength !== undefined) field.maxLength = rule.maxLength;
        if (rule.type === "integer") field.step = "1";
        field.onchange = () => {
          draft[key] =
            field.type === "checkbox"
              ? field.checked
              : field.type === "number"
                ? Number(field.value)
                : field.value;
        };
      }
      action(inspector, tr.apply, () => {
        assertValid(schema, draft);
        return update({ type: command, value: draft });
      });
    }
    action(tree, tr.group, () =>
      update({
        type: "insert",
        layer: {
          id: crypto.randomUUID(),
          kind: "group",
          name: tr.group,
          x: 0,
          y: 0,
          width: editor.project.layout.width,
          height: editor.project.layout.height,
          children: [],
        },
      }),
    );
    make("h3", inspector, tr.presets);
    for (const { path, file } of pkg.entries.values())
      if (path.startsWith("presets/") && path.endsWith(".json"))
        action(inspector, path, async () =>
          applyPreset(JSON.parse(await file.text())),
        );
    make("h3", inspector, tr.assets);
    const assets = make("ul", inspector);
    for (const { path } of pkg.entries.values())
      if (path.startsWith("assets/")) {
        const item = make("li", assets);
        if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path))
          action(item, path, () =>
            update({
              type: "insert",
              layer: {
                id: crypto.randomUUID(),
                kind: "image",
                name: path,
                asset: path,
                x: 16,
                y: 16,
                width: 160,
                height: 160,
              },
            }),
          );
        else item.textContent = path;
      }
  }
  return {
    load,
    send,
    export: () => editor?.export(),
    dispose() {
      disposed = true;
      ++generation;
      stopReplay();
      off();
      assetURLs.forEach(URL.revokeObjectURL);
      root.replaceChildren();
    },
  };
}
