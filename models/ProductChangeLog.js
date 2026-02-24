const mongoose = require('mongoose');

const productChangeLogSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    index: true,
  },
  operation: {
    type: String,
    enum: ['create', 'update', 'delete'],
    required: true,
  },
  ipAddress: {
    type: String,
    default: '',
  },
  userAgent: {
    type: String,
    default: '',
  },
  changedFields: {
    type: [{
      field: { type: String, required: true },
      from: { type: mongoose.Schema.Types.Mixed, default: null },
      to: { type: mongoose.Schema.Types.Mixed, default: null },
    }],
    default: [],
  },
  productSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('ProductChangeLog', productChangeLogSchema);
