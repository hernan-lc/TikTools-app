export function renderLayout(project, container, assetBase) {
  const stage = document.createElement("div");
  stage.className = "universal-layout";
  stage.style.cssText = `position:absolute;left:0;top:0;width:${project.layout.width}px;height:${project.layout.height}px;pointer-events:none;color:white;font-family:system-ui`;
  function visit(layers, parent) {
    for (const layer of layers) {
      const node = document.createElement("div");
      node.dataset.layer = layer.id;
      node.textContent = layer.text || "";
      node.style.cssText = `position:absolute;box-sizing:border-box;white-space:pre-wrap;overflow:hidden;left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;transform:rotate(${layer.rotation || 0}deg);opacity:${layer.opacity ?? 1}`;
      if (layer.kind === "image" && layer.asset) {
        const img = document.createElement("img");
        img.src = new URL(layer.asset, assetBase).href;
        img.alt = layer.name || "";
        img.style.cssText = "width:100%;height:100%;object-fit:contain";
        node.append(img);
      }
      parent.append(node);
      visit(layer.children ?? [], node);
    }
  }
  visit(project.layout.layers, stage);
  container.append(stage);
  return () => stage.remove();
}
