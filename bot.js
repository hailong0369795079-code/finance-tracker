require('dotenv').config();
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ==================== BẢO VỆ RENDER KHÔNG BỊ TREO ====================
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Expense Manager is running!');
}).listen(PORT, () => console.log(`🌐 Server Web-check đang chạy tại port ${PORT}`));

// ==================== KẾT NỐI MONGODB ====================
const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Bot đã kết nối MongoDB thành công'))
  .catch(err => console.error('❌ Bot lỗi kết nối MongoDB:', err));

const Transaction = require('./models/Transaction');
const Reminder = require('./models/Reminder');

// ==================== KHỞI TẠO AI & BOT ====================
const GEMINI_KEY = process.env.GEMINI_API_KEY;
let aiModel = null;
try {
  if (GEMINI_KEY) {
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
} catch (err) { console.error('❌ Lỗi Gemini AI:', err); }

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 90000 });

// ==================== HÀM TIỆN ÍCH TIỀN TỆ ====================
function parseAmount(amountStr) {
  if (!amountStr) return 0;
  let cleanStr = amountStr.toString().toLowerCase().trim();
  let multiplier = 1;

  if (cleanStr.endsWith('tr')) {
    multiplier = 1000000;
    cleanStr = cleanStr.slice(0, -2);
  } else if (cleanStr.endsWith('k')) {
    multiplier = 1000;
    cleanStr = cleanStr.slice(0, -1);
  }

  cleanStr = cleanStr.replace(/[^0-9.,]/g, '').replace(',', '.');
  const num = parseFloat(cleanStr);
  return isNaN(num) ? 0 : num * multiplier;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getBudgetSpent(userId, category, month) {
  try {
    const [year, monthNum] = month.split('-');
    const startDate = new Date(`${year}-${monthNum}-01`);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const result = await Transaction.aggregate([
      {
        $match: {
          telegramUserId: userId,
          category: category.toLowerCase(),
          createdAt: { $gte: startDate, $lt: endDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result.length > 0 ? result[0].total : 0;
  } catch (err) { return 0; }
}

// ==================== HÀM THỐNG KÊ & XUẤT EXCEL ====================
async function getStatsSummary(userId) {
  try {
    const transactions = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 });
    if (transactions.length === 0) return '📭 Chưa có giao dịch nào.';

    const categoryStats = {};
    transactions.forEach(tx => {
      if (!categoryStats[tx.category]) categoryStats[tx.category] = 0;
      categoryStats[tx.category] += tx.amount;
    });

    const totalAmount = Object.values(categoryStats).reduce((a, b) => a + b, 0);
    const now = new Date();
    const thisMonth = transactions.filter(t => {
      const txDate = new Date(t.createdAt);
      return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
    });
    const thisMonthTotal = thisMonth.reduce((sum, t) => sum + t.amount, 0);

    let report = `📊 **BÁO CÁO THÁNG NÀY**\n`;
    report += `💰 Tổng chi: ${thisMonthTotal.toLocaleString('vi-VN')} VNĐ\n`;
    report += `📝 Số GD: ${thisMonth.length}\n`;
    report += `📈 Trung bình/ngày: ${(thisMonthTotal / Math.max(1, thisMonth.length)).toFixed(0).toLocaleString('vi-VN')} VNĐ\n\n`;
    
    report += `📌 **TOP DANH MỤC**\n`;
    Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([cat, amount], idx) => {
        const pct = totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : 0;
        report += `${idx + 1}. ${cat}: ${amount.toLocaleString('vi-VN')} VNĐ (${pct}%)\n`;
      });
    return report;
  } catch (err) { return '❌ Lỗi khi tính toán.'; }
}

async function generateExcelReport(userId) {
  try {
    const transactions = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 });
    if (transactions.length === 0) return null;

    const workbook = new ExcelJS.Workbook();
    
    // Sheet 1: Chi tiết
    const sheet1 = workbook.addWorksheet('Giao dịch');
    sheet1.columns = [
      { header: 'Danh mục', key: 'category', width: 20 },
      { header: 'Số tiền (VNĐ)', key: 'amount', width: 15 },
      { header: 'Loại', key: 'type', width: 10 },
      { header: 'Ngày tạo', key: 'createdAt', width: 20 }
    ];
    transactions.forEach(tx => {
      sheet1.addRow({
        category: tx.category, amount: tx.amount.toLocaleString('vi-VN'),
        type: tx.type, createdAt: new Date(tx.createdAt).toLocaleString('vi-VN')
      });
    });

    const exportDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const filename = `Bao_Cao_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filepath = path.join(exportDir, filename);
    await workbook.xlsx.writeFile(filepath);
    return filepath;
  } catch (err) { return null; }
}

// ==================== HỆ THỐNG QUÉT LỊCH HẸN TỰ ĐỘNG ====================
setInterval(async () => {
  try {
    const now = new Date();
    const reminders = await Reminder.find({
      dueDate: { $lte: now },
      isNotified: { $ne: true }
    });

    for (const r of reminders) {
      await bot.telegram.sendMessage(
        r.telegramUserId,
        `⏰ **ĐẾN HẠN THANH TOÁN!**\nBạn có một lịch hẹn cần chi trả:\n\n📌 **Mục:** ${r.title}\n💰 **Số tiền:** ${r.amount.toLocaleString('vi-VN')} VNĐ`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Đã thanh toán', `confirm_rem_${r._id}`)],
            [Markup.button.callback('❌ Hủy bỏ', `cancel_rem_${r._id}`)]
          ])
        }
      );
      await Reminder.updateOne({ _id: r._id }, { $set: { isNotified: true } }, { strict: false });
    }
  } catch (err) { console.error('Lỗi quét lịch:', err); }
}, 60000); 

// ==================== LỆNH BOT (COMMANDS) ====================
bot.start((ctx) => {
  ctx.reply(
    '🤖 **Chào bạn!** Bot quản lý chi tiêu (Bản Full) đã sẵn sàng.\n\n' +
    '📌 **LỆNH CƠ BẢN:**\n' +
    '• Ghi nhanh: `ăn trưa 30k`\n' +
    '• Đặt lịch hẹn: `hẹn tiền mạng 200k ngày 10/8`\n' +
    '• 💰 Đặt ngân sách: `/ngansach ăn sáng 500k`\n' +
    '• 📊 Xem thống kê: `/thongke`\n' +
    '• 📊 Xem ngân sách: `/xemngansach`\n' +
    '• 📥 Xuất Excel: `/excel`\n' +
    '• 🤖 Hỏi AI: `ai tôi nên tiết kiệm thế nào?`\n' +
    '• ❌ Xóa gần nhất: `/xoa`',
    { parse_mode: 'Markdown' }
  );
});

bot.command('thongke', async (ctx) => {
  await ctx.sendChatAction('typing');
  const summary = await getStatsSummary(ctx.from.id);
  ctx.reply(summary, { parse_mode: 'Markdown' });
});

bot.command('ngansach', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    const match = args.match(/^(.+?)\s+([\d.,]+[k|tr]?)$/i);
    if (!match) return ctx.reply('❌ Cú pháp: `/ngansach ăn sáng 500k`', { parse_mode: 'Markdown' });

    const category = match[1].trim().toLowerCase();
    const limit = parseAmount(match[2]);
    const currentMonth = getCurrentMonth();
    
    await Transaction.updateOne(
      { telegramUserId: ctx.from.id, category, budget_month: currentMonth },
      { budget_limit: limit, budget_month: currentMonth },
      { upsert: true }
    );
    ctx.reply(`✅ **Đã đặt ngân sách!**\nMục: ${category} | Hạn mức: ${limit.toLocaleString('vi-VN')}đ`, { parse_mode: 'Markdown' });
  } catch (err) { ctx.reply('❌ Lỗi đặt ngân sách.'); }
});

bot.command('xemngansach', async (ctx) => {
  try {
    const currentMonth = getCurrentMonth();
    const budgets = await Transaction.find({ telegramUserId: ctx.from.id, budget_month: currentMonth, budget_limit: { $ne: null } }).distinct('category');
    if (budgets.length === 0) return ctx.reply('📭 Chưa có ngân sách nào.');

    let report = `💰 **NGÂN SÁCH THÁNG ${currentMonth}**\n\n`;
    for (const category of budgets) {
      const budgetDoc = await Transaction.findOne({ telegramUserId: ctx.from.id, category, budget_month: currentMonth, budget_limit: { $ne: null } });
      const spent = await getBudgetSpent(ctx.from.id, category, currentMonth);
      const limit = budgetDoc.budget_limit;
      const pct = limit > 0 ? ((spent / limit) * 100).toFixed(1) : 0;
      report += `${pct >= 100 ? '🔴' : '✅'} **${category}**: Đã tiêu ${spent.toLocaleString('vi-VN')} / ${limit.toLocaleString('vi-VN')}đ (${pct}%)\n`;
    }
    ctx.reply(report, { parse_mode: 'Markdown' });
  } catch (err) { ctx.reply('❌ Lỗi xem ngân sách.'); }
});

bot.command('excel', async (ctx) => {
  try {
    await ctx.sendChatAction('upload_document');
    const filepath = await generateExcelReport(ctx.from.id);
    if (!filepath) return ctx.reply('📭 Chưa có dữ liệu.');
    await ctx.replyWithDocument({ source: filepath }, { caption: `📊 Báo cáo Excel` });
    fs.unlinkSync(filepath);
  } catch (err) { ctx.reply('❌ Lỗi xuất Excel.'); }
});

bot.command('xoa', async (ctx) => {
  try {
    const lastTx = await Transaction.findOne({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
    if (!lastTx) return ctx.reply('📭 Không có giao dịch.');
    await Transaction.findByIdAndDelete(lastTx._id);
    ctx.reply(`🗑️ Đã xóa gần nhất: ${lastTx.category} - ${lastTx.amount.toLocaleString('vi-VN')}đ`);
  } catch (err) { ctx.reply('❌ Lỗi xóa.'); }
});

// ==================== LẮNG NGHE LỜI NÓI (HEARS) ====================
// Đặt lịch hẹn
bot.hears(/^hẹn\s+(.+?)\s+([\d.,]+[k|tr]?)\s+ngày\s+(\d{1,2}\/\d{1,2})/i, async (ctx) => {
  try {
    const title = ctx.match[1].trim();
    const rawAmount = parseAmount(ctx.match[2]);
    const dateStr = ctx.match[3];
    const [day, month] = dateStr.split('/');
    const dueDate = new Date(new Date().getFullYear(), parseInt(month) - 1, parseInt(day), 8, 0, 0);

    await Reminder.create({ telegramUserId: ctx.from.id, title, amount: rawAmount, dueDate });
    ctx.reply(`📅 **Đã lưu lịch!**\nSẽ nhắc thanh toán ${title} (${rawAmount.toLocaleString('vi-VN')}đ) lúc 8:00 sáng ngày ${dateStr}.`, { parse_mode: 'Markdown' });
  } catch (err) { ctx.reply('❌ Lỗi lưu lịch hẹn.'); }
});

// Ghi tiêu tiền nhanh (ĐÃ FIX LỖI)
bot.hears(/^(.+?)\s+([\d.,]+[k|tr]?)$/i, async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn') || text.toLowerCase().startsWith('ai')) return;
  try {
    const category = ctx.match[1].trim();
    const amount = parseAmount(ctx.match[2]);
    if (amount <= 0) return;

    const tx = await Transaction.create({ telegramUserId: ctx.from.id, amount, type: 'CHI', category });
    await ctx.reply(`✅ [BẢN CHUẨN] Đã ghi nhận:\n📂 **${category}**: **${amount.toLocaleString('vi-VN')} VNĐ**`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Xóa', `delete_tx_${tx._id}`)]])
    });
  } catch (err) { ctx.reply('❌ Lỗi ghi nhận.'); }
});

// Hỏi AI
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (aiModel && (text.toLowerCase().startsWith('ai ') || text.toLowerCase().startsWith('gemini '))) {
    try {
      await ctx.sendChatAction('typing');
      const queryText = text.replace(/^(ai|gemini)\s+/i, '');
      const prompt = `Bạn là trợ lý tài chính. Câu hỏi: "${queryText}". Trả lời ngắn gọn bằng tiếng Việt.`;
      const result = await aiModel.generateContent(prompt);
      ctx.reply(result.response.text());
    } catch (err) { ctx.reply('❌ AI đang bận.'); }
  }
});

// ==================== CÁC NÚT BẤM (ACTIONS) ====================
bot.action(/^delete_tx_(.+)$/, async (ctx) => {
  try {
    const deleted = await Transaction.findByIdAndDelete(ctx.match[1]);
    if (deleted) await ctx.editMessageText(`🗑️ Đã xóa: ${deleted.category} - ${deleted.amount.toLocaleString('vi-VN')}đ`);
  } catch (err) { ctx.answerCbQuery('Lỗi xóa.'); }
});

bot.action(/^confirm_rem_(.+)$/, async (ctx) => {
  try {
    const r = await Reminder.findById(ctx.match[1]);
    if (!r) return ctx.answerCbQuery('Lịch hẹn không còn!');
    await Transaction.create({ telegramUserId: r.telegramUserId, amount: r.amount, type: 'CHI', category: r.title });
    await Reminder.findByIdAndDelete(r._id);
    await ctx.editMessageText(`✅ Đã thanh toán: **${r.title}** - ${r.amount.toLocaleString('vi-VN')}đ`, { parse_mode: 'Markdown' });
  } catch(err) { ctx.answerCbQuery('Lỗi xử lý!'); }
});

bot.action(/^cancel_rem_(.+)$/, async (ctx) => {
  try {
    await Reminder.findByIdAndDelete(ctx.match[1]);
    await ctx.editMessageText('❌ Đã hủy lịch hẹn này.', { parse_mode: 'Markdown' });
  } catch(err) { ctx.answerCbQuery('Lỗi xử lý!'); }
});

// Bật Bot
bot.launch().then(() => console.log('🤖 Bot đang chạy (Bản Full)!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
