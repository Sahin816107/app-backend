// backend/src/routes/downloadRoutes.js
const express = require('express');
const router = express.Router();

// ✅ সঠিকভাবে middleware import করুন
const { verifyToken } = require('../middleware/auth');

// ✅ Controller import করুন
const downloadController = require('../controllers/downloadController');

// Debug logs
console.log('🚀 Download Routes Initializing...');
console.log('📦 downloadController functions:', Object.keys(downloadController).join(', '));
console.log('🔐 verifyToken type:', typeof verifyToken);

// ==================== TEST ROUTES ====================

/**
 * @route GET /api/downloads/test
 * @description Test route without authentication
 * @access Public
 */
router.get('/test', (req, res) => {
  console.log('✅ GET /api/downloads/test called');
  res.json({
    success: true,
    message: 'Downloads API is working!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET    /api/downloads/test',
      'GET    /api/downloads/test-auth',
      'GET    /api/downloads',
      'GET    /api/downloads/status/:videoId',
      'GET    /api/downloads/stats',
      'GET    /api/downloads/stream/:id',
      'DELETE /api/downloads/:id',
      'DELETE /api/downloads',
      'PATCH  /api/downloads/:id'
    ]
  });
});

/**
 * @route GET /api/downloads/test-auth
 * @description Test route with authentication
 * @access Private
 */
router.get('/test-auth', verifyToken, (req, res) => {
  console.log('✅ GET /api/downloads/test-auth called');
  console.log('👤 User:', req.user ? req.user.phoneNumber : 'No user'); // ✅ CHANGED
  
  res.json({
    success: true,
    message: 'Downloads auth test successful!',
    user: req.user ? {
      id: req.user.id,
      phoneNumber: req.user.phoneNumber, // ✅ CHANGED
      name: req.user.name,
      isAdmin: req.user.isAdmin,
      isSubscribed: req.user.isSubscribed
    } : null,
    timestamp: new Date().toISOString()
  });
});

// ==================== MAIN DOWNLOAD ROUTES ====================

/**
 * @route GET /api/downloads
 * @description Get all downloaded videos for authenticated user
 * @access Private
 */
router.get('/', verifyToken, async (req, res, next) => {
  console.log('📥 GET /api/downloads called');
  console.log('👤 User ID:', req.user.id);
  
  try {
    // Check if controller function exists
    if (typeof downloadController.getDownloads !== 'function') {
      throw new Error('getDownloads controller function not found');
    }
    
    await downloadController.getDownloads(req, res);
  } catch (error) {
    console.error('❌ Error in GET /api/downloads:', error.message);
    next(error);
  }
});

/**
 * @route GET /api/downloads/status/:videoId
 * @description Check if a video is downloaded by the user
 * @access Private
 */
router.get('/status/:videoId', verifyToken, async (req, res, next) => {
  const { videoId } = req.params;
  console.log(`📊 GET /api/downloads/status/${videoId} called`);
  console.log('👤 User ID:', req.user.id);
  
  try {
    if (typeof downloadController.checkDownloadStatus !== 'function') {
      throw new Error('checkDownloadStatus controller function not found');
    }
    
    await downloadController.checkDownloadStatus(req, res);
  } catch (error) {
    console.error('❌ Error in GET /api/downloads/status/:videoId:', error.message);
    next(error);
  }
});

/**
 * @route GET /api/downloads/stats
 * @description Get download statistics for authenticated user
 * @access Private
 */
router.get('/stats', verifyToken, async (req, res, next) => {
  console.log('📈 GET /api/downloads/stats called');
  console.log('👤 User ID:', req.user.id);
  
  try {
    if (typeof downloadController.getDownloadStats !== 'function') {
      throw new Error('getDownloadStats controller function not found');
    }
    
    await downloadController.getDownloadStats(req, res);
  } catch (error) {
    console.error('❌ Error in GET /api/downloads/stats:', error.message);
    next(error);
  }
});

/**
 * @route GET /api/downloads/stream/:id
 * @description Stream a downloaded video
 * @access Private
 */
router.get('/stream/:id', verifyToken, async (req, res, next) => {
  const { id } = req.params;
  console.log(`🎬 GET /api/downloads/stream/${id} called`);
  console.log('👤 User ID:', req.user.id);
  
  try {
    if (typeof downloadController.streamDownload !== 'function') {
      throw new Error('streamDownload controller function not found');
    }
    
    await downloadController.streamDownload(req, res);
  } catch (error) {
    console.error('❌ Error in GET /api/downloads/stream/:id:', error.message);
    next(error);
  }
});

/**
 * @route DELETE /api/downloads/:id
 * @description Delete a specific downloaded video
 * @access Private
 */
router.delete('/:id', verifyToken, async (req, res, next) => {
  const { id } = req.params;
  console.log(`🗑️ DELETE /api/downloads/${id} called`);
  console.log('👤 User ID:', req.user.id);
  
  try {
    if (typeof downloadController.deleteDownload !== 'function') {
      throw new Error('deleteDownload controller function not found');
    }
    
    await downloadController.deleteDownload(req, res);
  } catch (error) {
    console.error('❌ Error in DELETE /api/downloads/:id:', error.message);
    next(error);
  }
});

/**
 * @route DELETE /api/downloads
 * @description Delete all downloaded videos for the user
 * @access Private
 */
router.delete('/', verifyToken, async (req, res, next) => {
  console.log('🗑️ DELETE /api/downloads called');
  console.log('👤 User ID:', req.user.id);
  
  try {
    if (typeof downloadController.deleteAllDownloads !== 'function') {
      throw new Error('deleteAllDownloads controller function not found');
    }
    
    await downloadController.deleteAllDownloads(req, res);
  } catch (error) {
    console.error('❌ Error in DELETE /api/downloads:', error.message);
    next(error);
  }
});

/**
 * @route PATCH /api/downloads/:id
 * @description Update download status (watched/unwatched)
 * @access Private
 */
router.patch('/:id', verifyToken, async (req, res, next) => {
  const { id } = req.params;
  console.log(`🔄 PATCH /api/downloads/${id} called`);
  console.log('👤 User ID:', req.user.id);
  console.log('📝 Request body:', req.body);
  
  try {
    if (typeof downloadController.updateDownloadStatus !== 'function') {
      throw new Error('updateDownloadStatus controller function not found');
    }
    
    await downloadController.updateDownloadStatus(req, res);
  } catch (error) {
    console.error('❌ Error in PATCH /api/downloads/:id:', error.message);
    next(error);
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler for download routes
router.use('*', (req, res) => {
  console.log(`❌ Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: `Download route ${req.method} ${req.originalUrl} not found`,
    availableRoutes: [
      'GET    /api/downloads',
      'GET    /api/downloads/status/:videoId',
      'GET    /api/downloads/stats',
      'GET    /api/downloads/stream/:id',
      'DELETE /api/downloads/:id',
      'DELETE /api/downloads',
      'PATCH  /api/downloads/:id'
    ]
  });
});

// Error handling middleware for download routes
router.use((err, req, res, next) => {
  console.error('🔥 Download route error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Download operation failed',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

console.log('✅ Download routes initialized successfully');

module.exports = router;