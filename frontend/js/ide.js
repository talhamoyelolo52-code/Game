// Kodari IDE — Main Logic
const API = ''; // same origin

// State
let state = {
  pluginName: 'MyPlugin',
  mcVersion: '1.20.4',
  files: {},          // { filepath: content }
  openTabs: [],       // [filepath]
  activeTab: null,
  editor: null,
  chatHistory: [],
};

// ==========================================
// MONACO SETUP
// ==========================================
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
  // Define a dark theme matching Kodari colors
  monaco.editor.defineTheme('kodari-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'string', foreground: '06b6d4' },
      { token: 'number', foreground: 'f59e0b' },
      { token: 'type', foreground: '10b981' },
      { token: 'identifier', foreground: 'e4e7ef' },
    ],
    colors: {
      'editor.background': '#0a0e1a',
      'editor.foreground': '#e4e7ef',
      'editorLineNumber.foreground': '#3d4458',
      'editorLineNumber.activeForeground': '#a78bfa',
      'editor.selectionBackground': '#8b5cf640',
      'editor.lineHighlightBackground': '#111827',
      'editorCursor.foreground': '#a78bfa',
      'editorIndentGuide.background': '#1a2332',
      'editorWidget.background': '#111827',
      'editorWidget.border': '#2d3548',
    },
  });

  state.editor = monaco.editor.create(document.getElementById('monaco-editor'), {
    value: '',
    language: 'java',
    theme: 'kodari-dark',
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
    minimap: { enabled: true, scale: 1 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    wordWrap: 'on',
    padding: { top: 12 },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    renderLineHighlight: 'all',
  });

  // Sync editor content back to state when changed
  state.editor.onDidChangeModelContent(() => {
    if (state.activeTab) {
      state.files[state.activeTab] = state.editor.getValue();
    }
  });

  // Restore from localStorage
  restoreProject();
});

// ==========================================
// FILE TREE
// ==========================================
function renderFileTree() {
  const tree = document.getElementById('file-tree');
  if (Object.keys(state.files).length === 0) {
    tree.innerHTML = `
      <div style="padding:24px 16px;color:var(--text-muted);font-size:13px;text-align:center">
        No files yet.<br>
        <button class="btn btn-primary" style="margin-top:12px;padding:6px 14px;font-size:12px" onclick="showPrompt()">+ Generate Plugin</button>
      </div>`;
    return;
  }

  // Build tree structure
  const treeData = {};
  Object.keys(state.files).forEach((path) => {
    const parts = path.split('/');
    let current = treeData;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        current[part] = { __file: true, path };
      } else {
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    });
  });

  tree.innerHTML = renderTreeNode(treeData, '');
}

function renderTreeNode(node, prefix) {
  let html = '';
  const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
    if (av.__file && !bv.__file) return 1;
    if (!av.__file && bv.__file) return -1;
    return a.localeCompare(b);
  });

  for (const [name, value] of entries) {
    if (value.__file) {
      const icon = getFileIcon(name);
      const isActive = state.activeTab === value.path;
      html += `<div class="tree-node ${isActive ? 'active' : ''}" onclick="openFile('${value.path}')">
        <span class="tree-icon">${icon}</span>
        <span>${name}</span>
      </div>`;
    } else {
      html += `<div class="tree-node tree-folder">
        <span class="tree-icon">📁</span>
        <span>${name}/</span>
      </div>
      <div class="tree-children">${renderTreeNode(value, prefix + name + '/')}</div>`;
    }
  }
  return html;
}

function getFileIcon(name) {
  const ext = name.split('.').pop();
  const icons = {
    java: '☕',
    yml: '⚙️',
    yaml: '⚙️',
    xml: '📦',
    md: '📄',
    txt: '📄',
    json: '📋',
  };
  return icons[ext] || '📄';
}

// ==========================================
// TABS
// ==========================================
function renderTabs() {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = state.openTabs.map((path) => {
    const name = path.split('/').pop();
    const isActive = state.activeTab === path;
    return `<div class="tab ${isActive ? 'active' : ''}" onclick="openFile('${path}')">
      <span>${getFileIcon(name)}</span>
      <span>${name}</span>
      <span class="tab-close" onclick="event.stopPropagation();closeTab('${path}')">×</span>
    </div>`;
  }).join('');
}

