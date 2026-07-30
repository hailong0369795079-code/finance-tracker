const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// DATABASE LƯU CẤU HÌNH NGÂN SÁCH CỦA NGƯỜI DÙNG
const settingSchema = new mongoose.Schema({
  telegramUserId: Number,
  budget: Number
});
const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);

// HÀM LẤY THỜI GIAN CHUẨN MÚI GIỜ VIỆT NAM (Tránh lệch giờ trên Render)
function getVietnamTime(date = new Date()) {
  const options = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const partMap = {};
  parts.forEach(p => partMap[p.type] = p.value);
  return new Date(`${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}`);
}

// 1. Lệnh /start
bot.start((ctx) => {
  return ctx.reply('🚀 **Quản Gia Tài Chính AI** đã sẵn sàng!\n\n👉 **Gửi ảnh bill:** AI tự động đọc & lưu.\n👉 **Gõ chữ:** "50k ăn sáng", "2tr lương"\n\n🛠 **CÁC LỆNH HỖ TRỢ:**\n/ngansach <số tiền> - Cài hạn mức (VD: /ngansach 10tr)\n/thongke - Phân tích chi tiêu tháng này\n/tim <từ khóa> - Tìm kiếm giao dịch cũ\n/excel - Tải dữ liệu ra file Excel\n/xoa - Xóa giao dịch', { parse_mode: 'Markdown' });
});

// 2. Lệnh /ngansach - Cài đặt hạn mức chi tiêu
bot.command('ngansach', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/ngansach', '').trim();
  
  const amountMatch = text.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!amountMatch) {
    return ctx.reply('⚠️ Vui lòng nhập đúng định dạng.\nVí dụ: `/ngansach 10tr` hoặc `/ngansach 5000000`', { parse_mode: 'Markdown' });
  }

  let rawAmount = parseFloat(amountMatch[1].replace(/\./g, ''));
  const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
  if (unit === 'k') rawAmount *= 1000;
  if (unit === 'tr') rawAmount *= 1000000;

  try {
    await Setting.findOneAndUpdate(
      { telegramUserId: userId },
      { budget: rawAmount },
      { upsert: true, new: true }
    );
    return ctx.reply(`🎯 **Đã cập nhật ngân sách tháng!**\nHạn mức mới của bạn là: **${new Intl.NumberFormat('vi-VN').format(rawAmount)}đ**`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.reply('❌ Có lỗi khi lưu ngân sách.');
  }
});

// 3. Lệnh /thongke - Phân tích & Cảnh báo ngân sách theo thời gian VN
bot.command('thongke', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const nowVN = getVietnamTime();
    const start = new Date(nowVN.getFullYear(), nowVN.getMonth(), 1, 0, 0, 0);
    const end = new Date(nowVN.getFullYear(), nowVN.getMonth() + 1, 0, 23, 59, 59);

    const txs = await Transaction.find({ telegramUserId: userId, createdAt: { $gte: start, $lte: end }, type: 'CHI' });
    const userSetting = await Setting.findOne({ telegramUserId: userId });
    const BUDGET_LIMIT = userSetting && userSetting.budget ? userSetting.budget : 10000000;

    if (txs.length === 0) return ctx.reply('📊 Tháng này bạn chưa có khoản chi tiêu nào!');

    let totalSpent = 0;
    const categoryTotals = {};

    txs.forEach(tx => {
      totalSpent += tx.amount;
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    });

    let report = `📊 **BÁO CÁO THÁNG NÀY**\n\n`;
    report += `💰 Tổng chi: **${new Intl.NumberFormat('vi-VN').format(totalSpent)}đ**\n\n`;
    
    for (const [cat, amount] of Object.entries(categoryTotals)) {
      const percent = ((amount / totalSpent) * 100).toFixed(1);
      report += `🔹 ${cat}: ${new Intl.NumberFormat('vi-VN').format(amount)}đ (${percent}%)\n`;
    }

    const budgetPercent = (totalSpent / BUDGET_LIMIT) * 100;
    report += `\n🎯 **Ngân sách:** ${new Intl.NumberFormat('vi-VN').format(BUDGET_LIMIT)}đ\n`;
    if (budgetPercent >= 100) {
      report += `🚨 **CẢNH BÁO:** Đã vượt quá 100% ngân sách! (${budgetPercent.toFixed(1)}%)`;
    } else if (budgetPercent >= 80) {
      report += `⚠️ **CHÚ Ý:** Sắp cạn ngân sách (${budgetPercent.toFixed(1)}%). Hãy tiết chế!`;
    } else {
      report += `✅ Tốt lắm, bạn đang kiểm soát tốt (${budgetPercent.toFixed(1)}%).`;
    }

    return ctx.reply(report, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Lỗi thongke:', err);
    return ctx.reply('❌ Lỗi tạo thống kê.');
  }
});

