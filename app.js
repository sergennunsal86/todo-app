const SUPABASE_URL = 'https://fvsrvwfpdplrxsoeenrs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2c3J2d2ZwZHBscnhzb2VlbnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQyOTYsImV4cCI6MjA5MjI1MDI5Nn0.mcWh9V29mWFkX0DiJ4rH7uVnPDp0wf4bHtnCBHELbx4';

const API = `${SUPABASE_URL}/rest/v1/todos`;
const HEADERS = {
  'apikey': SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

let todos = [];
let currentFilter = 'all';

const input = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const list = document.getElementById('todo-list');
const remaining = document.getElementById('remaining');
const clearBtn = document.getElementById('clear-btn');
const filterBtns = document.querySelectorAll('.filter-btn');

async function fetchTodos() {
  const res = await fetch(`${API}?order=created_at.desc`, { headers: HEADERS });
  todos = await res.json();
  render();
}

async function addTodo() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await fetch(API, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ text, done: false })
  });
  await fetchTodos();
}

async function toggleTodo(id, done) {
  await fetch(`${API}?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ done })
  });
  await fetchTodos();
}

async function updateTodoText(id, text) {
  if (!text.trim()) return;
  await fetch(`${API}?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ text: text.trim() })
  });
  await fetchTodos();
}

async function deleteTodo(id) {
  await fetch(`${API}?id=eq.${id}`, { method: 'DELETE', headers: HEADERS });
  await fetchTodos();
}

async function clearCompleted() {
  await fetch(`${API}?done=eq.true`, { method: 'DELETE', headers: HEADERS });
  await fetchTodos();
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  const cancel = () => fetchTodos();

  saveBtn.addEventListener('click', save);
  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  });
}

function render() {
  const filtered = todos.filter(t => {
    if (currentFilter === 'active') return !t.done;
    if (currentFilter === 'completed') return t.done;
    return true;
  });

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty-msg">Görev yok.</p>';
    const activeCount = todos.filter(t => !t.done).length;
    remaining.textContent = `${activeCount} görev kaldı`;
    return;
  }

  filtered.forEach(todo => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (todo.done ? ' completed' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-checkbox';
    checkbox.checked = todo.done;
    checkbox.addEventListener('change', () => toggleTodo(todo.id, checkbox.checked));

    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = todo.text;
    span.addEventListener('dblclick', () => startEdit(li, todo));

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.title = 'Düzenle';
    editBtn.innerHTML = '&#x270E;';
    editBtn.addEventListener('click', () => startEdit(li, todo));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = 'Sil';
    deleteBtn.innerHTML = '&#x2715;';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

    li.append(checkbox, span, editBtn, deleteBtn);
    list.appendChild(li);
  });

  const activeCount = todos.filter(t => !t.done).length;
  remaining.textContent = `${activeCount} görev kaldı`;
}

addBtn.addEventListener('click', addTodo);
input.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
clearBtn.addEventListener('click', clearCompleted);

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

fetchTodos();
