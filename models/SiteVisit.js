const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema({
  visitorId: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  dayKey: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  ipAddress: {
    type: String,
    default: '',
    trim: true,
  },
  userAgent: {
    type: String,
    default: '',
    trim: true,
  },
  firstVisitedAt: {
    type: Date,
    default: Date.now,
  },
  lastVisitedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: true,
});

siteVisitSchema.index({ visitorId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
