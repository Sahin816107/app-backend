// for check update
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
const http = require('http');

dotenv.config();

const app = express();

// CORS Configuration - Apply FIRST before any routes
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins for testing, or specific origins in production
    const allowedOrigins = [
      "https://md-entertainment.in",
      "https://www.md-entertainment.in", 
      "https://api.md-entertainment.in",
      "http://localhost:3000",
      "http://localhost:3001"
    ];
    
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With", "Range", "Content-Range"],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

const { connectDB } = require('./src/config/database');

const authRoutes = require('./src/routes/authRoutes');
const videoRoutes = require('./src/routes/videoRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const subscriptionRoutes = require('./src/routes/subscriptionRoutes');
const posterRoutes = require('./src/routes/posterRoutes');
const downloadRoutes = require('./src/routes/downloadRoutes');
const bannerRoutes = require('./src/routes/bannerRoutes');
// const userRoutes = require('./src/routes/userRoutes');



// Increase payload size limit for large video uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Timeout configuration for large file uploads
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '1800000', 10); // 30 minutes
const HEADERS_TIMEOUT_MS = parseInt(process.env.HEADERS_TIMEOUT_MS || '1810000', 10);
const KEEP_ALIVE_TIMEOUT_MS = parseInt(process.env.KEEP_ALIVE_TIMEOUT_MS || '120000', 10);

// Global timeout middleware
app.use((req, res, next) => {
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    console.warn(`Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${req.method} ${req.url}`);
  });
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    console.warn(`Response timeout after ${REQUEST_TIMEOUT_MS}ms: ${req.method} ${req.url}`);
  });
  next();
});

// Add error handling for large payloads
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'File too large. Maximum file size is 500MB',
        maxSize: '500MB'
      });
    }
  }
  next(error);
});

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
const videosDir = path.join(uploadsDir, 'videos');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');
const postersDir = path.join(uploadsDir, 'posters');
const avatarsDir = path.join(uploadsDir, 'avatars');

[uploadsDir, videosDir, thumbnailsDir, postersDir, avatarsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

app.use('/uploads', express.static(uploadsDir));

// Welcome route
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: '🎬 Video Streaming API is Running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      videos: '/api/videos',
      posters: '/api/posters',
      admin: '/api/admin',
      subscribe: '/api/subscribe'
    },
    docs: 'Coming soon...',
    uploads: `http://${req.get('host')}/uploads`
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: '✅ Healthy',
    serverTime: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/posters', posterRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscribe', subscriptionRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/downloads', downloadRoutes);
// app.use('/api/users', userRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: {
      auth: [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'GET /api/auth/profile',
        'POST /api/auth/logout',
        'POST /api/auth/refresh-token'
      ],
      videos: [
        'GET /api/videos - Get all videos',
        'GET /api/videos/upcoming - Get upcoming videos',
        'GET /api/videos/:id - Get video by ID',
        'GET /api/videos/:id/stream - Stream video (auth required)',
        'PATCH /api/videos/:id/view - Increment view count',
        'POST /api/videos/:id/reminder - Set/remove reminder (auth required)',
        'POST /api/videos - Upload video (admin only)',
        'PUT /api/videos/:id - Update video (admin only)',
        'DELETE /api/videos/:id - Delete video (admin only)',
        'GET /api/videos/admin/all - Get all videos for admin',
        'PATCH /api/videos/:id/status - Toggle video status (admin only)',
        'GET /api/videos/:id/analytics - Get video analytics (admin only)'
      ],
      posters: [
        'GET /api/posters/upcoming - Get upcoming posters',
        'GET /api/posters/:id - Get poster by ID',
        'POST /api/posters/:id/reminder - Set reminder (auth required)',
        'POST /api/posters/upload - Upload poster (admin only)',
        'POST /api/posters/create - Create poster entry (admin only)',
        'GET /api/posters/admin/all - Get all posters for admin',
        'PUT /api/posters/:id - Update poster (admin only)',
        'DELETE /api/posters/:id - Delete poster (admin only)'
      ],
      admin: [
        'GET /api/admin/stats - Get admin statistics',
        'GET /api/admin/users - Get all users'
      ],
      subscription: [
        'GET /api/subscribe/status - Check subscription status',
        'POST /api/subscribe - Subscribe to plan',
        'POST /api/subscribe/cancel - Cancel subscription'
      ]
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  console.error('Stack:', err.stack);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File size too large',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  
  // Handle multer errors
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message
    });
  }
  
  res.status(500).json({ 
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ✅ FIXED: Create default admin user (WITHOUT mongoose hooks)
async function createDefaultAdmin() {
  try {
    console.log('🔍 Checking for admin user...');
    
    const bcrypt = require('bcryptjs');
    const db = mongoose.connection.db;
    
    // Check if admin already exists
    const adminExists = await db.collection('users').findOne({ 
      phoneNumber: '0123456789' 
    });
    
    if (adminExists) {
      console.log('✅ Admin user already exists');
      console.log('📱 Phone:', adminExists.phoneNumber);
      return;
    }
    
    console.log('👨‍💼 Creating default admin user...');
    
    // Hash password manually (avoiding pre-save hook)
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    // Direct database insertion
    await db.collection('users').insertOne({
      name: 'Admin User',
      dateOfBirth: new Date('1990-01-01'),
      phoneNumber: '0123456789',
      password: hashedPassword,
      isAdmin: true,
      isSubscribed: true,
      subscriptionExpires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      refreshToken: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0
    });
    
    console.log('✅ Default admin user created successfully!');
    console.log('📱 Phone Number: 0123456789');
    console.log('🔑 Password: admin123');
    console.log('========================================\n');
    
  } catch (error) {
    console.error('❌ Error creating default admin:', error.message);
    // Don't crash the server if admin creation fails
  }
}

// Start server
const PORT = process.env.PORT || 5000;
const SERVER_PUBLIC_URL = process.env.SERVER_PUBLIC_URL || `http://187.127.135.13:${PORT}`;

connectDB().then(() => {
  const server = http.createServer(app);
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🎬 VIDEO STREAMING BACKEND STARTED');
    console.log('========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Base URL: ${SERVER_PUBLIC_URL}`);
    console.log(`🔐 Auth API: ${SERVER_PUBLIC_URL}/api/auth`);
    console.log(`🎥 Videos API: ${SERVER_PUBLIC_URL}/api/videos`);
    console.log(`🖼️ Posters API: ${SERVER_PUBLIC_URL}/api/posters`);
    console.log(`👑 Admin API: ${SERVER_PUBLIC_URL}/api/admin`);
    console.log(`💰 Subscribe API: ${SERVER_PUBLIC_URL}/api/subscribe`);
    console.log(`🏥 Health: ${SERVER_PUBLIC_URL}/health`);
    console.log(`📁 Uploads: ${SERVER_PUBLIC_URL}/uploads`);
    console.log('========================================\n');

    setTimeout(() => {
      createDefaultAdmin();
    }, 1000);
  });
}).catch((error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});
