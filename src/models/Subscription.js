const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true
  },
  razorpayPaymentId: {
    type: String,
    default: null
  },
  razorpaySignature: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true
  },
  plan: {
    type: String,
    required: true,
    enum: ['monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'netbanking', 'upi', 'wallet', 'mock', null],
    default: null
  },
  subscriptionStart: {
    type: Date,
    default: Date.now
  },
  subscriptionEnd: {
    type: Date,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Index for better query performance
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ razorpayPaymentId: 1 });
subscriptionSchema.index({ subscriptionEnd: 1 });

// Virtual for checking if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return this.status === 'completed' && new Date() < this.subscriptionEnd;
});

// Method to calculate subscription end date based on plan
subscriptionSchema.statics.calculateEndDate = function(plan, startDate = new Date()) {
  const endDate = new Date(startDate);
  
  switch (plan) {
    case 'monthly':
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case 'quarterly':
      endDate.setMonth(endDate.getMonth() + 3);
      break;
    case 'yearly':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    default:
      endDate.setMonth(endDate.getMonth() + 1);
  }
  
  return endDate;
};

module.exports = mongoose.model('Subscription', subscriptionSchema);