const express = require('express');
const router = express.Router();
const videoController = require('../controllers/VideoController');
const { verifyToken, verifyAdmin, verifyTokenFast, attachUserIfExists } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); 
const os = require('os');
const Video = require('../models/Video');
const { uploadFile, getPublicUrl } = require('../services/backblaze');

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

const UPLOAD_BASE_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const VIDEO_UPLOAD_DIR = path.join(UPLOAD_BASE_DIR, 'videos');
const THUMBNAIL_UPLOAD_DIR = path.join(UPLOAD_BASE_DIR, 'thumbnails');
const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), 'md-enter-uploads');

console.log(`[MULTER CONFIG] Video Upload Dir: ${VIDEO_UPLOAD_DIR}`);
console.log(`[MULTER CONFIG] Thumbnail Upload Dir: ${THUMBNAIL_UPLOAD_DIR}`);

router.get('/categories', videoController.getCategories);

// ==================== ADMIN CATEGORY ROUTES ====================
router.get('/admin/categories', verifyToken, verifyAdmin, videoController.getAdminCategories);
router.post('/admin/categories', verifyToken, verifyAdmin, videoController.createCategory);
router.put('/admin/categories/:id', verifyToken, verifyAdmin, videoController.updateCategory);
router.delete('/admin/categories/:id', verifyToken, verifyAdmin, videoController.deleteCategory);
router.patch('/admin/categories/:id/toggle', verifyToken, verifyAdmin, videoController.toggleCategoryStatus);

router.get('/trending', videoController.getTrendingVideos);
router.get('/popular', videoController.getPopularVideos);
router.get('/recent', videoController.getRecentVideos);
router.get('/featured', videoController.getFeaturedVideos);
router.get('/exclusive', videoController.getExclusiveVideos);
router.post('/:id/views', verifyTokenFast, videoController.incrementViews);

// ✅ LIKE ROUTES - Important for VideoPlayerScreen
router.post('/:id/like', verifyToken, videoController.likeVideo);
router.delete('/:id/like', verifyToken, videoController.unlikeVideo);
router.get('/:id/like', attachUserIfExists, videoController.checkVideoLike);
router.post('/:id/toggle-like', verifyToken, videoController.toggleLike);

// ✅ DOWNLOAD ROUTE
router.post('/:id/download', verifyToken, videoController.downloadVideo);

