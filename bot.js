const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const Transaction = require('./models/Transaction');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Lệnh /start
bot.start((ctx) => {
  return ctx.reply('🚀 **Bot Quản Lý Tài Chính 24/7** đã sẵn sàng!\n\n👉 **Gửi ảnh bill chuyển khoản:** AI Gemini sẽ tự động đọc tiền và lưu.\n👉 **Gõ text nhanh:** "50k ăn sáng", "2tr lương"\n👉 **Xem & hủy giao dịch:** Gõ /xoa\n👉 **Thống kê:** Gõ "Hôm nay tiêu bao nhiêu"', { parse_mode: 'Markdown' });
});

// 2. Lệnh /xoa để chọn giao dịch cần hủy
bot.command('xoa', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const txs = await Transaction.find({ telegramUserId: userId }).sort({ createdAt: -1 }).limit(5);
    
    if (txs.length === 0) {
      return ctx.reply('✨ Bạn chưa có giao dịch nào.');
    }
    
    await ctx.reply('🗑️ **Chọn giao dịch cần xóa:**', { parse_mode: 'Markdown' });
    
    for (let tx of txs) {
      const amt = new Intl.NumberFormat('vi-VN').format(tx.amount);
      const time = new Date(tx.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
      const typeLabel = tx.type === 'THU' ? '🟢 THU' : (tx.type === 'DAUTU' ? '🔵 ĐẦU TƯ' : '🔴 CHI');
      
      await ctx.reply(`${typeLabel} | [${time}] ${tx.note} : ${amt}đ`, 
        Markup.inlineKeyboard([
          Markup.button.callback('❌ Xóa ngay', `del_${tx._id}`)
        ])
      );
    }
  } catch (err) {
    console.error('Lỗi /xoa:', err);
  }
});

// 3. Xử lý nút bấm Xóa nhanh
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
  } catch (err) {
    await ctx.answerCbQuery('❌ Lỗi khi xóa!');
  }
});

