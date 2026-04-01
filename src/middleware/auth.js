



const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Generate tokens - UPDATED: removed username, added dateOfBirth
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { 
      id: user._id, 
      phoneNumber: user.phoneNumber,
      name: user.name,
      dateOfBirth: user.dateOfBirth, // ✅ ADDED
      isAdmin: user.isAdmin,
      isSubscribed: user.isSubscribed
    },
    process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-change-this-in-production',
    { expiresIn: '24h' }
  );
  
  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-this-in-production',
    { expiresIn: '30d' }
  );
  
  return { accessToken, refreshToken };
};

// Handle refresh token - UPDATED: removed username references
const handleRefreshToken = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    const refreshToken = authHeader.split(' ')[1];
    
    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-this-in-production');
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Refresh token expired',
          code: 'REFRESH_TOKEN_EXPIRED'
        });
      }
      return res.status(403).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
    
    // Find user with matching refresh token
    const user = await User.findOne({ 
      _id: decoded.id,
      refreshToken: refreshToken 
    });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
    
    // Generate new tokens
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user);
    
    // Update refresh token in database
    user.refreshToken = newRefreshToken;
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          _id: user._id,
          phoneNumber: user.phoneNumber,
          name: user.name,
          dateOfBirth: user.dateOfBirth, // ✅ ADDED
          isAdmin: user.isAdmin,
          isSubscribed: user.isSubscribed,
          subscriptionExpires: user.subscriptionExpires,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    });
    
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify access token - UPDATED: Enhanced with debug logging
const verifyToken = async (req, res, next) => {
  try {
    console.log('🔐 [AUTH MIDDLEWARE] Verifying token...');
    console.log('📨 Request Headers:', {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    });
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.log('❌ [AUTH MIDDLEWARE] No Authorization header found');
      return res.status(401).json({
        success: false,
        message: 'Access token is required',
        code: 'MISSING_TOKEN'
      });
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      console.log('❌ [AUTH MIDDLEWARE] Invalid Authorization header format:', authHeader);
      return res.status(401).json({
        success: false,
        message: 'Invalid token format. Use: Bearer <token>',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }
    
    const token = authHeader.split(' ')[1];
    console.log(`🔍 [AUTH MIDDLEWARE] Token received: ${token.substring(0, 20)}...`);
    
    // Try to verify the token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-change-this-in-production');
      console.log('✅ [AUTH MIDDLEWARE] Token verified successfully:', {
        userId: decoded.id,
        phoneNumber: decoded.phoneNumber,
        expires: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'No expiry'
      });
    } catch (jwtError) {
      console.error('❌ [AUTH MIDDLEWARE] Token verification failed:', {
        error: jwtError.name,
        message: jwtError.message,
        token: token.substring(0, 20) + '...'
      });
      
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Access token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(403).json({
          success: false,
          message: 'Invalid access token',
          code: 'INVALID_TOKEN'
        });
      }
      throw jwtError;
    }
    
    // Fetch user from database
    console.log(`👤 [AUTH MIDDLEWARE] Fetching user: ${decoded.id}`);
    const user = await User.findById(decoded.id).select('-password -refreshToken -__v');
    
    if (!user) {
      console.log('❌ [AUTH MIDDLEWARE] User not found in database');
      return res.status(401).json({
        success: false,
        message: 'User not found or account deleted',
        code: 'USER_NOT_FOUND'
      });
    }
    
    // Check if user is active (if you have this field)
    if (user.isActive === false) {
      console.log('❌ [AUTH MIDDLEWARE] User account is deactivated');
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }
    
    // Check for subscription expiry and update if necessary
    if (user.isSubscribed && user.subscriptionExpires) {
      if (new Date() > new Date(user.subscriptionExpires)) {
        user.isSubscribed = false;
        user.subscriptionPlan = null;
        await user.save();
        console.log(`🕒 Subscription expired for user: ${user._id}`);
      }
    }

    // Attach full user object - UPDATED: removed username, added dateOfBirth
    req.user = {
      _id: user._id,
      id: user._id,
      phoneNumber: user.phoneNumber,
      name: user.name,
      dateOfBirth: user.dateOfBirth, // ✅ ADDED
      isAdmin: user.isAdmin,
      isSubscribed: user.isSubscribed,
      subscriptionExpires: user.subscriptionExpires,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
    
    console.log('✅ [AUTH MIDDLEWARE] Authentication successful:', {
      userId: req.user._id,
      name: req.user.name,
      isAdmin: req.user.isAdmin
    });
    
    next();
  } catch (error) {
    console.error('❌ [AUTH MIDDLEWARE] Token verification error:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    // Handle database errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Optional user middleware - doesn't block if token is missing/invalid
const getOptionalUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-change-this-in-production');
    } catch (jwtError) {
      return next();
    }
    
    const user = await User.findById(decoded.id).select('-password -refreshToken -__v');
    
    if (user && user.isActive !== false) {
      req.user = {
        _id: user._id,
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        dateOfBirth: user.dateOfBirth,
        isAdmin: user.isAdmin,
        isSubscribed: user.isSubscribed
      };
    }
    
    next();
  } catch (error) {
    // Silently fail and continue without user
    next();
  }
};

