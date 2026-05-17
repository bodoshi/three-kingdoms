// EP Page Builder — Figma Plugin Main Code
// Receives Layout Spec from WebSocket bridge via UI, builds pages with real EP components

// ============ Types ============

interface LayoutSpec {
  page: string;
  frame: { width: number; height: number };
  layout: {
    sidebar?: SidebarSpec;
    header?: HeaderSpec;
    content: ContentSpec;
  };
}

interface SidebarSpec {
  width: number;
  collapsed: boolean;
  menuItems: string[];
}

interface HeaderSpec {
  title: string;
  breadcrumb?: string[];
}

interface ContentSpec {
  children: ContentChild[];
}

type ContentChild =
  | KPIRowSpec
  | FilterAreaSpec
  | TableSpec
  | PaginationSpec
  | FormSpec
  | CardGroupSpec
  | GenericComponentSpec;

interface KPIRowSpec {
  type: 'kpi-row';
  items: { label: string; value: string; trend?: string; alert?: boolean }[];
}

interface FilterAreaSpec {
  type: 'filter-area';
  variant: 'inline' | 'stacked' | 'collapsed';
  fields: FieldSpec[];
}

interface FieldSpec {
  component: string;
  key: string;
  label?: string;
  placeholder?: string;
  type?: string;
  text?: string;
  range?: boolean;
}

interface TableSpec {
  type: 'table';
  columns: string[];
  rows: number;
  actions?: string[];
}

interface PaginationSpec {
  type: 'pagination';
  key: string;
  total: number;
}

interface FormSpec {
  type: 'form';
  fields: FieldSpec[];
  layout?: 'vertical' | 'horizontal';
}

interface CardGroupSpec {
  type: 'card-group';
  cards: { title: string; fields: { label: string; value: string }[] }[];
}

interface GenericComponentSpec {
  type: string;
  key?: string;
  props?: Record<string, any>;
}

// ============ EP Design Tokens ============

const EP_COLORS = {
  primary: { r: 0.251, g: 0.620, b: 1 },       // #409EFF
  success: { r: 0.404, g: 0.761, b: 0.227 },    // #67C23A
  warning: { r: 0.902, g: 0.635, b: 0.235 },    // #E6A23C
  danger: { r: 0.961, g: 0.424, b: 0.424 },     // #F56C6C
  info: { r: 0.565, g: 0.576, b: 0.600 },       // #909399
  textPrimary: { r: 0.188, g: 0.192, b: 0.200 },// #303133
  textRegular: { r: 0.376, g: 0.384, b: 0.400 },// #606266
  textSecondary: { r: 0.565, g: 0.576, b: 0.600 },// #909399
  borderLight: { r: 0.922, g: 0.933, b: 0.961 },// #EBEEF5
  border: { r: 0.863, g: 0.875, b: 0.902 },     // #DCDFE6
  fillLight: { r: 0.961, g: 0.969, b: 0.980 },  // #F5F7FA
  white: { r: 1, g: 1, b: 1 },
};

const EP_SPACING = { small: 8, default: 12, large: 16 };

// ============ Stats ============

let stats = { pages: 0, components: 0 };

function sendToUI(msg: any) {
  figma.ui.postMessage(msg);
}

function logToUI(text: string, level?: string) {
  sendToUI({ type: 'log', text, level });
}

// ============ Component Import Helpers ============

async function importComponentSet(key: string): Promise<ComponentSetNode | null> {
  try {
    const set = await figma.importComponentSetByKeyAsync(key);
    return set;
  } catch (e: any) {
    logToUI(`importComponentSet 失败 (key: ${key.slice(0, 8)}...): ${e.message}`, 'error');
    return null;
  }
}

