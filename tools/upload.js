const multer = require("multer");
const path = require("path");

// UTWARDZONA KONFIGURACJA MULTERA (MEMORY STORAGE)
const ALLOWED_MAGIC_BYTES = {
  jpg: ["ffd8ffe0", "ffd8ffe1", "ffd8ffe2", "ffd8ffe3", "ffd8ffe8"],
  jpeg: ["ffd8ffe0", "ffd8ffe1", "ffd8ffe2", "ffd8ffe3", "ffd8ffe8"],
  png: ["89504e47"],
  gif: ["47494638"],
  webp: ["52494646"],
};
// JEDNA, SKONSOLIDOWANA FUNKCJA WALIDACJI SYGNATUR
function verifyBufferSignature(buffer, originalName) {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) return false;
    const hexSignature = buffer.toString("hex", 0, 4).toLowerCase();
    const ext = path.extname(originalName).replace(".", "").toLowerCase();
    const validSignatures = ALLOWED_MAGIC_BYTES[ext];
    return validSignatures
      ? validSignatures.some((sig) => hexSignature.startsWith(sig))
      : false;
  } catch (err) {
    console.error("Błąd podczas weryfikacji sygnatury bufora:", err);
    return false;
  }
}
const safeFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  if (
    allowedMimeTypes.includes(file.mimetype) &&
    allowedExtensions.includes(fileExtension)
  ) {
    cb(null, true);
  } else {
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: safeFileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

module.exports = {
  verifyBufferSignature,
  upload,
};
