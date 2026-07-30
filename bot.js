const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// DATABASE CẤU HÌNH & NHẮC HẸN
const settingSchema = new mongoose.Schema({ telegramUserId: Number, budget: Number });
const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);

const reminderSchema = new mongoose.Schema({ telegramUserId: Number, title: String, amount: Number, date: String });
const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);

// HÀM LẤY NGÀY HIỆN TẠI THEO MÚI GIỜ VIỆT NAM (YYYY-MM-DD)
function getVNDateString(date = new Date()) {
  const options = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  let y, m, d;
  parts.forEach(p => {
    if (p.type === 'year') y = p.value;
    if (p.type === 'month') m = p.value;
    if (p.type === 'day') d = p.value;
  });
  return `${y}-${m}-${d}`;
}

// TỰ ĐỘNG QUÉT VÀ NHẮC HẸN MỖI NGÀY VÀO LÚC 8:00 SÁNG
function startDailyReminderCron() {
  setInterval(async () => {
    const now = new Date();
    const options = { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', minute: 'numeric', hour12: false };
    const timeParts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
    let hour = 0, minute = 0;
    timeParts.forEach(p => {
      if (p.type === 'hour') hour = parseInt(p.value);
      if (p.type === 'minute') minute = parseInt(p.value);
    });

    // Chạy kiểm tra vào lúc 8 giờ 0 phút sáng mỗi ngày
    if (hour === 8 && minute === 0) {
      const todayStr = getVNDateString();
      try {
        const dueReminders = await Reminder.find({ date: todayStr });
        for (const r of dueReminders) {
          if (r.telegramUserId) {
            const formattedAmt = new Intl.NumberFormat('vi-VN').format(r.amount);
            await bot.telegram.sendMessage(r.telegramUserId, `🔔 **NHẮC HẠN THANH TOÁN HÔM NAY!**\n\n📌 Khoản: *${r.title}*\n💰 Số tiền: *${formattedAmt}đ*\n📅 Hạn chót: Hôm nay (${todayStr})`, { parse_mode: 'Markdown' });
          }
        }
      } catch (err) {
        console.error('Lỗi cron nhắc hẹn:', err);
      }
    }
  }, 60 * 1000); // Kiểm tra mỗi phút một lần
}
startDailyReminderCron();

// 1. Lệnh /start
bot.start((ctx) => {
  return ctx.reply('🚀 **Quản Gia Tài Chính AI** đã sẵn sàng!\n\n👉 **Gửi ảnh bill:** AI tự động đọc & lưu.\n👉 **Gõ chữ:** "50k ăn sáng", "2tr lương"\n\n🛠 **CÁC LỆNH HỖ TRỢ:**\n/ngansach <số tiền> - Cài hạn mức\n/thongke - Phân tích chi tiêu tháng\n/nhaclich <tên> | <số tiền> | <YYYY-MM-DD> - Thêm lịch hẹn\n/danhsachnhac - Xem các lịch hẹn\n/excel - Tải file Excel\n/xoa - Xóa giao dịch', { parse_mode: 'Markdown' });
});

// 2. Lệnh /ngansach
bot.command('ngansach', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/ngansach', '').trim();
  const amountMatch = text.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!amountMatch) return ctx.reply('⚠️ Định dạng sai. VD: `/ngansach 10tr`', { parse_mode: 'Markdown' });

  let rawAmount = parseFloat(amountMatch[1].replace(/\./g, ''));
  const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
  if (unit === 'k') rawAmount *= 1000;
  if (unit === 'tr') rawAmount *= 1000000;

  await Setting.findOneAndUpdate({ telegramUserId: userId }, { budget: rawAmount }, { upsert: true, new: true });
  return ctx.reply(`🎯 Đã cập nhật ngân sách mới: **${new Intl.NumberFormat('vi-VN').format(rawAmount)}đ**`, { parse_mode: 'Markdown' });
});

