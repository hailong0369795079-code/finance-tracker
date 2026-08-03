const socket = io();
let allTransactions = [];
let allReminders = [];
let currentDate = new Date();
let financeChartInstance = null; // Biến lưu trữ biểu đồ

// ==================== 1. TÍNH NĂNG ĐỒNG HỒ & LỊCH ÂM ====================
function startLiveClock() {
  const clockEl = document.getElementById('clock-display');
  const solarEl = document.getElementById('solar-display');
  const lunarEl = document.getElementById('lunar-display');
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

  function updateTime() {
    const now = new Date();
    if (clockEl) clockEl.innerText = now.toLocaleTimeString('vi-VN', { hour12: false });
    
    if (solarEl && (now.getSeconds() === 0 || solarEl.innerText === 'Đang tải...')) {
      solarEl.innerText = `${days[now.getDay()]}, ${now.toLocaleDateString('vi-VN')}`;
      
      try {
        if (typeof Lunar !== 'undefined') {
          const lunar = Lunar.fromDate(now);
          if (lunarEl) lunarEl.innerText = `Âm Lịch: ${lunar.getDay()}/${lunar.getMonth()} (${lunar.getYearInGanZhi()})`;
        }
      } catch (e) {
        if (lunarEl) lunarEl.innerText = '';
      }
    }
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// ==================== 2. HÀM VẼ BIỂU ĐỒ (HIỆN THEO TỪNG NGÀY) ====================
function updateFinanceChart(transactions = []) {
  const canvas = document.getElementById('financeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const last7Days = [];
  const chiData = [0, 0, 0, 0, 0, 0, 0];
  const thuData = [0, 0, 0, 0, 0, 0, 0];

  // Tạo mốc 7 ngày gần nhất
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dayStr = String(d.getDate()).padStart(2, '0');
    const monthStr = String(d.getMonth() + 1).padStart(2, '0');
    last7Days.push(`${dayStr}/${monthStr}`);
  }

  // Phân loại dữ liệu theo từng ngày
  transactions.forEach(tx => {
    if (!tx.createdAt) return;
    
    const txDate = new Date(tx.createdAt);
    if (isNaN(txDate.getTime())) return;

    const dayStr = String(txDate.getDate()).padStart(2, '0');
    const monthStr = String(txDate.getMonth() + 1).padStart(2, '0');
    const dateStr = `${dayStr}/${monthStr}`;

    const index = last7Days.indexOf(dateStr);
    if (index !== -1) {
      const amount = Number(tx.amount) || 0;
      if (tx.type === 'CHI' || tx.type === 'DAUTU') {
        chiData[index] += amount;
      } else if (tx.type === 'THU') {
        thuData[index] += amount;
      }
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
            {
              label: 'Chi Tiêu (VNĐ)',
              data: chiData,
              borderColor: '#ef5350',
              backgroundColor: 'rgba(239, 83, 80, 0.15)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointRadius: 5, // Điểm mút rõ ràng
              pointHoverRadius: 7
            },
            {
              label: 'Thu Nhập (VNĐ)',
              data: thuData,
              borderColor: '#26a69a',
              backgroundColor: 'rgba(38, 166, 154, 0.15)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointRadius: 5,
              pointHoverRadius: 7
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#d1d4dc' } },
            tooltip: {
              callbacks: {
                label: (context) => `${context.dataset.label}: ${context.raw.toLocaleString('vi-VN')} VNĐ`
              }
            }
          },
          scales: {
            x: { ticks: { color: '#787b86' }, grid: { color: '#2a2e39' } },
            y: { 
              ticks: { 
                color: '#787b86',
                callback: (val) => val.toLocaleString('vi-VN')
              }, 
              grid: { color: '#2a2e39' }, 
              beginAtZero: true 
            }
          }
        }
      });
    }
  } catch (e) {
    console.error("Lỗi vẽ biểu đồ:", e);
  }
}

// ==================== 3. CÁC HÀM TÍNH TOÁN & HIỂN THỊ DỮ LIỆU ====================

