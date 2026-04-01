// backend/src/controllers/videoController.js
const Video = require('../models/Video');
const User = require('../models/User');
const Category = require('../models/Category');
const videoProcessor = require('../utils/videoProcessor');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { uploadFile, uploadFileFromPath, uploadLargeFileFromPath, deleteFile, getPublicUrl } = require('../services/backblaze');

// Set ffmpeg path from installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

const getLargeThreshold = () => {
  const value = parseInt(process.env.B2_LARGE_FILE_THRESHOLD_BYTES || '52428800', 10);
  return Number.isNaN(value) ? 52428800 : value;
};

const uploadToB2 = async (file, folder, originalName = 'video.mp4', mimeType = 'video/mp4') => {
  const fileName = buildFileName(folder, originalName);
  if (typeof file === 'string') {
    // File path provided
    const stat = await fs.stat(file);
    const threshold = getLargeThreshold();
    const result = stat.size >= threshold
      ? await uploadLargeFileFromPath(file, fileName, mimeType)
      : await uploadFileFromPath(file, fileName, mimeType);
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      url: getPublicUrl(result.fileName),
    };
  }
  // Multer file object provided
  const fileNameFromObj = buildFileName(folder, file.originalname);
  if (file.path) {
    const stat = await fs.stat(file.path);
    const threshold = getLargeThreshold();
    const result = stat.size >= threshold
      ? await uploadLargeFileFromPath(file.path, fileNameFromObj, file.mimetype)
      : await uploadFileFromPath(file.path, fileNameFromObj, file.mimetype);
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      url: getPublicUrl(result.fileName),
    };
  }
  const result = await uploadFile(file.buffer, fileNameFromObj, file.mimetype);
  return {
    fileId: result.fileId,
    fileName: result.fileName,
    url: getPublicUrl(result.fileName),
  };
};

const createTempFile = async (buffer, originalname) => {
  const extension = path.extname(originalname || '');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-enter-'));
  const tempPath = path.join(tempDir, `upload${extension}`);
  await fs.writeFile(tempPath, buffer);
  return { tempDir, tempPath };
};

/**
 * Convert video to browser-compatible MP4 format
 * @param {string} inputPath - Path to input video file
 * @param {string} outputPath - Path where converted file should be saved
 * @returns {Promise<string>} Path to the converted file
 */
const convertVideoToBrowserCompatibleMP4 = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions('-movflags +faststart') // Optimize for web streaming
      .outputOptions('-preset fast') // Balance between speed and compression
      .outputOptions('-crf 23') // Good quality with reasonable file size
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Conversion progress: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', () => {
        console.log('Video conversion completed successfully');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Video conversion error:', err.message);
        reject(new Error(`Video conversion failed: ${err.message}`));
      })
      .save(outputPath);
  });
};

/**
 * Process video file - convert to browser-compatible format if needed
 * @param {Object} videoFile - Multer file object
 * @returns {Promise<Object>} Object containing path to processed file and cleanup function
 */
const processVideoForUpload = async (videoFile) => {
  const isMP4 = videoFile.mimetype.toLowerCase() === 'video/mp4';
  const isH264 = true; // We'll assume conversion is needed for browser compatibility
  
  // If already MP4 with H.264, we can use it directly
  if (isMP4 && isH264) {
    console.log('Video is already in browser-compatible MP4 format');
    return {
      filePath: videoFile.path,
      cleanup: () => Promise.resolve()
    };
  }
  
  console.log('Converting video to browser-compatible MP4 format...');
  
  // Create temporary directory for conversion
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-enter-convert-'));
  const outputFileName = `converted-${Date.now()}.mp4`;
  const outputPath = path.join(tempDir, outputFileName);
  
  try {
    let inputPath = videoFile.path;
    let tempInputDir = null;
    
    // If file doesn't have a path (buffer upload), create temp file
    if (!inputPath) {
      const tempResult = await createTempFile(videoFile.buffer, videoFile.originalname);
      inputPath = tempResult.tempPath;
      tempInputDir = tempResult.tempDir;
    }
    
    // Convert video
    await convertVideoToBrowserCompatibleMP4(inputPath, outputPath);
    
    // Cleanup temporary input file if created
    if (tempInputDir) {
      await fs.rm(tempInputDir, { recursive: true, force: true }).catch(() => {});
    }
    
    return {
      filePath: outputPath,
      cleanup: () => fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    };
  } catch (error) {
    // Cleanup on error
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
  }
};

// ==================== ADMIN CATEGORY MANAGEMENT ====================

// ✅ Get all categories (admin)
exports.getAdminCategories = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    
    const categories = await Category.find(query)
      .sort({ order: 1, name: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Category.countDocuments(query);
    
    return res.json({
      success: true,
      data: categories,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin categories error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

// ✅ Create new category (admin)
exports.createCategory = async (req, res) => {
  try {
    const { name, description = '', order = 0 } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }
    
    const existingCategory = await Category.findOne({ 
      name: name.toLowerCase().trim() 
    });
    
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }
    
    const category = new Category({
      name: name.trim(),
      description: description.trim(),
      order: parseInt(order) || 0
    });
    
    await category.save();
    
    return res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
};

// ✅ Update category (admin)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, order, isActive } = req.body;
    
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    const updateData = {};
    
    if (name !== undefined && name.trim()) {
      // Check if new name conflicts with existing category
      const existingCategory = await Category.findOne({
        name: name.toLowerCase().trim(),
        _id: { $ne: id }
      });
      
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Category name already exists'
        });
      }
      
      updateData.name = name.trim();
    }
    
    if (description !== undefined) {
      updateData.description = description.trim();
    }
    
    if (order !== undefined) {
      updateData.order = parseInt(order);
    }
    
    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }
    
    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    
    return res.json({
      success: true,
      message: 'Category updated successfully',
      data: updatedCategory
    });
  } catch (error) {
    console.error('Update category error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update category'
    });
  }
};