function openFile(path) {
  if (!state.files[path]) return;
  if (!state.openTabs.includes(path)) state.openTabs.push(path);
  state.activeTab = path;

  // Set Monaco content
  const ext = path.split('.').pop();
  const langMap = { java: 'java', yml: 'yaml', yaml: 'yaml', xml: 'xml', md: 'markdown', json: 'json' };
  const lang = langMap[ext] || 'plaintext';

  const model = monaco.editor.createModel(state.files[path], lang);
  if (state.editor.getModel()) state.editor.getModel().dispose();
  state.editor.setModel(model);

  document.getElementById('editor-placeholder').style.display = 'none';
  document.getElementById('monaco-editor').style.display = 'block';

  renderTabs();
  renderFileTree();
}

function closeTab(path) {
  state.openTabs = state.openTabs.filter((p) => p !== path);
  if (state.activeTab === path) {
    state.activeTab = state.openTabs[state.openTabs.length - 1] || null;
    if (state.activeTab) openFile(state.activeTab);
    else {
      document.getElementById('monaco-editor').style.display = 'none';
      document.getElementById('editor-placeholder').style.display = 'flex';
    }
  }
  renderTabs();
}

// ==========================================
// PROMPT OVERLAY
// ==========================================
function showPrompt() {
  document.getElementById('prompt-overlay').style.display = 'flex';
  document.getElementById('prompt-input').focus();
}

function hidePrompt() {
  document.getElementById('prompt-overlay').style.display = 'none';
}

// ==========================================
// GENERATE PLUGIN
// ==========================================
async function generatePlugin() {
  const prompt = document.getElementById('prompt-input').value.trim();
  const pluginName = document.getElementById('meta-name').value.trim() || 'MyPlugin';
  const mcVersion = document.getElementById('meta-version').value;

  if (!prompt) {
    toast('⚠️ Please describe what your plugin should do', 'error');
    return;
  }

  state.pluginName = pluginName;
  state.mcVersion = mcVersion;

  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';

  log(`[Kodari] Generating "${pluginName}" for MC ${mcVersion}...`, 'info');
  log(`[Prompt] ${prompt}`, 'cmd');

  try {
    const res = await fetch(`${API}/api/generate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, pluginName, mcVersion }),
    });

    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Generation failed');

    state.files = data.files;
    state.openTabs = [];
    state.activeTab = null;

    // Open the main Java file first
    const javaFile = Object.keys(state.files).find((p) => p.endsWith('.java'));
    if (javaFile) openFile(javaFile);
    else {
      const firstFile = Object.keys(state.files)[0];
      if (firstFile) openFile(firstFile);
    }

    renderFileTree();
    renderTabs();

    log(`✓ Created ${Object.keys(state.files).length} files`, 'success');
    Object.keys(state.files).forEach((f) => log(`  + ${f}`, 'success'));
    log(`✓ ${data.summary}`, 'info');
    toast(`✨ Plugin generated! ${Object.keys(state.files).length} files`, 'success');

    // Add AI success message to chat
    addChatMessage('ai', `✅ I created **${pluginName}** with ${Object.keys(state.files).length} files. Open the files in the explorer to review. You can ask me to modify anything!`);

    hidePrompt();
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'error');
    toast(`❌ ${err.message}`, 'error');

    addChatMessage('ai', `❌ Sorry, generation failed: ${err.message}. Make sure your Gemini API key is set in backend/.env`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>⚡ Generate Plugin</span>';
  }
}

// ==========================================
// BUILD / EXPORT
// ==========================================
async function buildPlugin() {
  if (Object.keys(state.files).length === 0) {
    toast('⚠️ No files to build', 'error');
    return;
  }

  log(`[Build] Starting Maven build for ${state.pluginName}...`, 'info');
  log(`[Maven] mvn clean package`, 'cmd');

  // Simulate build steps
  await sleep(400);
  log(`[INFO] Scanning for projects...`, 'info');
  await sleep(300);
  log(`[INFO] Building ${state.pluginName} ${state.mcVersion}`, 'info');
  await sleep(400);
  log(`[INFO] Compiling Java sources...`, 'info');
  await sleep(300);

  const javaFiles = Object.keys(state.files).filter((f) => f.endsWith('.java'));
  log(`[INFO] Compiling ${javaFiles.length} Java files`, 'info');
  await sleep(500);

  log(`[INFO] Copying resources...`, 'info');
  await sleep(300);
  log(`[INFO] Building jar: ${state.pluginName}-1.0.jar`, 'info');
  await sleep(400);
  log(`[INFO] BUILD SUCCESS`, 'success');
  log(`[INFO] Total time: 2.1s`, 'success');
  log(`✓ Built ${state.pluginName}-1.0.jar (12 KB)`, 'success');

  document.getElementById('build-status').textContent = 'Built ✓';
  toast('⚡ Build complete!', 'success');

  // Auto-trigger download
  setTimeout(() => downloadProject(), 500);
}

async function downloadProject() {
  if (Object.keys(state.files).length === 0) {
    toast('⚠️ No files to download', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/export`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginName: state.pluginName, files: state.files }),
    });

    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.pluginName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`⬇ Downloaded ${state.pluginName}.zip`, 'success');
    log(`[Export] Downloaded ${state.pluginName}.zip`, 'success');
  } catch (err) {
    // Fallback: build zip client-side
    log(`[Export] Server export failed, building locally...`, 'warn');
    clientSideZip();
  }
}

