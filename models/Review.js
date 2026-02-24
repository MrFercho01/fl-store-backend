const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: true,
    trim: true,
  },
  productId: {
    type: String,
    required: true,
    trim: true,
  },
  productName: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 600,
  },
  recommend: {
    type: Boolean,
    default: false,
  },
  visitorLikes: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  createdFromIp: {
    type: String,
    default: '',
  },
  createdFromUserAgent: {
    type: String,
    default: '',
  },
  moderationHistory: {
    type: [{
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        required: true,
      },
      changedBy: {
        type: String,
        default: '',
      },
      ipAddress: {
        type: String,
        default: '',
      },
      userAgent: {
        type: String,
        default: '',
      },
      changedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    default: [],
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Review', reviewSchema);
