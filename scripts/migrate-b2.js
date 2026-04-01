const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/database');
const { uploadFile, getPublicUrl } = require('../src/services/backblaze');
const Video = require('../src/models/Video');
const Poster = require('../src/models/Poster');
const Banner = require('../src/models/Banner');
const User = require('../src/models/User');

dotenv.config();
process.env.MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const backendRoot = path.join(__dirname, '..');

const isRemoteUrl = (url) => /^https?:\/\//i.test(url || '');
const isLocalUploadUrl = (url) => typeof url === 'string' && url.startsWith('/uploads/');
const toLocalPath = (url) => path.join(backendRoot, url.replace(/^\/+/, ''));

const uploadLocalFile = async (localPath, folder) => {
  const buffer = await fs.readFile(localPath);
  const fileName = `${folder}/${path.basename(localPath)}`.replace(/\\/g, '/');
  const uploaded = await uploadFile(buffer, fileName);
  return {
    url: getPublicUrl(uploaded.fileName),
    fileId: uploaded.fileId
  };
};

const migrateVideo = async (video) => {
  let updated = false;

  if (isLocalUploadUrl(video.url)) {
    const localPath = toLocalPath(video.url);
    const upload = await uploadLocalFile(localPath, 'videos');
    video.url = upload.url;
    video.videoFileId = upload.fileId;
    updated = true;
  }

  if (isLocalUploadUrl(video.thumbnailUrl)) {
    const localPath = toLocalPath(video.thumbnailUrl);
    const upload = await uploadLocalFile(localPath, 'thumbnails');
    video.thumbnailUrl = upload.url;
    video.thumbnailFileId = upload.fileId;
    updated = true;
  }

  const qualityUrls = video.qualities instanceof Map ? Object.fromEntries(video.qualities) : (video.qualities || {});
  const qualityFileIds = video.qualityFileIds instanceof Map ? Object.fromEntries(video.qualityFileIds) : (video.qualityFileIds || {});
  let qualitiesChanged = false;

  for (const [quality, url] of Object.entries(qualityUrls)) {
    if (isLocalUploadUrl(url)) {
      const localPath = toLocalPath(url);
      const upload = await uploadLocalFile(localPath, 'videos');
      qualityUrls[quality] = upload.url;
      qualityFileIds[quality] = upload.fileId;
      qualitiesChanged = true;
    }
  }

  if (qualitiesChanged) {
    video.qualities = qualityUrls;
    video.qualityFileIds = qualityFileIds;
    updated = true;
  }

  if (updated) {
    await video.save();
  }

  return updated;
};

const migratePoster = async (poster) => {
  if (!isLocalUploadUrl(poster.thumbnailUrl)) return false;
  const localPath = toLocalPath(poster.thumbnailUrl);
  const upload = await uploadLocalFile(localPath, 'posters');
  poster.thumbnailUrl = upload.url;
  poster.thumbnailFileId = upload.fileId;
  await poster.save();
  return true;
};

const migrateBanner = async (banner) => {
  if (!isLocalUploadUrl(banner.imageUrl)) return false;
  const localPath = toLocalPath(banner.imageUrl);
  const upload = await uploadLocalFile(localPath, 'banners');
  banner.imageUrl = upload.url;
  banner.imageFileId = upload.fileId;
  await banner.save();
  return true;
};

const migrateUser = async (user) => {
  if (!isLocalUploadUrl(user.profileImage)) return false;
  const localPath = toLocalPath(user.profileImage);
  const upload = await uploadLocalFile(localPath, 'avatars');
  user.profileImage = upload.url;
  user.profileImageFileId = upload.fileId;
  await user.save();
  return true;
};

const run = async () => {
  await connectDB();

  let migrated = {
    videos: 0,
    posters: 0,
    banners: 0,
    users: 0
  };

  const videos = await Video.find({}).lean(false);
  for (const video of videos) {
    if (await migrateVideo(video)) migrated.videos += 1;
  }

  const posters = await Poster.find({}).lean(false);
  for (const poster of posters) {
    if (await migratePoster(poster)) migrated.posters += 1;
  }

  const banners = await Banner.find({}).lean(false);
  for (const banner of banners) {
    if (await migrateBanner(banner)) migrated.banners += 1;
  }

  const users = await User.find({}).lean(false);
  for (const user of users) {
    if (await migrateUser(user)) migrated.users += 1;
  }

  console.log('Migration complete:', migrated);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error('Migration failed:', error);
  await mongoose.connection.close();
  process.exit(1);
});