function renderTransactions(transactions = []) {
  const list = document.getElementById('transaction-list');
  if (!list) return;
  list.innerHTML = '';

  let totalChi = 0;

  transactions.forEach(tx => {
    const amount = Number(tx.amount) || 0;

    if (tx.type === 'CHI' || tx.type === 'DAUTU') {
      totalChi += amount;
    }

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(tx.createdAt).toLocaleString('vi-VN')}</td>
      <td><strong>${tx.category}</strong> <span style="font-size:0.75rem; background:var(--border); padding:2px 6px; border-radius:4px;">${tx.source || 'WEB'}</span></td>
      <td>${tx.note || ''}</td>
      <td style="color: ${tx.type === 'CHI' ? 'var(--c-chi)' : tx.type === 'THU' ? 'var(--c-thu)' : 'var(--c-dautu)'}; font-weight: bold;">
        ${tx.type === 'THU' ? '+' : '-'}${amount.toLocaleString('vi-VN')} VNĐ
      </td>
      <td><button onclick="deleteTx('${tx._id}')" style="background:none; border:none; color:var(--c-chi); cursor:pointer;">Xóa</button></td>
    `;
    list.appendChild(row);
  });

  // Hiển thị Tổng Tiền Tiêu
  const totalSpentEl = document.getElementById('total-spent');
  if (totalSpentEl) {
    totalSpentEl.innerText = `${totalChi.toLocaleString('vi-VN')} VNĐ`;
  }

  // Cập nhật biểu đồ ngay lập tức
  updateFinanceChart(transactions);
}

function renderReminders(reminders = []) {
  const list = document.getElementById('reminder-list');
  if (!list) return;
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
    
    item.innerHTML = `
      <div class="reminder-info">
        <strong>${rem.title}</strong><br>
        <small style="color: var(--text-muted);">📅 Hạn: ${dueDateStr} &nbsp;|&nbsp; <b style="color: #fff;">${Number(rem.amount).toLocaleString('vi-VN')} VNĐ</b></small>
      </div>
      <div class="reminder-actions">
        <button class="btn-confirm-pay">✅ Xác nhận</button>
        <button class="btn-delete-rem">✕</button>
      </div>
    `;

    // Sự kiện nút bấm an toàn
    item.querySelector('.btn-confirm-pay').onclick = () => payReminder(rem._id, rem.title, rem.amount);
    item.querySelector('.btn-delete-rem').onclick = () => deleteReminder(rem._id);

    list.appendChild(item);
  });
}

// ==================== 4. THAO TÁC API / OFFLINE (KHÔNG TRÙNG HÀM) ====================

async function deleteTx(id) {
  if (confirm('Xóa giao dịch này?')) {
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('API thất bại');
      fetchData();
    } catch (err) {
      allTransactions = allTransactions.filter(t => String(t._id) !== String(id));
      renderTransactions(allTransactions);
      saveToLocalStorage();
    }
  }
}

async function payReminder(id, title, amount) {
  if (confirm(`Bạn xác nhận đã thanh toán: ${title} (${Number(amount).toLocaleString('vi-VN')} VNĐ)?\n\nHệ thống sẽ tự động trừ vào chi tiêu thực tế.`)) {
    try {
      const res = await fetch(`/api/reminders/${id}/pay`, { method: 'POST' });
      if (!res.ok) throw new Error('API thất bại');
      fetchData();
      alert(`✅ Đã ghi nhận chi tiêu: ${title}`);
    } catch (err) {
      allReminders = allReminders.map(r => String(r._id) === String(id) ? { ...r, isPaid: true } : r);
      
      const newLocalTx = {
        _id: Date.now().toString(),
        telegramUserId: 0,
        amount: Number(amount),
        type: 'CHI',
        category: title,
        note: 'Thanh toán từ lịch hẹn',
        source: 'WEB',
        createdAt: new Date().toISOString()
      };
      allTransactions.unshift(newLocalTx);
      
      renderTransactions(allTransactions);
      renderReminders(allReminders);
      renderCalendar();
      saveToLocalStorage();
      alert(`⚠️ Đã ghi nhận (Offline): ${title}`);
    }
  }
}

async function deleteReminder(id) {
  if (confirm('Xóa lịch hẹn này?')) {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('API thất bại');
      fetchData();
    } catch (err) {
      allReminders = allReminders.filter(r => String(r._id) !== String(id));
      renderReminders(allReminders);
      renderCalendar();
      saveToLocalStorage();
    }
  }
}

// ==================== 5. LOCALSTORAGE & FETCH DATA ====================

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
    
    return Boolean(savedTx || savedRem);
  } catch (err) {
    console.error('Lỗi load localStorage:', err);
    return false;
  }
}

async function fetchData() {
  try {
    const resTx = await fetch('/api/transactions');
    if (!resTx.ok) throw new Error('API transactions failed');
    allTransactions = await resTx.json();

    const resRem = await fetch('/api/reminders');
    if (!resRem.ok) throw new Error('API reminders failed');
    allReminders = await resRem.json();

    renderTransactions(allTransactions);
    renderReminders(allReminders);
    renderCalendar();
    saveToLocalStorage();
  } catch (err) {
    if (allTransactions.length > 0 || allReminders.length > 0) {
      renderTransactions(allTransactions);
      renderReminders(allReminders);
      renderCalendar();
      return;
    }
    
    // Mẫu Dữ Liệu Ban Đầu Khi Chưa Có Gì
    allTransactions = [
      { _id: '1', telegramUserId: 0, amount: 35000, type: 'CHI', category: 'Ăn sáng', note: 'Cơm gà', source: 'BOT', createdAt: new Date().toISOString() },
      { _id: '2', telegramUserId: 0, amount: 150000, type: 'THU', category: 'Bán đồ', note: 'Áo cũ', source: 'WEB', createdAt: new Date(Date.now() - 86400000).toISOString() },
      { _id: '3', telegramUserId: 0, amount: 500000, type: 'CHI', category: 'Tiền nhà', note: 'Tháng 8', source: 'WEB', createdAt: new Date(Date.now() - 86400000 * 2).toISOString() }
    ];
    
    allReminders = [
      { _id: '1', title: 'Tiền điện', amount: 200000, dueDate: new Date(Date.now() + 86400000 * 3).toISOString(), isPaid: false }
    ];
    
    renderTransactions(allTransactions);
    renderReminders(allReminders);
    renderCalendar();
  }
}

// ==================== 6. LỊCH (CALENDAR) ====================

function changeMonth(direction) {
  currentDate.setMonth(currentDate.getMonth() + direction);
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const monthYearLabel = document.getElementById('calendar-month-year');
  if (!grid || !monthYearLabel) return;
  
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

// ==================== 7. FORM SUBMITS & KHỞI TẠO ====================

document.addEventListener('DOMContentLoaded', () => {
  startLiveClock(); 
  loadFromLocalStorage();
  fetchData();
  
  setInterval(saveToLocalStorage, 5000);
  setInterval(fetchData, 10000);

  // Submit Giao dịch
  const addForm = document.getElementById('addForm');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
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
        } else throw new Error('API Lỗi');
      } catch (err) {
        const newTx = { _id: Date.now().toString(), ...body, source: 'LOCAL', createdAt: new Date().toISOString() };
        allTransactions.unshift(newTx);
      } finally {
        addForm.reset();
        renderTransactions(allTransactions);
        saveToLocalStorage();
      }
    });
  }

  // Submit Nhắc hẹn
  const reminderForm = document.getElementById('reminderForm');
  if (reminderForm) {
    reminderForm.addEventListener('submit', async (e) => {
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
        } else throw new Error('API Lỗi');
      } catch (err) {
        const newRem = { _id: Date.now().toString(), ...body, isPaid: false };
        allReminders.unshift(newRem);
      } finally {
        reminderForm.reset();
        renderReminders(allReminders);
        renderCalendar();
        saveToLocalStorage();
      }
    });
  }
});

// ==================== 8. SOCKET LISTENERS ====================
socket.on('connect', () => { fetchData(); });
socket.on('new_transaction', () => { fetchData(); });
socket.on('delete_transaction', () => { fetchData(); });
socket.on('reminder_updated', () => { fetchData(); });
socket.on('budget_updated', () => { fetchData(); });
