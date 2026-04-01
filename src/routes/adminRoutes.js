const express = require('express');
const router = express.Router();
const adminController = require('../controllers/AdminController');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

router.get('/stats', verifyToken, verifyAdmin, adminController.getDashboardStats);
router.get('/users', verifyToken, verifyAdmin, adminController.getAllUsers);
router.put('/users/:id', verifyToken, verifyAdmin, adminController.updateUser);
router.delete('/users/:id', verifyToken, verifyAdmin, adminController.deleteUser);

module.exports = router;