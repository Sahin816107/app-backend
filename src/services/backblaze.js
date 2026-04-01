const dotenv = require('dotenv');
const fs = require('fs');
const crypto = require('crypto');
dotenv.config();

let B2;
try {
  B2 = require('backblaze-b2');
} catch (err) {
  console.error("❌ Failed to load backblaze-b2:", err.message);
  throw err;
}

const b2 = new B2({
  applicationKeyId: process.env.B2_APPLICATION_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

let bucketId = process.env.B2_BUCKET_ID;
let bucketName = process.env.B2_BUCKET_NAME;
let isAuthorized = false;

async function ensureAuthorized() {
  if (isAuthorized) return;
  await b2.authorize();
  isAuthorized = true;
  console.log("✅ Backblaze authorized");
}

async function ensureBucketId() {
  if (bucketId) return bucketId;

  await ensureAuthorized();

  const res = await b2.listBuckets();
  const bucket = res.data.buckets.find(b => b.bucketName === bucketName);

  if (!bucket) {
    throw new Error(`Bucket not found: ${bucketName}`);
  }

  bucketId = bucket.bucketId;
  return bucketId;
}

async function uploadFile(fileBuffer, fileName, contentType, maxRetries = 3) {
  await ensureAuthorized();
  const id = await ensureBucketId();

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 [B2 Upload] Attempt ${attempt}/${maxRetries} for ${fileName} (${fileBuffer.length} bytes)`);
      
      const uploadUrl = await b2.getUploadUrl({ bucketId: id });

      const res = await b2.uploadFile({
        uploadUrl: uploadUrl.data.uploadUrl,
        uploadAuthToken: uploadUrl.data.authorizationToken,
        fileName,
        data: fileBuffer,
        mime: contentType,
        info: {
          'upload-attempt': attempt.toString(),
          'content-length': fileBuffer.length.toString()
        }
      });

      console.log(`✅ [B2 Upload] Success on attempt ${attempt}: ${fileName}`);
      return res.data;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ [B2 Upload] Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        console.log(`⏳ [B2 Upload] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`B2 upload failed after ${maxRetries} attempts: ${lastError.message}`);
}

async function uploadFileFromPath(filePath, fileName, contentType) {
  const buffer = await fs.promises.readFile(filePath);
  return uploadFile(buffer, fileName, contentType);
}

async function uploadLargeFileFromPath(filePath, fileName, contentType, partSize) {
  await ensureAuthorized();
  const id = await ensureBucketId();
  const startRes = await b2.startLargeFile({
    bucketId: id,
    fileName,
    contentType
  });
  const fileId = startRes.data.fileId;
  const stat = await fs.promises.stat(filePath);
  const size = stat.size;
  const uploadPartSize = partSize || Math.max(5 * 1024 * 1024, parseInt(process.env.B2_PART_SIZE_BYTES || '104857600', 10));
  const fileHandle = await fs.promises.open(filePath, 'r');
  const partSha1Array = [];
  let partNumber = 1;
  let offset = 0;

  try {
    while (offset < size) {
      const remaining = size - offset;
      const currentSize = Math.min(uploadPartSize, remaining);
      const buffer = Buffer.alloc(currentSize);
      const { bytesRead } = await fileHandle.read(buffer, 0, currentSize, offset);
      const data = bytesRead === buffer.length ? buffer : buffer.slice(0, bytesRead);
      const hash = crypto.createHash('sha1').update(data).digest('hex');
      let uploadPartUrl = await b2.getUploadPartUrl({ fileId });
      try {
        await b2.uploadPart({
          partNumber,
          uploadUrl: uploadPartUrl.data.uploadUrl,
          uploadAuthToken: uploadPartUrl.data.authorizationToken,
          data,
          hash,
          contentLength: data.length
        });
      } catch (error) {
        uploadPartUrl = await b2.getUploadPartUrl({ fileId });
        await b2.uploadPart({
          partNumber,
          uploadUrl: uploadPartUrl.data.uploadUrl,
          uploadAuthToken: uploadPartUrl.data.authorizationToken,
          data,
          hash,
          contentLength: data.length
        });
      }
      partSha1Array.push(hash);
      offset += bytesRead;
      partNumber += 1;
    }
    const finishRes = await b2.finishLargeFile({ fileId, partSha1Array });
    return finishRes.data;
  } catch (error) {
    await b2.cancelLargeFile({ fileId }).catch(() => {});
    throw error;
  } finally {
    await fileHandle.close();
  }
}

async function deleteFile(fileId) {
  if (!fileId) return;

  await ensureAuthorized();

  const info = await b2.getFileInfo({ fileId });

  await b2.deleteFileVersion({
    fileId,
    fileName: info.data.fileName,
  });
}

function getPublicUrl(fileName) {
  const base = process.env.CDN_URL 
    ? process.env.CDN_URL 
    : `https://f000.backblazeb2.com/file/${bucketName}`;

  return `${base}/${fileName}`;
}

module.exports = {
  uploadFile,
  uploadFileFromPath,
  uploadLargeFileFromPath,
  deleteFile,
  getPublicUrl,
};
