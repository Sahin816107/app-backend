const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

// We need a dummy req and res
const req = {
  body: {
    title: 'Test Banner',
    description: 'Test Description',
    videoId: new mongoose.Types.ObjectId().toString(),
    order: '1',
    isActive: 'true',
    startDate: new Date().toISOString(),
    targetAudience: 'all'
  },
  file: {
    originalname: 'test.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake image content'),
    size: 100
  }
};

const res = {
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  json: function(data) {
    console.log('RESPONSE:', this.statusCode, data);
  }
};

async function runTest() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/md_entertainment');
    console.log('Connected to DB');
    
    // Create dummy video to avoid 404
    const Video = require('./src/models/Video');
    const dummyVideo = new Video({
      _id: req.body.videoId,
      title: 'Dummy Video',
      description: 'Dummy',
      url: 'http://dummy',
      thumbnailUrl: 'http://dummy',
      duration: 120,
      category: 'Action',
      uploadedBy: new mongoose.Types.ObjectId()
    });
    await dummyVideo.save();
    console.log('Dummy video saved');

    const bannerController = require('./src/controllers/BannerController');
    
    // Mock uploadBannerImage
    const originalUpload = bannerController.__get__ ? bannerController.__get__('uploadBannerImage') : null;
    // We can't easily mock an unexported function without proxyquire. Let's just mock the backblaze service!
    const backblaze = require('./src/services/backblaze');
    backblaze.uploadFile = async () => ({ fileName: 'test.jpg', fileId: '123' });
    backblaze.getPublicUrl = () => 'http://dummy.jpg';

    await bannerController.createBanner(req, res);
    
    // cleanup
    await dummyVideo.deleteOne();
    await mongoose.disconnect();
  } catch (err) {
    console.error('TEST ERROR:', err);
  }
}

runTest();