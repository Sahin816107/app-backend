// backend/src/controllers/BannerController.js
const Banner = require('../models/Banner');
const Video = require('../models/Video');
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

const uploadBannerImage = async (file) => {
  const fileName = buildFileName('banners', file.originalname);
  const result = await uploadFile(file.buffer, fileName, file.mimetype);
  return { url: getPublicUrl(result.fileName), fileId: result.fileId };
};

/**
 * Create new banner
 */
exports.createBanner = async (req, res) => {
  console.log('========================================');
  console.log('🖼️ CREATE BANNER CONTROLLER STARTED');
  console.log('========================================');
  console.log('Req Body:', JSON.stringify(req.body, null, 2));
  console.log('Req File:', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  } : 'MISSING');
  
  try {
    const { 
      title, 
      description, 
      videoId,
      order = 0,
      startDate,
      endDate,
      targetAudience = 'all',
      isActive
    } = req.body;

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Banner title is required'
      });
    }

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: 'Video ID is required'
      });
    }

    // Check if video exists
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Check if banner image file exists
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Banner image is required'
      });
    }

    // Validate image file
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: `Invalid image format: ${req.file.mimetype}. Please upload an image.`
      });
    }

    const bannerUpload = await uploadBannerImage(req.file);
    const imageUrl = bannerUpload.url;
    const imageFileId = bannerUpload.fileId;
    console.log('Banner uploaded:', imageUrl);

    // Parse dates
    const startDateObj = startDate ? new Date(startDate) : new Date();
    const endDateObj = endDate ? new Date(endDate) : null;

    // Parse target audience
    let audienceList = ['all'];
    if (targetAudience) {
      if (Array.isArray(targetAudience)) {
        audienceList = targetAudience;
      } else if (typeof targetAudience === 'string') {
        // Handle comma-separated string or single value
        audienceList = targetAudience.includes(',') 
          ? targetAudience.split(',').map(s => s.trim())
          : [targetAudience];
      }
    }
    
    // Validate target audience against enum
    const validAudiences = ['all', 'subscribed', 'non-subscribed', 'new-users'];
    audienceList = audienceList.filter(a => validAudiences.includes(a));
    if (audienceList.length === 0) audienceList = ['all'];

    // Create banner document
    const bannerData = {
      title: title.trim(),
      description: description ? description.trim() : '',
      imageUrl,
      imageFileId,
      videoId,
      order: parseInt(order) || 0,
      startDate: startDateObj,
      endDate: endDateObj,
      targetAudience: audienceList,
      isActive: isActive === 'true' || isActive === true,
      clicks: 0,
      impressions: 0
    };

    console.log('Creating banner with data:', bannerData);

    const banner = new Banner(bannerData);
    await banner.save();

    console.log('Banner saved to database:', banner._id);

    // Populate video details
    await banner.populate('videoId', 'title description duration thumbnailUrl');

    // Clean up temporary file - NOT NEEDED as we used the file directly
    // try {
    //   if (await fs.access(req.file.path).then(() => true).catch(() => false)) {
    //     await fs.unlink(req.file.path);
    //     console.log('Temporary banner file cleaned up');
    //   }
    // } catch (cleanupError) {
    //   console.warn('Cleanup warning:', cleanupError.message);
    // }

    // Send success response
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let fullImageUrl = banner.imageUrl;
    if (banner.imageUrl && !banner.imageUrl.startsWith('http')) {
      fullImageUrl = `${baseUrl}${banner.imageUrl.startsWith('/') ? '' : '/'}${banner.imageUrl}`;
    }

    res.status(201).json({
      success: true,
      message: 'Banner created successfully!',
      data: {
        _id: banner._id,
        title: banner.title,
        description: banner.description,
        imageUrl: fullImageUrl,
        video: banner.videoId,
        order: banner.order,
        isActive: banner.isActive,
        startDate: banner.startDate,
        endDate: banner.endDate,
        targetAudience: banner.targetAudience,
        clicks: banner.clicks,
        impressions: banner.impressions,
        createdAt: banner.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Banner creation error:', error);
    require('fs').appendFileSync('error.log', error.stack + '\n');
    
    // Handle validation errors
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

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A banner with this title already exists'
      });
    }

    // Generic error response
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating the banner',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all active banners
 */
exports.getAllBanners = async (req, res) => {
  try {
    console.log('📋 GET ALL ACTIVE BANNERS');
    
    const now = new Date();
    
    // Get active banners that are within date range
    const banners = await Banner.find({
      isActive: true,
      startDate: { $lte: now },
      $or: [
        { endDate: { $gte: now } },
        { endDate: null }
      ]
    })
    .sort({ order: 1, createdAt: -1 })
    .populate('videoId', 'title description duration thumbnailUrl url category')
    .lean();

    console.log(`Found ${banners.length} active banners`);

    // Format response
    const formattedBanners = banners.map(banner => {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      // Only prepend baseUrl if imageUrl is a relative path
      let fullImageUrl = banner.imageUrl;
      if (banner.imageUrl && !banner.imageUrl.startsWith('http')) {
        fullImageUrl = `${baseUrl}${banner.imageUrl.startsWith('/') ? '' : '/'}${banner.imageUrl}`;
      }
      
      return {
        ...banner,
        imageUrl: fullImageUrl,
        video: banner.videoId,
        videoId: banner.videoId?._id,
        isExpired: banner.endDate && new Date(banner.endDate) < now
      };
    });

    res.json({
      success: true,
      data: formattedBanners
    });

  } catch (error) {
    console.error('Get banners error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banners'
    });
  }
};

