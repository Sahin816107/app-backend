const mongoose = require('mongoose');

const posterSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      trim: true,
    },

    thumbnailUrl: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnailFileId: {
      type: String,
      default: null,
    },

    releaseDate: {
      type: Date,
      required: true,
      default: () => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return d;
      },
    },

    // ✅ Upcoming poster → duration 0 allowed
    duration: {
      type: Number,
      min: 0,
      default: 0,
    },

    isFree: {
      type: Boolean,
      default: false,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isUpcoming: {
      type: Boolean,
      default: true,
    },

    views: {
      type: Number,
      default: 0,
    },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    language: {
      type: String,
      default: 'English',
    },

    ageRestriction: {
      type: String,
      enum: ['All', '13+', '16+', '18+'],
      default: 'All',
    },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published', 'archived'],
      default: 'scheduled',
    },

    reminders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    reminderCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

//
// ✅ FIXED: pre save hook (NO next())
// 
posterSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

//
// ===== Virtuals =====
//
posterSchema.virtual('formattedDuration').get(function () {
  const total = this.duration || 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s
      .toString()
      .padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
});

posterSchema.virtual('releaseDateFormatted').get(function () {
  return this.releaseDate
    ? this.releaseDate.toISOString().split('T')[0]
    : '';
});

posterSchema.virtual('daysUntilRelease').get(function () {
  if (!this.releaseDate) return null;
  const now = new Date();
  const diff = this.releaseDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

posterSchema.virtual('statusText').get(function () {
  if (this.status === 'archived') return 'Archived';
  if (this.status === 'published') return 'Published';
  if (this.status === 'draft') return 'Draft';

  const days = this.daysUntilRelease;
  if (days > 0) return `Coming in ${days} day${days > 1 ? 's' : ''}`;
  return 'Released';
});

//
// ===== Methods =====
//
posterSchema.methods.isReleased = function () {
  return new Date() >= new Date(this.releaseDate);
};

posterSchema.methods.updateStatus = function () {
  if (this.status === 'archived') return;
  this.status = this.isReleased() ? 'published' : 'scheduled';
};

//
// ===== Statics =====
//
posterSchema.statics.getUpcoming = function (limit = 20) {
  return this.find({
    isActive: true,
    status: { $in: ['scheduled', 'draft'] },
    releaseDate: { $gt: new Date() },
  })
    .sort({ releaseDate: 1 })
    .limit(limit)
    .populate('uploadedBy', 'username name phoneNumber') // ✅ CHANGED
    .lean();
};

posterSchema.statics.getFeatured = function (limit = 10) {
  return this.find({
    isActive: true,
    isFeatured: true,
    status: { $in: ['scheduled', 'published'] },
  })
    .sort({ releaseDate: 1 })
    .limit(limit)
    .populate('uploadedBy', 'username name phoneNumber') // ✅ CHANGED
    .lean();
};

module.exports = mongoose.model('Poster', posterSchema);
