require('dotenv').config();
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const Transaction = require('./models/Transaction');
const Reminder = require('./models/Reminder');

// Kết nối MongoDB (dùng chung DB với server web)
const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Bot đã kết nối MongoDB thành công'))
  .catch(err => console.error('❌ Bot lỗi kết nối MongoDB:', err));

// Khởi tạo Gemini AI
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6J6NMdLfDr0gZUDqbnAl-IcRlaGqgeIDn5sNGdz3yoH8Q";
let aiModel = null;
try {
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  console.log('✨ Gemini AI đã được kích hoạt trong Bot!');
} catch (err) {
  console.error('❌ Lỗi khởi tạo Gemini AI:', err);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Thiếu BOT_TOKEN trong biến môi trường!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Lệnh khởi đầu /start
bot.start((ctx) => {
  ctx.reply('🤖 Chào bạn! Bot quản lý chi tiêu & Gemini AI đã sẵn sàng.\n\n📌 **Hướng dẫn:**\n- Ghi nhanh: `ăn sáng 35k` hoặc `tiền nhà 3tr`\n- Đặt lịch: `hẹn tiền điện 500k ngày 10/8`\n- Hỏi AI: Nhắn tin bắt đầu bằng từ `ai` (VD: `ai tôi nên tiết kiệm thế nào?`)\n- Xóa gần nhất: `/xoa`');
});

// 1. Đặt lịch hẹn thanh toán: "hẹn [nội dung] [số tiền] ngày [ngày/tháng]"
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
    
    // Nếu bạn muốn báo qua WebSocket nếu chạy chung tiến trình, hoặc chỉ cần lưu DB
    ctx.reply(`📅 **Đã đặt lịch thành công!**\n- ${title}: ${rawAmount.toLocaleString('vi-VN')} VNĐ (Ngày ${dateStr})`);
  } catch (err) {
    console.error('Lỗi hẹn lịch:', err);
    ctx.reply('❌ Lỗi khi đặt lịch hẹn.');
  }
});

// 2. Ghi nhận giao dịch nhanh: "[danh mục] [số tiền]" (VD: ăn sáng 35k)
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
      note: 'Ghi nhanh từ Telegram Bot',
      source: 'BOT'
    });

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
    console.error('Lỗi ghi giao dịch:', err);
    ctx.reply('❌ Không thể ghi nhận giao dịch.');
  }
});

// 3. Xử lý tư vấn tài chính với Gemini AI (Tin nhắn bắt đầu bằng 'ai ' hoặc 'gemini ')
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn')) return;

  if (aiModel && (text.toLowerCase().startsWith('ai ') || text.toLowerCase().startsWith('gemini '))) {
    try {
      await ctx.sendChatAction('typing');
      const queryText = text.replace(/^(ai|gemini)\s+/i, '');
      
      // Lấy 15 giao dịch gần đây để AI có ngữ cảnh phân tích
      const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(15);
      const summary = transactions.map(t => `- ${t.category}: ${t.amount.toLocaleString('vi-VN')}đ (${t.type})`).join('\n');

      const prompt = `Bạn là trợ lý tài chính thông minh. Dưới đây là các giao dịch gần đây của tôi:\n${summary}\n\nCâu hỏi/Yêu cầu của tôi: "${queryText}". Hãy trả lời ngắn gọn, thực tế và hữu ích bằng tiếng Việt.`;
      
      const result = await aiModel.generateContent(prompt);
      const responseText = result.response.text();

      return ctx.reply(responseText || 'Xin lỗi, tôi chưa thể đưa ra câu trả lời lúc này.');
    } catch (err) {
      console.error('Lỗi Gemini AI:', err);
      return ctx.reply('❌ Đã xảy ra lỗi khi kết nối với Gemini AI.');
    }
  }
});

// Xóa nhanh qua nút bấm Inline Keyboard
bot.action(/^delete_tx_(.+)$/, async (ctx) => {
  try {
    const txId = ctx.match[1];
    const deletedTx = await Transaction.findByIdAndDelete(txId);
    if (deletedTx) {
      await ctx.editMessageText(`🗑️ **Đã xóa giao dịch thành công!**\n(${deletedTx.category} - ${deletedTx.amount.toLocaleString('vi-VN')} VNĐ)`, { parse_mode: 'Markdown' });
    } else {
      await ctx.answerCbQuery('Giao dịch không tồn tại hoặc đã bị xóa.');
    }
  } catch (err) {
    console.error(err);
    await ctx.answerCbQuery('Lỗi khi xóa.');
  }
});

// Lệnh /xoa để xóa giao dịch cuối cùng của user
bot.command('xoa', async (ctx) => {
  try {
    const lastTx = await Transaction.findOne({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
    if (!lastTx) return ctx.reply('📭 Không tìm thấy giao dịch nào gần đây.');

    await Transaction.findByIdAndDelete(lastTx._id);
    ctx.reply(`🗑️ Đã xóa giao dịch gần nhất: ${lastTx.category} - ${lastTx.amount.toLocaleString('vi-VN')} VNĐ`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Lỗi khi xóa.');
  }
});

// Khởi chạy bot
bot.launch().then(() => console.log('🤖 Telegram Bot đang chạy thành công!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));