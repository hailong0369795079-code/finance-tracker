const socket = io();
let allTransactions = [];
let allReminders = [];
let currentDate = new Date();

document.addEventListener('DOMContentLoaded', () => {
  fetchData();
  renderCalendar();
});

async function fetchData() {
  try {
    const resTx = await fetch('/api/transactions');
    allTransactions = await resTx.json();
    renderTransactions(allTransactions);

    const resRem = await fetch('/api/reminders');
    allReminders = await resRem.json();
    renderReminders(allReminders);
    renderCalendar();
  } catch (err) {
    console.error("Lỗi tải dữ liệu:", err);
  }
}

function renderTransactions(transactions) {
  const list = document.getElementById('transaction-list');
  list.innerHTML = '';

  let totalChi = 0;
  transactions.forEach(tx => {
    if (tx.type === 'CHI') totalChi += tx.amount;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(tx.createdAt).toLocaleString('vi-VN')}</td>
      <td><strong>${tx.category}</strong> <span style="font-size:0.75rem; background:var(--border); padding:2px 6px; border-radius:4px;">${tx.source || 'WEB'}</span></td>
      <td>${tx.note || ''}</td>
      <td style="color: ${tx.type === 'CHI' ? 'var(--c-chi)' : 'var(--c-thu)'}; font-weight: bold;">
        ${tx.type === 'CHI' ? '-' : '+'}${tx.amount.toLocaleString('vi-VN')} VNĐ
      </td>
      <td><button onclick="deleteTx('${tx._id}')" style="background:none; border:none; color:var(--c-chi); cursor:pointer;">Xóa</button></td>
    `;
    list.appendChild(row);
  });

  document.getElementById('total-spent').innerText = `${totalChi.toLocaleString('vi-VN')} VNĐ`;
}

function renderReminders(reminders) {
  const list = document.getElementById('reminder-list');
  list.innerHTML = '';

  const pendingReminders = reminders.filter(r => !r.isPaid);

  if (pendingReminders.length === 0) {
    list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 10px;">Không có khoản hẹn nào sắp tới 🎉</div>';
    return;
  }

  pendingReminders.forEach(rem => {
    const dueDateStr = new Date(rem.dueDate).toLocaleDateString('vi-VN');
    const item = document.createElement('div');
    item.className = 'reminder-item';
    item.innerHTML = `
      <div>
        <strong>${rem.title}</strong><br>
        <small style="color: var(--text-muted);">Hạn: ${dueDateStr} - <b>${rem.amount.toLocaleString('vi-VN')} VNĐ</b></small>
      </div>
      <button class="btn-pay" onclick="payReminder('${rem._id}')">✅ Xác nhận chi</button>
    `;
    list.appendChild(item);
  });
}

async function payReminder(id) {
  if (confirm('Xác nhận bạn đã thanh toán khoản này? Tiền sẽ được ghi nhận vào giao dịch thực tế và trừ vào chi tiêu.')) {
    const res = await fetch(`/api/reminders/${id}/pay`, { method: 'POST' });
    if (res.ok) {
      fetchData();
    } else {
      alert('Có lỗi xảy ra khi xác nhận thanh toán!');
    }
  }
}

function changeMonth(direction) {
  currentDate.setMonth(currentDate.getMonth() + direction);
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const monthYearLabel = document.getElementById('calendar-month-year');
  
  while (grid.children.length > 7) {
    grid.removeChild(grid.lastChild);
  }

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  monthYearLabel.innerText = `Tháng ${month + 1} / ${year}`;

  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    grid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-date';
    cell.innerText = day;

    if (year === today.getFullYear() && month === today.getMonth() && day === today.getDate()) {
      cell.classList.add('today');
    }

    const hasRem = allReminders.some(r => {
      const rDate = new Date(r.dueDate);
      return !r.isPaid && rDate.getFullYear() === year && rDate.getMonth() === month && rDate.getDate() === day;
    });

    if (hasRem) {
      cell.classList.add('has-reminder');
    }

    grid.appendChild(cell);
  }
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    amount: parseFloat(document.getElementById('f_amount').value),
    type: document.getElementById('f_type').value,
    category: document.getElementById('f_category').value,
    note: document.getElementById('f_note').value
  };
  
  await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('addForm').reset();
});

async function deleteTx(id) {
  if(confirm('Xóa giao dịch này?')) {
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  }
}

socket.on('new_transaction', (tx) => { allTransactions.unshift(tx); renderTransactions(allTransactions); });
socket.on('delete_transaction', (id) => { allTransactions = allTransactions.filter(t => t._id !== id); renderTransactions(allTransactions); });
socket.on('reminder_updated', () => { fetchData(); });