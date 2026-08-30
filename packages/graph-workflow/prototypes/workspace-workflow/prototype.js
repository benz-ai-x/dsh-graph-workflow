const variants = [
  { key: 'A', name: '专业编排器', summary: '编排优先' },
  { key: 'B', name: '工作流中心', summary: '资产优先' },
  { key: 'C', name: '运行工作台', summary: '交付优先' },
]

const initialVariant = new URLSearchParams(window.location.search).get('variant')?.toUpperCase()
const state = {
  variant: variants.some(item => item.key === initialVariant) ? initialVariant : 'A',
  sessionsOpen: true,
  workflowsOpen: true,
  aMode: 'design',
  inspectorTab: 'prompt',
  selectedNode: 'draft',
  bView: 'hub',
  guideStep: 'nodes',
  cMode: 'run',
  runStage: 0,
  showNotes: false,
}

let runTimer

const icons = {
  add: '<path d="M12 5v14M5 12h14"/>',
  arrowLeft: '<path d="m15 18-6-6 6-6"/>',
  arrowRight: '<path d="m9 18 6-6-6-6"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 5h3a4 4 0 0 1 4 4v6M15 9a2 2 0 0 1 2-2h-1"/>',
  chat: '<path d="M20 14a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  input: '<path d="M4 5h16v14H4zM8 9h8M8 13h5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  model: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  redo: '<path d="M18 8h-8a6 6 0 0 0-6 6v2M15 5l3 3-3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  spark: '<path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8zM19 3l.6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  undo: '<path d="M6 8h8a6 6 0 0 1 6 6v2M9 5 6 8l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  workflow: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m15 15 5 5M10 7v6M7 10h6"/>',
  zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m15 15 5 5M7 10h6"/>',
}

