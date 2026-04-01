const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs').promises;
const path = require('path');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Get video duration in seconds
 * @param {string} filePath - Path to video file
 * @returns {Promise<number>} - Duration in seconds
 */
exports.getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error getting video metadata:', err);
        reject(new Error('Failed to get video duration'));
        return;
      }
      
      const duration = metadata.format.duration;
      resolve(Math.round(duration)); // Round to nearest second
    });
  });
};

/**
 * Generate thumbnail from video
 * @param {string} videoPath - Path to video file
 * @param {string} outputDir - Directory to save thumbnail
 * @param {number} timestamp - Time in seconds for thumbnail (default: 1)
 * @returns {Promise<string>} - Path to generated thumbnail
 */
exports.generateThumbnail = async (videoPath, outputDir, timestamp = 1) => {
  return new Promise((resolve, reject) => {
    const thumbnailName = `thumbnail_${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, thumbnailName);
    
    // Create output directory if it doesn't exist
    fs.mkdir(outputDir, { recursive: true }).catch(() => {});
    
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: thumbnailName,
        folder: outputDir,
        size: '640x360' // 16:9 aspect ratio
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(new Error('Failed to generate thumbnail'));
      });
  });
};

/**
 * Process video: get duration and generate thumbnail
 * @param {Object} videoFile - Video file object
 * @returns {Promise<Object>} - Contains duration and thumbnail path
 */
exports.processVideo = async (videoFile) => {
  try {
    // Get video duration
    const duration = await exports.getVideoDuration(videoFile.path);
    
    // Generate thumbnail
    const thumbnailDir = path.join(path.dirname(videoFile.path), '..', 'thumbnails');
    const thumbnailPath = await exports.generateThumbnail(
      videoFile.path, 
      thumbnailDir, 
      Math.min(1, duration) // Use 1 second or less if video is shorter
    );
    
    return {
      duration: Math.max(1, duration), // Ensure at least 1 second
      thumbnailPath
    };
  } catch (error) {
    console.error('Video processing error:', error);
    throw error;
  }
};

/**
 * Transcode video to different qualities
 * @param {string} videoPath - Path to source video file
 * @param {string} outputDir - Directory to save transcoded videos
 * @returns {Promise<Object>} - Map of quality names to relative URLs
 */
exports.transcodeVideo = async (videoPath, outputDir) => {
  const qualities = [
    { name: '1080p', size: '1920x1080', bitrate: '5000k' },
    { name: '720p', size: '1280x720', bitrate: '2500k' },
    { name: '480p', size: '854x480', bitrate: '1000k' },
    { name: '360p', size: '640x360', bitrate: '500k' }
  ];

  const results = {};
  const baseName = path.basename(videoPath, path.extname(videoPath));

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const transcodePromises = qualities.map((quality) => {
    return new Promise((resolve, reject) => {
      const outputFileName = `${baseName}_${quality.name}.mp4`;
      const outputPath = path.join(outputDir, outputFileName);
      const relativePath = `/uploads/videos/${outputFileName}`;

      ffmpeg(videoPath)
        .size(quality.size)
        .videoBitrate(quality.bitrate)
        .format('mp4')
        .on('start', (commandLine) => {
          console.log(`Spawned Ffmpeg with command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          console.log(`Processing ${quality.name}: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log(`Transcoding finished for ${quality.name}`);
          results[quality.name] = relativePath;
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error transcoding to ${quality.name}:`, err);
          // Don't reject the whole process if one quality fails, but log it
          resolve(); 
        })
        .save(outputPath);
    });
  });

  await Promise.all(transcodePromises);
  return results;
};