const User = require('../models/User');

// Middleware to check if user has active subscription
const requireSubscription = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admins have full access
    if (user.isAdmin) {
      return next();
    }

    // Check if user has active subscription
    const currentUser = await User.findById(user._id);
    
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const hasActiveSubscription = currentUser.isSubscribed && 
      (!currentUser.subscriptionExpires || 
       new Date() < new Date(currentUser.subscriptionExpires));

    if (!hasActiveSubscription) {
      return res.status(403).json({
        success: false,
        message: 'Subscription required to access this content',
        code: 'SUBSCRIPTION_REQUIRED',
        trialSeconds: 30 // 30-second free trial
      });
    }

    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Middleware to check subscription status (returns status without blocking)
const checkSubscriptionStatus = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      req.subscriptionStatus = {
        hasSubscription: false,
        isTrial: false,
        trialSeconds: 30
      };
      return next();
    }

    const currentUser = await User.findById(user._id);
    
    if (!currentUser) {
      req.subscriptionStatus = {
        hasSubscription: false,
        isTrial: false,
        trialSeconds: 30
      };
      return next();
    }

    const hasActiveSubscription = currentUser.isSubscribed && 
      (!currentUser.subscriptionExpires || 
       new Date() < new Date(currentUser.subscriptionExpires));

    req.subscriptionStatus = {
      hasSubscription: hasActiveSubscription,
      isTrial: !hasActiveSubscription,
      trialSeconds: 30,
      subscriptionExpires: currentUser.subscriptionExpires,
      subscriptionPlan: currentUser.subscriptionPlan
    };

    next();
  } catch (error) {
    console.error('Subscription status middleware error:', error);
    req.subscriptionStatus = {
      hasSubscription: false,
      isTrial: false,
      trialSeconds: 30
    };
    next();
  }
};

module.exports = {
  requireSubscription,
  checkSubscriptionStatus
};