// ✅ Delete category (admin)
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    // Check if category is being used by any videos
    const videosUsingCategory = await Video.countDocuments({
      category: category.name,
      isActive: true
    });
    
    if (videosUsingCategory > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. It is being used by ${videosUsingCategory} video(s)`
      });
    }
    
    await Category.findByIdAndDelete(id);
    
    return res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
};

// ✅ Toggle category status (admin)
exports.toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    category.isActive = !category.isActive;
    await category.save();
    
    return res.json({
      success: true,
      message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
      data: category
    });
  } catch (error) {
    console.error('Toggle category status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to toggle category status'
    });
  }
};

/**
 * Format duration helper
 */
const formatDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format file size helper
 */
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * ==================== LIKE/UNLIKE FUNCTIONS ====================
 */

// ✅ Like a video
exports.likeVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log(`❤️ [LIKE] User ${userId} liking video ${id}`);

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Initialize likes array if not exists
    video.likes = video.likes || [];
    
    // Check if user already liked the video
    const alreadyLiked = video.likes.some(likeId => 
      likeId?.toString() === userId.toString()
    );
    
    if (alreadyLiked) {
      return res.status(200).json({
        success: true,
        message: 'Video already liked',
        data: {
          liked: true,
          likes: Array.isArray(video.likes) ? video.likes.length : 0,
          videoId: id
        }
      });
    }

    // Add user to likes array
    video.likes.push(userId);
    await video.save();
    
    console.log(`✅ User ${userId} liked video ${id}`);

    // Update user's liked videos
    try {
      const user = await User.findById(userId);
      if (user) {
        user.likedVideos = user.likedVideos || [];
        if (!user.likedVideos.includes(id)) {
          user.likedVideos.push(id);
          await user.save();
        }
      }
    } catch (userError) {
      console.warn('Could not update user liked videos:', userError.message);
    }

    // Get updated video
    const updatedVideo = await Video.findById(id);
    
    return res.status(200).json({
      success: true,
      message: 'Video liked successfully',
      data: {
        liked: true,
        likes: updatedVideo.likes?.length || 0,
        videoId: id,
        videoTitle: updatedVideo.title
      }
    });

  } catch (error) {
    console.error('❌ Like video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to like video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Unlike a video
exports.unlikeVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log(`💔 [UNLIKE] User ${userId} unliking video ${id}`);

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Initialize likes array if not exists
    video.likes = video.likes || [];
    
    // Check if user has liked the video
    const userIndex = video.likes.findIndex(likeId => 
      likeId?.toString() === userId.toString()
    );
    
    if (userIndex === -1) {
      return res.status(200).json({
        success: true,
        message: 'Video not liked yet',
        data: {
          liked: false,
         likes: Array.isArray(video.likes) ? video.likes.length : 0,
          videoId: id
        }
      });
    }

    // Remove user from likes array
    video.likes.splice(userIndex, 1);
    await video.save();
    
    console.log(`✅ User ${userId} unliked video ${id}`);

    // Update user's liked videos
    try {
      const user = await User.findById(userId);
      if (user && user.likedVideos) {
        user.likedVideos = user.likedVideos.filter(videoId => 
          videoId.toString() !== id
        );
        await user.save();
      }
    } catch (userError) {
      console.warn('Could not update user liked videos:', userError.message);
    }

    // Get updated video
    const updatedVideo = await Video.findById(id);
    
    return res.status(200).json({
      success: true,
      message: 'Video unliked successfully',
      data: {
        liked: false,
        likes: updatedVideo.likes?.length || 0,
        videoId: id,
        videoTitle: updatedVideo.title
      }
    });

  } catch (error) {
    console.error('❌ Unlike video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to unlike video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Check if video is liked by user
exports.checkVideoLike = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;

    console.log(`🔍 [CHECK LIKE] Checking like for video ${id}, user ${userId}`);

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Initialize likes array if not exists
    video.likes = video.likes || [];
    
    const isLiked = video.likes.some(likeId => 
      likeId?.toString() === userId?.toString()
    );
    
    console.log(`📊 Like status: ${isLiked} (Total likes: ${video.likes.length})`);
    
    return res.status(200).json({
      success: true,
      data: {
        liked: isLiked,
       likes: Array.isArray(video.likes) ? video.likes.length : 0,
        videoId: id,
        videoTitle: video.title
      }
    });

  } catch (error) {
    console.error('❌ Check like error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check like status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ==================== VIDEO SECTIONS FUNCTIONS ====================
 */





// ✅ Get trending videos
exports.getTrendingVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('🔥 GET TRENDING VIDEOS');
    
    const trendingVideos = await Video.find({ 
      isActive: true,
      isTrending: true 
    })
    .sort('-views -createdAt')
    .limit(limit)
    .populate('uploadedBy', 'name phoneNumber avatar')
    .lean();
    
    // If no trending videos marked, get most viewed videos from last 7 days
    if (trendingVideos.length === 0) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const mostViewedVideos = await Video.find({ 
        isActive: true,
        createdAt: { $gte: sevenDaysAgo }
      })
        .sort('-views')
        .limit(limit)
        .populate('uploadedBy', 'name phoneNumber avatar')
        .lean();
      
      return formatVideosResponse(mostViewedVideos, userId, res, 'trending');
    }
    
    return formatVideosResponse(trendingVideos, userId, res, 'trending');
    
  } catch (error) {
    console.error('Get trending videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch trending videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get popular videos
exports.getPopularVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('🌟 GET POPULAR VIDEOS');
    
    const popularVideos = await Video.find({ 
      isActive: true,
      $or: [
        { views: { $gte: 500 } },
        { isPopular: true }
      ]
    })
      .sort('-views')
      .limit(limit)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();
    
    return formatVideosResponse(popularVideos, userId, res, 'popular');
    
  } catch (error) {
    console.error('Get popular videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch popular videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get recent videos
exports.getRecentVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('🆕 GET RECENT VIDEOS');
    
    const recentVideos = await Video.find({ isActive: true })
      .sort('-createdAt')
      .limit(limit)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();
    
    return formatVideosResponse(recentVideos, userId, res, 'recent');
    
  } catch (error) {
    console.error('Get recent videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recent videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get featured videos
exports.getFeaturedVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('⭐ GET FEATURED VIDEOS');
    
    const featuredVideos = await Video.find({ 
      isActive: true,
      isFeatured: true 
    })
    .sort('-createdAt')
    .limit(limit)
    .populate('uploadedBy', 'name phoneNumber avatar')
    .lean();
    
    // If not enough featured videos, add some from the same section
    if (featuredVideos.length < limit) {
      const remaining = limit - featuredVideos.length;
      
      // Get videos from same categories as featured videos
      const categories = [...new Set(featuredVideos.map(v => v.category))];
      
      const additionalVideos = await Video.find({ 
        isActive: true,
        _id: { $nin: featuredVideos.map(v => v._id) },
        category: { $in: categories }
      })
      .sort('-views')
      .limit(remaining)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();
      
      featuredVideos.push(...additionalVideos);
    }
    
    return formatVideosResponse(featuredVideos, userId, res, 'featured');
    
  } catch (error) {
    console.error('Get featured videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch featured videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get exclusive videos
exports.getExclusiveVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('💎 GET EXCLUSIVE VIDEOS');
    
    const exclusiveVideos = await Video.find({ 
      isActive: true,
      isExclusive: true 
    })
    .sort('-createdAt')
    .limit(limit)
    .populate('uploadedBy', 'name phoneNumber avatar')
    .lean();
    
    // If no exclusive videos, return empty array instead of featured
    if (exclusiveVideos.length === 0) {
      console.log('No exclusive videos found');
      return res.json({
        success: true,
        data: [],
        section: 'exclusive',
        count: 0
      });
    }
    
    return formatVideosResponse(exclusiveVideos, userId, res, 'exclusive');
    
  } catch (error) {
    console.error('Get exclusive videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch exclusive videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get recommended videos
exports.getRecommendedVideos = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?._id || req.user?.id;
    
    console.log('🤖 GET RECOMMENDED VIDEOS');
    
    // Get user's liked videos categories
    let userCategories = [];
    if (userId) {
      const user = await User.findById(userId).select('likedVideos');
      if (user && user.likedVideos && user.likedVideos.length > 0) {
        const likedVideos = await Video.find({
          _id: { $in: user.likedVideos },
          isActive: true
        }).select('category').lean();
        
        userCategories = [...new Set(likedVideos.map(v => v.category))];
      }
    }
    
    // Base query
    let query = { isActive: true };
    
    // If user has liked videos, recommend from same categories
    if (userCategories.length > 0) {
      query.category = { $in: userCategories };
    } else {
      // Otherwise recommend featured + trending
      query.$or = [
        { isFeatured: true },
        { isTrending: true }
      ];
    }
    
    const recommendedVideos = await Video.find(query)
      .sort('-views -createdAt')
      .limit(limit)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();
    
    // If not enough recommendations, fill with recent videos
    if (recommendedVideos.length < limit) {
      const remaining = limit - recommendedVideos.length;
      const recentVideos = await Video.find({
        isActive: true,
        _id: { $nin: recommendedVideos.map(v => v._id) }
      })
      .sort('-createdAt')
      .limit(remaining)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();
      
      recommendedVideos.push(...recentVideos);
    }
    
    // Shuffle recommendations
    const shuffledVideos = recommendedVideos.sort(() => 0.5 - Math.random());
    
    return formatVideosResponse(shuffledVideos, userId, res, 'recommended');
    
  } catch (error) {
    console.error('Get recommended videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch recommended videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to format videos response
const formatVideosResponse = (videos, userId, res, sectionName) => {
  const formattedVideos = videos.map(video => {
    const isLiked = video.likes?.some(likeId => 
      likeId?.toString() === userId?.toString()
    ) || false;
    
    return {
      ...video,
      id: video._id,
      formattedDuration: formatDuration(video.duration),
      liked: isLiked,
      likesCount: video.likes?.length || 0,
      formattedViews: video.views?.toLocaleString() || '0',
      fileSizeFormatted: formatFileSize(video.fileSize)
    };
  });
  
  console.log(`✅ Returning ${formattedVideos.length} ${sectionName} videos`);
  
  return res.json({
    success: true,
    data: formattedVideos,
    section: sectionName,
    count: formattedVideos.length
  });
};

/**
 * ==================== VIDEO CRUD FUNCTIONS ====================
 */

/**
 * Create video controller - UPDATED VERSION
 */
exports.createVideo = async (req, res) => {
  console.log('========================================');
  console.log('🎬 CREATE VIDEO CONTROLLER STARTED');
  console.log('========================================');
  
  try {
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);
    console.log('Request user:', req.user);

    // Extract form data
    const { 
      title, 
      description = '', 
      category = 'other', 
      isFree = 'false', 
      isFeatured = 'false',
      isTrending = 'false',
      isExclusive = 'false',
      isPopular = 'false',
      duration = '0',
      releaseDate,
      tags = ''
    } = req.body;

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Video title is required'
      });
    }

    if (!category || !category.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Category is required'
      });
    }



    // Check if video file exists
    if (!req.files || !req.files.video || !req.files.video[0]) {
      return res.status(400).json({
        success: false,
        message: 'Video file is required'
      });
    }

    const videoFile = req.files.video[0];
    console.log('Video file info:', {
      originalname: videoFile.originalname,
      mimetype: videoFile.mimetype,
      size: videoFile.size
    });

    // Validate video file
    const allowedMimeTypes = [
      'video/mp4',
      'video/mov',
      'video/avi',
      'video/mkv',
      'video/webm',
      'video/wmv',
      'video/flv',
      'video/3gp',
      'video/x-msvideo',
      'video/quicktime'
    ];

    if (!allowedMimeTypes.includes(videoFile.mimetype.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video format. Supported formats: MP4, MOV, AVI, MKV, WEBM, WMV, FLV, 3GP'
      });
    }

    // Check file size (max 5GB)
    const maxSize = 5 * 1024 * 1024 * 1024;
    if (videoFile.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'Video file is too large. Maximum size is 5GB.'
      });
    }

    if (videoFile.size < 1024) {
      return res.status(400).json({
        success: false,
        message: 'Video file is too small.'
      });
    }

    // Process video duration
    let videoDuration = parseInt(duration) || 0;
    
    // If duration is 0 or not provided, estimate based on file size
    if (videoDuration <= 0) {
      videoDuration = Math.round(videoFile.size / (1024 * 1024 / 5));
      videoDuration = Math.max(1, Math.min(videoDuration, 3600));
      console.log('Estimated duration:', videoDuration, 'seconds');
    } else {
      videoDuration = Math.max(1, videoDuration);
    }

    console.log('Final video duration:', videoDuration, 'seconds');

    // Process thumbnail
    let thumbnailUrl = '';
    let thumbnailFileId = null;

    if (req.files.thumbnail && req.files.thumbnail[0]) {
      const thumbnailFile = req.files.thumbnail[0];
      
      console.log('Thumbnail file info:', {
        originalname: thumbnailFile.originalname,
        mimetype: thumbnailFile.mimetype,
        size: thumbnailFile.size
      });

      const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedImageTypes.includes(thumbnailFile.mimetype.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid thumbnail format. Supported: JPG, PNG, GIF, WEBP'
        });
      }

      if (thumbnailFile.size > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: 'Thumbnail is too large. Maximum size is 10MB.'
        });
      }

      const thumbnailUpload = await uploadToB2(thumbnailFile, 'thumbnails');
      thumbnailUrl = thumbnailUpload.url;
      thumbnailFileId = thumbnailUpload.fileId;
      console.log('User thumbnail uploaded:', thumbnailUrl);
    } else {
      thumbnailUrl = '/uploads/thumbnails/default.jpg';
      console.log('Using default thumbnail');
    }

    // Process and convert video to browser-compatible format
    console.log('Processing video for browser compatibility...');
    let processedVideo = null;
    let videoCleanup = () => Promise.resolve();
    
    try {
      processedVideo = await processVideoForUpload(videoFile);
      videoCleanup = processedVideo.cleanup;
      
      // Upload converted video file
      console.log('Uploading converted video file...');
      const videoUpload = await uploadToB2(
        processedVideo.filePath, 
        'videos', 
        `${path.parse(videoFile.originalname).name}.mp4`,
        'video/mp4'
      );
      const videoUrl = videoUpload.url;
      const videoFileId = videoUpload.fileId;
      console.log('Converted video uploaded:', videoUrl);
    } catch (conversionError) {
      // Cleanup temporary files on conversion error
      await videoCleanup().catch(() => {});
      console.error('Video conversion/upload failed:', conversionError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to process video for upload. Please try again with a different video file.'
      });
    } finally {
      // Always cleanup temporary conversion files
      await videoCleanup().catch(() => {});
    }

    // ✅ NEW: Transcode video to different qualities (using the converted MP4 file)
    console.log('Transcoding video to different qualities...');
    let qualityUrls = {};
    let qualityFileIds = {};
    try {
      // Use the converted video file for transcoding (already in MP4 format)
      let sourcePath = processedVideo ? processedVideo.filePath : videoFile.path;
      let tempDir = null;
      
      // If we don't have a file path (buffer upload), create temp file from buffer
      if (!sourcePath) {
        const tempResult = await createTempFile(videoFile.buffer, videoFile.originalname);
        sourcePath = tempResult.tempPath;
        tempDir = tempResult.tempDir;
      }
      
      const outputDir = path.join(path.dirname(sourcePath), `transcodes-${Date.now()}`);
      const qualityMap = await videoProcessor.transcodeVideo(sourcePath, outputDir);
      for (const [quality, relativePath] of Object.entries(qualityMap)) {
        if (!relativePath) continue;
        const outputFileName = path.basename(relativePath);
        const outputPath = path.join(outputDir, outputFileName);
        const uploaded = await uploadFileFromPath(outputPath, `videos/${outputFileName}`, 'video/mp4');
        qualityUrls[quality] = getPublicUrl(uploaded.fileName);
        qualityFileIds[quality] = uploaded.fileId;
        await fs.unlink(outputPath).catch(() => {});
      }
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      console.warn('Transcoding failed:', error.message);
    }
    console.log('Transcoding finished. Quality URLs:', qualityUrls);

    // Parse boolean values
    const isFreeBool = isFree === 'true' || isFree === true;
    const isFeaturedBool = isFeatured === 'true' || isFeatured === true;
    const isTrendingBool = isTrending === 'true' || isTrending === true;
    const isExclusiveBool = isExclusive === 'true' || isExclusive === true;
    const isPopularBool = isPopular === 'true' || isPopular === true;

    // Format category
    const formattedCategory = category
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-');

    // ✅ DYNAMIC CATEGORY HANDLING: Create category if it doesn't exist
    try {
      let existingCategory = await Category.findOne({ name: formattedCategory });
      
      if (!existingCategory) {
        // Create new category automatically
        existingCategory = new Category({
          name: formattedCategory,
          description: `Auto-created category for ${formattedCategory} videos`,
          order: 0,
          isActive: true
        });
        await existingCategory.save();
        console.log('✅ Auto-created new category:', formattedCategory);
      }
    } catch (categoryError) {
      console.warn('⚠️ Category creation/check failed, but continuing with video upload:', categoryError.message);
      // Continue with video upload even if category creation fails
    }

    // Parse release date if provided
    let parsedReleaseDate = new Date();
    if (releaseDate) {
      parsedReleaseDate = new Date(releaseDate);
      if (isNaN(parsedReleaseDate.getTime())) {
        parsedReleaseDate = new Date();
      }
    }

    // Parse tags
    let tagsArray = [];
    if (tags && typeof tags === 'string') {
      tagsArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    }

    // ✅ Create video document with PROPER SECTION
    const videoData = {
      title: title.trim(),
      description: description.trim(),
      url: videoUrl,
      videoFileId,
      qualities: qualityUrls, // ✅ Store different quality URLs
      qualityFileIds,
      thumbnailUrl,
      thumbnailFileId,
      duration: videoDuration,
      isFree: isFreeBool,
      
      isFeatured: isFeaturedBool,
      isTrending: isTrendingBool,
      isExclusive: isExclusiveBool,
      isPopular: isPopularBool,
      
      category: formattedCategory,
      uploadedBy: req.user ? req.user._id : null,
      fileSize: videoFile.size,
      mimeType: videoFile.mimetype,
      isActive: true,
      views: 0,
      likes: [],
      releaseDate: parsedReleaseDate,
      tags: tagsArray
    };

    console.log('Creating video with data:', videoData);

    const video = new Video(videoData);
    await video.save();

    const cleanupPaths = [];
    if (videoFile.path) cleanupPaths.push(videoFile.path);
    if (req.files.thumbnail && req.files.thumbnail[0] && req.files.thumbnail[0].path) {
      cleanupPaths.push(req.files.thumbnail[0].path);
    }
    await Promise.all(cleanupPaths.map((filePath) => fs.unlink(filePath).catch(() => {})));

    console.log('Video saved to database:', video._id);

    // Populate uploadedBy info
    await video.populate('uploadedBy', 'name phoneNumber avatar');

    // Send success response
    return res.status(201).json({
      success: true,
      message: 'Video uploaded successfully!',
      data: {
        _id: video._id,
        id: video._id,
        title: video.title,
        description: video.description,
        url: video.url,
        thumbnailUrl: video.thumbnailUrl,
        duration: video.duration,
        formattedDuration: formatDuration(video.duration),
        isFree: video.isFree,
        isFeatured: video.isFeatured,
        isTrending: video.isTrending,
        isExclusive: video.isExclusive,
        category: video.category,
        views: video.views,
        uploadedBy: video.uploadedBy,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
       likes: Array.isArray(video.likes) ? video.likes.length : 0,
        liked: false,
        tags: video.tags
      }
    });

  } catch (error) {
    console.error('❌ Video upload error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A video with this title already exists'
      });
    }

    if (error.code === 'ENOENT') {
      return res.status(400).json({
        success: false,
        message: 'File not found or corrupted'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An error occurred while uploading the video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all videos controller
 */
exports.getAllVideos = async (req, res) => {
  try {
    console.log('📋 GET ALL VIDEOS REQUEST');
    
    const { 
      category, 
      section, // ✅ NEW: Filter by section
      search, 
      sort = '-createdAt', 
      page = 1, 
      limit = 20 
    } = req.query;
    
    const userId = req.user?._id || req.user?.id;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { isActive: true };
    
    if (category && category !== 'all') {
      query.category = category.toLowerCase();
    }
    
    if (section && section !== 'all') {
      query.section = section.toLowerCase();
    }
    
    if (search && search.trim()) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { section: { $regex: search, $options: 'i' } }
      ];
    }

    console.log('Query:', query, 'Sort:', sort, 'Page:', page, 'Limit:', limit);

    // Get videos with pagination
    const videos = await Video.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();

    // Get total count
    const total = await Video.countDocuments(query);

    // Format response with like status
    const formattedVideos = videos.map(video => {
      const isLiked = video.likes?.some(likeId => 
        likeId?.toString() === userId?.toString()
      ) || false;
      
      return {
        ...video,
        id: video._id,
        formattedDuration: formatDuration(video.duration),
        fileSizeFormatted: formatFileSize(video.fileSize),
        liked: isLiked,
        likesCount: video.likes?.length || 0,
        formattedViews: video.views?.toLocaleString() || '0'
      };
    });

    console.log(`Found ${formattedVideos.length} videos out of ${total}`);

    return res.json({
      success: true,
      data: formattedVideos,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch videos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get single video by ID
 */
exports.getVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id || req.user?.id;
    
    console.log(`🎥 GET VIDEO BY ID: ${id}, User: ${userId}`);
    
    const video = await Video.findById(id)
      .populate('uploadedBy', 'name phoneNumber avatar')
      .lean();

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Check if user has liked this video
    const isLiked = video.likes?.some(likeId => 
      likeId?.toString() === userId?.toString()
    ) || false;
    
    // Format video data
    video.formattedDuration = formatDuration(video.duration);
    video.fileSizeFormatted = formatFileSize(video.fileSize);
    video.liked = isLiked;
    video.likesCount = video.likes?.length || 0;
    video.id = video._id;
    video.formattedViews = video.views?.toLocaleString() || '0';
    
    // Add full video URL for direct access
    if (video.url && !video.url.startsWith('http')) {
      // Construct full URL for locally stored videos
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://api.md-entertainment.in' 
        : `http://${req.get('host')}`;
      video.videoUrl = `${baseUrl}/uploads/${video.url}`;
    } else {
      video.videoUrl = video.url;
    }

    console.log(`✅ Video found: ${video.title}, Liked: ${isLiked}, Likes: ${video.likesCount}`);

    // Increment view count
    try {
      await Video.findByIdAndUpdate(id, { $inc: { views: 1 } });
      
      // Auto-mark as popular if views >= 500
      if (video.views + 1 >= 500) {
        await Video.findByIdAndUpdate(id, { isPopular: true });
      }
    } catch (viewError) {
      console.warn('Could not increment views:', viewError.message);
    }

    return res.json({
      success: true,
      data: video
    });

  } catch (error) {
    console.error('Get video error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



/**
 * Stream video (protected)
 */
exports.streamVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    
    console.log(`🎬 Streaming video ${id} for user:`, user?.phoneNumber);

    const video = await Video.findById(id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    
    // Check if user can access the video
    // Free videos: accessible to everyone
    // Paid videos: require subscription or admin access
    const isFreeVideo = video.isFree === true;
    const isAdminUser = user && user.isAdmin;
    const hasSubscription = user && user.isSubscribed;
    
    const canAccessFullVideo = isFreeVideo || isAdminUser || hasSubscription;
    const trialDuration = 30;

    if (video.url && /^https?:\/\//i.test(video.url)) {
      if (!canAccessFullVideo && !isFreeVideo && video.duration > trialDuration) {
        return res.status(403).json({
          success: false,
          message: 'Subscription required to watch full video'
        });
      }
      return res.redirect(video.url);
    }

    // Get video file path
    const videoPath = path.join(__dirname, '..', '..', video.url);
    
    // Check if file exists
    try {
      await fs.access(videoPath);
    } catch {
      return res.status(404).json({
        success: false,
        message: 'Video file not found'
      });
    }

    const stat = await fs.stat(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // If user doesn't have subscription and video is NOT free, limit to trial duration
    if (!canAccessFullVideo && !isFreeVideo && video.duration > trialDuration) {
      console.log(`🔒 User on trial - limiting to ${trialDuration} seconds`);
      
      const bytesPerSecond = fileSize / video.duration;
      const trialBytes = Math.floor(bytesPerSecond * trialDuration);
      
      const start = 0;
      const end = Math.min(trialBytes, fileSize - 1);
      const chunkSize = (end - start) + 1;

      const file = await fs.open(videoPath, 'r');
      const stream = file.createReadStream({ start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': video.mimeType || 'video/mp4',
        'X-Video-Duration': video.duration,
        'X-Trial-Length': trialDuration,
        'X-Requires-Subscription': 'true'
      });

      stream.pipe(res);
    } else {
      // Send entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'X-Video-Duration': video.duration,
        'X-Full-Access': 'true'
      });

      const file = await fs.open(videoPath, 'r');
      const stream = file.createReadStream();
      stream.pipe(res);
    }

  } catch (error) {
    console.error('Stream video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to stream video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update video controller
 */
exports.updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔄 UPDATE VIDEO: ${id}`);
    console.log('Update body:', req.body);
    console.log('Update files:', req.files);

    const updateData = { ...req.body };
    const existingVideo = await Video.findById(id);

    if (!existingVideo) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Remove immutable fields
    delete updateData._id;
    delete updateData.url;
    delete updateData.uploadedBy;
    delete updateData.createdAt;
    delete updateData.views;
    delete updateData.likes;

    // Handle thumbnail update if new file provided
    if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
      const thumbnailFile = req.files.thumbnail[0];
      const thumbnailUpload = await uploadToB2(thumbnailFile, 'thumbnails');
      await deleteFile(existingVideo.thumbnailFileId).catch(() => {});
      updateData.thumbnailUrl = thumbnailUpload.url;
      updateData.thumbnailFileId = thumbnailUpload.fileId;
      console.log('Updated thumbnail:', updateData.thumbnailUrl);
      if (thumbnailFile.path) {
        await fs.unlink(thumbnailFile.path).catch(() => {});
      }
    }

    // Handle video update if new file provided
    if (req.files && req.files.video && req.files.video[0]) {
      const videoFile = req.files.video[0];
      await deleteFile(existingVideo.videoFileId).catch(() => {});
      const existingQualityFileIds = existingVideo.qualityFileIds instanceof Map
        ? Array.from(existingVideo.qualityFileIds.values())
        : Object.values(existingVideo.qualityFileIds || {});
      await Promise.all(existingQualityFileIds.map(fileId => deleteFile(fileId).catch(() => {})));

      const videoUpload = await uploadToB2(videoFile, 'videos');
      updateData.url = videoUpload.url;
      updateData.videoFileId = videoUpload.fileId;
      updateData.fileSize = videoFile.size;
      updateData.mimeType = videoFile.mimetype;

      let qualityUrls = {};
      let qualityFileIds = {};
      try {
        let sourcePath = videoFile.path;
        let tempDir = null;
        if (!sourcePath) {
          const tempResult = await createTempFile(videoFile.buffer, videoFile.originalname);
          sourcePath = tempResult.tempPath;
          tempDir = tempResult.tempDir;
        }
        const outputDir = path.join(path.dirname(sourcePath), `transcodes-${Date.now()}`);
        const qualityMap = await videoProcessor.transcodeVideo(sourcePath, outputDir);
        for (const [quality, relativePath] of Object.entries(qualityMap)) {
          if (!relativePath) continue;
          const outputFileName = path.basename(relativePath);
          const outputPath = path.join(outputDir, outputFileName);
          const uploaded = await uploadFileFromPath(outputPath, `videos/${outputFileName}`, 'video/mp4');
          qualityUrls[quality] = getPublicUrl(uploaded.fileName);
          qualityFileIds[quality] = uploaded.fileId;
          await fs.unlink(outputPath).catch(() => {});
        }
        await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
        if (tempDir) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      } catch (error) {
        console.warn('Transcoding failed:', error.message);
      }
      updateData.qualities = qualityUrls;
      updateData.qualityFileIds = qualityFileIds;
      console.log('Updated video:', updateData.url);
      if (videoFile.path) {
        await fs.unlink(videoFile.path).catch(() => {});
      }
    }

    // Format category if provided
    if (updateData.category) {
      updateData.category = updateData.category.toLowerCase().trim().replace(/\s+/g, '-');
    }

    // Format section if provided
    if (updateData.section) {
      updateData.section = updateData.section.toLowerCase().trim();
    }

    // Parse boolean fields
    if (updateData.isFree !== undefined) {
      updateData.isFree = updateData.isFree === 'true' || updateData.isFree === true;
    }
    
    if (updateData.isFeatured !== undefined) {
      updateData.isFeatured = updateData.isFeatured === 'true' || updateData.isFeatured === true;
    }
    
    if (updateData.isTrending !== undefined) {
      updateData.isTrending = updateData.isTrending === 'true' || updateData.isTrending === true;
    }
    
    if (updateData.isExclusive !== undefined) {
      updateData.isExclusive = updateData.isExclusive === 'true' || updateData.isExclusive === true;
    }

    // Auto-update isPopular based on views
    if (updateData.views !== undefined && parseInt(updateData.views) >= 500) {
      updateData.isPopular = true;
    }

    // Parse tags if provided
    if (updateData.tags !== undefined) {
      if (typeof updateData.tags === 'string') {
        updateData.tags = updateData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
      }
    }

    // Parse release date if provided
    if (updateData.releaseDate) {
      const parsedDate = new Date(updateData.releaseDate);
      if (!isNaN(parsedDate.getTime())) {
        updateData.releaseDate = parsedDate;
      }
    }

    const video = await Video.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('uploadedBy', 'name phoneNumber avatar');

    // Format response
    const formattedVideo = {
      ...video.toObject(),
      id: video._id,
      formattedDuration: formatDuration(video.duration),
      fileSizeFormatted: formatFileSize(video.fileSize),
      likesCount: video.likes?.length || 0,
      formattedViews: video.views?.toLocaleString() || '0'
    };

    return res.json({
      success: true,
      message: 'Video updated successfully',
      data: formattedVideo
    });

  } catch (error) {
    console.error('Update video error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete video (soft delete)
 */
exports.deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ DELETE VIDEO: ${id}`);

    const video = await Video.findById(id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    await deleteFile(video.videoFileId).catch(() => {});
    await deleteFile(video.thumbnailFileId).catch(() => {});
    const qualityFileIds = video.qualityFileIds instanceof Map
      ? Array.from(video.qualityFileIds.values())
      : Object.values(video.qualityFileIds || {});
    await Promise.all(qualityFileIds.map(fileId => deleteFile(fileId).catch(() => {})));

    await Video.findByIdAndUpdate(id, { isActive: false }, { new: true });

    return res.json({
      success: true,
      message: 'Video deleted successfully',
      data: {
        videoId: id,
        title: video.title,
        isActive: false
      }
    });

  } catch (error) {
    console.error('Delete video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete video',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ==================== ADDITIONAL FUNCTIONS ====================
 */

// ✅ Increment video views
exports.incrementViews = async (req, res) => {
  try {
    const { id } = req.params;
    
    const video = await Video.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    ).select('title views');

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Auto-mark as popular if views >= 500
    if (video.views >= 500) {
      await Video.findByIdAndUpdate(id, { isPopular: true });
    }

    return res.json({
      success: true,
      data: {
        views: video.views,
        title: video.title,
        videoId: id
      }
    });
  } catch (error) {
    console.error('Increment views error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update views',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Get video categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Video.distinct('category', { isActive: true });
    
    return res.json({
      success: true,
      data: categories.filter(cat => cat && cat.trim() !== '').sort()
    });
  } catch (error) {
    console.error('Get categories error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};



// ✅ Get related videos
exports.getRelatedVideos = async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    const userId = req.user?._id || req.user?.id;
    
    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    
    const relatedVideos = await Video.find({
      _id: { $ne: id },
      isActive: true,
      $or: [
        { category: video.category },
        { section: video.section },
        { isFeatured: true }
      ]
    })
    .limit(limit)
    .sort('-views -createdAt')
    .populate('uploadedBy', 'name phoneNumber avatar')
    .lean();
    
    // Format duration and add like status
    const formattedVideos = relatedVideos.map(v => {
      const isLiked = v.likes?.some(likeId => 
        likeId?.toString() === userId?.toString()
      ) || false;
      
      return {
        ...v,
        id: v._id,
        formattedDuration: formatDuration(v.duration),
        liked: isLiked,
        likesCount: v.likes?.length || 0,
        formattedViews: v.views?.toLocaleString() || '0'
      };
    });
    
    return res.json({
      success: true,
      data: formattedVideos
    });
  } catch (error) {
    console.error('Get related videos error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch related videos'
    });
  }
};

/**
 * Toggle like status for a video
 */
exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log(`👍 TOGGLE LIKE: Video ${id}, User ${userId}`);

    // Find video and user
    const [video, user] = await Promise.all([
      Video.findById(id),
      User.findById(userId)
    ]);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize arrays if they don't exist
    if (!video.likes) video.likes = [];
    if (!user.likedVideos) user.likedVideos = [];

    // Check if user already liked the video
    const isLiked = video.likes.some(likeId => likeId.toString() === userId.toString());

    if (isLiked) {
      // Unlike: Remove user from video likes and video from user likedVideos
      video.likes = video.likes.filter(id => id.toString() !== userId.toString());
      user.likedVideos = user.likedVideos.filter(vidId => vidId.toString() !== id.toString());
    } else {
      // Like: Add user to video likes and video to user likedVideos
      video.likes.push(userId);
      user.likedVideos.push(id);
    }

    // Save both
    await Promise.all([
      video.save(),
      user.save()
    ]);

    console.log(`✅ ${isLiked ? 'UNLIKED' : 'LIKED'} successfully. Total likes: ${video.likes.length}`);

    return res.json({
      success: true,
      message: isLiked ? 'Video unliked' : 'Video liked',
      data: {
        liked: !isLiked,
        likes: video.likes.length
      }
    });

  } catch (error) {
    console.error('Toggle like error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to toggle like',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Download video function
exports.downloadVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    
    console.log(`📥 [videoController] Download request for video ${id} by user ${userId}`);
    
    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    
    // Check if user has access (for premium videos)
    if (!video.isFree) {
      const user = await User.findById(userId);
      if (!user.subscription?.active) {
        return res.status(403).json({
          success: false,
          message: 'Premium subscription required to download this video'
        });
      }
    }
    
    // Check Download model exists
    try {
      const Download = require('../models/Download');
      
      const existingDownload = await Download.findOne({ userId, videoId: id });
      
      if (!existingDownload) {
        let size = '0 MB';
        try {
          const videoPath = path.join(__dirname, '../../', video.url);
          if (fsSync.existsSync(videoPath)) {
            const stats = fsSync.statSync(videoPath);
            const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            size = `${fileSizeInMB} MB`;
          }
        } catch (sizeError) {
          console.warn('Could not determine video file size:', sizeError.message);
        }
        
        const download = new Download({
          userId,
          videoId: id,
          downloadedDate: new Date(),
          isWatched: false,
          size: size,
          localPath: video.url,
          status: 'completed'
        });
        
        await download.save();
        console.log(`✅ [videoController] Download recorded for video ${id}`);
      } else {
        console.log(`ℹ️ [videoController] Video ${id} already downloaded by user`);
      }
    } catch (downloadError) {
      console.warn('Download model not available:', downloadError.message);
    }
    
    // Get full video URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fullVideoUrl = `${baseUrl}${video.url}`;
    
    // Check if file exists
    const videoPath = path.join(__dirname, '../../', video.url);
    if (!fsSync.existsSync(videoPath)) {
      return res.status(404).json({
        success: false,
        message: 'Video file not found on server'
      });
    }
    
    return res.json({
      success: true,
      message: 'Video ready for download',
      data: {
        downloadUrl: fullVideoUrl,
        video: {
          id: video._id,
          title: video.title,
          description: video.description,
          url: video.url,
          fullUrl: fullVideoUrl,
          thumbnailUrl: video.thumbnailUrl,
          duration: video.duration,
          formattedDuration: formatDuration(video.duration),
          size: formatFileSize(video.fileSize),
          category: video.category,
          section: video.section,
          isFree: video.isFree,
          views: video.views,
          createdAt: video.createdAt
        }
      }
    });
  } catch (error) {
    console.error('❌ [videoController] Download video error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to prepare video for download',
      error: error.message
    });
  }
};

// ✅ Clean up empty sections (Admin function)
exports.cleanupEmptySections = async (req, res) => {
  try {
    const sections = await Video.distinct('section', { isActive: true });
    
    const emptySections = [];
    
    for (const section of sections) {
      const count = await Video.countDocuments({ 
        section: section, 
        isActive: true 
      });
      
      if (count === 0) {
        emptySections.push(section);
      }
    }
    
    return res.json({
      success: true,
      data: {
        emptySections,
        message: emptySections.length > 0 
          ? `Found ${emptySections.length} empty sections` 
          : 'No empty sections found'
      }
    });
  } catch (error) {
    console.error('Cleanup empty sections error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cleanup sections'
    });
  }
};
