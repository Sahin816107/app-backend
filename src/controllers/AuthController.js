const User = require('../models/User');
const { generateTokens } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { uploadFile, deleteFile, getPublicUrl } = require('../services/backblaze');

const getSafeOriginalName = (originalname) => {
  if (!originalname) return 'file';
  let decoded = originalname;
  try {
    decoded = decodeURIComponent(originalname);
  } catch (error) {
    decoded = originalname;
  }
  return decoded.replace(/[^a-zA-Z0-9.\-_]/g, '_');
};

const buildFileName = (folder, originalname) => {
  const timestamp = Date.now();
  const safeName = getSafeOriginalName(originalname);
  const unique = `${timestamp}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  return `${folder}/${unique}`;
};

const uploadAvatarToB2 = async (file) => {
  const fileName = buildFileName('avatars', file.originalname);
  const result = await uploadFile(file.buffer, fileName, file.mimetype);
  return { url: getPublicUrl(result.fileName), fileId: result.fileId };
};

// Register user
const register = async (req, res) => {
  try {
    console.log('📝 Registration request body:', req.body);
    const { name, dateOfBirth, phoneNumber, password } = req.body;

    // Age validation
    if (dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      if (age < 18) {
        console.warn('❌ Registration failed: User under 18');
        return res.status(400).json({
          success: false,
          message: 'You must be 18 years or older to register'
        });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      phoneNumber
    });
    
    if (existingUser) {
      console.warn(`❌ Registration failed: Phone number ${phoneNumber} already exists`);
      return res.status(400).json({
        success: false,
        message: 'User already exists.'
      });
    }

    // Create new user
    const user = new User({
      name,
      dateOfBirth,
      phoneNumber,
      password
    });

    await user.save();
    console.log(`✅ User registered successfully: ${user._id}`);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.toJSON(),
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    console.log('🔐 [LOGIN] Login attempt received');
    console.log('📨 Request body:', req.body);
    
    const { phoneNumber, password } = req.body;

    // Validate input
    if (!phoneNumber || !password) {
      console.log('❌ [LOGIN] Missing phone number or password');
      return res.status(400).json({
        success: false,
        message: 'Phone number and password are required'
      });
    }

    console.log(`🔍 [LOGIN] Searching for user with phone: ${phoneNumber}`);
    
    // Find user by phone number
    const user = await User.findOne({ phoneNumber });
    
    if (!user) {
      console.log(`❌ [LOGIN] User not found with phone: ${phoneNumber}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }

    console.log(`✅ [LOGIN] User found: ${user._id} (${user.name})`);
    
    // Check password
    console.log('🔑 [LOGIN] Comparing passwords...');
    const isPasswordValid = await user.comparePassword(password);
    
    if (!isPasswordValid) {
      console.log('❌ [LOGIN] Password comparison failed');
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }
    
    console.log('✅ [LOGIN] Password comparison successful');

    // Generate tokens
    console.log('🎫 [LOGIN] Generating tokens...');
    const { accessToken, refreshToken } = generateTokens(user);
    console.log(`✅ [LOGIN] Tokens generated - Access: ${accessToken.substring(0, 20)}..., Refresh: ${refreshToken.substring(0, 20)}...`);

    // Update last login and save refresh token
    user.lastLogin = new Date();
    user.refreshToken = refreshToken;
    await user.save();
    console.log('💾 [LOGIN] User data updated with refresh token');

    console.log('✅ [LOGIN] Login successful - Sending response');
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Refresh access token
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-this-in-production');

    // Find user
    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Update refresh token
    user.refreshToken = newRefreshToken;
    await user.save();

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

// Get current user profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshToken -__v');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

// Update user profile (updated version with profileImage)
const updateProfile = async (req, res) => {
  try {
    const { name, phoneNumber, profileImage } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if phone number already exists (if changing phone number)
    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingUser = await User.findOne({ phoneNumber });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already taken'
        });
      }
      user.phoneNumber = phoneNumber;
    }

    // Update other fields
    if (name !== undefined) user.name = name;
    if (profileImage !== undefined) user.profileImage = profileImage;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: user.toJSON() }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// Logout
const logout = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }
    await User.findByIdAndUpdate(req.user.id, { refreshToken: null });
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// Change password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Set new password (the pre-save hook in User model will handle hashing)
    user.password = newPassword;
    
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Upload avatar (profile image)
const uploadAvatar = async (req, res) => {
  try {
    console.log('🖼️ Received avatar upload request');
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const userId = req.user.id;
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      console.log('❌ User not found for avatar update');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const avatarUpload = await uploadAvatarToB2(req.file);
    await deleteFile(existingUser.profileImageFileId).catch(() => {});
    const profileImage = avatarUpload.url;
    console.log(`✅ File uploaded: ${profileImage} for user: ${userId}`);

    const user = await User.findByIdAndUpdate(
      userId,
      { profileImage, profileImageFileId: avatarUpload.fileId },
      { new: true, select: '-password' }
    );

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: {
        url: profileImage,
        user: user
      }
    });
  } catch (error) {
    console.error('❌ Upload avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Export all functions
module.exports = {
  register,
  login,
  refreshToken,
  getProfile,
  updateProfile,
  logout,
  changePassword,
  uploadAvatar
};
