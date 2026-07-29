require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server); 
global.io = io; // Dùng biến toàn cục để bot.js bắn socket sang web

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. KẾT NỐI MONGODB ---
const mongoURI = process.env.MONGODB_URI;
if (mongoURI) {
  mongoose.connect(mongoURI, {
    tls: true,
    tlsAllowInvalidCertificates: true
  })
  .then(() => console.log('✅ Kết nối MongoDB thành công!'))
  .catch((err) => console.error('❌ Lỗi kết nối MongoDB:', err));
}

const Transaction = require('./models/Transaction');

// --- 2. CÁC API CHO WEB DASHBOARD ---
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(100);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy dữ liệu' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const newTx = await Transaction.create({
      ...req.body,
      source: 'WEB'
    });
    if (global.io) global.io.emit('new_transaction', newTx);
    res.json(newTx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const deletedTx = await Transaction.findByIdAndDelete(req.params.id);
    if (deletedTx && global.io) {
      global.io.emit('delete_transaction', req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. SOCKET.IO ---
io.on('connection', (socket) => {
  console.log('⚡ Web Dashboard connected');
});

// --- 4. KHỞI CHẠY SERVER & TELEGRAM BOT ---
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
  
  try {
    const bot = require('./bot');
    bot.launch().then(() => {
      console.log('🤖 Telegram Bot đã sẵn sàng và đang hoạt động!');
    }).catch(err => {
      console.error('❌ Bot không thể khởi động (Kiểm tra lại BOT_TOKEN trong file .env):', err.message);
    });
  } catch (err) {
    console.error('❌ Lỗi khi nạp file bot.js:', err.message);
  }
});

// Đảm bảo tắt bot an toàn khi dừng server
process.once('SIGINT', () => {
  try { const bot = require('./bot'); bot.stop('SIGINT'); } catch(e){}
});
process.once('SIGTERM', () => {
  try { const bot = require('./bot'); bot.stop('SIGTERM'); } catch(e){}
});