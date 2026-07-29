const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  telegramUserId: { type: String, required: false }, // Cho phép lưu cả dạng số hoặc chuỗi
  type: { type: String, default: 'CHI' },           // CHI, THU, DAUTU
  amount: { type: Number, required: true },
  note: { type: String, required: true },
  category: { type: String, default: 'Khác' },
  source: { type: String, default: 'BOT' }            // BOT hoặc WEB
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);