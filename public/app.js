document.addEventListener('DOMContentLoaded', () => {
  fetchData();
});

async function fetchData() {
  // 1. Tải danh sách giao dịch
  const resTx = await fetch('/api/transactions');
  const transactions = await resTx.json();
  renderTransactions(transactions);

  // 2. Tải dữ liệu thống kê
  const resStats = await fetch('/api/stats');
  const stats = await resStats.json();
  renderChart(stats);
}

function renderTransactions(transactions) {
  const list = document.getElementById('transaction-list');
  list.innerHTML = '';

  let total = 0;
  transactions.forEach(tx => {
    total += tx.amount;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(tx.createdAt).toLocaleString('vi-VN')}</td>
      <td><strong>${tx.category}</strong></td>
      <td>${tx.note}</td>
      <td style="color: #e74c3c; font-weight: bold;">
        ${tx.amount.toLocaleString('vi-VN')} VNĐ
      </td>
    `;
    list.appendChild(row);
  });

  document.getElementById('total-spent').innerText = `${total.toLocaleString('vi-VN')} VNĐ`;
}

function renderChart(stats) {
  const labels = stats.map(s => s._id);
  const data = stats.map(s => s.totalAmount);

  const ctx = document.getElementById('categoryChart').getContext('2d');
  new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF']
      }]
    }
  });
}