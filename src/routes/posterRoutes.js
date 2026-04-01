const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { 
  verifyToken, 
  verifyAdmin, 
  getOptionalUser 
} = require('../middleware/auth');
const Poster = require('../models/Poster');
const User = require('../models/User');
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

const UPLOAD_BASE_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const POSTER_UPLOAD_DIR = path.join(UPLOAD_BASE_DIR, 'posters');

console.log(`[POSTER CONFIG] Poster Upload Dir: ${POSTER_UPLOAD_DIR}`);

// Ensure directory exists
if (!fs.existsSync(POSTER_UPLOAD_DIR)) {
  console.log(`[POSTER SETUP] Creating directory: ${POSTER_UPLOAD_DIR}`);
  fs.mkdirSync(POSTER_UPLOAD_DIR, { recursive: true });
}

// ✅ Multer configuration for posters only
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for posters
  },
  fileFilter: function(req, file, cb) {
    console.log(`[POSTER FILTER] Checking: ${file.mimetype}`);
    
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for posters'));
    }
  }
});

// ==================== PUBLIC ROUTES ====================

// GET /api/posters/upcoming - Get upcoming posters
router.get('/upcoming', getOptionalUser, async (req, res) => {
  try {
    console.log('📅 [POSTERS] Fetching upcoming posters...');
    
    const now = new Date();
    const { limit = 20, category, featured } = req.query;
    const userId = req.user?.id;
    
    // Build query
    const query = {
      isActive: true,
      status: { $in: ['scheduled', 'draft'] },
      releaseDate: { $gt: now }
    };
    
    if (category) {
      query.category = { $regex: new RegExp(category, 'i') };
    }
    
    if (featured === 'true') {
      query.isFeatured = true;
    }
    
    const posters = await Poster.find(query)
      .sort({ releaseDate: 1 })
      .limit(parseInt(limit))
      .populate('uploadedBy', 'username name')
      .lean();
    
    console.log(`✅ [POSTERS] Found ${posters.length} upcoming posters`);
    
    // Format response
    const formattedPosters = posters.map(poster => {
      const releaseDate = new Date(poster.releaseDate);
      const daysUntil = Math.ceil((releaseDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // Check if current user has set a reminder
      const isReminderSet = userId && poster.reminders && poster.reminders.some(id => id.toString() === userId.toString());
      
      return {
        id: poster._id,
        title: poster.title,
        description: poster.description,
        category: poster.category,
        thumbnailUrl: poster.thumbnailUrl,
        releaseDate: poster.releaseDate,
        releaseDateFormatted: poster.releaseDateFormatted,
        daysUntilRelease: daysUntil,
        duration: poster.duration,
        formattedDuration: poster.formattedDuration,
        isFree: poster.isFree,
        isFeatured: poster.isFeatured,
        views: poster.views,
        uploadedBy: poster.uploadedBy,
        status: poster.status,
        tags: poster.tags || [],
        language: poster.language,
        ageRestriction: poster.ageRestriction,
        createdAt: poster.createdAt,
        isReminderSet: !!isReminderSet,
        reminderCount: poster.reminderCount || 0
      };
    });
    
    res.json({
      success: true,
      data: formattedPosters,
      count: formattedPosters.length,
      message: 'Upcoming posters loaded successfully'
    });
    
  } catch (error) {
    console.error('❌ [POSTERS] Error fetching upcoming posters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming posters'
    });
  }
});

// GET /api/posters/:id - Get single poster
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔍 [POSTERS] Fetching poster: ${id}`);
    
    const poster = await Poster.findById(id)
      .populate('uploadedBy', 'username name phoneNumber') // ✅ CHANGED
      .lean();
    
    if (!poster) {
      return res.status(404).json({
        success: false,
        message: 'Poster not found'
      });
    }
    
    if (!poster.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Poster is not available'
      });
    }
    
    console.log(`✅ [POSTERS] Poster found: ${poster.title}`);
    
    res.json({
      success: true,
      data: {
        ...poster,
        id: poster._id,
        formattedDuration: poster.formattedDuration,
        releaseDateFormatted: poster.releaseDateFormatted
      }
    });
    
  } catch (error) {
    console.error('❌ [POSTERS] Error fetching poster:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch poster'
    });
  }
});

// POST /api/posters/:id/reminder - Set reminder for poster
router.post('/:id/reminder', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { isReminderSet } = req.body;
    const userId = req.user.id;
    
    console.log(`🔔 [POSTER REMINDER] ${isReminderSet ? 'Setting' : 'Removing'} reminder for poster: ${id}, user: ${userId}`);
    
    const poster = await Poster.findById(id);
    
    if (!poster) {
      return res.status(404).json({
        success: false,
        message: 'Poster not found'
      });
    }

    // Initialize reminders array if it doesn't exist
    if (!poster.reminders) {
      poster.reminders = [];
    }

    const userIndex = poster.reminders.indexOf(userId);

    if (isReminderSet) {
      // Add user to reminders if not already there
      if (userIndex === -1) {
        poster.reminders.push(userId);
      }
    } else {
      // Remove user from reminders if they are there
      if (userIndex !== -1) {
        poster.reminders.splice(userIndex, 1);
      }
    }

    // Update the count based on the array length
    poster.reminderCount = poster.reminders.length;
    
    await poster.save();
    
    const action = isReminderSet ? 'set' : 'removed';
    console.log(`✅ [POSTER REMINDER] Reminder ${action} for poster: "${poster.title}". New count: ${poster.reminderCount}`);
    
    res.json({
      success: true,
      message: `Reminder ${action} successfully`,
      data: {
        posterId: id,
        posterTitle: poster.title,
        isReminderSet: isReminderSet,
        reminderCount: poster.reminderCount,
        userId: userId
      }
    });
    
  } catch (error) {
    console.error('❌ [POSTER REMINDER] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder'
    });
  }
});

// ==================== ADMIN ROUTES ====================

// POST /api/posters/upload - Upload poster only (admin)
router.post('/upload', 
  verifyToken, 
  verifyAdmin,
  upload.single('poster'),
  async (req, res) => {
    try {
      console.log('📤 [POSTER UPLOAD] Processing...');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No poster file provided'
        });
      }
      
      const fileName = buildFileName('posters', req.file.originalname);
      const uploaded = await uploadFile(req.file.buffer, fileName, req.file.mimetype);
      const posterUrl = getPublicUrl(uploaded.fileName);
      
      console.log('✅ [POSTER UPLOAD] Success:', posterUrl);
      
      res.json({
        success: true,
        message: 'Poster uploaded successfully',
        data: {
          fileId: uploaded.fileId,
          url: posterUrl,
          posterUrl: posterUrl,
          size: req.file.size,
          mimetype: req.file.mimetype
        }
      });
      
    } catch (error) {
      console.error('❌ [POSTER UPLOAD] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload poster'
      });
    }
  }
);

// POST /api/posters/create - Create poster entry (admin)
router.post('/create', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      console.log('📝 [POSTER CREATE] Creating new poster...');
      
      const {
        title,
        description,
        category,
        posterUrl,
        posterFileId,
        releaseDate,
        duration = 0,
        isFree = false,
        isFeatured = false,
        tags = [],
        language = 'English',
        ageRestriction = 'All',
        status = 'scheduled',
        isUpcoming = true
      } = req.body;
      
      // Validate required fields
      if (!title || !description || !category || !posterUrl) {
        return res.status(400).json({
          success: false,
          message: 'Title, description, category, and poster URL are required'
        });
      }
      
      // Parse release date
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
      
      // Create poster
      const newPoster = new Poster({
        title,
        description,
        category,
        thumbnailUrl: posterUrl,
        thumbnailFileId: posterFileId || null,
        releaseDate: parsedReleaseDate,
        duration: parseInt(duration) || 0,
        isFree: Boolean(isFree),
        isFeatured: Boolean(isFeatured),
        isUpcoming: Boolean(isUpcoming),
        tags: Array.isArray(tags) ? tags : [tags],
        language,
        ageRestriction,
        status,
        uploadedBy: req.user.id
      });
      
      await newPoster.save();
      
      console.log(`✅ [POSTER CREATE] Poster created: ${newPoster.title}`);
      
      // Populate uploadedBy info
      await newPoster.populate('uploadedBy', 'username phoneNumber name'); // ✅ CHANGED
      
      res.status(201).json({
        success: true,
        message: 'Poster created successfully',
        data: {
          ...newPoster.toObject(),
          id: newPoster._id,
          formattedDuration: newPoster.formattedDuration,
          releaseDateFormatted: newPoster.releaseDateFormatted,
          daysUntilRelease: newPoster.daysUntilRelease,
          statusText: newPoster.statusText
        }
      });
      
    } catch (error) {
      console.error('❌ [POSTER CREATE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create poster'
      });
    }
  }
);

// GET /api/posters/admin/all - Get all posters for admin
router.get('/admin/all', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search = '', status = '', isUpcoming = '' } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      // Build query
      const query = {};
      
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (status) {
        query.status = status;
      }

      if (isUpcoming !== '') {
        query.isUpcoming = isUpcoming === 'true';
      }
      
      console.log(`🔍 [POSTER ADMIN] Query:`, { search, status, isUpcoming, page, limit });
      
      // Get posters with pagination
      const posters = await Poster.find(query)
        .sort({ releaseDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('uploadedBy', 'username phoneNumber name') // ✅ CHANGED
        .lean();
      
      // Get total count
      const total = await Poster.countDocuments(query);
      
      // Format posters
      const formattedPosters = posters.map(poster => ({
        ...poster,
        id: poster._id,
        formattedDuration: poster.formattedDuration,
        releaseDateFormatted: poster.releaseDateFormatted,
        statusText: poster.statusText,
        daysUntilRelease: poster.daysUntilRelease
      }));
      
      res.json({
        success: true,
        data: formattedPosters,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      });
      
    } catch (error) {
      console.error('❌ [POSTER ADMIN] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch posters'
      });
    }
  }
);

// PUT /api/posters/:id - Update poster (admin)
router.put('/:id', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      console.log(`🔄 [POSTER UPDATE] Updating poster: ${id}`);
      
      const poster = await Poster.findById(id);
      
      if (!poster) {
        return res.status(404).json({
          success: false,
          message: 'Poster not found'
        });
      }
      
      // Update fields
      const updateFields = [
        'title', 'description', 'category', 'releaseDate',
        'duration', 'isFree', 'isFeatured', 'isActive', 'isUpcoming',
        'tags', 'language', 'ageRestriction', 'status'
      ];
      
      updateFields.forEach(field => {
        if (req.body[field] !== undefined) {
          if (field === 'releaseDate') {
            const date = new Date(req.body[field]);
            if (!isNaN(date.getTime())) {
              poster[field] = date;
            }
          } else if (field === 'duration') {
            poster[field] = parseInt(req.body[field]) || 0;
          } else if (field === 'tags' && typeof req.body[field] === 'string') {
            poster[field] = req.body[field].split(',').map(tag => tag.trim());
          } else {
            poster[field] = req.body[field];
          }
        }
      });
      
      // Update thumbnail if provided
      if (req.body.posterUrl) {
        poster.thumbnailUrl = req.body.posterUrl;
      }
      if (req.body.posterFileId !== undefined) {
        poster.thumbnailFileId = req.body.posterFileId || null;
      }
      
      await poster.save();
      
      console.log(`✅ [POSTER UPDATE] Poster updated: ${poster.title}`);
      
      res.json({
        success: true,
        message: 'Poster updated successfully',
        data: {
          ...poster.toObject(),
          id: poster._id,
          formattedDuration: poster.formattedDuration,
          releaseDateFormatted: poster.releaseDateFormatted,
          daysUntilRelease: poster.daysUntilRelease,
          statusText: poster.statusText
        }
      });
      
    } catch (error) {
      console.error('❌ [POSTER UPDATE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update poster'
      });
    }
  }
);

// DELETE /api/posters/:id - Delete poster (admin - hard delete)
router.delete('/:id', 
  verifyToken, 
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      console.log(`🗑️ [POSTER DELETE] Deleting poster: ${id}`);
      
      const poster = await Poster.findById(id);
      
      if (!poster) {
        return res.status(404).json({
          success: false,
          message: 'Poster not found'
        });
      }
      
      await deleteFile(poster.thumbnailFileId).catch(() => {});
      
      // Hard delete from database
      await Poster.findByIdAndDelete(id);
      
      console.log(`✅ [POSTER DELETE] Poster permanently removed: ${poster.title}`);
      
      res.json({
        success: true,
        message: 'Poster deleted permanently',
        data: {
          id: poster._id,
          title: poster.title
        }
      });
      
    } catch (error) {
      console.error('❌ [POSTER DELETE] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete poster'
      });
    }
  }
);

module.exports = router;
