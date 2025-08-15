const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const mysql = require('../config/db');
const mongo = require('../config/mongo');
const { Storage } = require('@google-cloud/storage');

// --- Google Cloud Storage Configuration ---
const GCS_BUCKET_NAME = process.env.BUCKET2;
const storage = new Storage();
const bucket = storage.bucket(GCS_BUCKET_NAME);

// Determine the correct Python command for cross-platform compatibility
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

// Base directory for storing captured faces and temporary files
const BASE_DIR = path.join(__dirname, '../uploads/faces');
if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

// Show the 10-photo registration page
async function showRegistrationPage(req, res) {
  const prompts = [
    'Face straight', 'Look left', 'Look right', 'Look up', 'Look down',
    'Smile', 'Neutral expression', 'Eyes closed', 'Raise eyebrows', 'Turn head slightly'
  ];
  res.render('face-registration.html', {
    volunteerId: req.params.id,
    instructions: prompts
  });
}

// Handle uploading of 10 photos, embedding generation, and DB update with GCS upload
async function handleMultiRegistration(req, res) {
  const vid = req.params.id;
  const files = req.files;
  if (!files || files.length !== 10) {
    return res.status(400).json({ error: 'Exactly 10 images required.' });
  }

  // Create temp dir for this volunteer's images
  const tempDir = path.join(BASE_DIR, String(vid));
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Prepare paths for local embedding file
  const localEmbeddingFileName = `${vid}_${Date.now()}.npy`;
  const localEmbeddingPath = path.join(BASE_DIR, localEmbeddingFileName);

  const [[existing]] = await mysql.query(
    'SELECT embedding_filename FROM volunteer_embeddings WHERE volunteer_id = ?',
    [vid]
  );

  try {
    // Move uploaded files to tempDir
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imgPath = path.join(tempDir, `img${i}.jpg`);
      await fs.promises.rename(file.path, imgPath);
    }

    // Spawn Python to generate embedding
    const py = spawn(PYTHON_CMD, [
      path.join(__dirname, '../scripts/generate_embedding.py'),
      tempDir,
      localEmbeddingPath
    ]);

    py.stdout.on('data', data => console.log(`PYTHON: ${data}`));
    py.stderr.on('data', data => console.error(`PYTHON ERR: ${data}`));

    py.on('error', err => {
      console.error('Failed to start Python process:', err);
      return res.status(500).json({ error: 'Failed to start embedding script' });
    });

    py.on('close', async (code) => {
      if (code !== 0) {
        console.error('Embedding generation failed, code:', code);
        return res.status(500).json({ error: 'Embedding generation failed', code });
      }

      try {
        // Upload the new embedding to GCS
        await bucket.upload(localEmbeddingPath, {
          destination: localEmbeddingFileName,
        });

        // If an old embedding existed, delete it from GCS
        if (existing?.embedding_filename) {
          try {
            await bucket.file(existing.embedding_filename).delete();
          } catch (gcsErr) {
            // Log the error but don't fail the request if the old file doesn't exist
            console.error('Failed to delete old GCS embedding:', gcsErr.message);
          }
        }

        // Upsert embedding filename in DB
        if (existing?.embedding_filename) {
          await mysql.query(
            'UPDATE volunteer_embeddings SET embedding_filename = ?, updated_at = NOW() WHERE volunteer_id = ?',
            [localEmbeddingFileName, vid]
          );
        } else {
          await mysql.query(
            'INSERT INTO volunteer_embeddings(volunteer_id, embedding_filename) VALUES (?, ?)',
            [vid, localEmbeddingFileName]
          );
        }

        // Update face_registered flag
        await mysql.query(
          'UPDATE volunteers SET face_registered = 1, updated_at = NOW() WHERE volunteer_id = ?',
          [vid]
        );

        res.json({ success: true, message: 'Face data registered successfully.' });
      } catch (err) {
        console.error('DB update or GCS upload error:', err);
        res.status(500).json({ error: 'Database update or GCS upload failed' });
      } finally {
        // Clean up temp image and local embedding file
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (fs.existsSync(localEmbeddingPath)) {
          fs.unlinkSync(localEmbeddingPath);
        }
      }
    });
  } catch (err) {
    console.error('File handling error:', err);
    return res.status(500).json({ error: 'Unable to process uploaded files' });
  }
}

