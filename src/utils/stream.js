const fs = require('fs');
const path = require('path');

const streamVideo = (req, res, filePath) => {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Parse Range header
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;

    // Validate range
    if (start >= fileSize || end >= fileSize) {
      return res.status(416).json({ error: 'Requested range not satisfiable' });
    }

    // Create read stream for the range
    const file = fs.createReadStream(filePath, { start, end });
    
    // Set headers for partial content
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4'
    });

    file.pipe(res);
  } else {
    // Send entire file
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    });

    fs.createReadStream(filePath).pipe(res);
  }
};

const getVideoDuration = (filePath) => {
  // Note: In production, you might want to use a library like fluent-ffmpeg
  // This is a simplified version
  return new Promise((resolve, reject) => {
    // For now, return a default or use metadata from request
    // You can implement actual duration extraction using ffmpeg
    resolve(0);
  });
};

module.exports = {
  streamVideo,
  getVideoDuration
};