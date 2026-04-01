const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { razorpayInstance, subscriptionPlans, validateSignature } = require('../config/razorpay');

if (razorpayInstance && razorpayInstance.isMock) {
  console.log('🧪 RUNNING IN MOCK PAYMENT MODE');
}

// Create Razorpay order for subscription
const createSubscriptionOrder = async (req, res) => {
  try {
    const { plan = 'monthly' } = req.body;
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user._id;

    // Validate plan
    if (!subscriptionPlans[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan'
      });
    }

    const planConfig = subscriptionPlans[plan];
    
    // Create Razorpay order
    const options = {
      amount: planConfig.amount,
      currency: planConfig.currency,
      receipt: `s_${userId.toString().slice(-10)}_${Date.now().toString().slice(-8)}`,
      notes: {
        userId: userId.toString(),
        plan: plan,
        description: planConfig.description
      }
    };

    let order;
    try {
      order = await razorpayInstance.orders.create(options);
      console.log('✅ Razorpay Order Created:', order.id);
    } catch (razorpayError) {
      console.error('❌ Razorpay Error:', razorpayError);
      
      let errorMessage = 'Failed to create payment order';
      if (razorpayError.statusCode === 401) {
        errorMessage = 'Razorpay Authentication Failed. Please check your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env file.';
      }
      
      return res.status(razorpayError.statusCode || 500).json({
        success: false,
        message: errorMessage,
        error: razorpayError.message
      });
    }

    // Create subscription record
    const subscription = new Subscription({
      user: userId,
      razorpayOrderId: order.id,
      amount: planConfig.amount,
      currency: planConfig.currency,
      plan: plan,
      subscriptionEnd: Subscription.calculateEndDate(plan)
    });

    await subscription.save();

    // Update user's last payment attempt
    await User.findByIdAndUpdate(userId, {
      lastPaymentAttempt: new Date()
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.RAZORPAY_KEY_ID,
        plan: plan,
        description: planConfig.description
      }
    });

  } catch (error) {
    console.error('❌ Create subscription order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription order',
      error: error.message
    });
  }
};

// Verify payment and activate subscription
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user._id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment details'
      });
    }

    // Validate signature
    const isValidSignature = validateSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValidSignature) {
      console.warn('⚠️ Invalid payment signature for order:', razorpay_order_id);
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Find subscription
    const subscription = await Subscription.findOne({
      razorpayOrderId: razorpay_order_id,
      user: userId
    });

    if (!subscription) {
      console.warn('⚠️ Subscription record not found for order:', razorpay_order_id);
      return res.status(404).json({
        success: false,
        message: 'Subscription record not found'
      });
    }

    // Update subscription with payment details
    subscription.razorpayPaymentId = razorpay_payment_id;
    subscription.razorpaySignature = razorpay_signature;
    subscription.status = 'completed';
    subscription.paymentMethod = req.body.payment_method || 'card';
    subscription.metadata = {
      ...req.body,
      verifiedAt: new Date()
    };

    await subscription.save();
    console.log('✅ Subscription record updated:', subscription.razorpayOrderId);

    // Update user subscription status
    const user = await User.findByIdAndUpdate(
      userId,
      {
        isSubscribed: true,
        subscriptionExpires: subscription.subscriptionEnd,
        subscriptionPlan: subscription.plan,
        subscriptionStart: new Date(),
        lastPaymentAttempt: null
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ User subscription activated:', user._id);

    res.json({
      success: true,
      data: {
        message: 'Subscription activated successfully',
        subscription: {
          plan: subscription.plan,
          expires: subscription.subscriptionEnd,
          status: subscription.status
        },
        user: {
          isSubscribed: user.isSubscribed,
          subscriptionExpires: user.subscriptionExpires
        }
      }
    });

  } catch (error) {
    console.error('❌ Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message
    });
  }
};

// Get user subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const userId = req.user._id;

    const user = await User.findById(userId).select('isSubscribed subscriptionExpires subscriptionPlan subscriptionStart');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const activeSubscription = await Subscription.findOne({
      user: userId,
      status: 'completed',
      subscriptionEnd: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    // Calculate days remaining
    let daysRemaining = 0;
    let isExpired = true;

    if (user.isSubscribed && user.subscriptionExpires) {
      const now = new Date();
      const expires = new Date(user.subscriptionExpires);
      const diffTime = expires.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      isExpired = now > expires;

      // Update database if expired
      if (isExpired) {
        user.isSubscribed = false;
        user.subscriptionPlan = null;
        await user.save();
        console.log(`🕒 Subscription status check: Deactivated expired subscription for user ${userId}`);
      }
    }

    res.json({
      success: true,
      data: {
        isSubscribed: user.isSubscribed,
        subscriptionExpires: user.subscriptionExpires,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStart: user.subscriptionStart,
        daysRemaining,
        isExpired,
        activeSubscription: activeSubscription
      }
    });

  } catch (error) {
    console.error('❌ Get subscription status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription status',
      error: error.message
    });
  }
};

// Get subscription plans
const getSubscriptionPlans = async (req, res) => {
  try {
    console.log('Fetching subscription plans, config:', !!subscriptionPlans);
    
    if (!subscriptionPlans || Object.keys(subscriptionPlans).length === 0) {
      console.warn('⚠️ No subscription plans found in config');
    }

    const plansArray = Object.entries(subscriptionPlans || {}).map(([key, config]) => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      amount: config.amount / 100, // Convert paise to rupees
      currency: config.currency,
      duration: config.duration,
      description: config.description
    }));

    console.log(`✅ Returning ${plansArray.length} subscription plans`);

    res.json({
      success: true,
      data: {
        plans: plansArray
      }
    });
  } catch (error) {
    console.error('❌ Get subscription plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription plans',
      error: error.message
    });
  }
};

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus,
  getSubscriptionPlans
};
