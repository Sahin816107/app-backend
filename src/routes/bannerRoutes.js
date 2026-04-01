// backend/src/routes/banner.js
const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/BannerController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const BANNER_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'banners');

// Ensure directory exists
if (!fs.existsSync(BANNER_UPLOAD_DIR)) {
  console.log(`[BANNER] Creating directory: ${BANNER_UPLOAD_DIR}`);
  fs.mkdirSync(BANNER_UPLOAD_DIR, { recursive: true });
}

// Multer configuration for banners
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function(req, file, cb) {
    console.log(`[BANNER UPLOAD] File filter check: ${file.mimetype}`);
    
    // Accept image files only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for banners'));
    }
  }
});

// ==================== ADMIN ROUTES ====================

// GET /api/banners/admin/all - Get all banners including inactive (admin only)
router.get('/admin/all', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 50, search = '' } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const query = {};
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      const banners = await require('../models/Banner').find(query)
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('videoId', 'title thumbnailUrl')
        .lean();
      
      const total = await require('../models/Banner').countDocuments(query);
      
      res.json({
        success: true,
        data: banners,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('Admin banners fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch banners'
      });
    }
  }
);

// GET /api/banners/admin/analytics - Get banner analytics (admin only)
router.get('/admin/analytics', 
  verifyToken, 
  verifyAdmin,
  bannerController.getBannerAnalytics
);

// POST /api/banners - Create new banner (admin only)
router.post('/', 
  verifyToken, 
  verifyAdmin,
  (req, res, next) => {
    console.log('========================================');
    console.log('🖼️ BANNER UPLOAD REQUEST');
    console.log('========================================');
    console.log('User:', req.user ? req.user.username : 'No user');
    console.log('Body:', req.body);
    next();
  },
  upload.single('image'),
  (req, res, next) => {
    console.log('📁 File received:', req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
      filename: req.file.originalname
    } : 'No file');
    console.log('========================================');
    next();
  },
  bannerController.createBanner
);

// PUT /api/banners/:id - Update banner (admin only)
router.put('/:id', 
  verifyToken, 
  verifyAdmin,
  upload.single('image'),
  bannerController.updateBanner
);

// DELETE /api/banners/:id - Delete banner (admin only)
router.delete('/:id', 
  verifyToken, 
  verifyAdmin,
  bannerController.deleteBanner
);

// PATCH /api/banners/:id/status - Toggle banner status (admin only)
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
      
      const banner = await require('../models/Banner').findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
      ).select('title isActive');
      
      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }
      
      console.log(`✅ Banner status updated: "${banner.title}" is now ${banner.isActive ? 'active' : 'inactive'}`);
      
      res.json({
        success: true,
        message: `Banner ${banner.isActive ? 'activated' : 'deactivated'} successfully`,
        data: {
          _id: banner._id,
          title: banner.title,
          isActive: banner.isActive
        }
      });
      
    } catch (error) {
      console.error('Toggle banner status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update banner status'
      });
    }
  }
);

// ==================== PUBLIC ROUTES ====================

// GET /api/banners - Get all active banners (public)
router.get('/', bannerController.getAllBanners);

// GET /api/banners/:id - Get banner by ID (public)
router.get('/:id', bannerController.getBannerById);

// PATCH /api/banners/:id/click - Increment banner clicks (public)
router.patch('/:id/click', bannerController.incrementClicks);

module.exports = router;