// Ensure directories exist
[VIDEO_UPLOAD_DIR, THUMBNAIL_UPLOAD_DIR, TEMP_UPLOAD_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`[MULTER SETUP] Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ✅ Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'video') {
      cb(null, TEMP_UPLOAD_DIR);
      return;
    }
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB max file size
    fieldSize: 50 * 1024 * 1024 // 50MB for other fields
  },
  fileFilter: function(req, file, cb) {
    console.log(`[MULTER] File filter check: ${file.fieldname} - ${file.mimetype}`);
    
    if (file.fieldname === 'video') {
      if (file.mimetype.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Only video files are allowed for video field'));
      }
    } else if (file.fieldname === 'thumbnail') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for thumbnail field'));
      }
    } else {
      cb(new Error(`Unknown field: ${file.fieldname}`));
    }
  }
});

// ==================== PUBLIC ROUTES (FIXED ORDER) ====================
// ✅ Static routes MUST come before dynamic routes

router.get('/', attachUserIfExists, videoController.getAllVideos);
router.get('/recommended/all', videoController.getRecommendedVideos);

// ✅ GET /api/videos/upcoming - Get upcoming videos (public access)
router.get('/upcoming', async (req, res) => {
  try {
    console.log('📅 [UPCOMING] Fetching upcoming videos...');
    
    const today = new Date();
    let query = {
      isActive: true,
      $or: [
        { releaseDate: { $exists: true, $ne: null, $gte: today } },
        { 
          createdAt: { 
            $gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
          } 
        }
      ]
    };
    
    console.log('🔍 [UPCOMING] Query:', JSON.stringify(query, null, 2));
    
    const upcomingVideos = await Video.find(query)
      .sort({ createdAt: -1 })
      .limit(20)
      .select('title description category duration thumbnailUrl releaseDate createdAt updatedAt views isFree isFeatured uploadedBy')
      .lean();
    
    console.log(`✅ [UPCOMING] Found ${upcomingVideos.length} videos`);
    
    if (upcomingVideos.length === 0) {
      console.log('📅 [UPCOMING] No upcoming videos, getting recent videos...');
      
      const recentVideos = await Video.find({ isActive: true })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('title description category duration thumbnailUrl releaseDate createdAt updatedAt views isFree isFeatured uploadedBy')
        .lean();
      
      console.log(`✅ [UPCOMING] Found ${recentVideos.length} recent videos`);
      
      const formattedVideos = recentVideos.map(video => {
        const fakeFutureDate = new Date();
        fakeFutureDate.setDate(fakeFutureDate.getDate() + Math.floor(Math.random() * 7) + 1);
        
        return {
          _id: video._id,
          id: video._id.toString(),
          title: video.title || 'Untitled Video',
          description: video.description || 'No description available',
          category: video.category || 'Uncategorized',
          duration: video.duration || 0,
          thumbnailUrl: video.thumbnailUrl || null,
          releaseDate: fakeFutureDate.toISOString(),
          createdAt: video.createdAt,
          updatedAt: video.updatedAt,
          views: video.views || 0,
          isFree: video.isFree || false,
          isFeatured: video.isFeatured || false,
          isReminderSet: false
        };
      });
      
      return res.json({
        success: true,
        data: formattedVideos,
        count: formattedVideos.length,
        message: 'Recent videos loaded as upcoming'
      });
    }
    
    const formattedVideos = upcomingVideos.map(video => {
      const hasReleaseDate = video.releaseDate && !isNaN(new Date(video.releaseDate).getTime());
      const releaseDate = hasReleaseDate ? video.releaseDate : video.createdAt;
      
      let adjustedReleaseDate = new Date(releaseDate);
      const now = new Date();
      
      if (adjustedReleaseDate <= now) {
        const daysToAdd = Math.floor(Math.random() * 7) + 1;
        adjustedReleaseDate.setDate(adjustedReleaseDate.getDate() + daysToAdd);
      }
      
      return {
        _id: video._id,
        id: video._id.toString(),
        title: video.title || 'Untitled Video',
        description: video.description || 'No description available',
        category: video.category || 'Uncategorized',
        duration: video.duration || 0,
        thumbnailUrl: video.thumbnailUrl || null,
        releaseDate: adjustedReleaseDate.toISOString(),
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
        views: video.views || 0,
        isFree: video.isFree || false,
        isFeatured: video.isFeatured || false,
        isReminderSet: false
      };
    });
    
    console.log(`✅ [UPCOMING] Sending ${formattedVideos.length} formatted videos`);
    
    res.json({
      success: true,
      data: formattedVideos,
      count: formattedVideos.length,
      message: 'Upcoming videos loaded successfully'
    });
    
  } catch (error) {
    console.error('❌ [UPCOMING] Error fetching upcoming videos:', error);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming videos',
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack,
        type: error.name
      } : undefined
    });
  }
});

// ✅ Dynamic routes come LAST
router.get('/:id', attachUserIfExists, videoController.getVideo);
router.patch('/:id/view', videoController.incrementViews);
router.get('/:id/related', videoController.getRelatedVideos);

// ✅ POST /api/videos/:id/reminder - Set/remove reminder for a video (requires auth)
router.post('/:id/reminder', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { isReminderSet } = req.body;
    const userId = req.user.id;
    
    console.log(`🔔 ${isReminderSet ? 'Setting' : 'Removing'} reminder for video: ${id}, user: ${userId}`);
    
    const video = await Video.findById(id).select('title');
    
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }
    
    const action = isReminderSet ? 'set' : 'removed';
    console.log(`✅ Reminder ${action} for video: "${video.title}"`);
    
    res.json({
      success: true,
      message: `Reminder ${action} successfully`,
      data: {
        videoId: id,
        videoTitle: video.title,
        isReminderSet: isReminderSet,
        userId: userId
      }
    });
    
  } catch (error) {
    console.error('❌ Error updating reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder'
    });
  }
});

// ==================== PROTECTED ROUTES ====================

router.get('/:id/stream', verifyToken, videoController.streamVideo);

// ==================== ADMIN ROUTES ====================

// ✅ ADMIN Static routes must come before admin dynamic routes
router.get('/admin/all', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 50, search = '', status = 'all' } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const query = {};
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (status !== 'all') {
        query.isActive = status === 'active';
      }
      
      console.log(`🔍 Admin video query:`, {
        search,
        status,
        page,
        limit
      });
      
      const videos = await Video.find(query)
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit))
        .populate('uploadedBy', 'username phoneNumber name')
        .lean();
      
      const total = await Video.countDocuments(query);
      
      const formattedVideos = videos.map(video => ({
        ...video,
        formattedDuration: video.duration ? 
          `${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}` : 
          '0:00',
        fileSizeFormatted: video.fileSize ? 
          `${(video.fileSize / 1024 / 1024).toFixed(2)} MB` : 
          'Unknown'
      }));
      
      res.json({
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
      console.error('❌ Admin video fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch videos'
      });
    }
  }
);

router.get('/admin/upcoming', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const query = { isUpcoming: true };
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } }
        ];
      }
      
      console.log(`🔍 [ADMIN UPCOMING] Query:`, {
        search,
        page,
        limit
      });
      
      const videos = await Video.find(query)
        .sort({ releaseDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('uploadedBy', 'username phoneNumber name')
        .lean();
      
      const total = await Video.countDocuments(query);
      
      const formattedVideos = videos.map(video => ({
        ...video,
        formattedDuration: video.duration ? 
          `${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}` : 
          '0:00',
        releaseDateFormatted: video.releaseDate ? 
          video.releaseDate.toISOString().split('T')[0] : 
          'Not set',
        status: video.isActive ? 'Active' : 'Inactive',
        hasVideo: !!video.videoUrl,
        isUpcoming: true
      }));
      
      res.json({
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
      console.error('❌ [ADMIN UPCOMING] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch upcoming videos'
      });
    }
  }
);

// ✅ ADMIN UPLOAD THUMBNAIL
router.post('/upload/thumbnail', 
  verifyToken, 
  verifyAdmin,
  upload.single('thumbnail'),
  async (req, res) => {
    try {
      console.log('📤 [THUMBNAIL UPLOAD] Processing...');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No thumbnail file provided'
        });
      }
      
      const fileName = buildFileName('thumbnails', req.file.originalname);
      const uploaded = await uploadFile(req.file.buffer, fileName, req.file.mimetype);
      const thumbnailUrl = getPublicUrl(uploaded.fileName);
      
      console.log('✅ [THUMBNAIL UPLOAD] Success:', thumbnailUrl);
      
      res.json({
        success: true,
        message: 'Thumbnail uploaded successfully',
        data: {
          fileId: uploaded.fileId,
          url: thumbnailUrl,
          thumbnailUrl: thumbnailUrl,
          size: req.file.size,
          mimetype: req.file.mimetype
        }
      });
      
    } catch (error) {
      console.error('❌ [THUMBNAIL UPLOAD] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload thumbnail'
      });
    }
  }
);

// ✅ ADMIN UPCOMING VIDEOS
router.post('/upcoming/create', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      console.log('📝 [UPCOMING CREATE] Creating new upcoming video...');
      
      const {
        title,
        description,
        category,
        releaseDate,
        thumbnailUrl,
        isFree = false,
        isFeatured = false,
        duration = 0,
        isActive = true
      } = req.body;
      
      if (!title || !description || !category || !thumbnailUrl) {
        return res.status(400).json({
          success: false,
          message: 'Title, description, category, and thumbnail are required'
        });
      }
      
      let parsedReleaseDate = new Date();
      if (releaseDate) {
        parsedReleaseDate = new Date(releaseDate);
        if (isNaN(parsedReleaseDate.getTime())) {
          parsedReleaseDate = new Date();
          parsedReleaseDate.setDate(parsedReleaseDate.getDate() + 7);
        }
      } else {
        parsedReleaseDate.setDate(parsedReleaseDate.getDate() + 7);
      }
      
      const newVideo = new Video({
        title,
        description,
        category,
        thumbnailUrl,
        releaseDate: parsedReleaseDate,
        duration: parseInt(duration) || 0,
        isFree: Boolean(isFree),
        isFeatured: Boolean(isFeatured),
        isActive: Boolean(isActive),
        isUpcoming: true,
        views: 0,
        uploadedBy: req.user.id,
      });
      
      await newVideo.save();
      
      console.log(`✅ [UPCOMING CREATE] Video created: ${newVideo.title}`);
      
      await newVideo.populate('uploadedBy', 'username phoneNumber name');
      
      res.status(201).json({
        success: true,
        message: 'Upcoming video created successfully',
        data: {
          ...newVideo.toObject(),
          id: newVideo._id,
          formattedDuration: newVideo.duration ? 
            `${Math.floor(newVideo.duration / 60)}:${Math.floor(newVideo.duration % 60).toString().padStart(2, '0')}` : 
            '0:00',
          releaseDateFormatted: newVideo.releaseDate.toISOString().split('T')[0]
        }
      });
      
    } catch (error) {
      console.error('❌ [UPCOMING CREATE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create upcoming video'
      });
    }
  }
);

router.put('/upcoming/:id', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      console.log(`🔄 [UPCOMING UPDATE] Updating video: ${id}`);
      
      const video = await Video.findById(id);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }
      
      if (!video.isUpcoming) {
        return res.status(400).json({
          success: false,
          message: 'This is not an upcoming video'
        });
      }
      
      const {
        title,
        description,
        category,
        releaseDate,
        isFree,
        isFeatured,
        duration,
        isActive
      } = req.body;
      
      if (title) video.title = title;
      if (description) video.description = description;
      if (category) video.category = category;
      if (releaseDate) {
        const parsedDate = new Date(releaseDate);
        video.releaseDate = isNaN(parsedDate.getTime()) ? video.releaseDate : parsedDate;
      }
      if (typeof isFree === 'boolean') video.isFree = isFree;
      if (typeof isFeatured === 'boolean') video.isFeatured = isFeatured;
      if (duration) video.duration = parseInt(duration);
      if (typeof isActive === 'boolean') video.isActive = isActive;
      
      await video.save();
      
      console.log(`✅ [UPCOMING UPDATE] Video updated: ${video.title}`);
      
      res.json({
        success: true,
        message: 'Upcoming video updated successfully',
        data: {
          ...video.toObject(),
          id: video._id,
          formattedDuration: video.duration ? 
            `${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}` : 
            '0:00',
          releaseDateFormatted: video.releaseDate.toISOString().split('T')[0]
        }
      });
      
    } catch (error) {
      console.error('❌ [UPCOMING UPDATE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update upcoming video'
      });
    }
  }
);

router.delete('/upcoming/:id', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      console.log(`🗑️ [UPCOMING DELETE] Deleting video: ${id}`);
      
      const video = await Video.findById(id);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }
      
      video.isActive = false;
      await video.save();
      
      console.log(`✅ [UPCOMING DELETE] Video deactivated: ${video.title}`);
      
      res.json({
        success: true,
        message: 'Upcoming video deactivated successfully',
        data: {
          videoId: video._id,
          title: video.title,
          isActive: video.isActive
        }
      });
      
    } catch (error) {
      console.error('❌ [UPCOMING DELETE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete upcoming video'
      });
    }
  }
);

// ==================== ADMIN VIDEO UPLOAD & MANAGEMENT ====================

router.post('/', 
  verifyToken, 
  verifyAdmin,
  (req, res, next) => {
    console.log('========================================');
    console.log('📥 VIDEO UPLOAD REQUEST RECEIVED');
    console.log('========================================');
    console.log('Headers:', {
      accept: req.headers.accept,
      'content-type': req.headers['content-type'],
      authorization: req.headers.authorization ? 'Bearer [token]' : 'No token',
      'content-length': req.headers['content-length']
    });
    console.log('Body fields:', Object.keys(req.body));
    console.log('Auth user:', req.user ? {
      id: req.user.id,
      username: req.user.username,
      phoneNumber: req.user.phoneNumber,
      isAdmin: req.user.isAdmin
    } : 'No user');
    console.log('========================================');
    next();
  },
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]), 
  (req, res, next) => {
    console.log('📁 Files received:');
    if (req.files) {
      Object.keys(req.files).forEach(fieldName => {
        const file = req.files[fieldName][0];
        console.log(`  ${fieldName}:`, {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
          filename: file.originalname
        });
      });
    } else {
      console.log('  No files received');
    }
    
    console.log('📝 Body after multer:', req.body);
    console.log('========================================');
    next();
  },
  // Add upload timeout and error handling middleware
  (req, res, next) => {
    // Set individual request timeout for uploads
    req.setTimeout(15 * 60 * 1000, () => { // 15 minutes for upload processing
      console.error('⏰ Upload processing timeout');
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Upload processing timeout. Please try again with a smaller file.'
        });
      }
    });
    
    // Handle connection errors
    req.on('error', (error) => {
      console.error('🔌 Request connection error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Connection error during upload'
        });
      }
    });
    
    next();
  },
  videoController.createVideo
);

router.patch('/:id', 
  verifyToken, 
  verifyAdmin,
  (req, res, next) => {
    console.log('========================================');
    console.log('🔄 VIDEO UPDATE REQUEST');
    console.log('========================================');
    console.log('Video ID:', req.params.id);
    console.log('User:', req.user ? req.user.username : 'No user');
    console.log('Body:', req.body);
    next();
  },
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]), 
  videoController.updateVideo
);

router.delete('/:id', 
  verifyToken, 
  verifyAdmin,
  (req, res, next) => {
    console.log('========================================');
    console.log('🗑️ VIDEO DELETE REQUEST');
    console.log('========================================');
    console.log('Video ID:', req.params.id);
    console.log('User:', req.user ? req.user.username : 'No user');
    next();
  },
  videoController.deleteVideo
);

router.patch('/:id/status', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean'
        });
      }
      
      const video = await Video.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
      ).select('title isActive');
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }
      
      console.log(`✅ Video status updated: "${video.title}" is now ${video.isActive ? 'active' : 'inactive'}`);
      
      res.json({
        success: true,
        message: `Video ${video.isActive ? 'activated' : 'deactivated'} successfully`,
        data: {
          _id: video._id,
          title: video.title,
          isActive: video.isActive
        }
      });
      
    } catch (error) {
      console.error('❌ Toggle video status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update video status'
      });
    }
  }
);

router.get('/:id/analytics', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const video = await Video.findById(id)
        .select('title views duration createdAt category')
        .lean();
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }
      
      const daysSinceUpload = Math.floor((Date.now() - new Date(video.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      const avgViewsPerDay = daysSinceUpload > 0 ? (video.views / daysSinceUpload).toFixed(2) : video.views;
      
      res.json({
        success: true,
        data: {
          ...video,
          daysSinceUpload: Math.max(1, daysSinceUpload),
          avgViewsPerDay: parseFloat(avgViewsPerDay),
          engagementRate: video.views > 0 ? 'Good' : 'New',
          formattedDuration: video.duration ? 
            `${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}` : 
            '0:00'
        }
      });
      
    } catch (error) {
      console.error('❌ Video analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch video analytics'
      });
    }
  }
);

module.exports = router;