// 4. XỬ LÝ ẢNH CHỤP MÀN HÌNH BẰNG GOOGLE GEMINI AI
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const processingMsg = await ctx.reply('🤖 AI đang phân tích bill chuyển khoản, đợi chút nhé...');

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    const response = await fetch(fileLink.href);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const prompt = `
      Bạn là một trợ lý tài chính thông minh. Hãy đọc bức ảnh chụp màn hình bill chuyển khoản ngân hàng/ví điện tử này và trả về kết quả CHÍNH XÁC dưới dạng một chuỗi JSON thuần túy (không kèm markdown như \`\`\`json) với cấu trúc sau:
      {
        "amount": con_số_nguyên_tố_tiền_chuyển_khoản (ví dụ: 50000),
        "type": "CHI" hoặc "THU" (nếu chuyển tiền đi là CHI, nhận tiền vào là THU),
        "note": "nội dung chuyển khoản hoặc tên người nhận ngắn gọn",
        "category": "danh mục phù hợp (ví dụ: Ăn uống, Mua sắm, Di chuyển, Lương, Hóa đơn, Khác)"
      }
    `;

    const aiResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        },
        prompt
      ]
    });

    let textResponse = aiResult.text.trim();
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsedData = JSON.parse(textResponse);

    if (!parsedData.amount || isNaN(parsedData.amount)) {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      return ctx.reply('❌ AI không tìm thấy số tiền hợp lệ trong bill này.');
    }

    const newTx = await Transaction.create({
      telegramUserId: userId,
      type: parsedData.type || 'CHI',
      amount: parsedData.amount,
      note: parsedData.note || 'Chuyển khoản qua bill',
      category: parsedData.category || 'Khác',
      source: 'AI-BILL'
    });

    if (global.io) global.io.emit('new_transaction', newTx);

    const formattedAmount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(parsedData.amount);
    const typeLabelMap = { 'CHI': '🔴 Chi Tiêu', 'THU': '🟢 Thu Nhập', 'DAUTU': '🔵 Đầu Tư' };

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    return ctx.reply(`✨ **AI đã đọc bill thành công!**\n\n📌 Loại: ${typeLabelMap[parsedData.type] || '🔴 Chi Tiêu'}\n💰 Số tiền: ${formattedAmount}\n📝 Nội dung: ${parsedData.note}\n🏷️ Danh mục: ${parsedData.category}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('❌ Hủy / Xóa giao dịch này', `del_${newTx._id}`)
      ])
    });

  } catch (err) {
    console.error('Lỗi Gemini AI đọc ảnh:', err);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch(e){}
    return ctx.reply('❌ AI gặp sự cố khi đọc hình ảnh này. Bạn hãy thử gửi ảnh rõ hơn hoặc gõ text nhé!');
  }
});

// 5. Lắng nghe tin nhắn văn bản thông thường
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const lowerText = text.toLowerCase();
  const userId = ctx.from.id;

  if (lowerText.includes('hôm nay') && (lowerText.includes('tiêu') || lowerText.includes('chi'))) {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    try {
      const txs = await Transaction.find({ telegramUserId: userId, createdAt: { $gte: start, $lte: end }, type: 'CHI' });
      const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
      return ctx.reply(`📊 Hôm nay bạn đã chi tổng cộng: **${new Intl.NumberFormat('vi-VN').format(total)} đ**`, { parse_mode: 'Markdown' });
    } catch (e) {
      return ctx.reply('❌ Lỗi thống kê.');
    }
  }

  const amountMatch = text.match(/(\d+[\d\.]*)\s*(k|tr)?/i);
  if (!amountMatch) return;

  let rawAmount = parseFloat(amountMatch[1].replace(/\./g, ''));
  const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
  const note = text.replace(amountMatch[0], '').trim() || 'Chi tiêu khác';
  
  if (unit === 'k') rawAmount *= 1000;
  if (unit === 'tr') rawAmount *= 1000000;

  let type = 'CHI';
  let category = 'Chi tiêu hàng ngày';
  const lowerNote = note.toLowerCase();

  if (lowerNote.includes('lương') || lowerNote.includes('thu') || lowerNote.includes('thưởng') || lowerNote.includes('nhận')) {
    type = 'THU';
    category = 'Thu nhập';
  } else if (lowerNote.includes('đầu tư') || lowerNote.includes('tiết kiệm') || lowerNote.includes('chứng khoán')) {
    type = 'DAUTU';
    category = 'Đầu tư / Tiết kiệm';
  } else {
    if (lowerNote.includes('ăn') || lowerNote.includes('uống') || lowerNote.includes('cà phê') || lowerNote.includes('phở')) category = 'Ăn uống';
    else if (lowerNote.includes('xăng') || lowerNote.includes('xe') || lowerNote.includes('grab')) category = 'Di chuyển';
    else if (lowerNote.includes('điện') || lowerNote.includes('nước') || lowerNote.includes('phòng trọ')) category = 'Hóa đơn';
    else if (lowerNote.includes('mua') || lowerNote.includes('sắm') || lowerNote.includes('quần áo')) category = 'Mua sắm';
  }

  try {
    const newTx = await Transaction.create({
      telegramUserId: userId,
      type: type,
      amount: rawAmount,
      note: note,
      category: category,
      source: 'BOT'
    });

    if (global.io) global.io.emit('new_transaction', newTx);

    const formattedAmount = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(rawAmount);
    const typeLabelMap = { 'CHI': '🔴 Chi Tiêu', 'THU': '🟢 Thu Nhập', 'DAUTU': '🔵 Đầu Tư' };

    return ctx.reply(`✅ **Đã ghi nhận!**\n\n📌 Loại: ${typeLabelMap[type]}\n💰 Số tiền: ${formattedAmount}\n📝 Nội dung: ${note}\n🏷️ Danh mục: ${category}`, { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('❌ Hủy / Xóa giao dịch này', `del_${newTx._id}`)
      ])
    });
  } catch (err) {
    console.error('Lỗi lưu Database:', err);
    return ctx.reply('❌ Có lỗi xảy ra khi lưu vào database!');
  }
});

module.exports = bot;