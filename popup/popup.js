/* HappyClaw Knowledge Collector - Popup Script */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let categories = [];
let clips = [];
let clipsFilter = null; // category_id or null for all
let editingClipId = null;
let selectedColor = '#F57F28';
let currentTab = null;
let selectedText = '';
let settingsSaveTimer = null;

const CLIPS_PAGE_SIZE = 30;

// ─── Init ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initPopup();
  bindEvents();
});

async function initPopup() {
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab) {
    $('#page-title').textContent = tab.title || '未知页面';
    $('#page-url').textContent = tab.url || '';
  }

  // Get selected text from content script
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    });
    if (result && result.result) {
      selectedText = result.result.trim();
      if (selectedText) {
        $('#selection-preview').style.display = 'block';
        $('#selection-text').textContent = selectedText;
      }
    }
  } catch (_) {
    // Content script may not be available on some pages
  }

  // Check connection status and load categories
  await checkConnectionAndLoad();
}

async function checkConnectionAndLoad() {
  const config = await getConfig();
  if (!config.serverUrl || !config.apiToken) {
    updateStatus('disconnected', '未配置');
    $('#categories-list').innerHTML = '<div class="empty-state">请先在设置中配置服务器</div>';
    return;
  }

  try {
    categories = await apiCall('GET', '/api/knowledge/categories');
    updateStatus('connected', '已连接');
    renderCategories();
    renderCategorySelect();
    await loadClips();
  } catch (err) {
    updateStatus('error', '连接失败');
    $('#categories-list').innerHTML = `<div class="empty-state">连接失败: ${err.message}</div>`;
    $('#clips-list').innerHTML = '';
  }
}

async function loadClips() {
  const list = $('#clips-list');
  list.innerHTML = '<div class="loading">加载中...</div>';
  const label = $('#clips-filter-label');
  if (clipsFilter) {
    const cat = categories.find((c) => c.id === clipsFilter);
    label.textContent = cat ? `分类: ${cat.name}` : '分类筛选';
    label.classList.add('active');
  } else {
    label.textContent = '全部';
    label.classList.remove('active');
  }

  try {
    const qs = new URLSearchParams({ limit: String(CLIPS_PAGE_SIZE), offset: '0' });
    if (clipsFilter) qs.set('category_id', clipsFilter);
    clips = await apiCall('GET', `/api/knowledge/clips?${qs.toString()}`);
    renderClips();
  } catch (err) {
    list.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

// ─── Events ─────────────────────────────────────────────────────────

function bindEvents() {
  // View switching
  $('#btn-settings').addEventListener('click', () => switchView('settings'));
  $('#btn-back').addEventListener('click', () => switchView('main'));

  // Quick save
  $('#btn-quick-save').addEventListener('click', handleQuickSave);

  // Category form
  $('#btn-add-category').addEventListener('click', () => {
    const form = $('#category-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  $('#btn-cancel-cat').addEventListener('click', () => {
    $('#category-form').style.display = 'none';
    resetCategoryForm();
  });
  $('#btn-save-cat').addEventListener('click', handleCreateCategory);

  // Color picker
  $$('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      $$('.color-dot').forEach((d) => d.classList.remove('selected'));
      dot.classList.add('selected');
      selectedColor = dot.dataset.color;
    });
  });

  // Clips list
  $('#btn-refresh-clips').addEventListener('click', () => loadClips());
  $('#clips-filter-label').addEventListener('click', () => {
    if (clipsFilter) {
      clipsFilter = null;
      loadClips();
    }
  });

  // Settings
  $('#btn-save-settings').addEventListener('click', handleSaveSettings);
  $('#btn-test-conn').addEventListener('click', handleTestConnection);
  $('#btn-toggle-token').addEventListener('click', () => {
    const input = $('#api-token');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Auto-save on input so switching tabs to copy a token doesn't lose
  // what the user has already typed. The popup closes when it loses focus.
  $('#server-url').addEventListener('input', scheduleAutoSave);
  $('#api-token').addEventListener('input', scheduleAutoSave);

  // Load saved settings into form when switching to settings
  $('#btn-settings').addEventListener('click', loadSettingsForm);
}

// Strip common SPA routes users accidentally paste (e.g.
// `https://claw.example.com/chat` → `https://claw.example.com`).
// Request URL would otherwise become `/chat/api/...` and get caught by
// the SPA fallback, returning HTML instead of JSON.
const SPA_PATH_SUFFIXES = [
  '/chat', '/settings', '/login', '/register', '/setup',
  '/monitor', '/tasks', '/memory', '/skills', '/users',
  '/mcp-servers', '/groups',
];

function normalizeServerUrl(raw) {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  const lower = url.toLowerCase();
  for (const suffix of SPA_PATH_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      url = url.slice(0, url.length - suffix.length);
      break;
    }
    // Also strip paths like /chat/anything
    const idx = lower.indexOf(suffix + '/');
    if (idx !== -1) {
      url = url.slice(0, idx);
      break;
    }
  }
  return url.replace(/\/+$/, '');
}

function scheduleAutoSave() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    const rawUrl = $('#server-url').value;
    const serverUrl = normalizeServerUrl(rawUrl);
    // If we trimmed something, reflect it back to the field so the user sees
    // the actual URL being saved (avoids silent path-strip surprises).
    if (serverUrl && serverUrl !== rawUrl.trim().replace(/\/+$/, '')) {
      $('#server-url').value = serverUrl;
    }
    const apiToken = $('#api-token').value.trim();
    await chrome.storage.local.set({ serverUrl, apiToken });
    const hint = $('#autosave-hint');
    if (hint) {
      hint.textContent = '✓ 已自动保存';
      hint.classList.add('autosave-ok');
      setTimeout(() => {
        hint.textContent = '输入会自动保存，切换标签页去复制 Token 不会丢';
        hint.classList.remove('autosave-ok');
      }, 1500);
    }
  }, 300);
}

