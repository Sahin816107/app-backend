// src/routes/userRoutes.js (নতুন ফাইল তৈরি করুন)
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { 
  updateProfile, 
  changePassword, 
  uploadAvatar 
} = require('../controllers/userController');

// User profile routes
router.post('/profile', auth, updateProfile);
router.post('/upload-avatar', auth, uploadAvatar);
router.put('/change-password', auth, changePassword);

module.exports = router;