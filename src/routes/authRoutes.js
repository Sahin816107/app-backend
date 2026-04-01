// src/routes/authRoutes.js - CORRECTED VERSION
const express = require('express');
const router = express.Router();

// ✅ CORRECT PATH: Go up one level from routes to src, then to middleware
const auth = require('../middleware/auth');
const { uploadAvatar } = require('../utils/upload');

// Import controller
const authController = require('../controllers/authController');

// Debug logging (optional)
console.log('✅ authController loaded successfully');
console.log('register function:', typeof authController.register);

// Routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', auth.verifyToken, authController.getProfile);  // ✅ Use verifyToken
router.post('/logout', auth.verifyToken, authController.logout);
router.post('/refresh-token', authController.refreshToken);
router.patch('/profile', auth.verifyToken, authController.updateProfile);
router.post('/upload-avatar', auth.verifyToken, uploadAvatar.single('profileImage'), authController.uploadAvatar);
router.put('/change-password', auth.verifyToken, authController.changePassword);

module.exports = router;