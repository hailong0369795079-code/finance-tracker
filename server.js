require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');

const Transaction = require('./models/Transaction');
const Reminder = require('./models/Reminder');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
global.io = io;

app.use(express.json());
app.use(express.static('public'));

// Khởi tạo Gemini AI bằng API Key bạn vừa cung cấp
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6J6NMdLfDr0gZUDqbnAl-IcRlaGqgeIDn5sNGdz3yoH8Q";
let ai = null;
try {
  ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  console.log('✨ Gemini AI đã được khởi tạo thành công với API Key cấu hình sẵn!');
} catch (err) {
  console.error('❌ Lỗi khởi tạo Gemini AI:', err);
}

// Kết nối MongoDB
const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Đã kết nối MongoDB thành công'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// ================= API ROUTES (WEB) =================
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

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

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    io.emit('delete_transaction', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await Reminder.find().sort({ dueDate: 1 });
    res.json(reminders);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/api/reminders', async (req, res) => {
  try {
    const { title, amount, dueDate } = req.body;
    const reminder = await Reminder.create({ title, amount, dueDate });
    io.emit('reminder_updated');
    res.status(201).json(reminder);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    io.emit('reminder_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

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

// ================= TELEGRAM BOT & GEMINI AI =================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    ctx.reply('🤖 Chào bạn! Bot quản lý chi tiêu & Gemini AI đã sẵn sàng.\n\n📌 **Hướng dẫn:**\n- Ghi nhanh: `ăn sáng 35k` hoặc `tiền nhà 3tr`\n- Đặt lịch: `hẹn tiền điện 500k ngày 10/8`\n- Hỏi AI: Nhắn tin bắt đầu bằng `ai` (VD: `ai tôi nên phân bổ chi tiêu thế nào?`)\n- Xóa gần nhất: `/xoa`');
  });

  // Hẹn lịch thanh toán
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

      await Reminder.create({ telegramUserId: userId, title, amount: rawAmount, dueDate });
      io.emit('reminder_updated');
      ctx.reply(`📅 **Đã đặt lịch thành công!**\n- ${title}: ${rawAmount.toLocaleString('vi-VN')} VNĐ (Ngày ${dateStr})`);
    } catch (err) {
      console.error(err);
      ctx.reply('❌ Lỗi khi đặt lịch hẹn.');
    }
  });

  // Ghi nhận giao dịch nhanh
  bot.hears(/^(.+?)\s+(\d+[k|tr]?)$/i, async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn') || text.toLowerCase().startsWith('ai')) return;

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

  // Xử lý trò chuyện/tư vấn tài chính với Gemini AI
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn')) return;

    if (ai && (text.toLowerCase().startsWith('ai ') || text.toLowerCase().startsWith('gemini '))) {
      try {
        await ctx.sendChatAction('typing');
        const queryText = text.replace(/^(ai|gemini)\s+/i, '');
        
        // Lấy 15 giao dịch gần đây để AI phân tích ngữ cảnh
        const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(15);
        const summary = transactions.map(t => `- ${t.category}: ${t.amount.toLocaleString('vi-VN')}đ (${t.type})`).join('\n');

        const prompt = `Bạn là trợ lý tài chính thông minh. Dưới đây là các giao dịch gần đây của tôi:\n${summary}\n\nCâu hỏi/Yêu cầu của tôi: "${queryText}". Hãy trả lời ngắn gọn, thực tế và hữu ích bằng tiếng Việt.`;
        
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
        });

        return ctx.reply(response.text || 'Xin lỗi, tôi chưa thể đưa ra câu trả lời lúc này.');
      } catch (err) {
        console.error('Lỗi Gemini AI:', err);
        return ctx.reply('❌ Đã xảy ra lỗi khi kết nối với Gemini AI.');
      }
    }
  });

  bot.action(/^delete_tx_(.+)$/, async (ctx) => {
    try {
      const txId = ctx.match[1];
      const deletedTx = await Transaction.findByIdAndDelete(txId);
      if (deletedTx) {
        io.emit('delete_transaction', txId);
        await ctx.editMessageText(`🗑️ **Đã xóa giao dịch thành công!**\n(${deletedTx.category} - ${deletedTx.amount.toLocaleString('vi-VN')} VNĐ)`, { parse_mode: 'Markdown' });
      } else {
        await ctx.answerCbQuery('Giao dịch không tồn tại.');
      }
    } catch (err) {
      console.error(err);
      await ctx.answerCbQuery('Lỗi khi xóa.');
    }
  });

  bot.command('xoa', async (ctx) => {
    try {
      const lastTx = await Transaction.findOne({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
      if (!lastTx) return ctx.reply('📭 Không tìm thấy giao dịch nào gần đây.');

      await Transaction.findByIdAndDelete(lastTx._id);
      io.emit('delete_transaction', lastTx._id);
      ctx.reply(`🗑️ Đã xóa giao dịch: ${lastTx.category} - ${lastTx.amount.toLocaleString('vi-VN')} VNĐ`);
    } catch (err) {
      console.error(err);
      ctx.reply('❌ Lỗi khi xóa.');
    }
  });

  bot.launch().then(() => console.log('🤖 Telegram Bot & Gemini AI đang chạy mượt mà'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});