'use strict';
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

function makeStorage(sub) {
  const dir = path.join(UPLOAD_ROOT, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').slice(0, 40);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${base}${ext}`);
    }
  });
}

const imageFilter = (req, file, cb) => {
  const ok = /image\/(png|jpe?g|gif|webp|svg\+xml)/.test(file.mimetype);
  cb(ok ? null : new Error('Formato de imagem não suportado'), ok);
};

module.exports = {
  UPLOAD_ROOT,
  uploadImage: (sub) => multer({ storage: makeStorage(sub), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: imageFilter }),
  uploadAny: (sub) => multer({ storage: makeStorage(sub), limits: { fileSize: 20 * 1024 * 1024 } })
};
