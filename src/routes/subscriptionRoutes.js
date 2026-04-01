const express = require('express');
const router = express.Router();
const {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus,
  getSubscriptionPlans
} = require('../controllers/SubscriptionController');
const { verifyToken } = require('../middleware/auth');

// Get subscription plans (public)
router.get('/plans', getSubscriptionPlans);

// Get user subscription status (protected)
router.get('/status', verifyToken, getSubscriptionStatus);

// Create subscription order (protected)
router.post('/create-order', verifyToken, createSubscriptionOrder);

// Verify payment (protected)
router.post('/verify-payment', verifyToken, verifyPayment);

module.exports = router;