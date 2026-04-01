const Razorpay = require('razorpay');

// Razorpay configuration - Required for production
let razorpayInstance = null;

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('❌ CRITICAL: Razorpay keys are missing in .env file!');
  console.error('Please ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.');
} else {
  const keyId = process.env.RAZORPAY_KEY_ID.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET.trim();
  
  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
  console.log('✅ Razorpay initialized successfully for real payments');
}

// Subscription plans configuration
const subscriptionPlans = {
  monthly: {
    amount: 399900, // ₹3999 in paise
    currency: 'INR',
    duration: 'month',
    description: 'Monthly Subscription - Unlimited Access'
  },
  quarterly: {
    amount: 799900, // ₹7999 in paise
    currency: 'INR',
    duration: '3 months',
    description: 'Quarterly Subscription - Best Value'
  },
  yearly: {
    amount: 1599900, // ₹15999 in paise
    currency: 'INR',
    duration: 'year',
    description: 'Yearly Subscription - Maximum Savings'
  }
};

// Validate Razorpay signature
const validateSignature = (orderId, paymentId, signature) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      console.error('❌ RAZORPAY_KEY_SECRET is missing - Signature validation failed');
      return false;
    }
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET.trim());
    hmac.update(orderId + '|' + paymentId);
    const generatedSignature = hmac.digest('hex');
    
    const isValid = generatedSignature === signature;
    if (!isValid) {
      console.warn('⚠️ Invalid payment signature detected!');
    }
    return isValid;
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
};

module.exports = {
  razorpayInstance,
  subscriptionPlans,
  validateSignature
};