async function importAndCreateInstance(
  key: string,
  variantFilter?: Record<string, string>
): Promise<InstanceNode | null> {
  const set = await importComponentSet(key);
  if (!set) return null;

  let target: ComponentNode | undefined;
  if (variantFilter) {
    target = set.children.find(c => {
      if (c.type !== 'COMPONENT') return false;
      return Object.entries(variantFilter).every(([k, v]) =>
        c.name.includes(`${k}=${v}`)
      );
    }) as ComponentNode | undefined;
  }
  if (!target) {
    target = set.children[0] as ComponentNode;
  }

  if (!target || target.type !== 'COMPONENT') {
    logToUI(`未找到变体: ${JSON.stringify(variantFilter)}`, 'error');
    return null;
  }

  const instance = target.createInstance();
  stats.components++;
  return instance;
}

// ============ Layout Builders ============

function createAutoLayoutFrame(
  name: string,
  direction: 'HORIZONTAL' | 'VERTICAL',
  opts?: { width?: number; height?: number; padding?: number; gap?: number; fill?: RGB }
): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = direction;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = opts?.gap ?? EP_SPACING.default;
  const pad = opts?.padding ?? EP_SPACING.large;
  frame.paddingTop = pad;
  frame.paddingBottom = pad;
  frame.paddingLeft = pad;
  frame.paddingRight = pad;
  if (opts?.width) { frame.resize(opts.width, opts?.height ?? 100); frame.primaryAxisSizingMode = 'FIXED'; }
  if (opts?.fill) {
    frame.fills = [{ type: 'SOLID', color: opts.fill }];
  } else {
    frame.fills = [];
  }
  return frame;
}

function createText(content: string, opts?: { size?: number; weight?: number; color?: RGB }): TextNode {
  const text = figma.createText();
  text.characters = content;
  text.fontSize = opts?.size ?? 13;
  if (opts?.color) {
    text.fills = [{ type: 'SOLID', color: opts.color }];
  }
  return text;
}

function createRect(name: string, w: number, h: number, color: RGB, radius?: number): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = name;
  rect.resize(w, h);
  rect.fills = [{ type: 'SOLID', color: color }];
  if (radius) rect.cornerRadius = radius;
  return rect;
}

// ============ Section Builders ============

async function buildSidebar(spec: SidebarSpec): Promise<FrameNode> {
  const sidebar = createAutoLayoutFrame('Sidebar', 'VERTICAL', {
    width: spec.width,
    padding: 0,
    gap: 0,
    fill: EP_COLORS.white,
  });
  sidebar.counterAxisSizingMode = 'FIXED';
  sidebar.primaryAxisSizingMode = 'FIXED';
  sidebar.resize(spec.width, 900);
  sidebar.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  sidebar.strokeWeight = 1;
  sidebar.strokeAlign = 'INSIDE';

  // Logo area
  const logoArea = createAutoLayoutFrame('Logo', 'HORIZONTAL', { padding: 16, gap: 8 });
  logoArea.layoutSizingHorizontal = 'FILL';
  const logoText = createText('CRM', { size: 16, weight: 600, color: EP_COLORS.primary });
  logoArea.appendChild(logoText);
  sidebar.appendChild(logoArea);

  // Menu items
  for (let i = 0; i < spec.menuItems.length; i++) {
    const item = spec.menuItems[i];
    const isActive = i === spec.menuItems.length - 1;
    const menuItem = createAutoLayoutFrame(`Menu/${item}`, 'HORIZONTAL', {
      padding: 12,
      gap: 8,
      fill: isActive ? { r: 0.925, g: 0.941, b: 1 } : undefined,
    });
    menuItem.layoutSizingHorizontal = 'FILL';
    menuItem.resize(spec.width, 44);
    menuItem.primaryAxisSizingMode = 'FIXED';
    const label = createText(item, {
      size: 14,
      color: isActive ? EP_COLORS.primary : EP_COLORS.textRegular,
    });
    menuItem.appendChild(label);
    sidebar.appendChild(menuItem);
  }

  return sidebar;
}