function switchView(view) {
  if (view === 'settings') {
    $('#main-view').style.display = 'none';
    $('#settings-view').style.display = 'block';
    loadSettingsForm();
  } else {
    $('#settings-view').style.display = 'none';
    $('#main-view').style.display = 'block';
    checkConnectionAndLoad();
  }
}

// ─── Quick Save ─────────────────────────────────────────────────────

async function handleQuickSave() {
  const btn = $('#btn-quick-save');
  const categoryId = $('#category-select').value;
  const tagsRaw = $('#tags-input').value.trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];

  if (!currentTab) {
    showToast('无法获取当前页面信息', 'error');
    return;
  }

  const sourceType = selectedText ? 'selection' : 'full_page';
  const content = selectedText || currentTab.title || '';

  const clip = {
    title: currentTab.title || '未命名',
    url: currentTab.url || '',
    content,
    category_id: categoryId || null,
    tags,
    source_type: sourceType,
  };

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    await apiCall('POST', '/api/knowledge/clips', clip);
    showToast('保存成功', 'success');
    // Clear selection preview after save
    selectedText = '';
    $('#selection-preview').style.display = 'none';
    $('#tags-input').value = '';
    // Refresh saved-clips list so the new entry shows up immediately
    await loadClips();
  } catch (err) {
    showToast(`保存失败: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17,21 17,13 7,13 7,21"/>
        <polyline points="7,3 7,8 15,8"/>
      </svg>
      保存`;
  }
}

// ─── Categories ─────────────────────────────────────────────────────

function renderCategories() {
  const list = $('#categories-list');
  if (categories.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无分类，点击 + 创建</div>';
    return;
  }

  list.innerHTML = categories
    .map(
      (cat) => `
    <div class="category-item" data-id="${cat.id}">
      <span class="cat-color" style="background:${cat.color || '#F57F28'}"></span>
      <div class="cat-info">
        <div class="cat-name">${escapeHtml(cat.name)}</div>
        <div class="cat-meta">${cat.description ? escapeHtml(cat.description) + ' · ' : ''}${cat.clip_count || 0} 条</div>
      </div>
      <div class="cat-actions">
        <button class="btn-danger btn-delete-cat" data-id="${cat.id}" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>`
    )
    .join('');

  // Bind delete events
  list.querySelectorAll('.btn-delete-cat').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const cat = categories.find((c) => c.id === id);
      if (!confirm(`确认删除分类「${cat?.name || ''}」？`)) return;
      try {
        await apiCall('DELETE', `/api/knowledge/categories/${id}`);
        showToast('分类已删除', 'info');
        await checkConnectionAndLoad();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, 'error');
      }
    });
  });

  // Click category to select it in dropdown AND filter saved clips by it
  list.querySelectorAll('.category-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      $('#category-select').value = id;
      list.querySelectorAll('.category-item').forEach((i) => i.classList.remove('selected'));
      item.classList.add('selected');
      clipsFilter = id;
      loadClips();
    });
  });
}

// ─── Saved Clips ────────────────────────────────────────────────────

