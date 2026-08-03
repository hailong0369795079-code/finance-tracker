const socket = io();
let allTransactions = [];
let allReminders = [];
let currentDate = new Date();
let financeChartInstance = null; // Biến lưu trữ biểu đồ

// ==================== TÍNH NĂNG MỚI: ĐỒNG HỒ & LỊCH ÂM ====================
function startLiveClock() {
  const clockEl = document.getElementById('clock-display');
  const solarEl = document.getElementById('solar-display');
  const lunarEl = document.getElementById('lunar-display');
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

  function updateTime() {
    const now = new Date();
    // Đồng hồ
    clockEl.innerText = now.toLocaleTimeString('vi-VN', { hour12: false });
    
    // Nếu là giây số 0 hoặc chưa có ngày thì cập nhật lịch
    if (now.getSeconds() === 0 || solarEl.innerText === 'Đang tải...') {
      solarEl.innerText = `${days[now.getDay()]}, ${now.toLocaleDateString('vi-VN')}`;
      
      try {
        // Dùng thư viện lunar-javascript
        const lunar = Lunar.fromDate(now);
        lunarEl.innerText = `Âm Lịch: ${lunar.getDay()}/${lunar.getMonth()} (${lunar.getYearInGanZhi()})`;
      } catch (e) {
        lunarEl.innerText = '';
      }
    }
  }
  updateTime(); // Chạy ngay lần đầu
  setInterval(updateTime, 1000); // Lặp lại mỗi 1 giây
}

// ==================== HÀM VẼ BIỂU ĐỒ (ĐÃ FIX HIỂN THỊ) ====================
function updateFinanceChart(transactions) {
  const canvas = document.getElementById('financeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const last7Days = [];
  const chiData = [0, 0, 0, 0, 0, 0, 0];
  const thuData = [0, 0, 0, 0, 0, 0, 0];

  // Lấy 7 ngày gần nhất
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Phân loại data
  transactions.forEach(tx => {
    if (!tx.createdAt) return;
    const txDate = new Date(tx.createdAt);
    const dateStr = `${String(txDate.getDate()).padStart(2, '0')}/${String(txDate.getMonth() + 1).padStart(2, '0')}`;
    const index = last7Days.indexOf(dateStr);
    
    if (index !== -1) {
      if (tx.type === 'CHI') chiData[index] += tx.amount;
      else if (tx.type === 'THU') thuData[index] += tx.amount;
    }
  });

  try {
    if (financeChartInstance) {
      financeChartInstance.data.labels = last7Days;
      financeChartInstance.data.datasets[0].data = chiData;
      financeChartInstance.data.datasets[1].data = thuData;
      financeChartInstance.update();
    } else {
      financeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: last7Days,
          datasets: [
            { label: 'Chi Tiêu (VNĐ)', data: chiData, borderColor: '#ef5350', backgroundColor: 'rgba(239, 83, 80, 0.1)', borderWidth: 2, tension: 0.3, fill: true },
            { label: 'Thu Nhập (VNĐ)', data: thuData, borderColor: '#26a69a', backgroundColor: 'rgba(38, 166, 154, 0.1)', borderWidth: 2, tension: 0.3, fill: true }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false, // 🔥 FIX LỖI TÀNG HÌNH BIỂU ĐỒ
          plugins: { legend: { labels: { color: '#d1d4dc' } } },
          scales: {
            x: { ticks: { color: '#787b86' }, grid: { color: '#2a2e39' } },
            y: { ticks: { color: '#787b86' }, grid: { color: '#2a2e39' }, beginAtZero: true }
          }
        }
      });
    }
  } catch (e) {
    console.error("Lỗi vẽ biểu đồ:", e);
  }
}

// ==================== CÁC HÀM XỬ LÝ NÚT BẤM (ĐÃ FIX LỖI KHÔNG XÓA ĐƯỢC) ====================

