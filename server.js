require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const Transaction = require('./models/Transaction');
const Reminder = require('./models/Reminder');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
global.io = io;

app.use(express.json());
app.use(express.static('public'));

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ Đã kết nối MongoDB')).catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ================= API ROUTES (WEB) =================

// Lấy danh sách giao dịch
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm giao dịch từ Web
app.post('/api/transactions', async (req, res) => {
  try {
    const { amount, type, category, note } = req.body;
    const tx = await Transaction.create({ amount, type, category, note, source: 'WEB' });
    io.emit('new_transaction', tx);
    res.status(201).json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xóa giao dịch từ Web
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    io.emit('delete_transaction', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Lấy danh sách lịch hẹn
app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await Reminder.find().sort({ dueDate: 1 });
    res.json(reminders);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Xác nhận thanh toán lịch hẹn (Tạo giao dịch thực tế & trừ tiền chi tiêu)
app.post('/api/reminders/:id/pay', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);
    if (!reminder || reminder.isPaid) {
      return res.status(404).json({ error: 'Không tìm thấy lịch hẹn hoặc đã thanh toán' });
    }

    const newTx = await Transaction.create({
      telegramUserId: reminder.telegramUserId || 0,
      type: 'CHI',
      amount: reminder.amount,
      category: 'Thanh toán định kỳ',
      note: `Thanh toán: ${reminder.title}`,
      source: 'REMINDER'
    });

    reminder.isPaid = true;
    await reminder.save();

    io.emit('new_transaction', newTx);
    io.emit('reminder_updated');

    res.json({ success: true, transaction: newTx });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ================= TELEGRAM BOT =================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    ctx.reply('🤖 Chào bạn đến với Bot Quản Lý Chi Tiêu!\n\n📌 **Hướng dẫn sử dụng:**\n- Nhập nhanh: `ăn sáng 35k` hoặc `tiền nhà 3tr` (Bot sẽ ghi nhận và gửi kèm nút bấm Xóa).\n- Đặt lịch: `hẹn đóng điện 500k ngày 10/8` (Đúng hạn mới nhắc và trừ tiền).\n- Lệnh xóa nhanh: `/xoa` (Xóa giao dịch gần nhất bạn vừa nhập).');
  });

  // 1. Đặt lịch hẹn qua Telegram
  bot.hears(/^hẹn\s+(.+?)\s+(\d+[k|tr]?)\s+ngày\s+(\d{1,2}\/\d{1,2})/i, async (ctx) => {
    try {
      const title = ctx.match[1];
      let rawAmount = parseFloat(ctx.match[2]);
      const dateStr = ctx.match[3];
      const userId = ctx.from.id;

      if (ctx.match[2].toLowerCase().includes('k')) rawAmount *= 1000;
      if (ctx.match[2].toLowerCase().includes('tr')) rawAmount *= 1000000;

      const [day, month] = dateStr.split('/');
      const currentYear = new Date().getFullYear();
      const dueDate = new Date(currentYear, parseInt(month) - 1, parseInt(day));

      await Reminder.create({
        telegramUserId: userId,
        title,
        amount: rawAmount,
        dueDate
      });

      io.emit('reminder_updated');
      ctx.reply(`📅 **Đã đặt lịch nhắc thành công!**\n- Nội dung: ${title}\n- Số tiền: ${rawAmount.toLocaleString('vi-VN')} VNĐ\n- Hạn: Ngày ${dateStr}\n\n*(Đến đúng ngày hệ thống sẽ nhắc và chỉ trừ tiền khi bạn xác nhận).*`);
    } catch (err) {
      console.error(err);
      ctx.reply('❌ Lỗi khi đặt lịch hẹn.');
    }
  });

  // 2. Ghi nhận giao dịch nhanh qua Telegram kèm nút [❌ Xóa giao dịch này]
  bot.hears(/^(.+?)\s+(\d+[k|tr]?)$/i, async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn')) return;

    try {
      const category = ctx.match[1].trim();
      let amount = parseFloat(ctx.match[2]);
      if (text.toLowerCase().includes('k')) amount *= 1000;
      if (text.toLowerCase().includes('tr')) amount *= 1000000;

      const tx = await Transaction.create({
        telegramUserId: ctx.from.id,
        amount,
        type: 'CHI',
        category,
        note: 'Ghi nhanh từ Telegram',
        source: 'BOT'
      });

      io.emit('new_transaction', tx);

      // Phản hồi kèm nút inline [❌ Xóa giao dịch này]
      await ctx.reply(
        `✅ Đã ghi nhận:\n📂 **${category}**: **${amount.toLocaleString('vi-VN')} VNĐ**`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Xóa giao dịch này', `delete_tx_${tx._id}`)]
          ])
        }
      );
    } catch (err) {
      console.error(err);
      ctx.reply('❌ Không thể ghi nhận giao dịch.');
    }
  });

  // 3. Xử lý khi bấm nút Xóa giao dịch ngay trên Telegram
  bot.action(/^delete_tx_(.+)$/, async (ctx) => {
    try {
      const txId = ctx.match[1];
      const deletedTx = await Transaction.findByIdAndDelete(txId);

      if (deletedTx) {
        io.emit('delete_transaction', txId);
        await ctx.editMessageText(`🗑️ **Đã xóa giao dịch thành công!**\n(${deletedTx.category} - ${deletedTx.amount.toLocaleString('vi-VN')} VNĐ)`, { parse_mode: 'Markdown' });
      } else {
        await ctx.answerCbQuery('Giao dịch không tồn tại hoặc đã bị xóa trước đó.');
      }
    } catch (err) {
      console.error(err);
      await ctx.answerCbQuery('Lỗi khi xóa giao dịch.');
    }
  });

  // 4. Lệnh /xoa để xóa giao dịch gần nhất
  bot.command('xoa', async (ctx) => {
    try {
      const lastTx = await Transaction.findOne({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
      if (!lastTx) {
        return ctx.reply('📭 Không tìm thấy giao dịch nào gần đây để xóa.');
      }

      await Transaction.findByIdAndDelete(lastTx._id);
      io.emit('delete_transaction', lastTx._id);
      ctx.reply(`🗑️ Đã xóa giao dịch gần nhất:\n- ${lastTx.category}: ${lastTx.amount.toLocaleString('vi-VN')} VNĐ`);
    } catch (err) {
      console.error(err);
      ctx.reply('❌ Lỗi khi xóa giao dịch.');
    }
  });

  bot.launch().then(() => console.log('🤖 Telegram Bot đã khởi động thành công'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});