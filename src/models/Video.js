const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  url: {
    type: String,
    required: [true, 'Video URL is required']
  },
  videoFileId: {
    type: String,
    default: null
  },
  qualities: {
    type: Map,
    of: String,
    default: {}
  },
  qualityFileIds: {
    type: Map,
    of: String,
    default: {}
  },
  thumbnailUrl: {
    type: String,
    required: [true, 'Thumbnail URL is required']
  },
  thumbnailFileId: {
    type: String,
    default: null
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: [0, 'Duration must be at least 0 second'],
    default: 0
  },
  isFree: {
    type: Boolean,
    default: false
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    lowercase: true,
    default: 'other'
  },
  
  // ✅ BOOLEAN FLAGS FOR SPECIAL SECTIONS
  isTrending: {
    type: Boolean,
    default: false
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  // ✅ Add back isFeatured here (not in enum)
  isFeatured: {
    type: Boolean,
    default: false
  },
  isExclusive: {
    type: Boolean,
    default: false
  },
  
  views: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileSize: {
    type: Number,
    default: 0
  },
  mimeType: {
    type: String,
    default: 'video/mp4'
  },
  tags: [{
    type: String,
    trim: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  // ✅ Optional: release date for upcoming videos
  releaseDate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
videoSchema.index({ title: 'text', description: 'text' });
videoSchema.index({ isFree: 1, isActive: 1 });
videoSchema.index({ uploadedBy: 1, createdAt: -1 });
videoSchema.index({ category: 1, isActive: 1 });

// Indexes for boolean flags
videoSchema.index({ isTrending: 1, isActive: 1 });
videoSchema.index({ isFeatured: 1, isActive: 1 });
videoSchema.index({ isExclusive: 1, isActive: 1 });
videoSchema.index({ isPopular: 1, isActive: 1 });

// ❌ REMOVE: This index doesn't exist anymore (sections field removed)
// videoSchema.index({ sections: 1, isActive: 1 });

// Virtual for formatted duration
videoSchema.virtual('formattedDuration').get(function() {
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = Math.floor(this.duration % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Method to increment views
videoSchema.methods.incrementViews = async function() {
  this.views += 1;
  await this.save();
};

const Video = mongoose.model('Video', videoSchema);

module.exports = Video;
