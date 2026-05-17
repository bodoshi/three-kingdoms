// EP Page Builder — Figma Plugin
figma.showUI(__html__, { width: 300, height: 360 });

var EP_COLORS = {
  primary: { r: 0.251, g: 0.62, b: 1 },
  success: { r: 0.404, g: 0.761, b: 0.227 },
  warning: { r: 0.902, g: 0.635, b: 0.235 },
  danger: { r: 0.961, g: 0.424, b: 0.424 },
  textPrimary: { r: 0.188, g: 0.192, b: 0.2 },
  textRegular: { r: 0.376, g: 0.384, b: 0.4 },
  textSecondary: { r: 0.565, g: 0.576, b: 0.6 },
  borderLight: { r: 0.922, g: 0.933, b: 0.961 },
  border: { r: 0.863, g: 0.875, b: 0.902 },
  fillLight: { r: 0.961, g: 0.969, b: 0.98 },
  white: { r: 1, g: 1, b: 1 }
};

var stats = { pages: 0, components: 0 };
var loadedFont = null;

function sendToUI(msg) {
  figma.ui.postMessage(msg);
}

function logToUI(text, level) {
  sendToUI({ type: 'log', text: text, level: level || '' });
}

async function loadAnyFont() {
  var candidates = [
    { family: "Inter", style: "Regular" },
    { family: "Roboto", style: "Regular" },
    { family: "Arial", style: "Regular" }
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync(candidates[i]);
      logToUI('Font OK: ' + candidates[i].family, 'success');
      return candidates[i];
    } catch (e) {
      logToUI('Font skip: ' + candidates[i].family);
    }
  }
  return null;
}

// Helper: append child then set FILL sizing
function appendFill(parent, child, h, v) {
  parent.appendChild(child);
  if (h) child.layoutSizingHorizontal = h;
  if (v) child.layoutSizingVertical = v;
}

function makeFrame(name, direction, opts) {
  opts = opts || {};
  var frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = direction;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = opts.gap != null ? opts.gap : 12;
  var pad = opts.padding != null ? opts.padding : 16;
  frame.paddingTop = pad;
  frame.paddingBottom = pad;
  frame.paddingLeft = pad;
  frame.paddingRight = pad;
  if (opts.width) {
    frame.resize(opts.width, opts.height || 100);
    frame.primaryAxisSizingMode = 'FIXED';
  }
  if (opts.fill) {
    frame.fills = [{ type: 'SOLID', color: opts.fill }];
  } else {
    frame.fills = [];
  }
  return frame;
}

function makeText(content, opts) {
  opts = opts || {};
  if (!loadedFont) {
    var rect = figma.createRectangle();
    rect.name = String(content || 'text');
    rect.resize(Math.max(String(content || '').length * 8, 30), (opts.size || 13) + 6);
    rect.fills = [{ type: 'SOLID', color: opts.color || EP_COLORS.textRegular }];
    rect.cornerRadius = 2;
    return rect;
  }
  var text = figma.createText();
  text.fontName = loadedFont;
  text.characters = String(content || ' ');
  text.fontSize = opts.size || 13;
  if (opts.color) {
    text.fills = [{ type: 'SOLID', color: opts.color }];
  }
  return text;
}

function buildSidebar(spec) {
  var sidebar = makeFrame('Sidebar', 'VERTICAL', { width: spec.width, padding: 0, gap: 0, fill: EP_COLORS.white });
  sidebar.counterAxisSizingMode = 'FIXED';
  sidebar.primaryAxisSizingMode = 'FIXED';
  sidebar.resize(spec.width, 900);
  sidebar.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  sidebar.strokeWeight = 1;
  sidebar.strokeAlign = 'INSIDE';

  // Logo
  var logoArea = makeFrame('Logo', 'HORIZONTAL', { padding: 16, gap: 8 });
  logoArea.appendChild(makeText('CRM', { size: 16, color: EP_COLORS.primary }));
  appendFill(sidebar, logoArea, 'FILL');

  // Menu items
  for (var i = 0; i < spec.menuItems.length; i++) {
    var isActive = i === spec.menuItems.length - 1;
    var item = makeFrame('Menu/' + spec.menuItems[i], 'HORIZONTAL', {
      padding: 12, gap: 8,
      fill: isActive ? { r: 0.925, g: 0.941, b: 1 } : undefined
    });
    item.appendChild(makeText(spec.menuItems[i], { size: 14, color: isActive ? EP_COLORS.primary : EP_COLORS.textRegular }));
    appendFill(sidebar, item, 'FILL');
  }
  return sidebar;
}

function buildHeader(spec) {
  var header = makeFrame('Header', 'VERTICAL', { padding: 16, gap: 8, fill: EP_COLORS.white });
  header.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  header.strokeWeight = 1;
  header.strokeAlign = 'INSIDE';
  if (spec.breadcrumb) {
    header.appendChild(makeText(spec.breadcrumb.join(' / '), { size: 12, color: EP_COLORS.textSecondary }));
  }
  header.appendChild(makeText(spec.title, { size: 20, color: EP_COLORS.textPrimary }));
  return header;
}