function renderClips() {
  const list = $('#clips-list');
  if (!clips || clips.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无收藏</div>';
    return;
  }

  list.innerHTML = clips
    .map((clip) => {
      const isEditing = clip.id === editingClipId;
      const tagText = (clip.tags || []).join(', ');
      const catOptions = ['<option value="">（未分类）</option>']
        .concat(
          categories.map(
            (c) =>
              `<option value="${c.id}"${clip.category_id === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`,
          ),
        )
        .join('');
      const urlLine = clip.url
        ? `<a class="clip-url" href="${escapeAttr(clip.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(clip.url)}</a>`
        : '';
      const meta = [
        clip.category_name ? `<span class="clip-tag clip-cat">${escapeHtml(clip.category_name)}</span>` : '',
        ...(clip.tags || []).map((t) => `<span class="clip-tag">#${escapeHtml(t)}</span>`),
      ]
        .filter(Boolean)
        .join(' ');

      if (isEditing) {
        return `
    <div class="clip-item editing" data-id="${clip.id}">
      <input type="text" class="input clip-edit-title" value="${escapeAttr(clip.title)}" placeholder="标题" maxlength="500">
      <select class="input clip-edit-category">${catOptions}</select>
      <input type="text" class="input clip-edit-tags" value="${escapeAttr(tagText)}" placeholder="标签（逗号分隔）">
      <textarea class="input clip-edit-summary" placeholder="摘要（可选）" rows="2" maxlength="5000">${escapeHtml(clip.summary || '')}</textarea>
      <div class="form-actions">
        <button class="btn btn-ghost btn-cancel-clip" data-id="${clip.id}">取消</button>
        <button class="btn btn-primary btn-save-clip" data-id="${clip.id}">保存</button>
      </div>
    </div>`;
      }

      return `
    <div class="clip-item" data-id="${clip.id}">
      <div class="clip-main">
        <div class="clip-title" title="${escapeAttr(clip.title)}">${escapeHtml(clip.title)}</div>
        ${urlLine}
        ${meta ? `<div class="clip-meta">${meta}</div>` : ''}
      </div>
      <div class="clip-actions">
        <button class="icon-btn btn-edit-clip" data-id="${clip.id}" title="编辑">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-danger btn-delete-clip" data-id="${clip.id}" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
    })
    .join('');

  list.querySelectorAll('.btn-edit-clip').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingClipId = btn.dataset.id;
      renderClips();
    }),
  );
  list.querySelectorAll('.btn-cancel-clip').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingClipId = null;
      renderClips();
    }),
  );
  list.querySelectorAll('.btn-save-clip').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSaveClipEdit(btn.dataset.id);
    }),
  );
  list.querySelectorAll('.btn-delete-clip').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteClip(btn.dataset.id);
    }),
  );
}

async function handleDeleteClip(id) {
  const clip = clips.find((c) => c.id === id);
  if (!confirm(`确认删除「${clip?.title || '此条'}」？会同时删除 Markdown 镜像文件。`)) return;
  try {
    await apiCall('DELETE', `/api/knowledge/clips/${id}`);
    // Sync local state so the deleted entry disappears immediately — avoids
    // showing stale records before the next refresh.
    clips = clips.filter((c) => c.id !== id);
    if (editingClipId === id) editingClipId = null;
    renderClips();
    // Categories show clip_count; refresh them too.
    try {
      categories = await apiCall('GET', '/api/knowledge/categories');
      renderCategories();
      renderCategorySelect();
    } catch (_) {}
    showToast('已删除', 'info');
  } catch (err) {
    showToast(`删除失败: ${err.message}`, 'error');
  }
}

async function handleSaveClipEdit(id) {
  const item = document.querySelector(`.clip-item.editing[data-id="${id}"]`);
  if (!item) return;
  const title = item.querySelector('.clip-edit-title').value.trim();
  if (!title) {
    showToast('标题不能为空', 'error');
    return;
  }
  const category_id = item.querySelector('.clip-edit-category').value || null;
  const tagsRaw = item.querySelector('.clip-edit-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];
  const summary = item.querySelector('.clip-edit-summary').value.trim();

  try {
    const updated = await apiCall('PATCH', `/api/knowledge/clips/${id}`, {
      title,
      category_id,
      tags,
      summary: summary || undefined,
    });
    // Merge updated fields into local state
    const idx = clips.findIndex((c) => c.id === id);
    if (idx !== -1) {
      const catName = categories.find((c) => c.id === updated.category_id)?.name || null;
      clips[idx] = { ...clips[idx], ...updated, category_name: catName };
    }
    editingClipId = null;
    renderClips();
    showToast('已更新', 'success');
  } catch (err) {
    showToast(`保存失败: ${err.message}`, 'error');
  }
}

function renderCategorySelect() {
  const select = $('#category-select');
  const currentVal = select.value;
  select.innerHTML = '<option value="">选择分类...</option>' +
    categories
      .map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`)
      .join('');
  if (currentVal && categories.some((c) => c.id === currentVal)) {
    select.value = currentVal;
  }
}

async function handleCreateCategory() {
  const name = $('#cat-name').value.trim();
  if (!name) {
    showToast('请输入分类名称', 'error');
    return;
  }

  const desc = $('#cat-desc').value.trim();
  const btn = $('#btn-save-cat');
  btn.disabled = true;

  try {
    await apiCall('POST', '/api/knowledge/categories', {
      name,
      description: desc || null,
      color: selectedColor,
    });
    showToast('分类已创建', 'success');
    $('#category-form').style.display = 'none';
    resetCategoryForm();
    await checkConnectionAndLoad();
  } catch (err) {
    showToast(`创建失败: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function resetCategoryForm() {
  $('#cat-name').value = '';
  $('#cat-desc').value = '';
  $$('.color-dot').forEach((d) => d.classList.remove('selected'));
  $$('.color-dot')[0]?.classList.add('selected');
  selectedColor = '#F57F28';
}

// ─── Settings ───────────────────────────────────────────────────────

async function loadSettingsForm() {
  const config = await getConfig();
  $('#server-url').value = config.serverUrl || '';
  $('#api-token').value = config.apiToken || '';
}

async function handleSaveSettings() {
  const serverUrl = normalizeServerUrl($('#server-url').value);
  $('#server-url').value = serverUrl;
  const apiToken = $('#api-token').value.trim();

  if (!serverUrl) {
    showToast('请输入服务器地址', 'error');
    return;
  }

  await chrome.storage.local.set({
    serverUrl,
    apiToken,
  });

  showToast('设置已保存', 'success');

  // Notify background script to refresh context menu
  chrome.runtime.sendMessage({ type: 'settings_updated' });
}

async function handleTestConnection() {
  const serverUrl = normalizeServerUrl($('#server-url').value);
  $('#server-url').value = serverUrl;
  const apiToken = $('#api-token').value.trim();
  const resultEl = $('#conn-result');
  const btn = $('#btn-test-conn');

  if (!serverUrl) {
    showToast('请输入服务器地址', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 测试中...';
  resultEl.style.display = 'none';

  try {
    const resp = await fetch(`${serverUrl}/api/health`, {
      method: 'GET',
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
    });

    const ctype = resp.headers.get('content-type') || '';
    if (resp.ok && ctype.includes('application/json')) {
      resultEl.className = 'conn-result success';
      resultEl.textContent = '连接成功! 服务器运行正常。';
    } else if (resp.ok && !ctype.includes('application/json')) {
      resultEl.className = 'conn-result error';
      resultEl.textContent = '地址可能错了：服务器返回的是网页而不是 API。请确认只填根域名（如 https://example.com），不要带 /chat、/settings 等页面路径。';
    } else {
      resultEl.className = 'conn-result error';
      resultEl.textContent = `连接失败: HTTP ${resp.status}`;
    }
  } catch (err) {
    resultEl.className = 'conn-result error';
    resultEl.textContent = `连接失败: ${err.message}`;
  } finally {
    resultEl.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
        <polyline points="22,4 12,14.01 9,11.01"/>
      </svg>
      测试连接`;
  }
}

// ─── API Client ─────────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.local.get(['serverUrl', 'apiToken']);
  return {
    serverUrl: data.serverUrl || '',
    apiToken: data.apiToken || '',
  };
}

async function apiCall(method, path, body) {
  const config = await getConfig();
  if (!config.serverUrl) {
    throw new Error('未配置服务器地址');
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiToken) {
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }

  const opts = {
    method,
    headers,
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${config.serverUrl}${path}`, opts);
  const ctype = resp.headers.get('content-type') || '';

  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const errData = await resp.json();
      if (errData.error) msg = errData.error;
    } catch (_) {}
    throw new Error(msg);
  }

  // Guard against SPA fallback / misconfigured reverse proxy returning HTML.
  if (!ctype.includes('application/json')) {
    throw new Error('服务器返回了网页而不是 API。请在扩展设置里把服务器地址改为根域名（去掉 /chat 等路径）');
  }

  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ─── UI Helpers ─────────────────────────────────────────────────────

function updateStatus(state, title) {
  const dot = $('#status-dot');
  dot.className = `status-dot ${state}`;
  dot.title = title;
}

function showToast(message, type = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
