const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  telegramUserId: { type: Number, default: 0 },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  isPaid: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', reminderSchema);