async function buildHeader(spec: HeaderSpec): Promise<FrameNode> {
  const header = createAutoLayoutFrame('Header', 'VERTICAL', {
    padding: 16,
    gap: 8,
    fill: EP_COLORS.white,
  });
  header.layoutSizingHorizontal = 'FILL';
  header.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  header.strokeWeight = 1;
  header.strokeAlign = 'INSIDE';

  if (spec.breadcrumb && spec.breadcrumb.length > 0) {
    const bcText = createText(spec.breadcrumb.join(' / '), { size: 12, color: EP_COLORS.textSecondary });
    header.appendChild(bcText);
  }

  const title = createText(spec.title, { size: 20, weight: 600, color: EP_COLORS.textPrimary });
  header.appendChild(title);

  return header;
}

async function buildKPIRow(spec: KPIRowSpec): Promise<FrameNode> {
  const row = createAutoLayoutFrame('KPI Row', 'HORIZONTAL', { padding: 0, gap: 12 });
  row.layoutSizingHorizontal = 'FILL';

  for (const item of spec.items) {
    const card = createAutoLayoutFrame(`KPI/${item.label}`, 'VERTICAL', {
      padding: 16,
      gap: 4,
      fill: item.alert ? { r: 0.996, g: 0.949, b: 0.949 } : EP_COLORS.fillLight,
    });
    card.cornerRadius = 8;
    card.layoutSizingHorizontal = 'FILL';
    card.strokes = [{ type: 'SOLID', color: item.alert ? { r: 0.996, g: 0.800, b: 0.800 } : EP_COLORS.borderLight }];
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

async function buildFilterArea(spec: FilterAreaSpec): Promise<FrameNode> {
  const area = createAutoLayoutFrame('Filter Area', 'HORIZONTAL', { padding: 0, gap: 8 });
  area.layoutSizingHorizontal = 'FILL';

  for (const field of spec.fields) {
    const instance = await importAndCreateInstance(field.key, {
      Size: 'Default',
      State: 'Default',
      ...(field.type ? { Type: field.type } : {}),
    });
    if (instance) {
      // Try to set text properties
      try {
        if (field.text) {
          instance.setProperties({ 'Text': field.text });
        }
      } catch (e) { /* property may not exist */ }
      area.appendChild(instance);
    } else {
      // Fallback: placeholder rectangle
      const placeholder = createRect(field.component, 120, 32, EP_COLORS.fillLight, 4);
      area.appendChild(placeholder);
    }
  }

  return area;
}

async function buildTable(spec: TableSpec): Promise<FrameNode> {
  const table = createAutoLayoutFrame('Table', 'VERTICAL', { padding: 0, gap: 0 });
  table.layoutSizingHorizontal = 'FILL';
  table.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
  table.strokeWeight = 1;
  table.cornerRadius = 4;

  // Header row
  const headerRow = createAutoLayoutFrame('Table/Header', 'HORIZONTAL', {
    padding: 8,
    gap: 0,
    fill: EP_COLORS.fillLight,
  });
  headerRow.layoutSizingHorizontal = 'FILL';
  for (const col of spec.columns) {
    const cell = createAutoLayoutFrame(`TH/${col}`, 'HORIZONTAL', { padding: 8, gap: 0 });
    cell.layoutSizingHorizontal = 'FILL';
    const text = createText(col, { size: 12, weight: 500, color: EP_COLORS.textSecondary });
    cell.appendChild(text);
    headerRow.appendChild(cell);
  }
  table.appendChild(headerRow);

  // Data rows
  for (let r = 0; r < spec.rows; r++) {
    const row = createAutoLayoutFrame(`Table/Row-${r}`, 'HORIZONTAL', {
      padding: 8,
      gap: 0,
      fill: EP_COLORS.white,
    });
    row.layoutSizingHorizontal = 'FILL';
    row.strokes = [{ type: 'SOLID', color: EP_COLORS.borderLight }];
    row.strokeWeight = 1;
    row.strokeAlign = 'INSIDE';

    for (let c = 0; c < spec.columns.length; c++) {
      const cell = createAutoLayoutFrame(`TD/${spec.columns[c]}`, 'HORIZONTAL', { padding: 8, gap: 0 });
      cell.layoutSizingHorizontal = 'FILL';
      const isAction = spec.columns[c] === '操作';
      const text = createText(
        isAction ? (spec.actions || ['查看']).join(' | ') : `数据${r + 1}-${c + 1}`,
        { size: 13, color: isAction ? EP_COLORS.primary : EP_COLORS.textRegular }
      );
      cell.appendChild(text);
      row.appendChild(cell);
    }
    table.appendChild(row);
  }

  return table;
}

async function buildPagination(spec: PaginationSpec): Promise<FrameNode> {
  const wrapper = createAutoLayoutFrame('Pagination', 'HORIZONTAL', { padding: 8, gap: 8 });
  wrapper.layoutSizingHorizontal = 'FILL';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.primaryAxisAlignItems = 'MAX';

  const instance = await importAndCreateInstance(spec.key, { Size: 'Default' });
  if (instance) {
    wrapper.appendChild(instance);
  } else {
    const text = createText(`共 ${spec.total} 条`, { size: 12, color: EP_COLORS.textSecondary });
    wrapper.appendChild(text);
  }

  return wrapper;
}

async function buildContent(spec: ContentSpec): Promise<FrameNode> {
  const content = createAutoLayoutFrame('Content', 'VERTICAL', {
    padding: 20,
    gap: 16,
    fill: EP_COLORS.fillLight,
  });
  content.layoutSizingHorizontal = 'FILL';
  content.layoutSizingVertical = 'FILL';

  for (const child of spec.children) {
    let node: FrameNode | null = null;
    switch (child.type) {
      case 'kpi-row':
        node = await buildKPIRow(child as KPIRowSpec);
        break;
      case 'filter-area':
        node = await buildFilterArea(child as FilterAreaSpec);
        break;
      case 'table':
        node = await buildTable(child as TableSpec);
        break;
      case 'pagination':
        node = await buildPagination(child as PaginationSpec);
        break;
      default:
        logToUI(`未知组件类型: ${child.type}`);
    }
    if (node) {
      content.appendChild(node);
    }
  }

  return content;
}

// ============ Main Page Builder ============

async function buildPage(spec: LayoutSpec) {
  logToUI(`开始构建页面: ${spec.page}`);

  // Create or use current page
  const page = figma.currentPage;
  page.name = spec.page;

  // Root frame
  const root = createAutoLayoutFrame(spec.page, 'HORIZONTAL', {
    width: spec.frame.width,
    padding: 0,
    gap: 0,
    fill: EP_COLORS.white,
  });
  root.resize(spec.frame.width, spec.frame.height);
  root.primaryAxisSizingMode = 'FIXED';
  root.counterAxisSizingMode = 'FIXED';
  root.clipsContent = true;

  // Sidebar
  if (spec.layout.sidebar) {
    const sidebar = await buildSidebar(spec.layout.sidebar);
    root.appendChild(sidebar);
  }

  // Right area (header + content)
  const rightArea = createAutoLayoutFrame('Main', 'VERTICAL', { padding: 0, gap: 0 });
  rightArea.layoutSizingHorizontal = 'FILL';
  rightArea.layoutSizingVertical = 'FILL';

  if (spec.layout.header) {
    const header = await buildHeader(spec.layout.header);
    rightArea.appendChild(header);
  }

  const content = await buildContent(spec.layout.content);
  rightArea.appendChild(content);

  root.appendChild(rightArea);
  page.appendChild(root);

  // Center view
  figma.viewport.scrollAndZoomIntoView([root]);

  stats.pages++;
  sendToUI({ type: 'stats', data: stats });
  sendToUI({ type: 'done', pageName: spec.page, componentCount: stats.components });
  logToUI(`页面 "${spec.page}" 构建完成`);
}

// ============ Plugin Entry ============

figma.showUI(__html__, { width: 300, height: 360 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'build-page') {
    try {
      await figma.loadAllPagesAsync();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      await figma.loadFontAsync({ family: "Inter", style: "Medium" });
      await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    } catch (e) {
      // Fallback font loading
      try {
        await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
      } catch (e2) { /* use default */ }
    }

    try {
      await buildPage(msg.spec as LayoutSpec);
    } catch (e: any) {
      sendToUI({ type: 'error', text: e.message || String(e) });
    }
  }
};
