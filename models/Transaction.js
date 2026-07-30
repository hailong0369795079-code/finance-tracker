const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  telegramUserId: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['CHI', 'THU', 'DAUTU'], required: true },
  category: { type: String, required: true },
  note: { type: String, default: '' },
  source: { type: String, default: 'WEB' } // WEB, BOT, REMINDER
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);