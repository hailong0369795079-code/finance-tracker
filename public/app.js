document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

let socket;
let allData = [];
let reminders = [];
let doughnutChart = null;
let currentCalDate = new Date();

async function initApp() {
  // 1. Khởi tạo kết nối Socket.io real-time
  socket = io();

  // 2. Lắng nghe sự kiện real-time từ server
  socket.on('new_transaction', (tx) => {
    allData.unshift(tx);
    updateUI();
  });

  socket.on('delete_transaction', (id) => {
    allData = allData.filter(t => t._id !== id);
    updateUI();
  });

  socket.on('new_reminder', (r) => {
    reminders.push(r);
    updateUI();
  });

  socket.on('delete_reminder', (id) => {
    reminders = reminders.filter(r => r._id !== id);
    updateUI();
  });

  // 3. Gắn sự kiện submit form thêm giao dịch
  const addForm = document.getElementById('addForm');
  if (addForm) {
    addForm.addEventListener('submit', handleAddTransaction);
  }

  // 4. Gắn sự kiện chuyển tháng trên lịch
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  if (prevBtn) prevBtn.addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() - 1); renderCalendar(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() + 1); renderCalendar(); });

  // 5. Tải toàn bộ dữ liệu ban đầu từ Server
  await loadAllData();
}

async function loadAllData() {
  try {
    const [resTx, resRem] = await Promise.all([
      fetch('/api/transactions'),
      fetch('/api/reminders')
    ]);
    
    if (resTx.ok) allData = await resTx.json();
    if (resRem.ok) reminders = await resRem.json();
  } catch (err) {
    console.error("Lỗi khi tải dữ liệu từ server:", err);
  }
  updateUI();
}

function updateUI() {
  renderTable();
  renderCharts();
  renderCalendar();
  renderReminders();
}

// --- XỬ LÝ GIAO DỊCH ---
function renderTable() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (allData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">Chưa có giao dịch nào.</td></tr>`;
    return;
  }

  allData.forEach(tx => {
    const isChi = tx.type === 'CHI' || !tx.type;
    const typeClass = isChi ? 'chi' : (tx.type === 'THU' ? 'thu' : 'dautu');
    const formattedAmount = new Intl.NumberFormat('vi-VN').format(tx.amount) + ' đ';
    
    let timeStr = '';
    if (tx.createdAt) {
      const d = new Date(tx.createdAt);
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    }

    tbody.innerHTML += `
      <tr>
        <td><span class="badge ${typeClass}">${tx.type || 'CHI'}</span></td>
        <td>${escapeHtml(tx.note || '')}</td>
        <td>${escapeHtml(tx.category || 'Khác')}</td>
        <td style="font-size:11px; color:#787b86;">${escapeHtml(tx.source || 'BOT')}</td>
        <td class="${isChi ? 'text-chi' : 'text-thu'}">${isChi ? '-' : '+'}${formattedAmount}</td>
        <td>${timeStr}</td>
        <td><button class="action-btn delete" onclick="deleteTx('${tx._id}')" title="Xóa">🗑️</button></td>
      </tr>
    `;
  });
}

async function handleAddTransaction(e) {
  e.preventDefault();
  const amountInput = document.getElementById('f_amount');
  const typeInput = document.getElementById('f_type');
  const categoryInput = document.getElementById('f_category');
  const noteInput = document.getElementById('f_note');

  if (!amountInput || !categoryInput || !noteInput) return;

  const payload = {
    amount: parseFloat(amountInput.value),
    type: typeInput ? typeInput.value : 'CHI',
    category: categoryInput.value.trim(),
    note: noteInput.value.trim()
  };

  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      document.getElementById('addForm').reset();
    } else {
      alert('Không thể lưu giao dịch.');
    }
  } catch (err) {
    console.error('Lỗi khi thêm giao dịch:', err);
  }
}

