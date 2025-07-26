const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const path    = require('path');
const { Storage } = require('@google-cloud/storage'); // Import GCS client
const { authorizeVolunteer } = require('../middleware/authJwt');

// --- Google Cloud Storage & Multer Configuration ---

// !! IMPORTANT: Make sure this is your actual GCS bucket name !!
const BUCKET_NAME = process.env.BUCKET1; 

// Instantiate a GCS client
const gcs = new Storage();
const bucket = gcs.bucket(BUCKET_NAME);

// Configure Multer to use memory storage to handle the file as a buffer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        if (extOk && mimeOk) {
            return cb(null, true);
        }
        return cb(new Error('Only .png, .jpg and .jpeg formats are allowed'));
    }
});

// --- Routes ---

// GET /edit-volunteer/:id -> Renders the edit form (Unchanged from your code)
router.get('/:id', authorizeVolunteer, async (req, res) => {
    const volunteerId = parseInt(req.params.id, 10);
    if (isNaN(volunteerId)) {
        return res.status(400).send('Invalid volunteer ID.');
    }
    try {
        const sqlPool = req.app.locals.sqlPool;
        const [rows] = await sqlPool.query(
            `SELECT volunteer_id, name, photo_url, aadhar_number, email, phone, alt_phone, address,
                    bank_ifsc, bank_acc_no, salary, education, education_description,
                    status, foundation_id, face_registered, fingerprint_registered
             FROM volunteers WHERE volunteer_id = ? LIMIT 1;`,
            [volunteerId]
        );
        if (!rows.length) {
            return res.status(404).send('Volunteer not found.');
        }
        return res.render('Volunteer-edit.html', { volunteer: rows[0] });
    }
    catch (err) {
        console.error('Error fetching volunteer for edit:', err);
        return res.status(500).send('Server error.');
    }
});


// POST /edit-volunteer/:id -> Processes form submission with GCS upload
router.post('/:id', authorizeVolunteer, upload.single('photo'), async (req, res, next) => {
    const volunteerId = parseInt(req.params.id, 10);
    let gcsFileName; // To hold the name of a newly uploaded file for potential cleanup

    try {
        if (isNaN(volunteerId)) {
            return res.status(400).send('Invalid volunteer ID.');
        }

        const {
            current_password, name, email, phone, alt_phone, address,
            education, education_description, salary, bank_acc_no, bank_ifsc
        } = req.body;

        if (!current_password) {
            return res.status(400).send('Current password is required to make changes.');
        }

        const sqlPool = req.app.locals.sqlPool;

        // 1. Fetch current user data and verify password
        const [volRows] = await sqlPool.query(
            'SELECT password_hash, photo_url FROM volunteers WHERE volunteer_id = ? LIMIT 1',
            [volunteerId]
        );
        if (!volRows.length) {
            return res.status(404).send('Volunteer not found.');
        }
        const volunteer = volRows[0];
        const passwordMatches = await bcrypt.compare(current_password, volunteer.password_hash || '');
        if (!passwordMatches) {
            return res.status(403).send('Incorrect current password.');
        }

        // 2. Build dynamic SQL update
        const fields = [];
        const params = [];
        
        function maybeAdd(fieldName, value) {
            if (value !== undefined && value !== null && value.trim() !== '') {
                fields.push(`${fieldName} = ?`);
                params.push(value.trim());
            }
        }

        maybeAdd('name', name);
        maybeAdd('email', email);
        maybeAdd('phone', phone);
        maybeAdd('alt_phone', alt_phone);
        maybeAdd('address', address);
        maybeAdd('education', education);
        maybeAdd('education_description', education_description);
        maybeAdd('bank_acc_no', bank_acc_no);
        maybeAdd('bank_ifsc', bank_ifsc);

        if (salary !== undefined && salary !== null && salary !== '') {
            const salNum = parseFloat(salary);
            if (!isNaN(salNum)) {
                fields.push('salary = ?');
                params.push(salNum);
            }
        }

        // 3. Handle optional photo upload
        if (req.file) {
            // A. Upload the new file to Google Cloud Storage
            const ext = path.extname(req.file.originalname);
            gcsFileName = `volunteers/vol-${volunteerId}-${Date.now()}${ext}`; // Store for cleanup on error
            const blob = bucket.file(gcsFileName);
            const blobStream = blob.createWriteStream({ resumable: false });
            
            await new Promise((resolve, reject) => {
                blobStream.on('error', reject);
                blobStream.on('finish', resolve);
                blobStream.end(req.file.buffer);
            });
            
            const newPhotoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;
            fields.push('photo_url = ?');
            params.push(newPhotoUrl);

            // B. Delete the old photo from GCS if it exists
            if (volunteer.photo_url) {
                try {
                    const oldFileName = volunteer.photo_url.split(`${BUCKET_NAME}/`)[1];
                    if (oldFileName) {
                        await bucket.file(oldFileName).delete();
                    }
                } catch (delError) {
                    console.error("Non-critical: Failed to delete old profile picture:", delError.message);
                }
            }
        }

        // 4. Execute the update if there are fields to update
        if (fields.length > 0) {
            fields.push('updated_at = NOW()');
            const updateSql = `UPDATE volunteers SET ${fields.join(', ')} WHERE volunteer_id = ?`;
            params.push(volunteerId);
            await sqlPool.query(updateSql, params);
        }

        // 5. Redirect back to the dashboard
        return res.redirect(`/volunteer-dashboard/${volunteerId}/dashboard`);

    } catch (err) {
        console.error('Error in POST /edit-volunteer:', err);
        // If an error occurs after a new file was uploaded, delete it from GCS
        if (gcsFileName) {
            try {
                await bucket.file(gcsFileName).delete();
            } catch (delError) {
                console.error("Critical: Failed to delete orphaned GCS file during error cleanup:", delError);
            }
        }
        return res.status(500).send('Server error.');
    }
});