function icon(name, size = 16) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.dots}</svg>`
}

function sidebar() {
  const sessionRows = state.sessionsOpen
    ? `<div class="resource-list">
        <button class="resource-row"><span class="resource-leading">${icon('chat', 14)}</span><span class="truncate">小红书 8 月内容计划</span><span class="attention-dot" title="等待回复"></span></button>
        <button class="resource-row"><span class="resource-leading">${icon('chat', 14)}</span><span class="truncate">夏季新品定位讨论</span></button>
        <button class="resource-row muted"><span class="resource-leading">${icon('history', 14)}</span><span>查看全部会话</span><span class="count">12</span></button>
      </div>`
    : ''
  const workflowRows = state.workflowsOpen
    ? `<div class="resource-list">
        <button class="resource-row selected"><span class="resource-leading workflow-icon">${icon('workflow', 14)}</span><span class="truncate">小红书运营文案</span><span class="tiny-status draft">草稿</span></button>
        <button class="resource-row"><span class="resource-leading workflow-icon">${icon('workflow', 14)}</span><span class="truncate">周报生成</span><span class="status-dot success"></span></button>
        <button class="resource-row"><span class="resource-leading workflow-icon">${icon('workflow', 14)}</span><span class="truncate">竞品内容拆解</span><span class="status-dot running"></span></button>
        <button class="resource-row muted" data-action="b-hub"><span class="resource-leading">${icon('layers', 14)}</span><span>查看全部工作流</span><span class="count">6</span></button>
      </div>`
    : ''

  return `<aside class="app-sidebar" aria-label="工作区导航">
    <div class="brand-row">
      <div class="brand-mark">d</div>
      <span class="brand-name">DeepSeek Harness</span>
      <button class="icon-button subtle" aria-label="折叠侧栏">${icon('chevron', 15)}</button>
    </div>
    <button class="new-session">${icon('add', 16)}<span>新会话</span><kbd>⌘ K</kbd></button>
    <button class="search-row">${icon('search', 15)}<span>搜索会话与工作流</span></button>
    <div class="sidebar-label">工作区</div>
    <nav class="workspace-nav">
      <section class="workspace-group current">
        <div class="workspace-row">
          <span class="workspace-caret open">${icon('chevron', 13)}</span>
          <span class="workspace-avatar coral">CG</span>
          <span class="workspace-name">内容增长</span>
          <button class="icon-button subtle" aria-label="工作区菜单">${icon('dots', 15)}</button>
        </div>
        <div class="workspace-children">
          <div class="resource-group">
            <button class="resource-heading" data-action="toggle-sessions" aria-expanded="${String(state.sessionsOpen)}">
              <span class="heading-caret ${state.sessionsOpen ? 'open' : ''}">${icon('chevron', 12)}</span>
              <span>会话</span><span class="count">12</span>
              <span class="heading-add" title="在此工作区新建会话">${icon('add', 14)}</span>
            </button>
            ${sessionRows}
          </div>
          <div class="resource-group">
            <button class="resource-heading" data-action="toggle-workflows" aria-expanded="${String(state.workflowsOpen)}">
              <span class="heading-caret ${state.workflowsOpen ? 'open' : ''}">${icon('chevron', 12)}</span>
              <span>工作流</span><span class="count">6</span>
              <span class="heading-add" title="在此工作区新建工作流">${icon('add', 14)}</span>
            </button>
            ${workflowRows}
          </div>
        </div>
      </section>
      <section class="workspace-group">
        <div class="workspace-row compact">
          <span class="workspace-caret">${icon('chevron', 13)}</span>
          <span class="workspace-avatar blue">RD</span>
          <span class="workspace-name">产品研发</span>
        </div>
      </section>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="prototype-slot-note">${icon('code', 14)}<span>理想结构 · 需 Workspace resource Slot</span></div>
    <div class="sidebar-footer">
      <button>${icon('settings', 16)}<span>全局设置</span></button>
      <button class="profile-button"><span class="avatar">BX</span><span class="profile-copy"><strong>benz</strong><small>Local profile</small></span>${icon('dots', 15)}</button>
    </div>
  </aside>`
}

function canvasControls() {
  return `<div class="canvas-controls" aria-label="画布控制">
    <button aria-label="缩小">${icon('zoomOut', 15)}</button>
    <span>80%</span>
    <button aria-label="放大">${icon('zoomIn', 15)}</button>
    <span class="control-divider"></span>
    <button aria-label="适应画布">${icon('fit', 15)}</button>
    <button aria-label="锁定画布">${icon('lock', 15)}</button>
  </div>`
}

function dagNode({ key, eyebrow, title, meta, stateClass = '', badges = [], pseudo = false }) {
  const badgeMarkup = badges.map(badge => `<span class="node-badge">${badge}</span>`).join('')
  const selected = state.selectedNode === key
  return `<button class="dag-node node-${key} ${stateClass} ${selected ? 'is-selected' : ''} ${pseudo ? 'pseudo-node' : ''}" data-action="select-node" data-node="${key}">
    <span class="node-accent"></span>
    <span class="node-top"><span class="node-kind">${eyebrow}</span><span class="node-menu">${icon('dots', 13)}</span></span>
    <strong>${title}</strong>
    <span class="node-meta">${meta}</span>
    <span class="node-badges">${badgeMarkup}</span>
    <span class="port input-port"></span><span class="port output-port"></span>
  </button>`
}

function workflowCanvas({ run = false, stage = 0, compact = false } = {}) {
  const status = (step) => {
    if (!run) return ''
    if (stage > step) return 'node-success'
    if (stage === step) return 'node-running'
    return 'node-waiting'
  }
  const label = (step, idle) => {
    if (!run) return idle
    if (stage > step) return '已通过'
    if (stage === step) return '执行中'
    return '等待中'
  }
  return `<div class="workflow-canvas ${compact ? 'compact-canvas' : ''}">
    <svg class="dag-edges" viewBox="0 0 810 500" preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id="arrow-${state.variant}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      <path class="edge ${run && stage > 0 ? 'edge-success' : ''}" d="M145 250 C158 250 158 250 171 250" marker-end="url(#arrow-${state.variant})" />
      <path class="edge ${run && stage > 1 ? 'edge-success' : ''}" d="M300 250 C313 250 313 250 326 250" marker-end="url(#arrow-${state.variant})" />
      <path class="edge ${run && stage > 2 ? 'edge-success' : ''}" d="M455 250 C468 250 468 250 481 250" marker-end="url(#arrow-${state.variant})" />
      <path class="edge ${run && stage > 3 ? 'edge-success' : ''}" d="M610 250 C623 250 623 250 636 250" marker-end="url(#arrow-${state.variant})" />
    </svg>
    ${dagNode({ key: 'input', eyebrow: '输入', title: '运营需求', meta: '4 个结构化字段', pseudo: true, stateClass: run ? 'node-success' : '', badges: [run ? '已就绪' : '表单'] })}
    ${dagNode({ key: 'strategy', eyebrow: 'AI 任务', title: '内容策略', meta: label(1, '继承默认模型'), stateClass: status(1), badges: ['Skill', '验收 2'] })}
    ${dagNode({ key: 'draft', eyebrow: 'AI 任务', title: '首稿撰写', meta: label(2, 'DeepSeek · chat'), stateClass: status(2), badges: ['xiaohongshu', '验收 3'] })}
    ${dagNode({ key: 'review', eyebrow: '审校', title: '质量与合规', meta: label(3, '确定性规则'), stateClass: status(3), badges: ['规则 4'] })}
    ${dagNode({ key: 'publish', eyebrow: '输出', title: '发布版交付', meta: label(4, '工作流最终输出'), stateClass: status(4), badges: ['OUTPUT'] })}
    ${canvasControls()}
    <div class="minimap" aria-hidden="true"><span class="mini-node m1"></span><span class="mini-node m2"></span><span class="mini-node m3"></span><span class="mini-node m4"></span><span class="mini-node m5"></span><span class="mini-window"></span></div>
  </div>`
}

function aHeader() {
  const tabs = [
    ['design', '编排'],
    ['test', '测试'],
    ['runs', '运行'],
    ['versions', '版本'],
  ]
  return `<header class="workspace-header editor-header">
    <div class="title-cluster">
      <div class="breadcrumbs"><span>内容增长</span><b>/</b><span>工作流</span><b>/</b></div>
      <div class="title-line"><h1>小红书运营文案</h1><span class="status-pill draft">草稿 r7</span><span class="save-state"><i></i>有 2 项未保存</span></div>
    </div>
    <div class="header-actions">
      <button class="icon-button" aria-label="撤销">${icon('undo', 16)}</button>
      <button class="icon-button" aria-label="重做">${icon('redo', 16)}</button>
      <span class="action-separator"></span>
      <button class="button secondary">${icon('check', 15)}校验</button>
      <button class="button secondary">保存草稿</button>
      <button class="button primary" data-action="a-mode" data-mode="test">${icon('play', 15)}测试运行</button>
    </div>
    <nav class="view-tabs">
      ${tabs.map(([key, label]) => `<button class="${state.aMode === key ? 'active' : ''}" data-action="a-mode" data-mode="${key}">${label}${key === 'runs' ? '<span class="tab-count">12</span>' : ''}${key === 'versions' ? '<span class="future-dot" title="需领域能力扩展"></span>' : ''}</button>`).join('')}
    </nav>
  </header>`
}

function nodeLibrary() {
  return `<aside class="node-library">
    <div class="pane-heading"><div><strong>节点</strong><small>拖到画布中</small></div><button class="icon-button subtle">${icon('add', 15)}</button></div>
    <label class="compact-search">${icon('search', 14)}<input placeholder="搜索节点" /></label>
    <div class="library-section"><span class="library-label">数据</span>
      <button class="library-item"><span class="library-icon sky">${icon('input', 15)}</span><span><strong>工作流输入</strong><small>结构化表单</small></span><b>⋮</b></button>
    </div>
    <div class="library-section"><span class="library-label">生成</span>
      <button class="library-item"><span class="library-icon violet">${icon('spark', 15)}</span><span><strong>AI 任务</strong><small>Prompt + Skill + LLM</small></span><b>⋮</b></button>
      <button class="library-item"><span class="library-icon mint">${icon('workflow', 15)}</span><span><strong>已存工作流</strong><small>复用子流程</small></span><em>后续</em></button>
    </div>
    <div class="library-section"><span class="library-label">控制与质量</span>
      <button class="library-item"><span class="library-icon amber">${icon('check', 15)}</span><span><strong>验收门</strong><small>规则与失败策略</small></span><em>后续</em></button>
    </div>
    <div class="outline-card">
      <div class="outline-title"><span>图大纲</span><small>5 节点 · 4 连线</small></div>
      <ol><li>运营需求</li><li>内容策略</li><li class="active">首稿撰写</li><li>质量与合规</li><li>发布版交付</li></ol>
    </div>
  </aside>`
}

function inspector() {
  const tabs = [['basic', '基础'], ['prompt', '提示词'], ['capability', '能力'], ['acceptance', '验收']]
  let content
  if (state.inspectorTab === 'basic') {
    content = `<div class="form-stack">
      <label class="field"><span>节点名称</span><input value="首稿撰写" /></label>
      <label class="field"><span>说明</span><textarea rows="3">基于内容策略生成第一版小红书正文。</textarea></label>
      <div class="field"><span>上游依赖</span><div class="dependency-chip">${icon('workflow', 13)}内容策略<button>×</button></div></div>
      <details class="advanced"><summary>高级设置</summary><label class="field"><span>节点 ID</span><input value="content-draft" /></label></details>
    </div>`
  } else if (state.inspectorTab === 'capability') {
    content = `<div class="form-stack">
      <div class="field"><span>Skill</span><button class="select-control"><span><b>xiaohongshu-writer</b><small>已授权 · modelInvocable</small></span>${icon('chevron', 14)}</button></div>
      <div class="setting-group"><div class="group-title"><span>LLM 路由</span><span class="inherit-chip">覆盖默认</span></div>
        <label class="field"><span>Provider</span><button class="select-control single"><span>deepseek</span>${icon('chevron', 14)}</button></label>
        <label class="field"><span>Model</span><button class="select-control single"><span>deepseek-chat</span>${icon('chevron', 14)}</button></label>
      </div>
      <button class="link-button">恢复继承工作区默认模型</button>
    </div>`
  } else if (state.inspectorTab === 'acceptance') {
    content = `<div class="form-stack acceptance-stack">
      <div class="inspector-callout"><span>${icon('check', 15)}</span><p><strong>3 条确定性验收规则</strong><small>全部通过后才允许下游执行</small></p></div>
      <div class="rule-card"><span class="rule-index">1</span><div><small>最小字数</small><strong>输出不少于 300 字</strong></div><button>${icon('dots', 14)}</button></div>
      <div class="rule-card"><span class="rule-index">2</span><div><small>必须包含</small><strong>#种草 · 品牌名</strong></div><button>${icon('dots', 14)}</button></div>
      <div class="rule-card"><span class="rule-index">3</span><div><small>禁止包含</small><strong>最低价 · 100% 有效</strong></div><button>${icon('dots', 14)}</button></div>
      <button class="add-rule">${icon('add', 14)}添加验收规则</button>
      <div class="failure-policy"><span>失败时</span><button class="select-control single"><span>停止流程并显示证据</span>${icon('chevron', 14)}</button></div>
    </div>`
  } else {
    content = `<div class="form-stack prompt-stack">
      <div class="prompt-toolbar"><span>任务提示词</span><div><button title="插入变量">{x}</button><button title="扩大编辑">${icon('fit', 13)}</button></div></div>
      <div class="prompt-editor" contenteditable="true" role="textbox" aria-label="任务提示词"><p>你是资深小红书内容编辑。</p><p>请基于 <mark>{{nodes.content-strategy}}</mark> 撰写首稿，并突出 <mark>{{input.selling_points}}</mark>。</p><p>语气要真实、可读，避免绝对化表述。</p></div>
      <div class="variable-picker"><div class="picker-title"><span>可用变量</span><small>点击插入</small></div>
        <button><span class="var-symbol">in</span><span><strong>selling_points</strong><small>核心卖点</small></span>${icon('add', 13)}</button>
        <button><span class="var-symbol upstream">up</span><span><strong>content-strategy</strong><small>内容策略 · 输出</small></span>${icon('add', 13)}</button>
      </div>
      <div class="token-hint"><span>预估 486 tokens</span><span>变量引用合法 ${icon('check', 13)}</span></div>
    </div>`
  }
  return `<aside class="node-inspector">
    <div class="inspector-head"><div><span class="inspector-icon">${icon('spark', 16)}</span><span><strong>首稿撰写</strong><small>content-draft</small></span></div><button class="icon-button subtle">${icon('dots', 15)}</button></div>
    <nav class="inspector-tabs">${tabs.map(([key, label]) => `<button class="${state.inspectorTab === key ? 'active' : ''}" data-action="inspector-tab" data-tab="${key}">${label}${key === 'acceptance' ? '<span>3</span>' : ''}</button>`).join('')}</nav>
    <div class="inspector-content">${content}</div>
    <div class="inspector-footer"><button class="button secondary">${icon('play', 14)}测试此节点</button><button class="button primary">应用</button></div>
  </aside>`
}

function designSurface() {
  return `<div class="editor-shell">
    ${nodeLibrary()}
    <main class="canvas-column">
      <div class="canvas-toolbar"><div><button class="tool-active">${icon('workflow', 15)}选择</button><button>${icon('add', 15)}节点</button><button>${icon('branch', 15)}连线</button></div><div><span class="validation-ok">${icon('check', 13)}图结构有效</span><button>自动布局</button></div></div>
      ${workflowCanvas()}
      <button class="trace-drawer collapsed"><span>${icon('terminal', 15)}测试与 Trace</span><span>最近一次节点测试已过期</span><b>⌓</b></button>
    </main>
    ${inspector()}
  </div>`
}

function testSurface() {
  return `<div class="test-layout">
    <aside class="test-input-pane">
      <div class="pane-heading"><div><strong>测试输入</strong><small>样例：夏季新品种草</small></div><button class="icon-button subtle">${icon('dots', 15)}</button></div>
      <label class="field"><span>主题 / 产品 *</span><textarea rows="3">新款轻薄防晒衣，适合城市通勤和周末户外</textarea></label>
      <label class="field"><span>目标人群 *</span><input value="22–35 岁城市女性" /></label>
      <label class="field"><span>核心卖点 *</span><textarea rows="4">防晒 UPF50+，重量仅 180g，透气不闷，可收纳进包</textarea></label>
      <label class="field"><span>语气</span><button class="select-control single"><span>真实体验型</span>${icon('chevron', 14)}</button></label>
      <button class="button primary wide" data-action="demo-run">${icon('play', 15)}${state.runStage > 0 && state.runStage < 5 ? '正在测试…' : '运行完整流程'}</button>
      <p class="helper-copy">测试不会影响已发布版本，运行绑定当前草稿 r7。</p>
    </aside>
    <main class="test-canvas-pane">
      <div class="run-summary-bar"><div><span class="live-indicator ${state.runStage > 0 && state.runStage < 5 ? 'live' : ''}"></span><strong>${state.runStage === 0 ? '尚未运行' : state.runStage < 5 ? '测试运行中' : '测试已通过'}</strong><small>${state.runStage === 0 ? '点击左侧按钮开始' : `Run #T-1048 · ${state.runStage < 5 ? '已用 8.4s' : '总计 19.7s'}`}</small></div><button class="button secondary">${icon('terminal', 14)}打开 Trace</button></div>
      ${workflowCanvas({ run: true, stage: state.runStage })}
      <div class="timeline-strip"><span class="timeline-label">时间线</span><div class="time-event done"><i></i><span>输入已校验<small>0.1s</small></span></div><div class="time-event ${state.runStage > 1 ? 'done' : state.runStage === 1 ? 'active' : ''}"><i></i><span>内容策略<small>4.2s</small></span></div><div class="time-event ${state.runStage > 2 ? 'done' : state.runStage === 2 ? 'active' : ''}"><i></i><span>首稿撰写<small>8.1s</small></span></div><div class="time-event ${state.runStage > 3 ? 'done' : state.runStage === 3 ? 'active' : ''}"><i></i><span>质量审校<small>3.6s</small></span></div></div>
    </main>
    <aside class="evidence-pane"><div class="pane-heading"><div><strong>节点证据</strong><small>首稿撰写</small></div><span class="result-pill success">${icon('check', 12)}已通过</span></div>
      <div class="evidence-metrics"><div><small>状态</small><strong>成功</strong></div><div><small>耗时</small><strong>8.1s</strong></div><div><small>模型</small><strong>deepseek-chat</strong></div></div>
      <section class="evidence-section"><h3>验收证据 <span>3/3</span></h3><div class="check-line">${icon('check', 13)}<span>字数 486 ≥ 300</span></div><div class="check-line">${icon('check', 13)}<span>包含品牌名与 #种草</span></div><div class="check-line">${icon('check', 13)}<span>未命中 2 个禁用词</span></div></section>
      <section class="evidence-section output-preview"><h3>节点输出 <button>${icon('copy', 13)}复制</button></h3><p>防晒衣也能像衬衫一样轻盈？这件新款我通勤实穿了一周……</p></section>
    </aside>
  </div>`
}

function runsSurface() {
  const rows = [
    ['#R-1047', '成功', '今天 15:42', '19.7s', 'success'],
    ['#R-1046', '失败', '今天 14:08', '12.4s', 'error'],
    ['#R-1045', '成功', '昨天 18:21', '21.3s', 'success'],
    ['#R-1044', '已取消', '8 月 29 日', '6.8s', 'neutral'],
  ]
  return `<div class="runs-layout">
    <aside class="runs-list"><div class="pane-heading"><div><strong>近期运行</strong><small>当前 Host 进程 · 12 条</small></div><button class="icon-button subtle">${icon('search', 15)}</button></div><div class="filter-row"><button class="active">全部</button><button>失败</button><button>运行中</button></div>
      <div class="run-list-rows">${rows.map((row, index) => `<button class="run-list-row ${index === 0 ? 'active' : ''}"><span class="run-status-icon ${row[4]}">${row[4] === 'success' ? icon('check', 12) : row[4] === 'error' ? '!' : '–'}</span><span><strong>${row[0]}</strong><small>${row[2]}</small></span><span><b>${row[1]}</b><small>${row[3]}</small></span></button>`).join('')}</div>
      <div class="process-note">${icon('history', 14)}<span>运行记录目前仅在本次 Host 进程内保留</span></div>
    </aside>
    <main class="run-detail-canvas"><div class="detail-run-head"><div><span class="result-pill success">${icon('check', 12)}成功</span><strong>运行 #R-1047</strong><small>已绑定 revision 6 · 原始输入已保留</small></div><div><button class="button secondary">${icon('copy', 14)}复制为测试</button><button class="button secondary">${icon('redo', 14)}按 r6 重跑</button></div></div>${workflowCanvas({ run: true, stage: 5 })}<div class="run-log"><span>15:42:18</span><b>publish-ready</b><p>验收 2/2 通过，已生成最终交付物。</p></div></main>
    <aside class="evidence-pane run-evidence"><div class="pane-heading"><div><strong>运行详情</strong><small>revision 6 · 不可变快照</small></div><button class="icon-button subtle">${icon('dots', 15)}</button></div><div class="summary-grid"><div><small>开始</small><strong>15:42:03</strong></div><div><small>结束</small><strong>15:42:23</strong></div><div><small>总耗时</small><strong>19.7s</strong></div><div><small>节点</small><strong>4 / 4</strong></div></div><section class="evidence-section deliverable-box"><h3>最终交付物 <button>${icon('copy', 13)}复制</button></h3><div class="deliverable-paper"><b>通勤人的防晒衣，轻到放包里就忘了 ☀️</b><p>这周几乎天天穿它出门。UPF50+ 的防晒力很安心，180g 拿在手里几乎没什么负担……</p><p>#夏日穿搭 #防晒衣 #通勤好物</p></div></section></aside>
  </div>`
}

function versionsSurface() {
  return `<div class="versions-page"><div class="future-banner"><span>${icon('history', 18)}</span><div><strong>版本与发布是建议的下一阶段能力</strong><p>当前域模型只有保存 revision；“草稿 / 已发布”、差异和回滚需要 Host 合同扩展，不是纯前端状态。</p></div><span class="phase-chip">P1 概念</span></div>
    <section class="versions-card"><div class="versions-head"><div><h2>版本记录</h2><p>模型自动运行只使用已发布版本</p></div><button class="button primary">发布草稿 r7</button></div><table><thead><tr><th>版本</th><th>状态</th><th>变更</th><th>作者</th><th>时间</th><th></th></tr></thead><tbody><tr class="current"><td><strong>r7</strong></td><td><span class="status-pill draft">草稿</span></td><td>调整首稿 Prompt，新增禁用词</td><td>benz</td><td>3 分钟前</td><td><button>${icon('dots', 15)}</button></td></tr><tr><td><strong>r6</strong></td><td><span class="status-pill published">已发布</span></td><td>调整内容策略输出格式</td><td>benz</td><td>今天 11:20</td><td><button>查看差异</button></td></tr><tr><td><strong>r5</strong></td><td><span class="status-pill archived">已归档</span></td><td>新增质量与合规节点</td><td>benz</td><td>8 月 28 日</td><td><button>查看差异</button></td></tr></tbody></table></section>
    <section class="version-policy"><div><span class="policy-icon">${icon('workflow', 18)}</span><span><strong>运行绑定版本</strong><small>每次运行保留不可变的 definition snapshot</small></span></div><div><span class="policy-icon">${icon('redo', 18)}</span><span><strong>可复现重跑</strong><small>明确区分原 revision 重跑与当前草稿测试</small></span></div><div><span class="policy-icon">${icon('lock', 18)}</span><span><strong>模型安全调用</strong><small>Agent 只见到已发布的稳定定义</small></span></div></section>
  </div>`
}

function variantA() {
  const content = state.aMode === 'design'
    ? designSurface()
    : state.aMode === 'test'
      ? testSurface()
      : state.aMode === 'runs'
        ? runsSurface()
        : versionsSurface()
  return `<div class="main-surface variant-a">${aHeader()}<div class="mode-content">${content}</div></div>`
}

const workflows = [
  { name: '小红书运营文案', description: '从策略、撰写到合规审校，交付可直接发布的内容。', tag: '内容', status: '草稿 r7', run: '19.7s', result: '成功', updated: '3 分钟前' },
  { name: '周报生成', description: '汇总本周会话与任务，生成结构化周报。', tag: '效率', status: '已发布 r4', run: '13.2s', result: '成功', updated: '昨天' },
  { name: '竞品内容拆解', description: '识别卖点、叙事结构与评论区反馈。', tag: '研究', status: '已发布 r2', run: '运行中', result: '执行中', updated: '今天 14:08' },
  { name: '直播复盘提纲', description: '整理数据、高频问题与下次直播改进项。', tag: '运营', status: '草稿 r1', run: '—', result: '未运行', updated: '8 月 27 日' },
]

function hubHeader() {
  return `<header class="workspace-header hub-header"><div><div class="breadcrumbs"><span>内容增长</span><b>/</b></div><h1>工作流</h1><p>管理当前工作区可复用的 AI 任务流程</p></div><div class="header-actions"><button class="button secondary">从文件导入</button><button class="button primary" data-action="b-open">${icon('add', 15)}新建工作流</button></div></header>`
}

function workflowHub() {
  return `<div class="hub-content">
    <section class="hub-hero"><div><span class="eyebrow">工作区资产</span><h2>把做过一次的好方法，<br />变成每次都能复现的流程。</h2><p>编排 Prompt、Skill、LLM 与验收规则，从会话或表单直接执行。</p><button class="button dark" data-action="b-open">${icon('add', 15)}创建第一个流程</button></div><div class="template-preview"><div class="template-top"><span class="template-icon">${icon('spark', 18)}</span><span><small>推荐模板</small><strong>小红书运营文案</strong></span><span class="tag">内置</span></div><div class="mini-flow"><span>需求</span><i></i><span>策略</span><i></i><span>撰写</span><i></i><span>审校</span></div><p>输入产品与卖点，交付可直接发布的文案。</p><button data-action="b-open">使用此模板 ${icon('arrowRight', 14)}</button></div></section>
    <section class="hub-stats"><div><span class="metric-icon violet">${icon('workflow', 17)}</span><span><strong>6</strong><small>工作流</small></span></div><div><span class="metric-icon mint">${icon('check', 17)}</span><span><strong>94%</strong><small>近 7 日成功率</small></span></div><div><span class="metric-icon amber">${icon('clock', 17)}</span><span><strong>18.4s</strong><small>平均运行时间</small></span></div><div><span class="metric-icon sky">${icon('play', 17)}</span><span><strong>38</strong><small>近 7 日运行</small></span></div></section>
    <section class="workflow-table-card"><div class="table-toolbar"><div><h2>全部工作流 <span>6</span></h2></div><div><label class="table-search">${icon('search', 14)}<input placeholder="搜索工作流" /></label><button class="filter-button">状态：全部 ${icon('chevron', 13)}</button><button class="icon-button">${icon('dots', 15)}</button></div></div><div class="workflow-table"><div class="workflow-table-head"><span>工作流</span><span>状态</span><span>最近运行</span><span>更新</span><span></span></div>${workflows.map((workflow, index) => `<button class="workflow-table-row" data-action="b-open"><span class="workflow-cell-main"><span class="flow-avatar ${['violet', 'blue', 'coral', 'green'][index]}">${icon('workflow', 16)}</span><span><strong>${workflow.name}</strong><small>${workflow.description}</small><em>${workflow.tag}</em></span></span><span><span class="status-pill ${workflow.status.includes('草稿') ? 'draft' : 'published'}">${workflow.status}</span></span><span class="last-run"><b class="${workflow.result === '成功' ? 'success-text' : workflow.result === '执行中' ? 'running-text' : ''}">${workflow.result}</b><small>${workflow.run}</small></span><span class="updated-cell">${workflow.updated}</span><span class="row-arrow">${icon('arrowRight', 15)}</span></button>`).join('')}</div></section>
    <section class="activity-row"><div class="activity-card"><div class="activity-head"><h3>最近活动</h3><button>查看运行</button></div><div class="activity-item"><span class="activity-status success">${icon('check', 13)}</span><p><strong>小红书运营文案</strong> 完成了一次运行<small>3 分钟前 · 19.7s</small></p></div><div class="activity-item"><span class="activity-status running">${icon('play', 12)}</span><p><strong>竞品内容拆解</strong> 正在执行<small>5 分钟前 · 3/5 节点</small></p></div></div><div class="getting-started"><span>${icon('spark', 18)}</span><div><strong>新手建议</strong><p>先用一个结构化输入 + 3–5 个节点验证价值，再扩展复杂分支。</p></div></div></section>
  </div>`
}

function guideContent() {
  if (state.guideStep === 'basic') return `<section class="guide-form"><div class="form-section-title"><span>1</span><div><h2>基本信息</h2><p>说清这个工作流在什么情况下使用。</p></div></div><div class="two-field"><label class="field"><span>工作流名称</span><input value="小红书运营文案" /></label><label class="field"><span>标识 ID</span><input value="xiaohongshu-content" /></label></div><label class="field"><span>用途说明</span><textarea rows="4">输入产品或主题、受众与核心卖点，交付可直接发布的小红书文案。</textarea></label><label class="field"><span>标签</span><div class="tag-input"><span>内容 <button>×</button></span><span>小红书 <button>×</button></span><input placeholder="添加标签" /></div></label></section>`
  if (state.guideStep === 'inputs') return `<section class="guide-form"><div class="form-section-title"><span>2</span><div><h2>运行输入</h2><p>从这些字段自动生成用户启动工作流时的表单。</p></div></div><div class="schema-table"><div class="schema-head"><span>字段</span><span>显示名称</span><span>类型</span><span>必填</span><span></span></div><div class="schema-row"><code>topic</code><span>主题 / 产品</span><span>长文本</span><span>${icon('check', 13)}</span><button>${icon('dots', 14)}</button></div><div class="schema-row"><code>audience</code><span>目标人群</span><span>单行文本</span><span>${icon('check', 13)}</span><button>${icon('dots', 14)}</button></div><div class="schema-row"><code>selling_points</code><span>核心卖点</span><span>长文本</span><span>${icon('check', 13)}</span><button>${icon('dots', 14)}</button></div><div class="schema-row"><code>tone</code><span>语气</span><span>单选</span><span>—</span><button>${icon('dots', 14)}</button></div></div><button class="add-schema">${icon('add', 14)}添加输入字段</button></section>`
  if (state.guideStep === 'acceptance') return `<section class="guide-form"><div class="form-section-title"><span>4</span><div><h2>验收与交付</h2><p>把“完成”定义成可检查、可解释的条件。</p></div></div><div class="quality-summary"><div class="quality-score"><strong>9</strong><span>条节点规则</span></div><div><b>确定性规则</b><p>字数、必须包含、禁止包含。失败时停止下游并保留证据。</p></div></div><div class="acceptance-node-list"><div><span class="step-number">01</span><span><strong>内容策略</strong><small>2 条规则</small></span><button>编辑</button></div><div><span class="step-number">02</span><span><strong>首稿撰写</strong><small>3 条规则</small></span><button>编辑</button></div><div><span class="step-number">03</span><span><strong>质量与合规</strong><small>4 条规则</small></span><button>编辑</button></div></div><label class="field"><span>最终交付节点</span><button class="select-control single"><span>发布版交付</span>${icon('chevron', 14)}</button></label></section>`
  if (state.guideStep === 'publish') return `<section class="guide-form"><div class="form-section-title"><span>5</span><div><h2>测试与发布</h2><p>用真实样例验证后，再交给 dsh 自动调用。</p></div></div><div class="publish-checks"><div class="publish-check done">${icon('check', 15)}<span><strong>图结构校验</strong><small>4 个任务节点，无环与悬空引用</small></span></div><div class="publish-check done">${icon('check', 15)}<span><strong>Skill 与 LLM 可用</strong><small>1 个 Skill 已授权，模型路由可用</small></span></div><div class="publish-check warning"><span>!</span><span><strong>回归样例</strong><small>建议先测试当前草稿 r7</small></span><button>去测试</button></div></div><div class="publish-box"><span class="publish-icon">${icon('spark', 20)}</span><div><strong>准备发布 r7</strong><p>发布后，会话中的 Agent 将可以发现并执行这个版本。</p></div><button class="button primary">发布</button></div></section>`
  return `<section class="guide-form"><div class="form-section-title"><span>3</span><div><h2>节点与任务</h2><p>按交付顺序编辑节点；有分支时再进入图视图。</p></div></div><div class="guided-node-list"><div class="guided-node"><span class="step-number">01</span><span class="guided-icon violet">${icon('spark', 15)}</span><span><strong>内容策略</strong><small>继承默认 LLM · Skill: content-strategist · 验收 2</small></span><button>编辑</button><span class="drag-handle">⠇</span></div><div class="step-connector"></div><div class="guided-node active"><span class="step-number">02</span><span class="guided-icon violet">${icon('spark', 15)}</span><span><strong>首稿撰写</strong><small>deepseek-chat · Skill: xiaohongshu-writer · 验收 3</small></span><button>编辑</button><span class="drag-handle">⠇</span></div><div class="step-connector"></div><div class="guided-node"><span class="step-number">03</span><span class="guided-icon amber">${icon('check', 15)}</span><span><strong>质量与合规</strong><small>继承默认 LLM · 验收 4</small></span><button>编辑</button><span class="drag-handle">⠇</span></div><div class="step-connector"></div><div class="guided-node"><span class="step-number">04</span><span class="guided-icon green">${icon('check', 15)}</span><span><strong>发布版交付</strong><small>最终输出 · 验收 2</small></span><button>编辑</button><span class="drag-handle">⠇</span></div></div><div class="node-add-row"><button>${icon('add', 14)}添加下一个节点</button><button>${icon('branch', 14)}切换到图视图</button></div></section>`
}

function guidedEditor() {
  const steps = [['basic', '01', '基本信息'], ['inputs', '02', '运行输入'], ['nodes', '03', '节点与任务'], ['acceptance', '04', '验收与交付'], ['publish', '05', '测试与发布']]
  return `<div class="guided-page"><header class="guided-header"><div><button class="back-button" data-action="b-hub">${icon('arrowLeft', 15)}工作流中心</button><div class="title-line"><h1>小红书运营文案</h1><span class="status-pill draft">草稿 r7</span></div></div><div class="header-actions"><button class="button secondary">预览表单</button><button class="button secondary">保存草稿</button><button class="button primary">${icon('play', 14)}测试</button></div></header>
    <div class="guided-layout"><aside class="guide-steps"><div class="guide-progress"><span style="width: 60%"></span></div><span class="guide-kicker">配置进度 · 3/5</span>${steps.map(([key, number, label], index) => `<button class="guide-step ${state.guideStep === key ? 'active' : ''} ${index < 3 ? 'done' : ''}" data-action="guide-step" data-step="${key}"><span>${index < 3 ? icon('check', 12) : number}</span><strong>${label}</strong>${icon('chevron', 13)}</button>`).join('')}<div class="guide-help"><span>${icon('spark', 16)}</span><strong>不确定怎么配？</strong><p>从内置模板开始，再用真实输入调整。</p><button>查看编排建议</button></div></aside>
      <main class="guide-main">${guideContent()}<div class="guide-nav"><button class="button secondary">${icon('arrowLeft', 14)}上一步</button><button class="button primary">保存并继续 ${icon('arrowRight', 14)}</button></div></main>
      <aside class="guide-summary"><div class="summary-head"><span>工作流摘要</span><span class="health-dot">92</span></div><div class="mini-topology"><div><span>01</span><strong>策略</strong></div><i></i><div><span>02</span><strong>撰写</strong></div><i></i><div><span>03</span><strong>审校</strong></div><i></i><div><span>04</span><strong>交付</strong></div></div><dl><div><dt>输入</dt><dd>4 个字段</dd></div><div><dt>任务</dt><dd>4 个节点</dd></div><div><dt>Skill</dt><dd>2 个</dd></div><div><dt>LLM 覆盖</dt><dd>1 个</dd></div><div><dt>验收</dt><dd>9 条规则</dd></div></dl><div class="summary-warning"><span>!</span><p><strong>还差一步</strong><small>运行草稿 r7 的发布前测试</small></p></div><button class="button secondary wide">${icon('workflow', 14)}打开图视图</button></aside>
    </div></div>`
}

function variantB() {
  return `<div class="main-surface variant-b">${state.bView === 'hub' ? `${hubHeader()}${workflowHub()}` : guidedEditor()}</div>`
}

function cHeader() {
  return `<header class="workspace-header cockpit-header"><div class="title-cluster"><div class="breadcrumbs"><span>内容增长</span><b>/</b><span>工作流</span><b>/</b></div><div class="title-line"><span class="title-icon">${icon('workflow', 18)}</span><h1>小红书运营文案</h1><span class="status-pill published">已发布 r6</span></div></div><div class="cockpit-mode"><button class="${state.cMode === 'run' ? 'active' : ''}" data-action="c-mode" data-mode="run">${icon('play', 14)}运行</button><button class="${state.cMode === 'design' ? 'active' : ''}" data-action="c-mode" data-mode="design">${icon('settings', 14)}编辑流程</button></div><div class="header-actions"><button class="icon-button">${icon('history', 16)}</button><button class="icon-button">${icon('dots', 16)}</button></div></header>`
}

function cockpitRun() {
  const running = state.runStage > 0 && state.runStage < 5
  const completed = state.runStage >= 5
  return `<div class="cockpit-grid">
    <aside class="brief-pane"><div class="brief-head"><span><strong>本次运行</strong><small>输入需求，获得可发布文案</small></span><button class="icon-button subtle">${icon('history', 15)}</button></div><div class="input-progress"><span class="complete"></span><span class="complete"></span><span class="complete"></span><span></span><small>3 个必填项已完成 · 1 个可选项</small></div><div class="brief-fields"><label class="field"><span>主题 / 产品 *</span><textarea rows="3">新款轻薄防晒衣，城市通勤与周末户外</textarea></label><label class="field"><span>目标人群 *</span><input value="22–35 岁城市女性" /></label><label class="field"><span>核心卖点 *</span><textarea rows="5">· UPF50+
· 180g 轻量
· 透气不闷
· 可折叠收纳</textarea></label><label class="field"><span>语气</span><button class="select-control single"><span>真实体验型</span>${icon('chevron', 14)}</button></label></div><div class="brief-footer"><div class="revision-lock">${icon('lock', 13)}<span>将使用已发布 revision 6</span></div><button class="button primary wide run-large" data-action="demo-run">${running ? '<span class="spinner"></span>正在生成…' : completed ? `${icon('redo', 15)}再运行一次` : `${icon('play', 15)}生成可发布文案`}</button></div></aside>
    <main class="live-pane"><div class="live-pane-head"><div><span class="live-indicator ${running ? 'live' : ''} ${completed ? 'done' : ''}"></span><span><strong>${running ? '工作流正在执行' : completed ? '工作流已完成' : '执行预览'}</strong><small>${running ? `${String(Math.min(state.runStage, 4))}/4 节点 · ${String(state.runStage * 4.2)}s` : completed ? '4/4 节点 · 19.7s' : '4 个节点 · 预估 20s'}</small></span></div><div><button class="button secondary">${icon('terminal', 14)}日志</button>${running ? '<button class="button danger">取消</button>' : ''}</div></div>
      <div class="vertical-flow">
        ${[['strategy', '内容策略', 'content-strategist', 1], ['draft', '首稿撰写', 'xiaohongshu-writer · deepseek-chat', 2], ['review', '质量与合规', '4 条验收规则', 3], ['publish', '发布版交付', '最终输出', 4]].map(([key, title, meta, step], index) => {
          const stepNumber = Number(step)
          const statusClass = state.runStage > stepNumber ? 'done' : state.runStage === stepNumber ? 'running' : 'waiting'
          const statusLabel = state.runStage > stepNumber ? '已通过' : state.runStage === stepNumber ? '执行中' : '等待中'
          return `<button class="vertical-node ${statusClass}" data-action="select-node" data-node="${key}"><span class="vertical-index">${state.runStage > stepNumber ? icon('check', 13) : `0${String(step)}`}</span><span class="vertical-icon">${key === 'review' || key === 'publish' ? icon('check', 16) : icon('spark', 16)}</span><span><strong>${title}</strong><small>${meta}</small></span><span class="vertical-status">${statusLabel}</span><span class="duration">${state.runStage > stepNumber ? ['4.2s', '8.1s', '3.6s', '3.8s'][index] : ''}</span>${icon('chevron', 14)}</button>${index < 3 ? '<div class="vertical-connector"><i></i></div>' : ''}`
        }).join('')}
      </div>
      <div class="live-detail"><div class="detail-tabs"><button class="active">节点概要</button><button>输入 / 输出</button><button>验收证据</button></div><div class="detail-body"><span class="detail-node-icon">${icon('spark', 17)}</span><div><strong>首稿撰写</strong><p>使用 xiaohongshu-writer Skill 和 deepseek-chat，基于内容策略生成首稿。</p></div><span class="result-pill ${state.runStage > 2 ? 'success' : ''}">${state.runStage > 2 ? `${icon('check', 12)}验收 3/3` : '等待执行'}</span></div></div>
    </main>
    <aside class="delivery-pane"><div class="delivery-head"><div><span class="delivery-kicker">最终交付</span><h2>${completed ? '内容已就绪' : '等待工作流完成'}</h2></div>${completed ? '<span class="result-pill success">\u9a8c收\u901a\u8fc7</span>' : ''}</div>${completed ? `<article class="publish-preview"><div class="preview-cover"><span>通勤防晒<br />也可以很轻盈</span><small>180g · UPF50+</small></div><div class="preview-copy"><h3>通勤人的防晒衣，轻到放包里就忘了 ☀️</h3><p>这周几乎天天穿它出门。UPF50+ 的防晒力很安心，180g 拿在手里几乎没什么负担。</p><p>地铁冷气房也能当一层小外套，收起来不占包。真心建议经常在户外跑的人试试。</p><p class="hashtags">#夏日穿搭 #防晒衣 #通勤好物 #种草</p></div></article><div class="delivery-actions"><button class="button primary">${icon('copy', 14)}复制全文</button><button class="button secondary">${icon('chat', 14)}在会话中继续修改</button></div><div class="delivery-proof"><span>${icon('check', 14)}</span><p><strong>11/11 验收规则通过</strong><small>展开查看每条证据</small></p>${icon('chevron', 14)}</div>` : `<div class="delivery-empty"><span class="empty-orbit">${icon('spark', 24)}</span><h3>输入关键内容后开始</h3><p>此处会显示可直接发布的最终文案，以及验收结果。</p><div class="output-skeleton"><i></i><i></i><i></i><i></i><i></i></div></div>`}</aside>
  </div>`
}

function cockpitDesign() {
  return `<div class="cockpit-design"><main><div class="design-intro"><div><span class="eyebrow">已发布 r6 · 编辑中的更改将存入草稿 r7</span><h2>流程结构</h2></div><div><button class="button secondary">${icon('check', 14)}校验</button><button class="button primary">保存草稿</button></div></div>${workflowCanvas()}<div class="cockpit-bottom-tabs"><button class="active">节点配置</button><button>工作流输入</button><button>验收总览 <span>11</span></button></div></main><aside class="cockpit-config"><div class="pane-heading"><div><strong>首稿撰写</strong><small>AI 任务 · content-draft</small></div><button class="icon-button subtle">${icon('dots', 15)}</button></div><div class="compact-config-section"><span>任务提示词</span><div class="compact-prompt">基于 <mark>{{nodes.content-strategy}}</mark> 与 <mark>{{input.selling_points}}</mark> 生成小红书首稿……</div><button class="link-button">展开编辑</button></div><div class="compact-config-section"><span>能力与模型</span><div class="config-summary-row"><b>Skill</b><span>xiaohongshu-writer</span></div><div class="config-summary-row"><b>LLM</b><span>deepseek-chat</span></div></div><div class="compact-config-section"><span>验收</span><div class="config-summary-row"><b>规则</b><span>3 条</span></div><div class="config-summary-row"><b>失败时</b><span>停止下游</span></div></div><div class="cockpit-config-footer"><button class="button secondary">${icon('play', 14)}测试节点</button><button class="button primary">编辑详情</button></div></aside></div>`
}

function variantC() {
  return `<div class="main-surface variant-c">${cHeader()}${state.cMode === 'run' ? cockpitRun() : cockpitDesign()}</div>`
}

function reviewNotes() {
  if (!state.showNotes) return ''
  return `<aside class="review-notes"><div class="notes-head"><span><b>UI/UX 评审结论</b><small>原型内容，不是已实现能力</small></span><button class="icon-button" data-action="toggle-notes">×</button></div><div class="notes-recommendation"><span>${icon('spark', 17)}</span><p><strong>建议不要三选一，而是组合成一条用户路径</strong><small>B 作为工作流入口 → A 负责编排 → C 的交付面板用于测试与运行。</small></p></div><dl><div><dt>A</dt><dd><strong>适合创作者</strong><span>复杂 DAG 可见、属性清晰，但新手学习成本较高。</span></dd></div><div><dt>B</dt><dd><strong>适合发现与管理</strong><span>容易找、容易复用，但不应取代真正画布。</span></dd></div><div><dt>C</dt><dd><strong>适合执行与交付</strong><span>输入、进度、交付同屏，是普通使用者的默认体验。</span></dd></div></dl><div class="notes-boundary"><strong>实现边界</strong><p>侧栏的“会话 / 工作流”并列需要 Harness 新增每工作区资源 Slot；版本发布、持久运行、成本统计也需要 Host 合同扩展。</p></div></aside>`
}

function prototypeSwitcher() {
  const current = variants.find(item => item.key === state.variant)
  return `<div class="prototype-switcher" role="toolbar" aria-label="原型方案切换">
    <span class="prototype-label">THROWAWAY PROTOTYPE</span>
    <button class="switch-arrow" data-action="variant-prev" aria-label="上一个方案">${icon('arrowLeft', 16)}</button>
    <div class="switch-copy"><strong>${current.key} — ${current.name}</strong><small>${current.summary} · 键盘 ← → 切换</small></div>
    <div class="variant-dots">${variants.map(item => `<button class="${item.key === state.variant ? 'active' : ''}" data-action="variant-set" data-variant="${item.key}" aria-label="切换到方案 ${item.key}">${item.key}</button>`).join('')}</div>
    <button class="switch-arrow" data-action="variant-next" aria-label="下一个方案">${icon('arrowRight', 16)}</button>
    <span class="switch-divider"></span>
    <button class="review-button ${state.showNotes ? 'active' : ''}" data-action="toggle-notes">${icon('chat', 15)}评审要点</button>
  </div>`
}

function render() {
  const variant = state.variant === 'A' ? variantA() : state.variant === 'B' ? variantB() : variantC()
  document.querySelector('#app').innerHTML = `<div class="prototype-app">${sidebar()}${variant}${reviewNotes()}${prototypeSwitcher()}</div>`
}

function setVariant(key) {
  state.variant = key
  const url = new URL(window.location.href)
  url.searchParams.set('variant', key)
  window.history.replaceState({}, '', url)
  render()
}

function cycleVariant(direction) {
  const index = variants.findIndex(item => item.key === state.variant)
  const next = (index + direction + variants.length) % variants.length
  setVariant(variants[next].key)
}

function startDemoRun() {
  window.clearInterval(runTimer)
  state.runStage = 1
  render()
  runTimer = window.setInterval(() => {
    state.runStage += 1
    if (state.runStage >= 5) window.clearInterval(runTimer)
    render()
  }, 720)
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]')
  if (!(target instanceof HTMLElement)) return
  const action = target.dataset.action
  if (action === 'variant-prev') cycleVariant(-1)
  if (action === 'variant-next') cycleVariant(1)
  if (action === 'variant-set' && target.dataset.variant) setVariant(target.dataset.variant)
  if (action === 'toggle-sessions') { state.sessionsOpen = !state.sessionsOpen; render() }
  if (action === 'toggle-workflows') { state.workflowsOpen = !state.workflowsOpen; render() }
  if (action === 'a-mode' && target.dataset.mode) { state.aMode = target.dataset.mode; render() }
  if (action === 'inspector-tab' && target.dataset.tab) { state.inspectorTab = target.dataset.tab; render() }
  if (action === 'select-node' && target.dataset.node) { state.selectedNode = target.dataset.node; render() }
  if (action === 'b-open') { state.bView = 'editor'; render() }
  if (action === 'b-hub') { state.variant = 'B'; state.bView = 'hub'; setVariant('B') }
  if (action === 'guide-step' && target.dataset.step) { state.guideStep = target.dataset.step; render() }
  if (action === 'c-mode' && target.dataset.mode) { state.cMode = target.dataset.mode; render() }
  if (action === 'demo-run') startDemoRun()
  if (action === 'toggle-notes') { state.showNotes = !state.showNotes; render() }
})

document.addEventListener('keydown', (event) => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active?.getAttribute('contenteditable') === 'true') return
  if (event.key === 'ArrowLeft') cycleVariant(-1)
  if (event.key === 'ArrowRight') cycleVariant(1)
})

window.addEventListener('popstate', () => {
  const candidate = new URLSearchParams(window.location.search).get('variant')?.toUpperCase()
  if (variants.some(item => item.key === candidate)) state.variant = candidate
  render()
})

render()
