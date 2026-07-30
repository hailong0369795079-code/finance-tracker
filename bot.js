<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finance Dashboard - Sync Database</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-main: #131722;
      --bg-card: #1e222d;
      --text-main: #d1d4dc;
      --text-muted: #787b86;
      --border: #2a2e39;
      --c-chi: #ef5350;
      --c-thu: #26a69a;
      --c-dautu: #2962ff;
    }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: var(--bg-main); color: var(--text-main); margin: 0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .card { background: var(--bg-card); border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid var(--border); }
    .card-title { font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; color: #fff; }
    .row-charts { display: grid; grid-template-columns: 1fr 1.5fr; gap: 20px; }
    .chart-container { position: relative; height: 250px; width: 100%; }
    .row-data { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
    .form-group { margin-bottom: 15px; }
    label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 5px; }
    input, select { width: 100%; background: var(--bg-main); border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; outline: none; }
    input:focus, select:focus { border-color: var(--c-dautu); }
    button.btn-submit { width: 100%; background: var(--c-dautu); color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px; }
    button.btn-submit:hover { opacity: 0.9; }
    .table-responsive { overflow-x: auto; max-height: 400px; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { color: var(--text-muted); padding: 12px 10px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg-card); font-size: 12px; z-index: 10; }
    td { padding: 12px 10px; border-bottom: 1px solid var(--border); color: var(--text-main); }
    tr:hover { background: rgba(255,255,255,0.02); }
    .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .badge.chi { color: var(--c-chi); background: rgba(239,83,80,0.1); }
    .badge.thu { color: var(--c-thu); background: rgba(38,166,154,0.1); }
    .badge.dautu { color: var(--c-dautu); background: rgba(41,98,255,0.1); }
    .text-chi { color: var(--c-chi); font-weight: bold; }
    .text-thu { color: var(--c-thu); font-weight: bold; }
    .action-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 16px; margin-right: 5px; transition: color 0.2s; }
    .action-btn.delete:hover { color: var(--c-chi); }
    
    /* Lịch & Nhắc hẹn CSS */
    .calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .cal-btn { background: var(--bg-main); border: 1px solid var(--border); color: #fff; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    .cal-btn:hover { border-color: var(--c-dautu); background: var(--c-dautu); }
    .calendar-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: bold; }
    .calendar-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
    .day-cell { padding: 6px 0; font-size: 12px; border-radius: 4px; background: rgba(255,255,255,0.02); position: relative; cursor: pointer; transition: 0.2s; }
    .day-cell:hover { background: var(--border); }
    .day-cell.empty { background: transparent; cursor: default; }
    .day-cell.today { background: rgba(41, 98, 255, 0.2); border: 1px solid var(--c-dautu); color: #fff; font-weight: bold; }
    .day-cell.has-reminder::after { content: ''; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; background: var(--c-chi); border-radius: 50%; }
    .divider { border-top: 1px solid var(--border); margin: 15px 0 10px 0; }
    .btn-add-reminder { background: transparent; border: 1px solid var(--c-dautu); color: var(--c-dautu); font-size: 11px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    .btn-add-reminder:hover { background: var(--c-dautu); color: #fff; }
    .reminder-list { max-height: 100px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 5px; }
    .reminder-item { display: flex; justify-content: space-between; align-items: center; background: var(--bg-main); padding: 8px 10px; border-radius: 6px; border-left: 3px solid var(--c-chi); font-size: 12px; }
    .reminder-info { display: flex; flex-direction: column; gap: 4px; }
    .reminder-date { font-size: 11px; color: var(--text-muted); }
    .reminder-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; }
    .reminder-del:hover { color: var(--c-chi); }
    @media(max-width: 768px) { .row-charts, .row-data { grid-template-columns: 1fr; } }
  </style>
</head>
<body>

  <div class="container">
    <div class="row-charts">
      <div class="card">
        <h3 class="card-title">🍩 Cơ Cấu Theo Danh Mục</h3>
        <div class="chart-container"><canvas id="doughnutChart"></canvas></div>
      </div>
      
      <div class="card">
        <h3 class="card-title">📅 Lịch & Nhắc Thanh Toán (Database)</h3>
        <div class="calendar-container">
          <div class="calendar-header">
            <button type="button" class="cal-btn" id="prevMonth">&lt;</button>
            <span id="calendarTitle" style="font-weight: bold; font-size: 14px;"></span>
            <button type="button" class="cal-btn" id="nextMonth">&gt;</button>
          </div>
          <div class="calendar-weekdays">
            <div>CN</div><div>T2</div><div>T3</div><div>T4</div><div>T5</div><div>T6</div><div>T7</div>
          </div>
          <div class="calendar-days" id="calendarDays"></div>
        </div>
        <div class="divider"></div>
        <div class="reminder-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">📌 LỊCH HẸN TRÊN HỆ THỐNG</span>
            <button type="button" class="btn-add-reminder" onclick="addReminderPrompt()">+ Thêm nhắc hẹn</button>
          </div>
          <div id="reminderList" class="reminder-list"></div>
        </div>
      </div>
    </div>

    <div class="row-data">
      <div class="card">
        <h3 class="card-title">➕ Thêm Giao Dịch</h3>
        <form id="addForm">
          <div class="form-group"><label>Số Tiền (VNĐ)</label><input type="number" id="f_amount" placeholder="VD: 50000" required></div>
          <div class="form-group">
            <label>Loại Giao Dịch</label>
            <select id="f_type">
              <option value="CHI">🔴 Chi Tiêu</option>
              <option value="THU">🟢 Thu Nhập</option>
              <option value="DAUTU">🔵 Đầu Tư</option>
            </select>
          </div>
          <div class="form-group"><label>Danh Mục</label><input type="text" id="f_category" placeholder="Ăn uống, Lương..." required></div>
          <div class="form-group"><label>Ghi Chú</label><input type="text" id="f_note" placeholder="Nội dung..." required></div>
          <button type="submit" class="btn-submit">Lưu Giao Dịch</button>
        </form>
      </div>

      <div class="card">
        <h3 class="card-title">📋 Nhật Ký Giao Dịch Gần Đây</h3>
        <div class="table-responsive">
          <table>
            <thead>
              <tr><th>LOẠI</th><th>GHI CHÚ</th><th>DANH MỤC</th><th>NGUỒN</th><th>SỐ TIỀN</th><th>THỜI GIAN</th><th>HÀNH ĐỘNG</th></tr>
            </thead>
            <tbody id="table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let allData = [];
    let reminders = [];
    let doughnutChart;
    let currentCalDate = new Date();

    const formatMoney = (val) => new Intl.NumberFormat('vi-VN').format(val) + ' đ';
    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
    };

    function renderTable() {
      const tbody = document.getElementById('table-body');
      tbody.innerHTML = '';
      allData.forEach(tx => {
        const isChi = tx.type === 'CHI' || !tx.type;
        const typeClass = isChi ? 'chi' : (tx.type === 'THU' ? 'thu' : 'dautu');
        tbody.innerHTML += `
          <tr>
            <td><span class="badge ${typeClass}">${tx.type || 'CHI'}</span></td>
            <td>${tx.note}</td>
            <td>${tx.category}</td>
            <td style="font-size:11px; color:#787b86;">${tx.source || 'BOT'}</td>
            <td class="${isChi ? 'text-chi' : 'text-thu'}">${isChi ? '-' : '+'}${formatMoney(tx.amount)}</td>
            <td>${formatDate(tx.createdAt)}</td>
            <td><button class="action-btn delete" onclick="deleteTx('${tx._id}')" title="Xóa">🗑️</button></td>
          </tr>
        `;
      });
    }

    function renderCharts() {
      let categories = {};
      allData.forEach(tx => {
        if (tx.type === 'CHI' || !tx.type) {
          categories[tx.category] = (categories[tx.category] || 0) + tx.amount;
        }
      });
      const dCtx = document.getElementById('doughnutChart').getContext('2d');
      if (doughnutChart) doughnutChart.destroy();
      doughnutChart = new Chart(dCtx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(categories).length ? Object.keys(categories) : ['Trống'],
          datasets: [{ data: Object.keys(categories).length ? Object.values(categories) : [1], backgroundColor: ['#ef5350', '#ab47bc', '#42a5f5', '#ffca28', '#26a69a'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#d1d4dc', font: { size: 11 } } } }, cutout: '70%' }
      });
    }

    function renderCalendar() {
      const year = currentCalDate.getFullYear();
      const month = currentCalDate.getMonth();
      document.getElementById('calendarTitle').innerText = `Tháng ${month + 1} / ${year}`;

      const firstDay = new Date(year, month, 1).getDay();
      const lastDate = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      const daysContainer = document.getElementById('calendarDays');
      daysContainer.innerHTML = '';

      for (let i = 0; i < firstDay; i++) daysContainer.innerHTML += `<div class="day-cell empty"></div>`;

      for (let date = 1; date <= lastDate; date++) {
        const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
        const isToday = date === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const hasReminder = reminders.some(r => r.date === fullDateStr);
        let cls = 'day-cell';
        if (isToday) cls += ' today';
        if (hasReminder) cls += ' has-reminder';
        daysContainer.innerHTML += `<div class="${cls}">${date}</div>`;
      }
    }

    function renderReminders() {
      const listContainer = document.getElementById('reminderList');
      listContainer.innerHTML = '';
      if (reminders.length === 0) {
        listContainer.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding: 10px;">Không có lịch hẹn thanh toán.</div>`;
        return;
      }
      reminders.sort((a, b) => new Date(a.date) - new Date(b.date));
      reminders.forEach(item => {
        const fmtDate = item.date.split('-').reverse().join('/');
        listContainer.innerHTML += `
          <div class="reminder-item">
            <div class="reminder-info">
              <span style="font-weight: 600; color: #fff;">${item.title}</span>
              <span class="reminder-date">⏰ ${fmtDate} - <span style="color:var(--c-chi); font-weight:bold;">${formatMoney(item.amount)}</span></span>
            </div>
            <button class="reminder-del" onclick="deleteReminder('${item._id}')" title="Xóa">🗑️</button>
          </div>
        `;
      });
    }

    async function addReminderPrompt() {
      const title = prompt("Tên khoản thanh toán (VD: Tiền nhà):");
      if (!title) return;
      const amountInput = prompt("Số tiền (VNĐ):", "500000");
      if (amountInput === null) return;
      const amount = parseFloat(amountInput) || 0;
      const date = prompt("Ngày hạn (Định dạng YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
      if (!date) return;

      try {
        await fetch('/api/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, amount, date })
        });
      } catch (err) { alert('Lỗi khi thêm nhắc hẹn!'); }
    }

    async function deleteReminder(id) {
      if (confirm('Xóa lịch hẹn này?')) {
        await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      }
    }

    function updateUI() {
      renderTable();
      renderCharts();
      renderCalendar();
      renderReminders();
    }

    document.getElementById('prevMonth').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() - 1); renderCalendar(); });
    document.getElementById('nextMonth').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() + 1); renderCalendar(); });

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(document.getElementById('f_amount').value),
          type: document.getElementById('f_type').value,
          category: document.getElementById('f_category').value,
          note: document.getElementById('f_note').value
        })
      });
      document.getElementById('addForm').reset();
    });

    async function deleteTx(id) {
      if (confirm('Xóa giao dịch này?')) await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    }

    // Socket realtime listeners
    socket.on('new_transaction', (tx) => { allData.unshift(tx); updateUI(); });
    socket.on('delete_transaction', (id) => { allData = allData.filter(t => t._id !== id); updateUI(); });
    socket.on('new_reminder', (r) => { reminders.push(r); updateUI(); });
    socket.on('delete_reminder', (id) => { reminders = reminders.filter(r => r._id !== id); updateUI(); });

    async function loadAllData() {
      try {
        const [resTx, resRem] = await Promise.all([fetch('/api/transactions'), fetch('/api/reminders')]);
        allData = await resTx.json();
        reminders = await resRem.json();
      } catch (err) {
        console.log("Lỗi kết nối API.");
      }
      updateUI();
    }

    loadAllData();
  </script>
</body>
</html>