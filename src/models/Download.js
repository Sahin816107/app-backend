// backend/src/models/Download.js
const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: true
  },
  downloadedDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  isWatched: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: '0 MB'
  },
  localPath: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'downloading', 'completed', 'failed'],
    default: 'completed'
  },
  progress: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

// Create compound index for faster queries
downloadSchema.index({ userId: 1, videoId: 1 }, { unique: true });
downloadSchema.index({ downloadedDate: -1 });
downloadSchema.index({ isWatched: 1 });

module.exports = mongoose.model('Download', downloadSchema);