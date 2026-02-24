const mongoose = require('mongoose');

const mobileApkDownloadSchema = new mongoose.Schema({
  dayKey: {
    type: String,
    required: true,
    index: true,
  },
  ipAddress: {
    type: String,
    default: '',
  },
  userAgent: {
    type: String,
    default: '',
  },
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MobileApkDownload', mobileApkDownloadSchema);