/**
 * Get banner by ID
 */
exports.getBannerById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🎯 GET BANNER BY ID: ${id}`);
    
    const banner = await Banner.findById(id)
      .populate('videoId', 'title description duration thumbnailUrl url category views')
      .lean();

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    // Increment impressions
    await Banner.findByIdAndUpdate(id, { $inc: { impressions: 1 } });

    // Format response
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let fullImageUrl = banner.imageUrl;
    if (banner.imageUrl && !banner.imageUrl.startsWith('http')) {
      fullImageUrl = `${baseUrl}${banner.imageUrl.startsWith('/') ? '' : '/'}${banner.imageUrl}`;
    }
    banner.imageUrl = fullImageUrl;
    banner.video = banner.videoId;

    res.json({
      success: true,
      data: banner
    });

  } catch (error) {
    console.error('Get banner error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banner'
    });
  }
};

/**
 * Update banner
 */
exports.updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔄 UPDATE BANNER: ${id}`);
    
    const updateData = { ...req.body };
    const existingBanner = await Banner.findById(id);

    if (!existingBanner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    // Remove immutable fields
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.clicks;
    delete updateData.impressions;

    // Handle image update if new file provided
    if (req.file) {
      // Validate image file
      const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimeTypes.includes(req.file.mimetype.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid image format. Supported: JPG, PNG, GIF, WEBP'
        });
      }

      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: 'Banner image is too large. Maximum size is 5MB.'
        });
      }

      const imageUpload = await uploadBannerImage(req.file);
      await deleteFile(existingBanner.imageFileId).catch(() => {});
      updateData.imageUrl = imageUpload.url;
      updateData.imageFileId = imageUpload.fileId;
      console.log('Updated banner image:', updateData.imageUrl);
    }

    // Parse dates if provided
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }
    
    if (updateData.endDate) {
      updateData.endDate = new Date(updateData.endDate);
    }

    // Parse order if provided
    if (updateData.order) {
      updateData.order = parseInt(updateData.order);
    }

    // Parse target audience
    if (updateData.targetAudience) {
      updateData.targetAudience = Array.isArray(updateData.targetAudience) 
        ? updateData.targetAudience 
        : [updateData.targetAudience];
    }

    const banner = await Banner.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
    .populate('videoId', 'title description duration thumbnailUrl url category')
    .lean();

    // Format response
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    if (banner.imageUrl && !banner.imageUrl.startsWith('http')) {
      banner.imageUrl = `${baseUrl}${banner.imageUrl.startsWith('/') ? '' : '/'}${banner.imageUrl}`;
    }
    banner.video = banner.videoId;

    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: banner
    });

  } catch (error) {
    console.error('Update banner error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update banner'
    });
  }
};

/**
 * Delete banner (hard delete)
 */
exports.deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ DELETE BANNER: ${id}`);

    // Find the banner first to get the image URL
    const banner = await Banner.findById(id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    await deleteFile(banner.imageFileId).catch(() => {});

    // Delete the document from database
    await Banner.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Banner deleted permanently'
    });

  } catch (error) {
    console.error('Delete banner error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete banner'
    });
  }
};

/**
 * Increment banner clicks
 */
exports.incrementClicks = async (req, res) => {
  try {
    const { id } = req.params;
    
    const banner = await Banner.findByIdAndUpdate(
      id,
      { $inc: { clicks: 1 } },
      { new: true }
    ).select('title clicks');

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    console.log(`✅ Click recorded for banner: "${banner.title}" - Total clicks: ${banner.clicks}`);

    res.json({
      success: true,
      data: { 
        clicks: banner.clicks,
        bannerId: banner._id,
        title: banner.title
      }
    });
  } catch (error) {
    console.error('Increment clicks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update clicks'
    });
  }
};

/**
 * Get banner analytics
 */
exports.getBannerAnalytics = async (req, res) => {
  try {
    const banners = await Banner.find()
      .select('title clicks impressions startDate endDate isActive')
      .sort('-clicks')
      .lean();

    const totalClicks = banners.reduce((sum, banner) => sum + banner.clicks, 0);
    const totalImpressions = banners.reduce((sum, banner) => sum + banner.impressions, 0);
    const activeBanners = banners.filter(b => b.isActive).length;

    res.json({
      success: true,
      data: {
        banners,
        stats: {
          totalBanners: banners.length,
          activeBanners,
          totalClicks,
          totalImpressions,
          clickThroughRate: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    console.error('Get banner analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banner analytics'
    });
  }
};
