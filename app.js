const SUPABASE_URL  = 'https://fvsrvwfpdplrxsoeenrs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2c3J2d2ZwZHBscnhzb2VlbnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQyOTYsImV4cCI6MjA5MjI1MDI5Nn0.mcWh9V29mWFkX0DiJ4rH7uVnPDp0wf4bHtnCBHELbx4';
const AUTH_URL      = `${SUPABASE_URL}/auth/v1`;
const API           = `${SUPABASE_URL}/rest/v1/todos`;

let session       = null;
let todos         = [];
let currentFilter = 'all';

// ── DOM refs ──────────────────────────────────────────────
const authScreen      = document.getElementById('auth-screen');
const appScreen       = document.getElementById('app-screen');
const authForm        = document.getElementById('auth-form');
const authEmail       = document.getElementById('auth-email');
const authPassword    = document.getElementById('auth-password');
const authSubmitBtn   = document.getElementById('auth-submit-btn');
const authMessage     = document.getElementById('auth-message');
const authTabs        = document.querySelectorAll('.auth-tab');
const userEmailDisplay = document.getElementById('user-email-display');
const logoutBtn       = document.getElementById('logout-btn');
const todoInput       = document.getElementById('todo-input');
const addBtn          = document.getElementById('add-btn');
const list            = document.getElementById('todo-list');
const remaining       = document.getElementById('remaining');
const clearBtn        = document.getElementById('clear-btn');
const filterBtns      = document.querySelectorAll('.filter-btn');

// ── Auth helpers ──────────────────────────────────────────
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

function clearMessage() {
  authMessage.classList.add('hidden');
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
  const email    = authEmail.value.trim();
  const password = authPassword.value;

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
  } catch {
    showMessage('Bağlantı hatası, lütfen tekrar deneyin.');
  } finally {
    authSubmitBtn.disabled = false;
  }
});

function saveSession(data) {
  session = data;
  localStorage.setItem('sb_session', JSON.stringify(data));
}

function loadSession() {
  const raw = localStorage.getItem('sb_session');
  if (!raw) return null;
  return JSON.parse(raw);
}

function clearSession() {
  session = null;
  localStorage.removeItem('sb_session');
}

async function logout() {
  if (session?.access_token) {
    await fetch(`${AUTH_URL}/logout`, {
      method: 'POST',
      headers: apiHeaders(session.access_token)
    }).catch(() => {});
  }
  clearSession();
  todos = [];
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  authEmail.value = '';
  authPassword.value = '';
  clearMessage();
}

logoutBtn.addEventListener('click', logout);

// ── App ──────────────────────────────────────────────────
function startApp() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  userEmailDisplay.textContent = session.user?.email || '';
  fetchTodos();
}

async function fetchTodos() {
  const res = await fetch(`${API}?order=created_at.desc`, { headers: apiHeaders(session.access_token) });
  todos = await res.json();
  if (!Array.isArray(todos)) todos = [];
  render();
}

async function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  todoInput.value = '';
  await fetch(API, {
    method: 'POST',
    headers: apiHeaders(session.access_token),
    body: JSON.stringify({ text, done: false, user_id: session.user.id })
  });
  await fetchTodos();
}

async function toggleTodo(id, done) {
  await fetch(`${API}?id=eq.${id}`, {
    method: 'PATCH',
    headers: apiHeaders(session.access_token),
    body: JSON.stringify({ done })
  });
  await fetchTodos();
}

async function updateTodoText(id, text) {
  if (!text.trim()) return;
  await fetch(`${API}?id=eq.${id}`, {
    method: 'PATCH',
    headers: apiHeaders(session.access_token),
    body: JSON.stringify({ text: text.trim() })
  });
  await fetchTodos();
}

async function deleteTodo(id) {
  await fetch(`${API}?id=eq.${id}`, { method: 'DELETE', headers: apiHeaders(session.access_token) });
  await fetchTodos();
}

async function clearCompleted() {
  await fetch(`${API}?done=eq.true&user_id=eq.${session.user.id}`, {
    method: 'DELETE',
    headers: apiHeaders(session.access_token)
  });
  await fetchTodos();
}

function startEdit(li, todo) {
  if (li.classList.contains('editing')) return;
  li.classList.add('editing');

  const span = li.querySelector('.todo-text');
  const editInput = document.createElement('input');
  editInput.className = 'edit-input';
  editInput.value = todo.text;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Kaydet';

  span.after(editInput);
  editInput.after(saveBtn);
  editInput.focus();
  editInput.select();

  const save = () => updateTodoText(todo.id, editInput.value);
  saveBtn.addEventListener('click', save);
  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') fetchTodos();
  });
}

function render() {
  const filtered = todos.filter(t => {
    if (currentFilter === 'active')    return !t.done;
    if (currentFilter === 'completed') return t.done;
    return true;
  });

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-msg">Görev yok.</p>';
  } else {
    filtered.forEach(todo => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (todo.done ? ' completed' : '');

      const checkbox = document.createElement('input');
      checkbox.type      = 'checkbox';
      checkbox.className = 'todo-checkbox';
      checkbox.checked   = todo.done;
      checkbox.addEventListener('change', () => toggleTodo(todo.id, checkbox.checked));

      const span = document.createElement('span');
      span.className   = 'todo-text';
      span.textContent = todo.text;
      span.addEventListener('dblclick', () => startEdit(li, todo));

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.title     = 'Düzenle';
      editBtn.innerHTML = '&#x270E;';
      editBtn.addEventListener('click', () => startEdit(li, todo));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.title     = 'Sil';
      deleteBtn.innerHTML = '&#x2715;';
      deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

      li.append(checkbox, span, editBtn, deleteBtn);
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
const stored = loadSession();
if (stored?.access_token) {
  session = stored;
  startApp();
}
