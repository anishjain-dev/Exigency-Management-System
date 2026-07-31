/**
 * report.js
 *
 * The module's own built-in exigency-report intake — no Google Form,
 * Apps Script trigger, or tunnel required. Backs the form served at
 * /report.html. Uses the exact same validation/authorization/mail
 * pipeline as the legacy Google Form webhook (see services/submissionService.js).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { processSubmission } = require('../services/submissionService');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const ALLOWED_TYPES = /^(image\/|video\/|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)/;
const BATCH_ID_RE = /^[a-zA-Z0-9-]{1,64}$/;

function batchDir(batchId) {
  return path.join(UPLOAD_DIR, batchId);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const batchId = req.body.batchId;
      if (!BATCH_ID_RE.test(batchId || '')) return cb(new Error('Invalid batchId'));
      const dir = batchDir(batchId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.test(file.mimetype))
});

router.post('/upload', upload.array('files', 5), (req, res) => {
  const appUrl = `${req.protocol}://${req.get('host')}`;
  const batchId = req.body.batchId;
  if (!req.files || !req.files.length) return res.json({ galleryUrl: '' });
  res.json({ galleryUrl: `${appUrl}/api/report/gallery/${batchId}` });
});

router.get('/gallery/:batchId', (req, res) => {
  const { batchId } = req.params;
  if (!BATCH_ID_RE.test(batchId)) return res.status(400).send('Invalid gallery id');
  const dir = batchDir(batchId);
  if (!fs.existsSync(dir)) return res.status(404).send('Gallery not found');

  const files = fs.readdirSync(dir).sort();
  const isVideo = (f) => /\.(mp4|mov|webm|avi)$/i.test(f);
  const tiles = files.map((f, i) => {
    const url = `/uploads/${batchId}/${f}`;
    const preview = isVideo(f)
      ? `<video src="${url}" controls class="thumb"></video>`
      : `<img src="${url}" alt="Attachment ${i + 1}" class="thumb" />`;
    return `
      <a href="${url}" target="_blank" rel="noopener" class="card">
        <div class="thumb-frame">${preview}</div>
        <div class="card-label">Attachment ${i + 1}<span class="open-hint">Open full size ↗</span></div>
      </a>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>Attached Photos/Videos</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --blue: #005BAA; --red: #B8292F; --yellow: #F2C418;
    --bg: #f4f6fa; --card: #ffffff; --ink: #1a2230; --sub: #5b6472; --border: #dde3ec;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Nunito','Segoe UI',Arial,sans-serif; background:var(--bg); margin:0; color:var(--ink); }
  .page { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  .masthead { background:#fff; border-radius:12px 12px 0 0; padding:22px 26px 18px; border-bottom:1px solid var(--border); }
  .masthead-logo { height:36px; width:auto; display:block; margin-bottom:14px; }
  .masthead h1 { font-family:'Montserrat','Segoe UI',Arial,sans-serif; font-weight:800; font-size:19px; margin:0 0 4px; color:var(--blue); }
  .masthead p { margin:0; font-size:13px; color:var(--sub); }
  .proportion-bar { display:flex; height:5px; }
  .proportion-bar span.b { width:45%; background:var(--blue); }
  .proportion-bar span.r { width:45%; background:var(--red); }
  .proportion-bar span.y { width:10%; background:var(--yellow); }
  .body-card { background:var(--card); border-radius:0 0 12px 12px; padding:24px 26px 30px; box-shadow:0 1px 4px rgba(0,0,0,0.1); }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:16px; }
  .card { display:block; text-decoration:none; color:inherit; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:#fbfcfe; transition:box-shadow .15s ease, transform .15s ease; }
  .card:hover { box-shadow:0 6px 16px rgba(0,0,0,0.12); transform:translateY(-2px); }
  .thumb-frame { width:100%; aspect-ratio: 4 / 3; background:#eef4fa; overflow:hidden; }
  .thumb { width:100%; height:100%; object-fit:cover; display:block; }
  .card-label { padding:9px 12px; font-size:12.5px; font-weight:700; font-family:'Montserrat','Segoe UI',Arial,sans-serif; color:var(--ink); display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .open-hint { font-size:11px; font-weight:400; color:var(--blue); white-space:nowrap; }
  .empty { color:var(--sub); font-size:14px; }
</style>
</head><body>
  <div class="page">
    <div class="masthead">
      <img src="/images/fountainhead-logo.png" alt="Fountainhead" class="masthead-logo" />
      <h1>Attached Photos/Videos</h1>
      <p>${files.length} file${files.length === 1 ? '' : 's'} attached to this exigency report.</p>
    </div>
    <div class="proportion-bar"><span class="b"></span><span class="r"></span><span class="y"></span></div>
    <div class="body-card">
      <div class="grid">${tiles || '<p class="empty">No files.</p>'}</div>
    </div>
  </div>
</body></html>`);
});

router.post('/submit', async (req, res) => {
  const appUrl = `${req.protocol}://${req.get('host')}`;
  const result = await processSubmission(req.body || {}, appUrl);
  res.json(result);
});

module.exports = router;