// 3. Lệnh /nhaclich (Thêm nhắc hẹn nhanh qua Telegram)
bot.command('nhaclich', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/nhaclich', '').trim();
  const parts = text.split('|').map(p => p.trim());

  if (parts.length < 3) {
    return ctx.reply('⚠️ Vui lòng nhập đúng cú pháp:\n`/nhaclich Tiền điện | 450k | 2026-08-05`', { parse_mode: 'Markdown' });
  }

  const title = parts[0];
  const amountStr = parts[1];
  const date = parts[2]; // YYYY-MM-DD

  const amountMatch = amountStr.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!amountMatch) return ctx.reply('⚠️ Số tiền không hợp lệ.');
  let rawAmount = parseFloat(amountMatch[1].replace(/\./g, ''));
  const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
  if (unit === 'k') rawAmount *= 1000;
  if (unit === 'tr') rawAmount *= 1000000;

  try {
    const newR = await Reminder.create({ telegramUserId: userId, title, amount: rawAmount, date });
    if (global.io) global.io.emit('new_reminder', newR);
    return ctx.reply(`✅ **Đã thêm lịch nhắc thành công!**\n📌 ${title} - ${new Intl.NumberFormat('vi-VN').format(rawAmount)}đ vào ngày ${date}`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.reply('❌ Lỗi khi tạo lịch hẹn.');
  }
});

// 4. Lệnh /danhsachnhac
bot.command('danhsachnhac', async (ctx) => {
  try {
    const list = await Reminder.find().sort({ date: 1 });
    if (list.length === 0) return ctx.reply('📅 Hiện tại không có lịch hẹn nào.');
    let msg = `📅 **DANH SÁCH LỊCH HẸN:**\n\n`;
    list.forEach(r => {
      const formattedDate = r.date.split('-').reverse().join('/');
      msg += `📌 *${r.title}* - ${new Intl.NumberFormat('vi-VN').format(r.amount)}đ\n⏰ Hạn: ${formattedDate}\n\n`;
    });
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.reply('❌ Lỗi tải danh sách.');
  }
});

// 5. Lệnh /thongke
bot.command('thongke', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 7*3600*1000);
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 7*3600*1000);

    const txs = await Transaction.find({ telegramUserId: userId, createdAt: { $gte: start, $lte: end }, type: 'CHI' });
    const userSetting = await Setting.findOne({ telegramUserId: userId });
    const BUDGET = userSetting && userSetting.budget ? userSetting.budget : 10000000;

    if (txs.length === 0) return ctx.reply('📊 Tháng này bạn chưa có khoản chi nào!');

    let totalSpent = 0;
    const catMap = {};
    txs.forEach(tx => {
      totalSpent += tx.amount;
      catMap[tx.category] = (catMap[tx.category] || 0) + tx.amount;
    });

    let report = `📊 **BÁO CÁO THÁNG NÀY**\n\n💰 Tổng chi: **${new Intl.NumberFormat('vi-VN').format(totalSpent)}đ**\n\n`;
    for (const [cat, amt] of Object.entries(catMap)) {
      const p = ((amt / totalSpent) * 100).toFixed(1);
      report += `🔹 ${cat}: ${new Intl.NumberFormat('vi-VN').format(amt)}đ (${p}%)\n`;
    }
    const percent = (totalSpent / BUDGET) * 100;
    report += `\n🎯 Ngân sách: ${new Intl.NumberFormat('vi-VN').format(BUDGET)}đ (${percent.toFixed(1)}%)`;
    return ctx.reply(report, { parse_mode: 'Markdown' });
  } catch (e) {
    return ctx.reply('❌ Lỗi tạo thống kê.');
  }
});

// 6. Lệnh /excel
bot.command('excel', async (ctx) => {
  try {
    const txs = await Transaction.find({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 });
    if (txs.length === 0) return ctx.reply('Chưa có dữ liệu.');
    let csv = 'Ngay,Loai,So Tien,Danh Muc,Noi Dung\n';
    txs.forEach(tx => {
      const date = new Date(tx.createdAt).toLocaleDateString('vi-VN');
      csv += `${date},${tx.type},${tx.amount},${tx.category},${tx.note.replace(/,/g, ' ')}\n`;
    });
    const buffer = Buffer.from('\ufeff' + csv, 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `Bao_Cao.csv` }, { caption: '📑 File Excel của bạn đây!' });
  } catch (e) { return ctx.reply('❌ Lỗi xuất file.'); }
});