async function deleteTx(id) {
  if (confirm('Bạn có chắc chắn muốn xóa giao dịch này?')) {
    try {
      await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Lỗi khi xóa giao dịch:', err);
    }
  }
}

// --- XỬ LÝ BIỂU ĐỒ ---
function renderCharts() {
  let categories = {};
  allData.forEach(tx => {
    if (tx.type === 'CHI' || !tx.type) {
      categories[tx.category] = (categories[tx.category] || 0) + tx.amount;
    }
  });

  const canvasEl = document.getElementById('doughnutChart');
  if (!canvasEl) return;
  const dCtx = canvasEl.getContext('2d');
  
  if (doughnutChart) doughnutChart.destroy();

  const labels = Object.keys(categories);
  const dataVals = Object.values(categories);

  doughnutChart = new Chart(dCtx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['Chưa có dữ liệu'],
      datasets: [{
        data: dataVals.length ? dataVals : [1],
        backgroundColor: ['#ef5350', '#ab47bc', '#42a5f5', '#ffca28', '#26a69a', '#ec407a', '#7e57c2'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#d1d4dc', font: { size: 11 } } }
      },
      cutout: '70%'
    }
  });
}

// --- XỬ LÝ LỊCH & NHẮC HẸN ---
function renderCalendar() {
  const titleEl = document.getElementById('calendarTitle');
  const daysContainer = document.getElementById('calendarDays');
  if (!titleEl || !daysContainer) return;

  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  titleEl.innerText = `Tháng ${month + 1} / ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  
  daysContainer.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    daysContainer.innerHTML += `<div class="day-cell empty"></div>`;
  }

  for (let date = 1; date <= lastDate; date++) {
    const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    const isToday = date === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const hasReminder = reminders.some(r => r.date === fullDateStr);
    
    let cls = 'day-cell';
    if (isToday) cls += ' today';
    if (hasReminder) cls += ' has-reminder';

    daysContainer.innerHTML += `<div class="${cls}" title="${fullDateStr}">${date}</div>`;
  }
}

function renderReminders() {
  const listContainer = document.getElementById('reminderList');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  if (reminders.length === 0) {
    listContainer.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding: 10px;">Không có lịch hẹn thanh toán.</div>`;
    return;
  }

  const sortedReminders = [...reminders].sort((a, b) => new Date(a.date) - new Date(b.date));

  sortedReminders.forEach(item => {
    const fmtDate = item.date ? item.date.split('-').reverse().join('/') : '';
    const formattedAmount = new Intl.NumberFormat('vi-VN').format(item.amount) + ' đ';

    listContainer.innerHTML += `
      <div class="reminder-item">
        <div class="reminder-info">
          <span style="font-weight: 600; color: #fff;">${escapeHtml(item.title)}</span>
          <span class="reminder-date">⏰ ${fmtDate} - <span style="color:var(--c-chi); font-weight:bold;">${formattedAmount}</span></span>
        </div>
        <button class="reminder-del" onclick="deleteReminder('${item._id}')" title="Xóa">🗑️</button>
      </div>
    `;
  });
}

async function addReminderPrompt() {
  const title = prompt("Tên khoản thanh toán (VD: Tiền nhà, Tiền điện):");
  if (!title) return;
  const amountInput = prompt("Số tiền (VNĐ):", "500000");
  if (amountInput === null) return;
  const amount = parseFloat(amountInput) || 0;
  const date = prompt("Ngày hạn (Định dạng YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
  if (!date) return;

  try {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, amount, date })
    });
    if (!res.ok) {
      alert('Không thể thêm lịch nhắc!');
    }
  } catch (err) {
    console.error('Lỗi khi thêm nhắc hẹn:', err);
  }
}

async function deleteReminder(id) {
  if (confirm('Bạn có muốn xóa lịch hẹn này không?')) {
    try {
      await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Lỗi khi xóa nhắc hẹn:', err);
    }
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}