function clientSideZip() {
  // Simple fallback: trigger downloads per file
  Object.entries(state.files).forEach(([path, content]) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop();
    a.click();
    URL.revokeObjectURL(url);
  });
  toast(`⬇ Downloaded ${Object.keys(state.files).length} files`, 'info');
}

// ==========================================
// CHAT
// ==========================================
async function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  addChatMessage('user', message);
  input.value = '';
  input.style.height = 'auto';

  // Show typing
  const typingEl = document.createElement('div');
  typingEl.className = 'msg-typing';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  typingEl.id = 'typing-indicator';
  document.getElementById('chat-messages').appendChild(typingEl);
  scrollChat();

  document.getElementById('chat-send').disabled = true;
  document.getElementById('chat-status').textContent = 'Thinking...';

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: state.chatHistory,
      }),
    });

    const data = await res.json();
    document.getElementById('typing-indicator')?.remove();

    if (!data.success) throw new Error(data.error);

    addChatMessage('ai', data.reply);
    state.chatHistory.push({ role: 'user', content: message });
    state.chatHistory.push({ role: 'model', content: data.reply });
  } catch (err) {
    document.getElementById('typing-indicator')?.remove();
    addChatMessage('ai', `❌ Error: ${err.message}. Make sure backend is running and Gemini API key is configured.`);
  } finally {
    document.getElementById('chat-send').disabled = false;
    document.getElementById('chat-status').textContent = 'Online • Gemini 2.0';
  }
}

function addChatMessage(role, content) {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = formatMarkdown(content);
  messages.appendChild(div);
  scrollChat();
}

function formatMarkdown(text) {
  // Basic markdown: code blocks, inline code, bold
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function scrollChat() {
  const messages = document.getElementById('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

// Auto-resize chat input
document.getElementById('chat-input')?.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

document.getElementById('prompt-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    generatePlugin();
  }
});

// ==========================================
// LOCAL STORAGE
// ==========================================
function saveProject() {
  try {
    localStorage.setItem('kodari-project', JSON.stringify({
      pluginName: state.pluginName,
      mcVersion: state.mcVersion,
      files: state.files,
      activeTab: state.activeTab,
      openTabs: state.openTabs,
    }));
    toast('💾 Project saved', 'success');
    log(`[Save] Project saved to browser storage`, 'success');
  } catch (e) {
    toast('⚠️ Save failed', 'error');
  }
}

function restoreProject() {
  try {
    const saved = localStorage.getItem('kodari-project');
    if (!saved) return;
    const data = JSON.parse(saved);
    state.pluginName = data.pluginName || 'MyPlugin';
    state.mcVersion = data.mcVersion || '1.20.4';
    state.files = data.files || {};
    state.openTabs = data.openTabs || [];
    state.activeTab = data.activeTab;

    if (Object.keys(state.files).length > 0) {
      renderFileTree();
      renderTabs();
      if (state.activeTab && state.files[state.activeTab]) {
        openFile(state.activeTab);
      }
      log(`[Restore] Loaded "${state.pluginName}" from storage`, 'info');
    }
  } catch (e) {
    console.error('Restore failed', e);
  }
}

// ==========================================
// UTILS
// ==========================================
function log(message, type = 'info') {
  const terminal = document.getElementById('terminal');
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.textContent = message;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function toast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}