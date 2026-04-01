const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function test() {
  try {
    const form = new FormData();
    form.append('title', 'Test Banner');
    form.append('description', 'Test Description');
    form.append('videoId', '69cbe6cd89b249f6702567ee'); // Need a valid ID if validation checks it, but let's see
    form.append('order', '1');
    form.append('isActive', 'true');
    form.append('startDate', new Date().toISOString());
    form.append('targetAudience', 'all');
    
    // Create dummy image file
    fs.writeFileSync('dummy.jpg', 'fake image content');
    form.append('image', fs.createReadStream('dummy.jpg'));
    
    // We need a token for /api/banners
    // Wait, the API requires a token, I might get 401 Unauthorized if I don't have one.
    // Let's just mock the controller directly? No, I can't easily do that without starting the app.
  } catch (err) {
    console.error(err);
  }
}
test();