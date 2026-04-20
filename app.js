const SUPABASE_URL  = 'https://fvsrvwfpdplrxsoeenrs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2c3J2d2ZwZHBscnhzb2VlbnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQyOTYsImV4cCI6MjA5MjI1MDI5Nn0.mcWh9V29mWFkX0DiJ4rH7uVnPDp0wf4bHtnCBHELbx4';
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const API      = `${SUPABASE_URL}/rest/v1/todos`;
const PUSH_API = `${SUPABASE_URL}/rest/v1/push_subscriptions`;
const INTEGRATIONS_API = `${SUPABASE_URL}/rest/v1/user_integrations`;
const VAPID_PUBLIC_KEY = 'BGudk1z57su_bqV0NYdmm7aL6gVD02XwaU8CvCcudd4WVppOBF_CzW-9JF_ytMa3P8LjyA5zqu9Y7WLStpzX9CM';

let session       = null;
let todos         = [];
let currentFilter = 'all';
let editingId     = null;

// ── DOM refs ──────────────────────────────────────────────
const authScreen       = document.getElementById('auth-screen');
const appScreen        = document.getElementById('app-screen');
const authForm         = document.getElementById('auth-form');
const authEmail        = document.getElementById('auth-email');
const authPassword     = document.getElementById('auth-password');
const authSubmitBtn    = document.getElementById('auth-submit-btn');
const authMessage      = document.getElementById('auth-message');
const authTabs         = document.querySelectorAll('.auth-tab');
const userEmailDisplay = document.getElementById('user-email-display');
const notifyBtn        = document.getElementById('notify-btn');
const logoutBtn        = document.getElementById('logout-btn');
const todoInput        = document.getElementById('todo-input');
const todoDue          = document.getElementById('todo-due');
const todoRemind       = document.getElementById('todo-remind');
const addBtn           = document.getElementById('add-btn');
const list             = document.getElementById('todo-list');
const remaining        = document.getElementById('remaining');
const clearBtn         = document.getElementById('clear-btn');
const filterBtns       = document.querySelectorAll('.filter-btn');
const editModal        = document.getElementById('edit-modal');
const modalText        = document.getElementById('modal-text');
const modalDue         = document.getElementById('modal-due');
const modalRemind      = document.getElementById('modal-remind');
const modalSaveBtn     = document.getElementById('modal-save-btn');
const modalCancelBtn   = document.getElementById('modal-cancel-btn');

// ── Helpers ───────────────────────────────────────────────
function apiHeaders(token) {
  return {
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${token || SUPABASE_ANON}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

function showMessage(text, type = 'error') {
  authMessage.textContent = text;
  authMessage.className   = `auth-message ${type}`;
  authMessage.classList.remove('hidden');
}

function clearMessage() { authMessage.classList.add('hidden'); }

// ── Due date helpers ──────────────────────────────────────
function dueBadge(dueAt) {
  if (!dueAt) return null;
  const diff = new Date(dueAt) - new Date();
  const abs  = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const hrs  = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);

  if (diff < 0) return { label: 'Gecikti', cls: 'overdue' };
  if (diff < 3600000)   return { label: `${mins} dk kaldı`,  cls: 'soon' };
  if (diff < 86400000)  return { label: `${hrs} saat kaldı`, cls: hrs < 3 ? 'soon' : 'ok' };
  return { label: `${days} gün kaldı`, cls: 'ok' };
}

function remindLabel(mins) {
  if (!mins) return null;
  if (mins < 60)   return `${mins} dk önce`;
  if (mins < 1440) return `${mins / 60} saat önce`;
  if (mins < 10080) return `${mins / 1440} gün önce`;
  return `${mins / 10080} hafta önce`;
}

function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── .ics export ───────────────────────────────────────────
function downloadIcs(todo) {
  const start = new Date(todo.due_at);
  const end   = new Date(start.getTime() + 60 * 60000);
  const fmt   = d => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Todo App//TR',
    'BEGIN:VEVENT',
    `UID:${todo.id}@todo-app`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${todo.text}`,
    ...(todo.remind_before_minutes
      ? [`BEGIN:VALARM`, `TRIGGER:-PT${todo.remind_before_minutes}M`, `ACTION:DISPLAY`, `DESCRIPTION:Hatırlatma`, `END:VALARM`]
      : []),
    'END:VEVENT', 'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${todo.text.slice(0, 30)}.ics`;
  a.click();
}

// ── Auth ──────────────────────────────────────────────────
function parseHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  return Object.fromEntries(hash.split('&').map(p => p.split('=').map(decodeURIComponent)));
}