async function deleteReminder(id) {
  if (confirm('Xóa lịch hẹn này?')) {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('API chưa sẵn sàng'); // Ép văng lỗi để chạy Catch bên dưới
      fetchData();
    } catch (err) {
      // 🔥 Xóa mạnh ở LocalStorage nếu API bị lỗi
      allReminders = allReminders.filter(r => String(r._id) !== String(id));
      renderReminders(allReminders);
      saveToLocalStorage();
    }
  }
}

async function payReminder(id, title, amount) {
  if (confirm(`Bạn xác nhận đã thanh toán: ${title} (${amount.toLocaleString('vi-VN')} VNĐ)?\n\nHệ thống sẽ tự động trừ vào chi tiêu thực tế.`)) {
    try {
      const res = await fetch(`/api/reminders/${id}/pay`, { method: 'POST' });
      if (!res.ok) throw new Error('API chưa sẵn sàng');
      fetchData();
      alert(`✅ Đã ghi nhận chi tiêu: ${title}`);
    } catch (err) {
      // 🔥 Xử lý mạnh ở Local nếu API bị lỗi
      allReminders = allReminders.map(r => String(r._id) === String(id) ? { ...r, isPaid: true } : r);
      
      const newLocalTx = {
        _id: Date.now().toString(),
        telegramUserId: 0, amount: amount, type: 'CHI', category: title,
        note: 'Thanh toán từ lịch hẹn', source: 'WEB', createdAt: new Date()
      };
      allTransactions.unshift(newLocalTx);
      
      renderTransactions(allTransactions); // Hàm này sẽ gọi updateFinanceChart luôn
      renderReminders(allReminders);
      saveToLocalStorage();
    }
  }
}

async function deleteTx(id) {
  if (confirm('Xóa giao dịch này?')) {
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('API chưa sẵn sàng');
      fetchData();
    } catch (err) {
      // 🔥 Xóa mạnh ở LocalStorage nếu API bị lỗi
      allTransactions = allTransactions.filter(t => String(t._id) !== String(id));
      renderTransactions(allTransactions); // Cập nhật lại list và biểu đồ
      saveToLocalStorage();
    }
  }
}
// ==================== LOCALSTORAGE FUNCTIONS ====================

function saveToLocalStorage() {
  localStorage.setItem('transactions', JSON.stringify(allTransactions));
  localStorage.setItem('reminders', JSON.stringify(allReminders));
}

function loadFromLocalStorage() {
  try {
    const savedTx = localStorage.getItem('transactions');
    const savedRem = localStorage.getItem('reminders');
    
    if (savedTx) allTransactions = JSON.parse(savedTx);
    if (savedRem) allReminders = JSON.parse(savedRem);
    
    if (savedTx || savedRem) {
      return true;
    }
  } catch (err) {
    console.error('Lỗi load localStorage:', err);
  }
  return false;
}

// ==================== FETCH DATA ====================

