require('dotenv').config();
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const Transaction = require('./models/Transaction');
const Reminder = require('./models/Reminder');

// Kết nối MongoDB
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

const BOT_TOKEN = process.env.BOT_TOKEN || "8902520402:AAFqK83aAdDO1xp6R0WHi6p27mrdtOd7EuM";
if (!BOT_TOKEN) {
  console.error('❌ Thiếu BOT_TOKEN trong biến môi trường!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ==================== HÀM NGÂN SÁCH ====================

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
  } catch (err) {
    console.error('Lỗi lấy chi tiêu:', err);
    return 0;
  }
}

// ==================== THỐNG KÊ & XUẤT EXCEL ====================

// Hàm tạo file Excel thống kê
async function generateExcelReport(userId) {
  try {
    const transactions = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 });
    
    if (transactions.length === 0) return null;

    const workbook = new ExcelJS.Workbook();
    
    // Sheet 1: Chi tiết giao dịch
    const sheet1 = workbook.addWorksheet('Giao dịch');
    sheet1.columns = [
      { header: 'Danh mục', key: 'category', width: 20 },
      { header: 'Số tiền (VNĐ)', key: 'amount', width: 15 },
      { header: 'Loại', key: 'type', width: 10 },
      { header: 'Ngày tạo', key: 'createdAt', width: 20 },
      { header: 'Ghi chú', key: 'note', width: 30 }
    ];

    transactions.forEach(tx => {
      sheet1.addRow({
        category: tx.category,
        amount: tx.amount.toLocaleString('vi-VN'),
        type: tx.type,
        createdAt: new Date(tx.createdAt).toLocaleString('vi-VN'),
        note: tx.note || ''
      });
    });

    // Định dạng header
    sheet1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

    // Sheet 2: Thống kê theo danh mục
    const categoryStats = {};
    transactions.forEach(tx => {
      if (!categoryStats[tx.category]) {
        categoryStats[tx.category] = 0;
      }
      categoryStats[tx.category] += tx.amount;
    });

    const sheet2 = workbook.addWorksheet('Thống kê');
    sheet2.columns = [
      { header: 'Danh mục', key: 'category', width: 25 },
      { header: 'Tổng chi (VNĐ)', key: 'total', width: 20 },
      { header: 'Tỷ lệ (%)', key: 'percentage', width: 15 }
    ];

    const totalAmount = Object.values(categoryStats).reduce((a, b) => a + b, 0);
    Object.entries(categoryStats).forEach(([cat, amount]) => {
      sheet2.addRow({
        category: cat,
        total: amount.toLocaleString('vi-VN'),
        percentage: ((amount / totalAmount) * 100).toFixed(1)
      });
    });

    sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: 'FF70AD47' };

    // Sheet 3: Tóm tắt tháng
    const sheet3 = workbook.addWorksheet('Tóm tắt');
    const now = new Date();
    const thisMonth = transactions.filter(t => {
      const txDate = new Date(t.createdAt);
      return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
    });

    const thisMonthTotal = thisMonth.reduce((sum, t) => sum + t.amount, 0);
    const avgDaily = thisMonthTotal / Math.max(1, thisMonth.length);

    sheet3.columns = [
      { header: 'Chỉ số', key: 'metric', width: 25 },
      { header: 'Giá trị', key: 'value', width: 25 }
    ];

    sheet3.addRows([
      { metric: '📊 Tổng chi tháng này', value: thisMonthTotal.toLocaleString('vi-VN') + ' VNĐ' },
      { metric: '📝 Số giao dịch tháng này', value: thisMonth.length },
      { metric: '📈 Trung bình/ngày', value: avgDaily.toFixed(0).toLocaleString('vi-VN') + ' VNĐ' },
      { metric: '💰 Tổng chi toàn thời gian', value: totalAmount.toLocaleString('vi-VN') + ' VNĐ' },
      { metric: '📌 Danh mục nhiều nhất', value: Object.keys(categoryStats).reduce((a, b) => categoryStats[a] > categoryStats[b] ? a : b) }
    ]);

    sheet3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: 'FFC65911' };

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `Bao_Cao_Tai_Chinh_${timestamp}.xlsx`;
    const filepath = path.join(__dirname, 'exports', filename);
    
    // Tạo thư mục exports nếu chưa có
    const exportDir = path.join(__dirname, 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(filepath);
    return filepath;
  } catch (err) {
    console.error('Lỗi tạo Excel:', err);
    return null;
  }
}

