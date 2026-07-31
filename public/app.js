const socket = io();
let allTransactions = [];
let allReminders = [];
let currentDate = new Date();

// ==================== LOCALSTORAGE FUNCTIONS ====================

function saveToLocalStorage() {
  localStorage.setItem('transactions', JSON.stringify(allTransactions));
  localStorage.setItem('reminders', JSON.stringify(allReminders));
  console.log('💾 Dữ liệu đã lưu vào bộ nhớ');
}

function loadFromLocalStorage() {
  try {
    const savedTx = localStorage.getItem('transactions');
    const savedRem = localStorage.getItem('reminders');
    
    if (savedTx) allTransactions = JSON.parse(savedTx);
    if (savedRem) allReminders = JSON.parse(savedRem);
    
    if (savedTx || savedRem) {
      console.log('✅ Đã load dữ liệu từ bộ nhớ cũ');
      return true;
    }
  } catch (err) {
    console.error('Lỗi load localStorage:', err);
  }
  return false;
}

// ==================== FETCH DATA ====================

document.addEventListener('DOMContentLoaded', () => {
  // Cố load từ localStorage trước
  const hasLocalData = loadFromLocalStorage();
  
  // Sau đó try fetch từ API
  fetchData();
  
  // Auto-save mỗi 5 giây
  setInterval(saveToLocalStorage, 5000);
  
  // Auto-refresh mỗi 10 giây (backup nếu socket không sync)
  setInterval(() => {
    fetchData();
  }, 10000);
});

async function fetchData() {
  try {
    const resTx = await fetch('/api/transactions');
    if (!resTx.ok) throw new Error('API transactions failed');
    allTransactions = await resTx.json();
    renderTransactions(allTransactions);
    saveToLocalStorage();

    const resRem = await fetch('/api/reminders');
    if (!resRem.ok) throw new Error('API reminders failed');
    allReminders = await resRem.json();
    renderReminders(allReminders);
    renderCalendar();
    saveToLocalStorage();
    
    console.log('✅ Dữ liệu từ API được load thành công');
  } catch (err) {
    console.error("Lỗi tải dữ liệu từ API:", err);
    
    // Nếu API fail nhưng có data cũ → giữ data cũ
    if (allTransactions.length > 0 || allReminders.length > 0) {
      console.log('⚠️ Dùng dữ liệu từ bộ nhớ (API không kết nối)');
      renderTransactions(allTransactions);
      renderReminders(allReminders);
      renderCalendar();
      return;
    }
    
    // Nếu không có data cũ → show demo
    console.log('📭 Không có dữ liệu, hiển thị demo');
    allTransactions = [
      {
        _id: '1',
        telegramUserId: 0,
        amount: 35000,
        type: 'CHI',
        category: 'Ăn sáng',
        note: 'Cơm gà',
        source: 'BOT',
        createdAt: new Date()
      },
      {
        _id: '2',
        telegramUserId: 0,
        amount: 50000,
        type: 'CHI',
        category: 'Xăng xe',
        note: 'Đi làm',
        source: 'WEB',
        createdAt: new Date(Date.now() - 3600000)
      },
      {
        _id: '3',
        telegramUserId: 0,
        amount: 500000,
        type: 'CHI',
        category: 'Tiền nhà',
        note: 'Tháng 8',
        source: 'WEB',
        createdAt: new Date(Date.now() - 86400000)
      }
    ];
    
    allReminders = [
      {
        _id: '1',
        title: 'Tiền điện',
        amount: 200000,
        dueDate: new Date(Date.now() + 86400000 * 3),
        isPaid: false
      },
      {
        _id: '2',
        title: 'Tiền nước',
        amount: 100000,
        dueDate: new Date(Date.now() + 86400000 * 5),
        isPaid: false
      }
    ];
    
    renderTransactions(allTransactions);
    renderReminders(allReminders);
    renderCalendar();
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
    list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 5px;">Không có lịch hẹn sắp tới 🎉</div>';
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
      <div>
        <button class="btn-pay" onclick="payReminder('${rem._id}')">✅ Chi</button>
        <button onclick="deleteReminder('${rem._id}')" style="background:none; border:none; color:var(--c-chi); cursor:pointer; margin-left:5px;">✕</button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function payReminder(id) {
  if (confirm('Xác nhận thanh toán khoản này? Tiền sẽ được trừ vào chi tiêu thực tế.')) {
    try {
      const res = await fetch(`/api/reminders/${id}/pay`, { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Lỗi thanh toán:', err);
      // Local update
      allReminders = allReminders.map(r => r._id === id ? { ...r, isPaid: true } : r);
      renderReminders(allReminders);
      saveToLocalStorage();
    }
  }
}

async function deleteReminder(id) {
  if (confirm('Xóa lịch hẹn này?')) {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Lỗi xóa nhắc hẹn:', err);
      // Local delete
      allReminders = allReminders.filter(r => r._id !== id);
      renderReminders(allReminders);
      saveToLocalStorage();
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
    grid.appendChild(document.createElement('div'));
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
  
  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (res.ok) {
      const newTx = await res.json();
      allTransactions.unshift(newTx);
      document.getElementById('addForm').reset();
      renderTransactions(allTransactions);
      saveToLocalStorage();
    }
  } catch (err) {
    console.error('Lỗi thêm giao dịch:', err);
    // Local add
    const newTx = {
      _id: Date.now().toString(),
      ...body,
      source: 'LOCAL',
      createdAt: new Date()
    };
    allTransactions.unshift(newTx);
    document.getElementById('addForm').reset();
    renderTransactions(allTransactions);
    saveToLocalStorage();
  }
});

document.getElementById('reminderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: document.getElementById('r_title').value,
    amount: parseFloat(document.getElementById('r_amount').value),
    dueDate: document.getElementById('r_date').value
  };

  try {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (res.ok) {
      const newRem = await res.json();
      allReminders.unshift(newRem);
      document.getElementById('reminderForm').reset();
      renderReminders(allReminders);
      renderCalendar();
      saveToLocalStorage();
    }
  } catch (err) {
    console.error('Lỗi thêm nhắc hẹn:', err);
    // Local add
    const newRem = {
      _id: Date.now().toString(),
      ...body,
      isPaid: false
    };
    allReminders.unshift(newRem);
    document.getElementById('reminderForm').reset();
    renderReminders(allReminders);
    renderCalendar();
    saveToLocalStorage();
  }
});

async function deleteTx(id) {
  if (confirm('Xóa giao dịch này?')) {
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Lỗi xóa giao dịch:', err);
      // Local delete
      allTransactions = allTransactions.filter(t => t._id !== id);
      renderTransactions(allTransactions);
      saveToLocalStorage();
    }
  }
}

// ==================== SOCKET LISTENERS ====================

socket.on('connect', () => {
  console.log('✅ Socket connected');
  fetchData();
});

socket.on('new_transaction', (tx) => {
  console.log('📝 New transaction:', tx);
  fetchData();
});

socket.on('delete_transaction', (id) => {
  console.log('🗑️ Transaction deleted:', id);
  fetchData();
});

socket.on('reminder_updated', () => {
  console.log('📅 Reminder updated');
  fetchData();
});

socket.on('budget_updated', () => {
  console.log('💰 Budget updated');
  fetchData();
});

socket.on('disconnect', () => {
  console.log('❌ Socket disconnected');
});