async function handleHashCallback(params) {
  if (!params?.access_token) return false;
  history.replaceState(null, '', window.location.pathname);
  const res  = await fetch(`${AUTH_URL}/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${params.access_token}` }
  });
  const user = await res.json();
  if (!res.ok) return false;
  saveSession({ access_token: params.access_token, refresh_token: params.refresh_token,
    token_type: params.token_type || 'bearer', expires_in: Number(params.expires_in),
    expires_at: Number(params.expires_at), user });
  // Google OAuth callback: save provider tokens
  if (params.provider_token) {
    // Save after session is set (startApp sets session)
    window._pendingGoogleToken = { access: params.provider_token, refresh: params.provider_refresh_token };
  }
  return true;
}

let currentTab = 'login';

authTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    authTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    authSubmitBtn.textContent = currentTab === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
    clearMessage();
  });
});

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = authEmail.value.trim(), password = authPassword.value;
  authSubmitBtn.disabled = true;
  clearMessage();
  try {
    if (currentTab === 'register') {
      const res  = await fetch(`${AUTH_URL}/signup`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) { showMessage(data.msg || data.error_description || 'Kayıt başarısız.'); return; }
      showMessage('Kayıt başarılı! Lütfen e-postanıza gelen onay bağlantısına tıklayın.', 'success');
      authPassword.value = '';
    } else {
      const res  = await fetch(`${AUTH_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) { showMessage(data.error_description || 'Giriş başarısız.'); return; }
      saveSession(data);
      startApp();
    }
  } catch { showMessage('Bağlantı hatası, lütfen tekrar deneyin.'); }
  finally   { authSubmitBtn.disabled = false; }
});

function saveSession(data) {
  session = data;
  localStorage.setItem('sb_session', JSON.stringify(data));
}

function loadSession() {
  const raw = localStorage.getItem('sb_session');
  return raw ? JSON.parse(raw) : null;
}

function clearSession() { session = null; localStorage.removeItem('sb_session'); }

async function logout() {
  if (session?.access_token) {
    await fetch(`${AUTH_URL}/logout`, { method: 'POST', headers: apiHeaders(session.access_token) }).catch(() => {});
  }
  clearSession();
  todos = [];
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  authEmail.value = ''; authPassword.value = ''; clearMessage();
}

logoutBtn.addEventListener('click', logout);

// ── Service Worker + Push Notifications ──────────────────
let swReg = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('/todo-app/sw.js');
  } catch (e) { console.warn('SW register failed', e); }
}

function initNotifyBtn() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  notifyBtn.classList.remove('hidden');
  if (Notification.permission === 'granted') {
    notifyBtn.classList.add('enabled');
    notifyBtn.title = 'Bildirimler açık';
  }
  notifyBtn.addEventListener('click', requestPushPermission);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function requestPushPermission() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  notifyBtn.classList.add('enabled');
  notifyBtn.title = 'Bildirimler açık';

  try {
    if (!swReg) swReg = await navigator.serviceWorker.ready;
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const subJson = sub.toJSON();
    await fetch(PUSH_API, {
      method: 'POST',
      headers: { ...apiHeaders(session.access_token), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: session.user.id,
        endpoint: subJson.endpoint,
        p256dh:   subJson.keys?.p256dh   ?? '',
        auth:     subJson.keys?.auth     ?? '',
      }),
    });
  } catch (e) { console.warn('Push subscribe failed', e); }
}

// ── Google Calendar ───────────────────────────────────────
async function linkGoogleCalendar() {
  const { data, error } = await fetch(`${AUTH_URL}/authorize?provider=google&scopes=${encodeURIComponent('email profile https://www.googleapis.com/auth/calendar.events')}&redirect_to=${encodeURIComponent(window.location.origin + '/todo-app/')}&access_type=offline&prompt=consent`, {
    method: 'GET', headers: { apikey: SUPABASE_ANON }
  }).then(r => r.json()).catch(() => ({ data: null, error: 'fetch failed' }));

  // Supabase JS SDK flow: redirect to Google OAuth
  const url = `${AUTH_URL}/authorize?provider=google&scopes=${encodeURIComponent('email profile https://www.googleapis.com/auth/calendar.events')}&redirect_to=${encodeURIComponent(window.location.origin + '/todo-app/')}&query_params=${encodeURIComponent('access_type=offline&prompt=consent')}`;
  window.location.href = url;
}

async function saveGoogleTokens(providerToken, providerRefreshToken) {
  if (!providerToken) return;
  await fetch(INTEGRATIONS_API, {
    method: 'POST',
    headers: { ...apiHeaders(session.access_token), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: session.user.id,
      google_access_token: providerToken,
      google_refresh_token: providerRefreshToken || null,
      google_expires_at: new Date(Date.now() + 3600000).toISOString(),
    }),
  });
}

async function syncToCalendar(todoId, action) {
  await fetch(`${SUPABASE_URL}/functions/v1/sync-to-calendar`, {
    method: 'POST',
    headers: { ...apiHeaders(session.access_token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ todo_id: todoId, action }),
  }).catch(() => {});
}

async function hasGoogleCalendar() {
  const res = await fetch(`${INTEGRATIONS_API}?user_id=eq.${session.user.id}&select=google_access_token`, {
    headers: apiHeaders(session.access_token),
  });
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 && !!data[0].google_access_token;
}

// ── App ───────────────────────────────────────────────────
function startApp() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  userEmailDisplay.textContent = session.user?.email || '';
  registerSW();
  initNotifyBtn();
  initGoogleBtn();
  fetchTodos();
  setInterval(() => render(), 60000);
}

function initGoogleBtn() {
  const gcalBtn = document.getElementById('gcal-btn');
  if (!gcalBtn) return;
  // Save pending Google tokens from OAuth callback
  if (window._pendingGoogleToken) {
    saveGoogleTokens(window._pendingGoogleToken.access, window._pendingGoogleToken.refresh);
    window._pendingGoogleToken = null;
  }
  hasGoogleCalendar().then(linked => {
    gcalBtn.classList.remove('hidden');
    if (linked) {
      gcalBtn.classList.add('enabled');
      gcalBtn.title = 'Google Calendar bağlı';
      gcalBtn.textContent = '📅';
    }
  });
  gcalBtn.addEventListener('click', () => {
    if (!gcalBtn.classList.contains('enabled')) linkGoogleCalendar();
  });
}

async function fetchTodos() {
  const res = await fetch(`${API}?order=created_at.desc`, { headers: apiHeaders(session.access_token) });
  const data = await res.json();
  todos = Array.isArray(data) ? data : [];
  render();
}

async function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  const due    = todoDue.value ? new Date(todoDue.value).toISOString() : null;
  const remind = todoRemind.value ? Number(todoRemind.value) : null;
  todoInput.value = ''; todoDue.value = ''; todoRemind.value = '';
  const res = await fetch(API, {
    method: 'POST',
    headers: apiHeaders(session.access_token),
    body: JSON.stringify({ text, done: false, user_id: session.user.id, due_at: due, remind_before_minutes: remind })
  });
  const [created] = await res.json();
  if (created?.id && due) syncToCalendar(created.id, 'create');
  await fetchTodos();
}

async function toggleTodo(id, done) {
  await fetch(`${API}?id=eq.${id}`, {
    method: 'PATCH', headers: apiHeaders(session.access_token), body: JSON.stringify({ done })
  });
  await fetchTodos();
}

async function deleteTodo(id) {
  syncToCalendar(id, 'delete');
  await fetch(`${API}?id=eq.${id}`, { method: 'DELETE', headers: apiHeaders(session.access_token) });
  await fetchTodos();
}

async function clearCompleted() {
  await fetch(`${API}?done=eq.true&user_id=eq.${session.user.id}`, {
    method: 'DELETE', headers: apiHeaders(session.access_token)
  });
  await fetchTodos();
}

// ── Edit Modal ────────────────────────────────────────────
function openModal(todo) {
  editingId         = todo.id;
  modalText.value   = todo.text;
  modalDue.value    = toDatetimeLocal(todo.due_at);
  modalRemind.value = todo.remind_before_minutes || '';
  editModal.classList.remove('hidden');
  modalText.focus();
}

function closeModal() {
  editModal.classList.add('hidden');
  editingId = null;
}

modalCancelBtn.addEventListener('click', closeModal);
editModal.addEventListener('click', e => { if (e.target === editModal) closeModal(); });

modalSaveBtn.addEventListener('click', async () => {
  if (!editingId) return;
  const text   = modalText.value.trim();
  if (!text) return;
  const due    = modalDue.value ? new Date(modalDue.value).toISOString() : null;
  const remind = modalRemind.value ? Number(modalRemind.value) : null;
  await fetch(`${API}?id=eq.${editingId}`, {
    method: 'PATCH',
    headers: apiHeaders(session.access_token),
    body: JSON.stringify({ text, due_at: due, remind_before_minutes: remind,
      reminded_email: false, reminded_push: false })
  });
  if (due) syncToCalendar(editingId, 'update');
  closeModal();
  await fetchTodos();
});

// ── Render ────────────────────────────────────────────────
function render() {
  const filtered = todos.filter(t => {
    if (currentFilter === 'active')    return !t.done;
    if (currentFilter === 'completed') return t.done;
    if (currentFilter === 'upcoming')  return !t.done && t.due_at && new Date(t.due_at) > new Date();
    return true;
  });

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-msg">Görev yok.</p>';
  } else {
    filtered.forEach(todo => {
      const badge = dueBadge(todo.due_at);
      const isOverdue = badge?.cls === 'overdue';
      const isSoon    = badge?.cls === 'soon';

      const li = document.createElement('li');
      li.className = 'todo-item'
        + (todo.done      ? ' completed' : '')
        + (isOverdue && !todo.done ? ' overdue'  : '')
        + (isSoon    && !todo.done ? ' due-soon' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.className = 'todo-checkbox'; checkbox.checked = todo.done;
      checkbox.addEventListener('change', () => toggleTodo(todo.id, checkbox.checked));

      const body = document.createElement('div');
      body.className = 'todo-body';

      const span = document.createElement('span');
      span.className = 'todo-text'; span.textContent = todo.text;

      const meta = document.createElement('div');
      meta.className = 'todo-meta';

      if (badge) {
        const bd = document.createElement('span');
        bd.className = `due-badge ${badge.cls}`;
        bd.textContent = badge.label;
        meta.appendChild(bd);
      }

      if (todo.due_at) {
        const dateStr = new Date(todo.due_at).toLocaleString('tr-TR', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        const dateLbl = document.createElement('span');
        dateLbl.className = 'remind-badge'; dateLbl.textContent = dateStr;
        meta.appendChild(dateLbl);
      }

      if (todo.remind_before_minutes) {
        const rl = document.createElement('span');
        rl.className = 'remind-badge'; rl.textContent = `🔔 ${remindLabel(todo.remind_before_minutes)}`;
        meta.appendChild(rl);
      }

      if (todo.due_at) {
        const icsBtn = document.createElement('button');
        icsBtn.className = 'ics-btn'; icsBtn.textContent = '📅 Takvime ekle';
        icsBtn.addEventListener('click', () => downloadIcs(todo));
        meta.appendChild(icsBtn);
      }

      body.append(span);
      if (meta.children.length) body.append(meta);

      const actions = document.createElement('div');
      actions.className = 'todo-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn'; editBtn.title = 'Düzenle'; editBtn.innerHTML = '&#x270E;';
      editBtn.addEventListener('click', () => openModal(todo));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn'; deleteBtn.title = 'Sil'; deleteBtn.innerHTML = '&#x2715;';
      deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

      actions.append(editBtn, deleteBtn);
      li.append(checkbox, body, actions);
      list.appendChild(li);
    });
  }

  const activeCount = todos.filter(t => !t.done).length;
  remaining.textContent = `${activeCount} görev kaldı`;
}

addBtn.addEventListener('click', addTodo);
todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
clearBtn.addEventListener('click', clearCompleted);

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

// ── Bootstrap ─────────────────────────────────────────────
(async () => {
  const hash = parseHash();
  if (hash?.access_token) {
    const ok = await handleHashCallback(hash);
    if (ok) { startApp(); return; }
  }
  const stored = loadSession();
  if (stored?.access_token) { session = stored; startApp(); }
})();