// 4. Lệnh /tim <từ khóa>
bot.hears(/^\/tim (.+)/i, async (ctx) => {
  const keyword = ctx.match[1].trim();
  const userId = ctx.from.id;
  try {
    const txs = await Transaction.find({ telegramUserId: userId, note: { $regex: keyword, $options: 'i' } }).sort({ createdAt: -1 }).limit(10);
    if (txs.length === 0) return ctx.reply(`🕵️ Không tìm thấy: "${keyword}"`);
    let msg = `🕵️ **Kết quả cho:** "${keyword}"\n\n`;
    txs.forEach(tx => {
      const amt = new Intl.NumberFormat('vi-VN').format(tx.amount);
      const date = new Date(tx.createdAt).toLocaleDateString('vi-VN');
      const icon = tx.type === 'THU' ? '🟢' : '🔴';
      msg += `${icon} [${date}] ${tx.note}: ${amt}đ\n`;
    });
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.reply('❌ Lỗi tìm kiếm.');
  }
});

// 5. Lệnh /excel
bot.command('excel', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const txs = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 });
    if (txs.length === 0) return ctx.reply('Bạn chưa có dữ liệu.');
    let csvString = 'Ngay,Loai,So Tien,Danh Muc,Noi Dung\n';
    txs.forEach(tx => {
      const date = new Date(tx.createdAt).toLocaleDateString('vi-VN');
      const noteClean = tx.note.replace(/,/g, ' ');
      csvString += `${date},${tx.type},${tx.amount},${tx.category},${noteClean}\n`;
    });
    const buffer = Buffer.from('\ufeff' + csvString, 'utf8');
    await ctx.replyWithDocument({ source: buffer, filename: `Bao_Cao_Tai_Chinh.csv` }, { caption: '📑 File của bạn đây!' });
  } catch (err) {
    return ctx.reply('❌ Lỗi xuất Excel.');
  }
});

// 6. Lệnh /xoa & Xử lý Callback Xóa
bot.command('xoa', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const txs = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 }).limit(5);
    if (txs.length === 0) return ctx.reply('✨ Bạn chưa có giao dịch nào.');
    await ctx.reply('🗑️ **Chọn giao dịch cần xóa:**', { parse_mode: 'Markdown' });
    for (let tx of txs) {
      const amt = new Intl.NumberFormat('vi-VN').format(tx.amount);
      const time = new Date(tx.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
      const typeLabel = tx.type === 'THU' ? '🟢' : '🔴';
      await ctx.reply(`${typeLabel} [${time}] ${tx.note} : ${amt}đ`, Markup.inlineKeyboard([Markup.button.callback('❌ Xóa', `del_${tx._id}`)]));
    }
  } catch (err) { console.error(err); }
});

bot.action(/^del_(.+)$/, async (ctx) => {
  const txId = ctx.match[1];
  try {
    const deletedTx = await Transaction.findByIdAndDelete(txId);
    if (deletedTx) {
      if (global.io) global.io.emit('delete_transaction', txId);
      await ctx.editMessageText(`✅ **Đã xóa:** ${deletedTx.note} (-${new Intl.NumberFormat('vi-VN').format(deletedTx.amount)}đ)`, { parse_mode: 'Markdown' });
    } else {
      await ctx.answerCbQuery('⚠️ Giao dịch này đã được xóa trước đó!');
    }
  } catch (err) {}
});

