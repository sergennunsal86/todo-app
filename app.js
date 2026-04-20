let todos = JSON.parse(localStorage.getItem('todos') || '[]');
let currentFilter = 'all';

const input = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const list = document.getElementById('todo-list');
const remaining = document.getElementById('remaining');
const clearBtn = document.getElementById('clear-btn');
const filterBtns = document.querySelectorAll('.filter-btn');

function save() {
  localStorage.setItem('todos', JSON.stringify(todos));
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
  } else {
    filtered.forEach(todo => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (todo.done ? ' completed' : '');
      li.innerHTML = `
        <input class="todo-checkbox" type="checkbox" ${todo.done ? 'checked' : ''} data-id="${todo.id}" />
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <button class="delete-btn" data-id="${todo.id}" title="Sil">&#x2715;</button>
      `;
      list.appendChild(li);
    });
  }

  const activeCount = todos.filter(t => !t.done).length;
  remaining.textContent = `${activeCount} görev kaldı`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addTodo() {
  const text = input.value.trim();
  if (!text) return;
  todos.unshift({ id: Date.now(), text, done: false });
  input.value = '';
  save();
  render();
}

list.addEventListener('change', e => {
  if (e.target.classList.contains('todo-checkbox')) {
    const id = Number(e.target.dataset.id);
    const todo = todos.find(t => t.id === id);
    if (todo) { todo.done = e.target.checked; save(); render(); }
  }
});

list.addEventListener('click', e => {
  if (e.target.classList.contains('delete-btn')) {
    const id = Number(e.target.dataset.id);
    todos = todos.filter(t => t.id !== id);
    save();
    render();
  }
});

addBtn.addEventListener('click', addTodo);
input.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

clearBtn.addEventListener('click', () => {
  todos = todos.filter(t => !t.done);
  save();
  render();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

render();