// 7. Lệnh /xoa
bot.command('xoa', async (ctx) => {
  try {
    const txs = await Transaction.find({ telegramUserId: ctx.from.id }).sort({ createdAt: -1 }).limit(5);
    if (txs.length === 0) return ctx.reply('✨ Không có giao dịch nào.');
    for (let tx of txs) {
      const amt = new Intl.NumberFormat('vi-VN').format(tx.amount);
      const time = new Date(tx.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
      await ctx.reply(`🔴 [${time}] ${tx.note} : ${amt}đ`, Markup.inlineKeyboard([Markup.button.callback('❌ Xóa', `del_${tx._id}`)]));
    }
  } catch (e) {}
});

bot.action(/^del_(.+)$/, async (ctx) => {
  try {
    const deleted = await Transaction.findByIdAndDelete(ctx.match[1]);
    if (deleted) {
      if (global.io) global.io.emit('delete_transaction', ctx.match[1]);
      await ctx.editMessageText(`✅ Đã xóa: ${deleted.note}`);
    }
  } catch (e) {}
});

// 8. XỬ LÝ ẢNH BILL (Gemini AI)
bot.on('photo', async (ctx) => {
  const processing = await ctx.reply('🤖 Đang đọc bill...');
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const link = await ctx.telegram.getFileLink(photo.file_id);
    const res = await fetch(link.href);
    const buf = Buffer.from(await res.arrayBuffer()).toString('base64');

    const prompt = `Đọc bill và trả về JSON chuẩn: {"amount": số_tiền, "type": "CHI", "note": "nội dung ngắn gọn", "category": "Ăn uống/Mua sắm/Di chuyển/Hóa đơn/Khác"}`;
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ inlineData: { mimeType: 'image/jpeg', data: buf } }, prompt]
    });

    const parsed = JSON.parse(result.text.trim().replace(/```json/g, '').replace(/```/g, '').trim());
    const newTx = await Transaction.create({ telegramUserId: ctx.from.id, type: parsed.type || 'CHI', amount: parsed.amount, note: parsed.note || 'Bill', category: parsed.category || 'Khác', source: 'AI-BILL' });
    if (global.io) global.io.emit('new_transaction', newTx);

    await ctx.telegram.deleteMessage(ctx.chat.id, processing.message_id);
    return ctx.reply(`✅ Đã ghi nhận bill: ${new Intl.NumberFormat('vi-VN').format(parsed.amount)}đ (${parsed.note})`);
  } catch (e) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, processing.message_id); } catch(err){}
    return ctx.reply('❌ Không đọc được ảnh bill. Bạn nhập tay giúp mình nhé!');
  }
});

// 9. XỬ LÝ TEXT GHI NHANH
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const match = text.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!match) return;

  let amt = parseFloat(match[1].replace(/\./g, ''));
  const unit = match[2] ? match[2].toLowerCase() : '';
  const note = text.replace(match[0], '').trim() || 'Chi tiêu khác';
  if (unit === 'k') amt *= 1000;
  if (unit === 'tr') amt *= 1000000;

  let type = 'CHI', cat = 'Chi tiêu hàng ngày';
  const lower = note.toLowerCase();
  if (lower.includes('lương') || lower.includes('thu')) { type = 'THU'; cat = 'Thu nhập'; }
  else if (lower.includes('ăn') || lower.includes('cafe')) cat = 'Ăn uống';
  else if (lower.includes('xăng') || lower.includes('grab')) cat = 'Di chuyển';

  const newTx = await Transaction.create({ telegramUserId: ctx.from.id, type, amount: amt, note, category: cat, source: 'BOT' });
  if (global.io) global.io.emit('new_transaction', newTx);
  return ctx.reply(`✅ Đã lưu: ${note} - ${new Intl.NumberFormat('vi-VN').format(amt)}đ`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;