// 7. XỬ LÝ ẢNH BILL (Google Gemini AI)
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const processingMsg = await ctx.reply('🤖 Đang phân tích bill...');
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileLink.href);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const prompt = `Bạn là trợ lý tài chính. Đọc ảnh bill này và trả về JSON thuần túy: {"amount": số_tiền, "type": "CHI" hoặc "THU", "note": "nội dung ngắn gọn", "category": "Ăn uống/Mua sắm/Di chuyển/Hóa đơn/Lương/Khác"}`;
    
    const aiResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ inlineData: { mimeType: 'image/jpeg', data: base64Image } }, prompt]
    });

    let textResponse = aiResult.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(textResponse);

    if (!parsedData.amount || isNaN(parsedData.amount)) throw new Error('Không có số tiền');

    const newTx = await Transaction.create({
      telegramUserId: userId, type: parsedData.type || 'CHI', amount: parsedData.amount, note: parsedData.note || 'Chuyển khoản', category: parsedData.category || 'Khác', source: 'AI-BILL'
    });
    if (global.io) global.io.emit('new_transaction', newTx);

    const formattedAmount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(parsedData.amount);
    const typeLabelMap = { 'CHI': '🔴 Chi Tiêu', 'THU': '🟢 Thu Nhập', 'DAUTU': '🔵 Đầu Tư' };

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    return ctx.reply(`✅ **Đã ghi nhận!**\n\n📌 Loại: ${typeLabelMap[parsedData.type] || '🔴 Chi Tiêu'}\n💰 Số tiền: ${formattedAmount}\n📝 Nội dung: ${parsedData.note}\n🏷️ Danh mục: ${parsedData.category}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([Markup.button.callback('❌ Hủy / Xóa giao dịch này', `del_${newTx._id}`)])
    });
  } catch (err) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e){}
    return ctx.reply('❌ AI gặp sự cố khi đọc ảnh. Thử gõ text nhé!');
  }
});

// 8. XỬ LÝ CHỮ (Thống kê theo giờ VN & Ghi nhanh)
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const lowerText = text.toLowerCase();
  const userId = ctx.from.id;
  
  if (text.startsWith('/')) return;

  // HỎI THỐNG KÊ (Hôm nay, hôm qua, tháng này)
  if (lowerText.includes('chi') || lowerText.includes('tiêu')) {
    try {
      const nowVN = getVietnamTime();
      let start = new Date(nowVN);
      let end = new Date(nowVN);
      let timeLabel = '';

      if (lowerText.includes('hôm nay')) {
        start.setHours(0, 0, 0, 0); 
        end.setHours(23, 59, 59, 999); 
        timeLabel = 'Hôm nay';
      } else if (lowerText.includes('hôm qua')) {
        start.setDate(start.getDate() - 1); 
        start.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - 1); 
        end.setHours(23, 59, 59, 999); 
        timeLabel = 'Hôm qua';
      } else if (lowerText.includes('tháng này')) {
        start = new Date(nowVN.getFullYear(), nowVN.getMonth(), 1, 0, 0, 0);
        end = new Date(nowVN.getFullYear(), nowVN.getMonth() + 1, 0, 23, 59, 59);
        timeLabel = 'Tháng này';
      }

      if (timeLabel !== '') {
        const txs = await Transaction.find({ telegramUserId: userId, createdAt: { $gte: start, $lte: end }, type: 'CHI' });
        const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
        return ctx.reply(`📊 ${timeLabel} bạn đã chi: **${new Intl.NumberFormat('vi-VN').format(total)} đ**`, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      console.error('Lỗi truy vấn text thống kê:', e);
      return ctx.reply('❌ Lỗi thống kê.');
    }
  }

  // GHI NHANH
  const amountMatch = text.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!amountMatch) {
      if (lowerText.includes('nhắc nhở') || lowerText.includes('sổ nợ')) {
          return ctx.reply('🛠️ Tính năng "Nhắc nhở" và "Sổ nợ" đang phát triển. Sếp đợi bản sau nhé!');
      }
      return; 
  }

  let rawAmount = parseFloat(amountMatch[1].replace(/\./g, ''));
  const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
  const note = text.replace(amountMatch[0], '').trim() || 'Chi tiêu khác';
  if (unit === 'k') rawAmount *= 1000;
  if (unit === 'tr') rawAmount *= 1000000;

  let type = 'CHI'; let category = 'Chi tiêu hàng ngày';
  const lowerNote = note.toLowerCase();

  if (lowerNote.includes('lương') || lowerNote.includes('thu')) { type = 'THU'; category = 'Thu nhập'; }
  else if (lowerNote.includes('ăn') || lowerNote.includes('cà phê')) category = 'Ăn uống';
  else if (lowerNote.includes('xăng') || lowerNote.includes('xe') || lowerNote.includes('grab')) category = 'Di chuyển';
  else if (lowerNote.includes('mua') || lowerNote.includes('sắm')) category = 'Mua sắm';

  try {
    const newTx = await Transaction.create({
      telegramUserId: userId, type: type, amount: rawAmount, note: note, category: category, source: 'BOT'
    });
    if (global.io) global.io.emit('new_transaction', newTx);

    const formattedAmount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(rawAmount);
    const typeLabelMap = { 'CHI': '🔴 Chi Tiêu', 'THU': '🟢 Thu Nhập', 'DAUTU': '🔵 Đầu Tư' };

    return ctx.reply(`✅ **Đã ghi nhận!**\n\n📌 Loại: ${typeLabelMap[type]}\n💰 Số tiền: ${formattedAmount}\n📝 Nội dung: ${note}\n🏷️ Danh mục: ${category}`, { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([Markup.button.callback('❌ Hủy / Xóa', `del_${newTx._id}`)])
    });
  } catch (err) {
    console.error('Lỗi lưu ghi nhanh:', err);
    return ctx.reply('❌ Có lỗi lưu database!');
  }
});

module.exports = bot;