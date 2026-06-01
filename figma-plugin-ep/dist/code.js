"use strict";
(() => {
  // src/code.ts
  var EP_COLORS = {
    primary: { r: 0.251, g: 0.62, b: 1 },
    // #409EFF
    success: { r: 0.404, g: 0.761, b: 0.227 },
    // #67C23A
    warning: { r: 0.902, g: 0.635, b: 0.235 },
    // #E6A23C
    danger: { r: 0.961, g: 0.424, b: 0.424 },
    // #F56C6C
    info: { r: 0.565, g: 0.576, b: 0.6 },
    // #909399
    textPrimary: { r: 0.188, g: 0.192, b: 0.2 },
    // #303133
    textRegular: { r: 0.376, g: 0.384, b: 0.4 },
    // #606266
    textSecondary: { r: 0.565, g: 0.576, b: 0.6 },
    // #909399
    borderLight: { r: 0.922, g: 0.933, b: 0.961 },
    // #EBEEF5
    border: { r: 0.863, g: 0.875, b: 0.902 },
    // #DCDFE6
    fillLight: { r: 0.961, g: 0.969, b: 0.98 },
    // #F5F7FA
    white: { r: 1, g: 1, b: 1 }
  };
  var EP_SPACING = { small: 8, default: 12, large: 16 };
  var stats = { pages: 0, components: 0 };
  function sendToUI(msg) {
    figma.ui.postMessage(msg);
  }
  function logToUI(text, level) {
    sendToUI({ type: "log", text, level });
  }
  async function importComponentSet(key) {
    try {
      const set = await figma.importComponentSetByKeyAsync(key);
      return set;
    } catch (e) {
      logToUI(`importComponentSet \u5931\u8D25 (key: ${key.slice(0, 8)}...): ${e.message}`, "error");
      return null;
    }
  }
  async function importAndCreateInstance(key, variantFilter) {
    const set = await importComponentSet(key);
    if (!set)
      return null;
    let target;
    if (variantFilter) {
      target = set.children.find((c) => {
        if (c.type !== "COMPONENT")
          return false;
        return Object.entries(variantFilter).every(
          ([k, v]) => c.name.includes(`${k}=${v}`)
        );
      });
    }
    if (!target) {
      target = set.children[0];
    }
    if (!target || target.type !== "COMPONENT") {
      logToUI(`\u672A\u627E\u5230\u53D8\u4F53: ${JSON.stringify(variantFilter)}`, "error");
      return null;
    }
    const instance = target.createInstance();
    stats.components++;
    return instance;
  }
  function createAutoLayoutFrame(name, direction, opts) {
    const frame = figma.createFrame();
    frame.name = name;
    frame.layoutMode = direction;
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    frame.itemSpacing = opts?.gap ?? EP_SPACING.default;
    const pad = opts?.padding ?? EP_SPACING.large;
    frame.paddingTop = pad;
    frame.paddingBottom = pad;
    frame.paddingLeft = pad;
    frame.paddingRight = pad;
    if (opts?.width) {
      frame.resize(opts.width, opts?.height ?? 100);
      frame.primaryAxisSizingMode = "FIXED";
    }
    if (opts?.fill) {
      frame.fills = [{ type: "SOLID", color: opts.fill }];
    } else {
      frame.fills = [];
    }
    return frame;
  }
  function createText(content, opts) {
    const text = figma.createText();
    text.characters = content;
    text.fontSize = opts?.size ?? 13;
    if (opts?.color) {
      text.fills = [{ type: "SOLID", color: opts.color }];
    }
    return text;
  }
  function createRect(name, w, h, color, radius) {
    const rect = figma.createRectangle();
    rect.name = name;
    rect.resize(w, h);
    rect.fills = [{ type: "SOLID", color }];
    if (radius)
      rect.cornerRadius = radius;
    return rect;
  }
  async function buildSidebar(spec) {
    const sidebar = createAutoLayoutFrame("Sidebar", "VERTICAL", {
      width: spec.width,
      padding: 0,
      gap: 0,
      fill: EP_COLORS.white
    });
    sidebar.counterAxisSizingMode = "FIXED";
    sidebar.primaryAxisSizingMode = "FIXED";
    sidebar.resize(spec.width, 900);
    sidebar.strokes = [{ type: "SOLID", color: EP_COLORS.borderLight }];
    sidebar.strokeWeight = 1;
    sidebar.strokeAlign = "INSIDE";
    const logoArea = createAutoLayoutFrame("Logo", "HORIZONTAL", { padding: 16, gap: 8 });
    logoArea.layoutSizingHorizontal = "FILL";
    const logoText = createText("CRM", { size: 16, weight: 600, color: EP_COLORS.primary });
    logoArea.appendChild(logoText);
    sidebar.appendChild(logoArea);
    for (let i = 0; i < spec.menuItems.length; i++) {
      const item = spec.menuItems[i];
      const isActive = i === spec.menuItems.length - 1;
      const menuItem = createAutoLayoutFrame(`Menu/${item}`, "HORIZONTAL", {
        padding: 12,
        gap: 8,
        fill: isActive ? { r: 0.925, g: 0.941, b: 1 } : void 0
      });
      menuItem.layoutSizingHorizontal = "FILL";
      menuItem.resize(spec.width, 44);
      menuItem.primaryAxisSizingMode = "FIXED";
      const label = createText(item, {
        size: 14,
        color: isActive ? EP_COLORS.primary : EP_COLORS.textRegular
      });
      menuItem.appendChild(label);
      sidebar.appendChild(menuItem);
    }
    return sidebar;
  }
  async function buildHeader(spec) {
    const header = createAutoLayoutFrame("Header", "VERTICAL", {
      padding: 16,
      gap: 8,
      fill: EP_COLORS.white
    });
    header.layoutSizingHorizontal = "FILL";
    header.strokes = [{ type: "SOLID", color: EP_COLORS.borderLight }];
    header.strokeWeight = 1;
    header.strokeAlign = "INSIDE";
    if (spec.breadcrumb && spec.breadcrumb.length > 0) {
      const bcText = createText(spec.breadcrumb.join(" / "), { size: 12, color: EP_COLORS.textSecondary });
      header.appendChild(bcText);
    }
    const title = createText(spec.title, { size: 20, weight: 600, color: EP_COLORS.textPrimary });
    header.appendChild(title);
    return header;
  }
  async function buildKPIRow(spec) {
    const row = createAutoLayoutFrame("KPI Row", "HORIZONTAL", { padding: 0, gap: 12 });
    row.layoutSizingHorizontal = "FILL";
    for (const item of spec.items) {
      const card = createAutoLayoutFrame(`KPI/${item.label}`, "VERTICAL", {
        padding: 16,
        gap: 4,
        fill: item.alert ? { r: 0.996, g: 0.949, b: 0.949 } : EP_COLORS.fillLight
      });
      card.cornerRadius = 8;
      card.layoutSizingHorizontal = "FILL";
      card.strokes = [{ type: "SOLID", color: item.alert ? { r: 0.996, g: 0.8, b: 0.8 } : EP_COLORS.borderLight }];
      card.strokeWeight = 1;
      const label = createText(item.label, { size: 12, color: EP_COLORS.textSecondary });
      const value = createText(item.value, { size: 24, weight: 700, color: item.alert ? EP_COLORS.danger : EP_COLORS.textPrimary });
      card.appendChild(label);
      card.appendChild(value);
      if (item.trend) {
        const trend = createText(item.trend, { size: 11, color: EP_COLORS.success });
        card.appendChild(trend);
      }
      row.appendChild(card);
    }
    return row;
  }
  async function buildFilterArea(spec) {
    const area = createAutoLayoutFrame("Filter Area", "HORIZONTAL", { padding: 0, gap: 8 });
    area.layoutSizingHorizontal = "FILL";
    for (const field of spec.fields) {
      const instance = await importAndCreateInstance(field.key, {
        Size: "Default",
        State: "Default",
        ...field.type ? { Type: field.type } : {}
      });
      if (instance) {
        try {
          if (field.text) {
            instance.setProperties({ "Text": field.text });
          }
        } catch (e) {
        }
        area.appendChild(instance);
      } else {
        const placeholder = createRect(field.component, 120, 32, EP_COLORS.fillLight, 4);
        area.appendChild(placeholder);
      }
    }
    return area;
  }
  async function buildTable(spec) {
    const table = createAutoLayoutFrame("Table", "VERTICAL", { padding: 0, gap: 0 });
    table.layoutSizingHorizontal = "FILL";
    table.strokes = [{ type: "SOLID", color: EP_COLORS.borderLight }];
    table.strokeWeight = 1;
    table.cornerRadius = 4;
    const headerRow = createAutoLayoutFrame("Table/Header", "HORIZONTAL", {
      padding: 8,
      gap: 0,
      fill: EP_COLORS.fillLight
    });
    headerRow.layoutSizingHorizontal = "FILL";
    for (const col of spec.columns) {
      const cell = createAutoLayoutFrame(`TH/${col}`, "HORIZONTAL", { padding: 8, gap: 0 });
      cell.layoutSizingHorizontal = "FILL";
      const text = createText(col, { size: 12, weight: 500, color: EP_COLORS.textSecondary });
      cell.appendChild(text);
      headerRow.appendChild(cell);
    }
    table.appendChild(headerRow);
    for (let r = 0; r < spec.rows; r++) {
      const row = createAutoLayoutFrame(`Table/Row-${r}`, "HORIZONTAL", {
        padding: 8,
        gap: 0,
        fill: EP_COLORS.white
      });
      row.layoutSizingHorizontal = "FILL";
      row.strokes = [{ type: "SOLID", color: EP_COLORS.borderLight }];
      row.strokeWeight = 1;
      row.strokeAlign = "INSIDE";
      for (let c = 0; c < spec.columns.length; c++) {
        const cell = createAutoLayoutFrame(`TD/${spec.columns[c]}`, "HORIZONTAL", { padding: 8, gap: 0 });
        cell.layoutSizingHorizontal = "FILL";
        const isAction = spec.columns[c] === "\u64CD\u4F5C";
        const text = createText(
          isAction ? (spec.actions || ["\u67E5\u770B"]).join(" | ") : `\u6570\u636E${r + 1}-${c + 1}`,
          { size: 13, color: isAction ? EP_COLORS.primary : EP_COLORS.textRegular }
        );
        cell.appendChild(text);
        row.appendChild(cell);
      }
      table.appendChild(row);
    }
    return table;
  }
  async function buildPagination(spec) {
    const wrapper = createAutoLayoutFrame("Pagination", "HORIZONTAL", { padding: 8, gap: 8 });
    wrapper.layoutSizingHorizontal = "FILL";
    wrapper.counterAxisAlignItems = "CENTER";
    wrapper.primaryAxisAlignItems = "MAX";
    const instance = await importAndCreateInstance(spec.key, { Size: "Default" });
    if (instance) {
      wrapper.appendChild(instance);
    } else {
      const text = createText(`\u5171 ${spec.total} \u6761`, { size: 12, color: EP_COLORS.textSecondary });
      wrapper.appendChild(text);
    }
    return wrapper;
  }
  async function buildContent(spec) {
    const content = createAutoLayoutFrame("Content", "VERTICAL", {
      padding: 20,
      gap: 16,
      fill: EP_COLORS.fillLight
    });
    content.layoutSizingHorizontal = "FILL";
    content.layoutSizingVertical = "FILL";
    for (const child of spec.children) {
      let node = null;
      switch (child.type) {
        case "kpi-row":
          node = await buildKPIRow(child);
          break;
        case "filter-area":
          node = await buildFilterArea(child);
          break;
        case "table":
          node = await buildTable(child);
          break;
        case "pagination":
          node = await buildPagination(child);
          break;
        default:
          logToUI(`\u672A\u77E5\u7EC4\u4EF6\u7C7B\u578B: ${child.type}`);
      }
      if (node) {
        content.appendChild(node);
      }
    }
    return content;
  }
  async function buildPage(spec) {
    logToUI(`\u5F00\u59CB\u6784\u5EFA\u9875\u9762: ${spec.page}`);
    const page = figma.currentPage;
    page.name = spec.page;
    const root = createAutoLayoutFrame(spec.page, "HORIZONTAL", {
      width: spec.frame.width,
      padding: 0,
      gap: 0,
      fill: EP_COLORS.white
    });
    root.resize(spec.frame.width, spec.frame.height);
    root.primaryAxisSizingMode = "FIXED";
    root.counterAxisSizingMode = "FIXED";
    root.clipsContent = true;
    if (spec.layout.sidebar) {
      const sidebar = await buildSidebar(spec.layout.sidebar);
      root.appendChild(sidebar);
    }
    const rightArea = createAutoLayoutFrame("Main", "VERTICAL", { padding: 0, gap: 0 });
    rightArea.layoutSizingHorizontal = "FILL";
    rightArea.layoutSizingVertical = "FILL";
    if (spec.layout.header) {
      const header = await buildHeader(spec.layout.header);
      rightArea.appendChild(header);
    }
    const content = await buildContent(spec.layout.content);
    rightArea.appendChild(content);
    root.appendChild(rightArea);
    page.appendChild(root);
    figma.viewport.scrollAndZoomIntoView([root]);
    stats.pages++;
    sendToUI({ type: "stats", data: stats });
    sendToUI({ type: "done", pageName: spec.page, componentCount: stats.components });
    logToUI(`\u9875\u9762 "${spec.page}" \u6784\u5EFA\u5B8C\u6210`);
  }
  figma.showUI(__html__, { width: 300, height: 360 });
  figma.ui.onmessage = async (msg) => {
    if (msg.type === "build-page") {
      try {
        await figma.loadAllPagesAsync();
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        await figma.loadFontAsync({ family: "Inter", style: "Medium" });
        await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
        await figma.loadFontAsync({ family: "Inter", style: "Bold" });
      } catch (e) {
        try {
          await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
        } catch (e2) {
        }
      }
      try {
        await buildPage(msg.spec);
      } catch (e) {
        sendToUI({ type: "error", text: e.message || String(e) });
      }
    }
  };
})();