// Hàm tạo báo cáo text thống kê
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
    report += `📝 Số giao dịch: ${thisMonth.length}\n`;
    report += `📈 Trung bình/ngày: ${(thisMonthTotal / Math.max(1, thisMonth.length)).toFixed(0).toLocaleString('vi-VN')} VNĐ\n\n`;
    
    report += `📌 **TOP DANH MỤC**\n`;
    Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([cat, amount], idx) => {
        const pct = ((amount / totalAmount) * 100).toFixed(1);
        report += `${idx + 1}. ${cat}: ${amount.toLocaleString('vi-VN')} VNĐ (${pct}%)\n`;
      });

    return report;
  } catch (err) {
    console.error('Lỗi tính toán:', err);
    return '❌ Lỗi khi tính toán.';
  }
}

// ==================== BOT COMMANDS ====================

// Lệnh /start
bot.start((ctx) => {
  ctx.reply(
    '🤖 **Chào bạn!** Bot quản lý chi tiêu & Gemini AI đã sẵn sàng.\n\n' +
    '📌 **HƯỚNG DẪN SỬ DỤNG:**\n' +
    '• Ghi nhanh: `ăn sáng 35k` hoặc `tiền nhà 3tr`\n' +
    '• Đặt lịch: `hẹn tiền điện 500k ngày 10/8`\n' +
    '• 💰 Đặt ngân sách: `/ngansach ăn sáng 500k`\n' +
    '• 📊 Xem thống kê: `/thongke`\n' +
    '• 📊 Xem ngân sách: `/xemngansach`\n' +
    '• 📥 Xuất Excel: `/excel`\n' +
    '• 🤖 Hỏi AI: `ai tôi nên tiết kiệm thế nào?`\n' +
    '• ❌ Xóa gần nhất: `/xoa`\n\n' +
    '💡 _Hãy bắt đầu ghi chi tiêu ngay!_',
    { parse_mode: 'Markdown' }
  );
});

