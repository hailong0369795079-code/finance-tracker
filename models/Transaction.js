const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  telegramUserId: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['CHI', 'THU', 'DAUTU'], required: true },
  category: { type: String, required: true },
  note: { type: String, default: '' },
  source: { type: String, default: 'WEB' },
  budget_limit: { type: Number, default: null }, // Ngân sách cho danh mục này
  budget_month: { type: String, default: null }  // Tháng ngân sách (format: "2024-01")
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);