const User = require('../models/User');
const Video = require('../models/Video');
const mongoose = require('mongoose');

// Get admin dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    // Get total counts
    const totalUsers = await User.countDocuments();
    const totalVideos = await Video.countDocuments();
    const totalSubscribedUsers = await User.countDocuments({ isSubscribed: true });
    
    // Get recent videos
    const recentVideos = await Video.find()
      .sort({ uploadDate: -1 })
      .limit(5)
      .populate('uploadedBy', 'name phoneNumber'); // ✅ CHANGED
    
    // Get user growth (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const newUsersLast7Days = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });
    
    // Get total views
    const totalViewsResult = await Video.aggregate([
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$views' }
        }
      }
    ]);
    
    const totalViews = totalViewsResult[0]?.totalViews || 0;
    
    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalVideos,
          totalSubscribedUsers,
          newUsersLast7Days,
          totalViews
        },
        recentVideos
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard stats'
    });
  }
};

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const users = await User.find()
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await User.countDocuments();
    
    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

// Update user (admin only)
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { isAdmin, isSubscribed, subscriptionExpires } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    const updates = {};
    if (typeof isAdmin !== 'undefined') updates.isAdmin = isAdmin;
    if (typeof isSubscribed !== 'undefined') updates.isSubscribed = isSubscribed;
    if (subscriptionExpires) updates.subscriptionExpires = subscriptionExpires;
    
    const user = await User.findByIdAndUpdate(
      id,
      updates,
      { new: true }
    ).select('-password -refreshToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    
    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Prevent deleting own account
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    // Delete user
    await User.findByIdAndDelete(id);
    
    // Delete videos uploaded by this user
    await Video.deleteMany({ uploadedBy: id });
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};