// Verify admin - UPDATED: removed username references
const verifyAdmin = async (req, res, next) => {
  try {
    // First, ensure verifyToken ran successfully
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Fetch fresh user data to ensure admin status is current
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if user is admin
    if (!user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    // Update user object with fresh data
    req.user.isAdmin = user.isAdmin;
    req.user.isSubscribed = user.isSubscribed;
    req.user.dateOfBirth = user.dateOfBirth; // ✅ ADDED
    
    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Admin verification failed'
    });
  }
};

// Verify subscription - UPDATED: removed username references
const verifySubscription = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Fetch fresh user data
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check subscription or admin status
    if (!user.isSubscribed && !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Subscription required to access this content'
      });
    }
    
    // Update user object
    req.user.isSubscribed = user.isSubscribed;
    req.user.isAdmin = user.isAdmin;
    req.user.dateOfBirth = user.dateOfBirth; // ✅ ADDED
    
    next();
  } catch (error) {
    console.error('Subscription verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Subscription verification failed'
    });
  }
};

// Optional: Verify token without database fetch (faster for non-critical routes)
// UPDATED: removed username from decoded token
const verifyTokenFast = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access token is required'
    });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-change-this-in-production');
    req.user = decoded; // Just attach decoded token data
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(403).json({
      success: false,
      message: 'Invalid access token'
    });
  }
};

// Middleware to attach user to request without verification (for optional auth)
// UPDATED: removed username, added dateOfBirth
const attachUserIfExists = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'your-access-secret-key-change-this-in-production');
      
      const user = await User.findById(decoded.id).select('-password -refreshToken -__v');
      if (user) {
        req.user = {
          _id: user._id,
          id: user._id,
          phoneNumber: user.phoneNumber,
          name: user.name,
          dateOfBirth: user.dateOfBirth, // ✅ ADDED
          isAdmin: user.isAdmin,
          isSubscribed: user.isSubscribed,
          subscriptionExpires: user.subscriptionExpires,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };
      }
    }
    
    next();
  } catch (error) {
    // Token errors are ignored since auth is optional
    next();
  }
};

// Middleware to check if user owns a resource - No changes needed
const verifyOwnership = (Model, paramName = 'id') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params[paramName];
      const userId = req.user.id;
      
      const resource = await Model.findById(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }
      
      // Check if user owns the resource or is admin
      if (resource.uploadedBy.toString() !== userId.toString() && !req.user.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to modify this resource'
        });
      }
      
      next();
    } catch (error) {
      console.error('Ownership verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Ownership verification failed'
      });
    }
  };
};

// Middleware to check if user is logged in (simple check) - No changes needed
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Please login to access this resource'
    });
  }
  next();
};

// Middleware to check if user is subscribed or admin - No changes needed
const isSubscribedOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Please login to access this resource'
    });
  }
  
  if (!req.user.isSubscribed && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Subscription required to access this content'
    });
  }
  
  next();
};

module.exports = {
  generateTokens,
  handleRefreshToken,
  verifyToken,
  verifyTokenFast,
  verifyAdmin,
  verifySubscription,
  attachUserIfExists,
  getOptionalUser,
  verifyOwnership,
  isAuthenticated,
  isSubscribedOrAdmin,
};