// Lệnh /thongke - Xem thống kê
bot.command('thongke', async (ctx) => {
  try {
    await ctx.sendChatAction('typing');
    const summary = await getStatsSummary(ctx.from.id);
    ctx.reply(summary, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Lỗi thống kê:', err);
    ctx.reply('❌ Lỗi khi lấy thống kê.');
  }
});

// Lệnh /ngansach - Đặt ngân sách cho danh mục
bot.command('ngansach', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    const match = args.match(/^(.+?)\s+(\d+[k|tr]?)$/i);
    
    if (!match) {
      return ctx.reply('❌ Sai định dạng!\n\nUse: `/ngansach ăn sáng 500k`', { parse_mode: 'Markdown' });
    }

    const category = match[1].trim().toLowerCase();
    let limit = parseFloat(match[2]);
    if (match[2].toLowerCase().includes('k')) limit *= 1000;
    if (match[2].toLowerCase().includes('tr')) limit *= 1000000;

    const currentMonth = getCurrentMonth();
    
    // Lưu ngân sách vào transaction (một bản ghi đặc biệt)
    await Transaction.updateOne(
      { telegramUserId: ctx.from.id, category, budget_month: currentMonth },
      { budget_limit: limit, budget_month: currentMonth },
      { upsert: true }
    );

    ctx.reply(
      `✅ **Đã đặt ngân sách!**\n` +
      `📂 Danh mục: ${category}\n` +
      `💰 Giới hạn: ${limit.toLocaleString('vi-VN')} VNĐ\n` +
      `📅 Tháng: ${currentMonth}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Lỗi đặt ngân sách:', err);
    ctx.reply('❌ Lỗi khi đặt ngân sách.');
  }
});

// Lệnh /xemngansach - Xem ngân sách và tình trạng chi tiêu
bot.command('xemngansach', async (ctx) => {
  try {
    const currentMonth = getCurrentMonth();
    
    // Lấy tất cả ngân sách của user tháng này
    const budgets = await Transaction.find({
      telegramUserId: ctx.from.id,
      budget_month: currentMonth,
      budget_limit: { $ne: null }
    }).distinct('category');

    if (budgets.length === 0) {
      return ctx.reply('📭 Chưa có ngân sách nào.\n\nUse: `/ngansach ăn sáng 500k`', { parse_mode: 'Markdown' });
    }

    let report = `💰 **NGÂN SÁCH THÁNG ${currentMonth}**\n\n`;

    for (const category of budgets) {
      const budgetDoc = await Transaction.findOne({
        telegramUserId: ctx.from.id,
        category,
        budget_month: currentMonth,
        budget_limit: { $ne: null }
      });

      const spent = await getBudgetSpent(ctx.from.id, category, currentMonth);
      const limit = budgetDoc.budget_limit;
      const remaining = limit - spent;
      const percentage = ((spent / limit) * 100).toFixed(1);

      let status = '✅';
      if (percentage >= 100) status = '🔴';
      else if (percentage >= 80) status = '🟡';

      report += `${status} **${category}**\n`;
      report += `├ Giới hạn: ${limit.toLocaleString('vi-VN')} VNĐ\n`;
      report += `├ Đã chi: ${spent.toLocaleString('vi-VN')} VNĐ (${percentage}%)\n`;
      report += `└ Còn lại: ${Math.max(0, remaining).toLocaleString('vi-VN')} VNĐ\n\n`;
    }

    ctx.reply(report, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Lỗi xem ngân sách:', err);
    ctx.reply('❌ Lỗi khi lấy ngân sách.');
  }
});

// Lệnh /excel - Xuất file Excel
bot.command('excel', async (ctx) => {
  try {
    await ctx.sendChatAction('upload_document');
    const filepath = await generateExcelReport(ctx.from.id);
    
    if (!filepath) {
      return ctx.reply('📭 Chưa có dữ liệu để xuất.');
    }

    const filename = path.basename(filepath);
    await ctx.replyWithDocument(
      { source: filepath },
      { caption: `📊 Báo cáo tài chính - ${new Date().toLocaleDateString('vi-VN')}` }
    );

    // Xóa file tạm
    fs.unlinkSync(filepath);
  } catch (err) {
    console.error('Lỗi xuất Excel:', err);
    ctx.reply('❌ Lỗi khi xuất file Excel.');
  }
});

// Đặt lịch hẹn thanh toán
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
    
    ctx.reply(
      `📅 **Đã đặt lịch thành công!**\n- ${title}: ${rawAmount.toLocaleString('vi-VN')} VNĐ (Ngày ${dateStr})`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Lỗi hẹn lịch:', err);
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
      note: 'Ghi nhanh từ Telegram Bot',
      source: 'BOT'
    });

    await ctx.reply(
      `✅ Đã ghi nhận:\n📂 **${category}**: **${amount.toLocaleString('vi-VN')} VNĐ**`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Xóa', `delete_tx_${tx._id}`)]
        ])
      }
    );
  } catch (err) {
    console.error('Lỗi ghi giao dịch:', err);
    ctx.reply('❌ Không thể ghi nhận giao dịch.');
  }
});

// Hỏi AI tư vấn tài chính
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/') || text.toLowerCase().startsWith('hẹn')) return;

  if (aiModel && (text.toLowerCase().startsWith('ai ') || text.toLowerCase().startsWith('gemini '))) {
    try {
      await ctx.sendChatAction('typing');
      const queryText = text.replace(/^(ai|gemini)\s+/i, '');
      
      const transactions = await Transaction.find({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 }).limit(15);
      const summary = transactions.map(t => `- ${t.category}: ${t.amount.toLocaleString('vi-VN')}đ (${t.type})`).join('\n');

      const prompt = `Bạn là trợ lý tài chính thông minh. Dưới đây là các giao dịch gần đây của tôi:\n${summary}\n\nCâu hỏi: "${queryText}". Hãy trả lời ngắn gọn, thực tế và hữu ích bằng tiếng Việt.`;
      
      const result = await aiModel.generateContent(prompt);
      const responseText = result.response.text();

      return ctx.reply(responseText || 'Xin lỗi, tôi chưa thể đưa ra câu trả lời.');
    } catch (err) {
      console.error('Lỗi Gemini AI:', err);
      return ctx.reply('❌ Lỗi khi kết nối với Gemini AI.');
    }
  }
});

// Xóa giao dịch qua nút bấm
bot.action(/^delete_tx_(.+)$/, async (ctx) => {
  try {
    const txId = ctx.match[1];
    const deletedTx = await Transaction.findByIdAndDelete(txId);
    if (deletedTx) {
      await ctx.editMessageText(
        `🗑️ **Đã xóa thành công!**\n(${deletedTx.category} - ${deletedTx.amount.toLocaleString('vi-VN')} VNĐ)`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.answerCbQuery('Giao dịch không tồn tại.');
    }
  } catch (err) {
    console.error(err);
    await ctx.answerCbQuery('Lỗi khi xóa.');
  }
});

// Xóa giao dịch cuối cùng
bot.command('xoa', async (ctx) => {
  try {
    const lastTx = await Transaction.findOne({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
    if (!lastTx) return ctx.reply('📭 Không tìm thấy giao dịch nào.');

    await Transaction.findByIdAndDelete(lastTx._id);
    ctx.reply(`🗑️ Đã xóa: ${lastTx.category} - ${lastTx.amount.toLocaleString('vi-VN')} VNĐ`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Lỗi khi xóa.');
  }
});

// Khởi chạy bot
bot.launch().then(() => console.log('🤖 Telegram Bot đang chạy thành công!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));