function buildKPIRow(spec) {
  var row = makeFrame('KPI Row', 'HORIZONTAL', { padding: 0, gap: 12 });
  for (var i = 0; i < spec.items.length; i++) {
    var it = spec.items[i];
    var card = makeFrame('KPI/' + it.label, 'VERTICAL', {
      padding: 16, gap: 4,
      fill: it.alert ? { r: 0.996, g: 0.949, b: 0.949 } : EP_COLORS.fillLight
    });
    card.cornerRadius = 8;
    card.appendChild(makeText(it.label, { size: 12, color: EP_COLORS.textSecondary }));
    card.appendChild(makeText(it.value, { size: 24, color: it.alert ? EP_COLORS.danger : EP_COLORS.textPrimary }));
    if (it.trend) card.appendChild(makeText(it.trend, { size: 11, color: EP_COLORS.success }));
    appendFill(row, card, 'FILL');
  }
  return row;
}

function buildTable(spec) {
  var table = makeFrame('Table', 'VERTICAL', { padding: 0, gap: 0 });
  table.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  table.strokeWeight = 1;
  table.cornerRadius = 4;

  // Header row
  var headerRow = makeFrame('Table/Header', 'HORIZONTAL', { padding: 8, gap: 0, fill: EP_COLORS.fillLight });
  for (var c = 0; c < spec.columns.length; c++) {
    var th = makeFrame('TH/' + spec.columns[c], 'HORIZONTAL', { padding: 8, gap: 0 });
    th.appendChild(makeText(spec.columns[c], { size: 12, color: EP_COLORS.textSecondary }));
    appendFill(headerRow, th, 'FILL');
  }
  appendFill(table, headerRow, 'FILL');

  // Data rows
  for (var r = 0; r < spec.rows; r++) {
    var row = makeFrame('Table/Row-' + r, 'HORIZONTAL', { padding: 8, gap: 0, fill: EP_COLORS.white });
    row.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
    row.strokeWeight = 1;
    row.strokeAlign = 'INSIDE';
    for (var c2 = 0; c2 < spec.columns.length; c2++) {
      var td = makeFrame('TD/' + spec.columns[c2], 'HORIZONTAL', { padding: 8, gap: 0 });
      var isAction = spec.columns[c2] === '\u64CD\u4F5C' || spec.columns[c2] === 'Action';
      td.appendChild(makeText(
        isAction ? (spec.actions || ['View']).join(' | ') : 'Data-' + (r + 1) + '-' + (c2 + 1),
        { size: 13, color: isAction ? EP_COLORS.primary : EP_COLORS.textRegular }
      ));
      appendFill(row, td, 'FILL');
    }
    appendFill(table, row, 'FILL');
  }
  return table;
}

async function buildPage(spec) {
  logToUI('Building: ' + spec.page);

  var page = figma.currentPage;
  page.name = spec.page;

  // Root frame
  var root = makeFrame(spec.page, 'HORIZONTAL', { width: spec.frame.width, padding: 0, gap: 0, fill: EP_COLORS.white });
  root.resize(spec.frame.width, spec.frame.height);
  root.primaryAxisSizingMode = 'FIXED';
  root.counterAxisSizingMode = 'FIXED';
  root.clipsContent = true;

  // Sidebar
  if (spec.layout.sidebar) {
    root.appendChild(buildSidebar(spec.layout.sidebar));
    logToUI('Sidebar OK');
  }

  // Main area
  var main = makeFrame('Main', 'VERTICAL', { padding: 0, gap: 0 });
  appendFill(root, main, 'FILL', 'FILL');

  // Header
  if (spec.layout.header) {
    var header = buildHeader(spec.layout.header);
    appendFill(main, header, 'FILL');
    logToUI('Header OK');
  }

  // Content
  var content = makeFrame('Content', 'VERTICAL', { padding: 20, gap: 16, fill: EP_COLORS.fillLight });
  appendFill(main, content, 'FILL', 'FILL');

  var children = spec.layout.content.children || [];
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child.type === 'kpi-row') {
      var kpi = buildKPIRow(child);
      appendFill(content, kpi, 'FILL');
      logToUI('KPI Row OK');
    } else if (child.type === 'table') {
      var tbl = buildTable(child);
      appendFill(content, tbl, 'FILL');
      logToUI('Table OK');
    } else {
      logToUI('Skip: ' + child.type);
    }
  }

  page.appendChild(root);
  figma.viewport.scrollAndZoomIntoView([root]);

  stats.pages++;
  sendToUI({ type: 'stats', data: stats });
  sendToUI({ type: 'done', pageName: spec.page, componentCount: stats.components });
  logToUI('DONE!', 'success');
}

// Entry
sendToUI({ type: 'log', text: 'Plugin loaded', level: 'success' });

figma.ui.onmessage = async function(msg) {
  if (msg.type === 'build-page') {
    try {
      loadedFont = await loadAnyFont();
      await buildPage(msg.spec);
    } catch (e) {
      logToUI('BUILD ERROR: ' + e.message, 'error');
      sendToUI({ type: 'error', text: e.message });
    }
  }
};
