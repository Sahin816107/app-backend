const multer = require("multer");

const memoryStorage = multer.memoryStorage();

// ===============================
// FILE FILTERS
// ===============================
const videoFileFilter = (req, file, cb) => {
  const allowed = [
    "video/mp4",
    "video/x-matroska", // MKV
    "video/x-msvideo",  // AVI
    "video/quicktime",  // MOV
    "video/x-ms-wmv",
    "video/webm",
    "video/x-flv",
    "video/3gpp",
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        "Invalid video format"
      )
    );
  }
};

const imageFileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        "Invalid image format"
      )
    );
  }
};

// ===============================
// MULTER INSTANCES
// ===============================
const uploadVideo = multer({
  storage: memoryStorage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // ✅ 5GB
  },
});

const uploadThumbnail = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // ✅ 10MB
  },
});

const uploadAvatar = multer({
  storage: memoryStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // ✅ 5MB
  },
});

module.exports = {
  uploadVideo,
  uploadThumbnail,
  uploadAvatar,
};