async function findActiveSession(volunteerId, time, dayName) {
  // MODIFIED: Added 15-minute grace period for check-out
  const [[session]] = await mysql.query(
    `SELECT * FROM volunteer_schedule
     WHERE volunteer_id = ?
       AND day_of_week = ?
       AND start_time <= ?
       AND ? <= ADDTIME(end_time, '00:15:00')
     LIMIT 1`,
    [volunteerId, dayName, time, time]
  );
  return session || null;
}

// Verify face on attendance with GCS download
async function verifyFace(req, res) {
  const vid = req.params.id;
  const [[record]] = await mysql.query(
    'SELECT embedding_filename FROM volunteer_embeddings WHERE volunteer_id=?', [vid]
  );
  if (!record) return res.status(404).json({ error: 'No face embedding on record' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const tmpVerificationImagePath = path.join(BASE_DIR, `verify-${Date.now()}.jpg`);
  await fs.promises.rename(req.file.path, tmpVerificationImagePath);

  const gcsEmbeddingFileName = record.embedding_filename;
  const localTmpEmbeddingPath = path.join(BASE_DIR, gcsEmbeddingFileName);
  try {
    await bucket.file(gcsEmbeddingFileName).download({ destination: localTmpEmbeddingPath });
  } catch (err) {
    console.error('Failed to download embedding from GCS:', err);
    fs.unlinkSync(tmpVerificationImagePath);
    return res.status(500).json({ error: 'Could not retrieve face embedding.' });
  }

  const py = spawn(PYTHON_CMD, [
    path.join(__dirname, '../scripts/verify_embedding.py'),
    tmpVerificationImagePath,
    localTmpEmbeddingPath
  ]);

  py.stdout.on('data', data => console.log(`PYTHON: ${data}`));
  py.stderr.on('data', data => console.error(`PYTHON ERR: ${data}`));

  py.on('error', err => {
    console.error('Failed to start Python verify process:', err);
    fs.unlink(tmpVerificationImagePath, () => {});
    fs.unlink(localTmpEmbeddingPath, () => {});
    return res.status(500).json({ error: 'Failed to start verification script' });
  });

  py.on('close', async (code) => {
    fs.unlink(tmpVerificationImagePath, () => {});
    fs.unlink(localTmpEmbeddingPath, () => {});

    if (code !== 0) {
      return res.status(401).json({ error: 'Face verification failed' });
    }

    try {
      const db = await mongo;
      const attendanceCollection = db.collection('Attendance');
      const nowUTC = new Date();
      const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const isoDate = istDate.toISOString().split('T')[0];
      const currentDay = istDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const nowISTTime = istDate.toTimeString().slice(0, 8);

      const session = await findActiveSession(Number(vid), nowISTTime, currentDay);
      if (!session) {
        return res.status(400).json({ error: 'No active session found for attendance.' });
      }

      const existingAttendance = await attendanceCollection.findOne({
        volunteer_id: Number(vid),
        session_id: session.id,
        session_date: isoDate,
        status: 'Present'
      });

      if (existingAttendance) {
        // This is a CHECK-OUT
        await attendanceCollection.updateOne(
          { _id: existingAttendance._id },
          {
            $set: {
              status: 'present', // MODIFIED: Final status is Present
              check_out_time: nowUTC
            }
          }
        );
        res.json({ success: true, message: 'Check-out successful. Attendance marked as Present.' });
      } else {
        // This is a CHECK-IN
        await attendanceCollection.insertOne({
          volunteer_id: Number(vid),
          session_id: session.id,
          session_date: isoDate,
          shift: session.shift,
          status: 'Present',
          check_in_time: nowUTC,
          check_out_time: null,
        });
        res.json({ success: true, message: 'Check-in successful. Welcome!' });
      }
    } catch (err) {
      console.error('MongoDB insert/update error:', err);
      res.status(500).json({ error: 'Failed to record attendance' });
    }
  });
}

module.exports = { showRegistrationPage, handleMultiRegistration, verifyFace };