// Change Password routes (Unchanged from your code)
router.get('/:id/change-password', authorizeVolunteer, async (req, res) => {
    // This logic is fine, no changes needed
    const volunteerId = parseInt(req.params.id, 10);
    if (isNaN(volunteerId)) return res.status(400).send('Invalid volunteer ID.');
    try {
        const sqlPool = req.app.locals.sqlPool;
        const [rows] = await sqlPool.query('SELECT volunteer_id FROM volunteers WHERE volunteer_id = ? LIMIT 1', [volunteerId]);
        if (!rows.length) return res.status(404).send('Volunteer not found.');
        return res.render('Volunteer-change-password.html', { volunteer: rows[0] });
    } catch (err) {
        console.error('Error fetching volunteer for change-password:', err);
        return res.status(500).send('Server error.');
    }
});

router.post('/:id/change-password', authorizeVolunteer, async (req, res) => {
    // This logic is fine, no changes needed
    const volunteerId = parseInt(req.params.id, 10);
    if (isNaN(volunteerId)) return res.status(400).send('Invalid volunteer ID.');
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).send('Current and new passwords are required.');
    try {
        const sqlPool = req.app.locals.sqlPool;
        const [pwdRows] = await sqlPool.query('SELECT password_hash FROM volunteers WHERE volunteer_id = ? LIMIT 1', [volunteerId]);
        if (!pwdRows.length) return res.status(404).send('Volunteer not found.');
        const storedHash = pwdRows[0].password_hash || '';
        const passwordMatches = await bcrypt.compare(current_password, storedHash);
        if (!passwordMatches) return res.status(403).send('Incorrect current password.');
        const newHash = await bcrypt.hash(new_password, 12);
        await sqlPool.query('UPDATE volunteers SET password_hash = ?, updated_at = NOW() WHERE volunteer_id = ?', [newHash, volunteerId]);
        return res.redirect(`/volunteer-dashboard/${volunteerId}/dashboard`);
    } catch (err) {
        console.error('Error in POST /change-password:', err);
        return res.status(500).send('Server error.');
    }
});

module.exports = router;