document.addEventListener('DOMContentLoaded', () => {
  // Kích hoạt đồng hồ ngay khi load trang
  startLiveClock(); 
  
  const hasLocalData = loadFromLocalStorage();
  fetchData();
  setInterval(saveToLocalStorage, 5000);
  setInterval(() => { fetchData(); }, 10000);
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
  } catch (err) {
    console.error("Lỗi tải dữ liệu từ API:", err);
    if (allTransactions.length > 0 || allReminders.length > 0) {
      renderTransactions(allTransactions);
      renderReminders(allReminders);
      renderCalendar();
      return;
    }
    
    // Demo data nếu không có gì
    allTransactions = [
      { _id: '1', telegramUserId: 0, amount: 35000, type: 'CHI', category: 'Ăn sáng', note: 'Cơm gà', source: 'BOT', createdAt: new Date() },
      { _id: '2', telegramUserId: 0, amount: 150000, type: 'THU', category: 'Bán đồ', note: 'Áo cũ', source: 'WEB', createdAt: new Date(Date.now() - 86400000) },
      { _id: '3', telegramUserId: 0, amount: 500000, type: 'CHI', category: 'Tiền nhà', note: 'Tháng 8', source: 'WEB', createdAt: new Date(Date.now() - 86400000 * 2) }
    ];
    
    allReminders = [
      { _id: '1', title: 'Tiền điện', amount: 200000, dueDate: new Date(Date.now() + 86400000 * 3), isPaid: false }
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
  
  // 🔥 Gọi hàm update biểu đồ ngay khi render giao dịch
  updateFinanceChart(transactions); 
}

function renderReminders(reminders) {
  const list = document.getElementById('reminder-list');
  list.innerHTML = '';

  const pendingReminders = reminders.filter(r => !r.isPaid);

  if (pendingReminders.length === 0) {
    list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 15px;">Không có lịch hẹn sắp tới 🎉</div>';
    return;
  }

  pendingReminders.forEach(rem => {
    const dueDateStr = new Date(rem.dueDate).toLocaleDateString('vi-VN');
    const item = document.createElement('div');
    item.className = 'reminder-item';
    const safeTitle = rem.title.replace(/'/g, "\\'"); 
    
    item.innerHTML = `
      <div class="reminder-info">
        <strong>${rem.title}</strong><br>
        <small style="color: var(--text-muted);">📅 Hạn: ${dueDateStr} &nbsp;|&nbsp; <b style="color: #fff;">${rem.amount.toLocaleString('vi-VN')} VNĐ</b></small>
      </div>
      <div class="reminder-actions">
        <button class="btn-confirm-pay" onclick="payReminder('${rem._id}', '${safeTitle}', ${rem.amount})">✅ Xác nhận</button>
        <button onclick="deleteReminder('${rem._id}')" class="btn-delete-rem">✕</button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function payReminder(id, title, amount) {
  if (confirm(`Bạn xác nhận đã thanh toán: ${title} (${amount.toLocaleString('vi-VN')} VNĐ)?\n\nHệ thống sẽ tự động trừ vào chi tiêu thực tế.`)) {
    try {
      const res = await fetch(`/api/reminders/${id}/pay`, { method: 'POST' });
      if (res.ok) {
        fetchData();
        alert(`✅ Đã ghi nhận chi tiêu: ${title}`);
      }
    } catch (err) {
      allReminders = allReminders.map(r => r._id === id ? { ...r, isPaid: true } : r);
      
      const newLocalTx = {
        _id: Date.now().toString(),
        telegramUserId: 0, amount: amount, type: 'CHI', category: title,
        note: 'Thanh toán từ lịch hẹn', source: 'WEB', createdAt: new Date()
      };
      allTransactions.unshift(newLocalTx);
      renderTransactions(allTransactions);
      renderReminders(allReminders);
      saveToLocalStorage();
      alert(`⚠️ Đã ghi nhận (Offline): ${title}`);
    }
  }
}

async function deleteReminder(id) {
  if (confirm('Xóa lịch hẹn này?')) {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
    } catch (err) {
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
  
  while (grid.children.length > 7) { grid.removeChild(grid.lastChild); }

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

    if (hasRem) cell.classList.add('has-reminder');
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      const newTx = await res.json();
      allTransactions.unshift(newTx);
      document.getElementById('addForm').reset();
      renderTransactions(allTransactions);
      saveToLocalStorage();
    }
  } catch (err) {
    const newTx = { _id: Date.now().toString(), ...body, source: 'LOCAL', createdAt: new Date() };
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
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
    const newRem = { _id: Date.now().toString(), ...body, isPaid: false };
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
      if (res.ok) fetchData();
    } catch (err) {
      allTransactions = allTransactions.filter(t => t._id !== id);
      renderTransactions(allTransactions);
      saveToLocalStorage();
    }
  }
}

// ==================== SOCKET LISTENERS ====================
socket.on('connect', () => { fetchData(); });
socket.on('new_transaction', () => { fetchData(); });
socket.on('delete_transaction', () => { fetchData(); });
socket.on('reminder_updated', () => { fetchData(); });
socket.on('budget_updated', () => { fetchData(); });
