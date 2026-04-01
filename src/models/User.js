const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters']
  },
  dateOfBirth: {
    type: Date,
    required: [true, 'Date of birth is required']
  },
  
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    match: [/^[0-9]{10,15}$/, 'Please enter a valid phone number (10-15 digits)']
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  
  isAdmin: {
    type: Boolean,
    default: false
  },
  
  isSubscribed: {
    type: Boolean,
    default: false
  },
  
  subscriptionExpires: {
    type: Date,
    default: null
  },
  
  subscriptionPlan: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly', null],
    default: null
  },
  
  subscriptionStart: {
    type: Date,
    default: null
  },
  
  razorpayCustomerId: {
    type: String,
    default: null
  },
  
  lastPaymentAttempt: {
    type: Date,
    default: null
  },
  
  refreshToken: {
    type: String,
    default: null
  },
  
  lastLogin: {
    type: Date,
    default: null
  },
  
  profileImage: {
    type: String,
    default: null
  },
  profileImageFileId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// ✅ FIXED: Simple pre-save hook
userSchema.pre('save', async function() {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return;
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error;
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
