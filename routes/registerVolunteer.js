const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const bcrypt  = require('bcrypt');
const pool    = require('../config/db');
const { Storage } = require('@google-cloud/storage'); // Import GCS client

// --- Google Cloud Storage & Multer Configuration ---

// !! IMPORTANT: Make sure this is your actual GCS bucket name !!
const BUCKET_NAME = process.env.BUCKET1; 

// Instantiate a GCS client
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// Configure Multer to use memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit for profile pictures
    },
}).single('photo'); // Expects a single file from an input field with name="photo"


// --- Volunteer Registration Route ---

router.post('/', upload, async (req, res, next) => {
    let gcsFileName; // Variable to hold the GCS filename for potential cleanup on error

    try {
        // 1. Validate that a file was uploaded
        if (!req.file) {
            return res.redirect('/register.html?error=' + encodeURIComponent('Photo upload is required.'));
        }
        
        const photoFile = req.file;

        // 2. Destructure and validate all text fields
        const {
            volunteer_id,
            name,
            email,
            phone,
            password,
            confirm_password,
            aadhar_number,
            address,
            education,
            salary,
            bank_acc_no,
            bank_ifsc
        } = req.body;
        if (password !== confirm_password) {
            return res.status(400).send('Passwords do not match.');
        }
        const volId = parseInt(volunteer_id, 10);
        const sal = parseFloat(salary);

        if (
            isNaN(volId) || !name || !email || !phone || !password ||
            !aadhar_number || !address || !education ||
            isNaN(sal) || !bank_acc_no || !bank_ifsc
        ) {
            return res.redirect('/register.html?error=' + encodeURIComponent('All fields are required and must be valid.'));
        }

        // 3. Check if volunteer exists and is not already fully registered
        const [volRows] = await pool.query('SELECT * FROM volunteers WHERE volunteer_id = ?', [volId]);

        if (!volRows.length) {
            return res.redirect('/register.html?error=' + encodeURIComponent('Unauthorized access: Volunteer ID not found.'));
        }

        const volunteerData = volRows[0];
        if (volunteerData.password_hash) { // A password_hash indicates completed registration
            return res.redirect('/register.html?error=' + encodeURIComponent('This volunteer ID has already completed registration. Please log in.'));
        }

        const foundationId = volunteerData.foundation_id;

        // 4. Upload photo to Google Cloud Storage
        const ext = path.extname(photoFile.originalname);
        gcsFileName = `volunteers/vol-${volId}-${Date.now()}${ext}`; // Store filename for cleanup
        
        const blob = bucket.file(gcsFileName);
        const blobStream = blob.createWriteStream({ resumable: false });

        await new Promise((resolve, reject) => {
            blobStream.on('error', reject);
            blobStream.on('finish', resolve);
            blobStream.end(photoFile.buffer);
        });
        
        const photoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;

        // 5. Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // 6. Update existing volunteer record in the database
        const updateSql = `
            UPDATE volunteers SET
                name = ?, photo_url = ?, password_hash = ?, aadhar_number = ?,
                email = ?, phone = ?, address = ?, education = ?,
                salary = ?, bank_acc_no = ?, bank_ifsc = ?, status = ?
            WHERE volunteer_id = ?
        `;
        const params = [
            name, photoUrl, passwordHash, aadhar_number,
            email, phone, address, education,
            sal, bank_acc_no, bank_ifsc,
            'active', // Set status to 'active'
            volId
        ];
        await pool.query(updateSql, params);

        // 7. Increment foundation's volunteer count
        await pool.query(
            `UPDATE foundations SET volunteer_count = volunteer_count + 1 WHERE foundation_id = ?`,
            [foundationId]
        );

        // 8. Redirect on success
        // NOTE: The user is NOT logged in yet. Redirecting to the login page is best practice.
        return res.redirect('/?success=' + encodeURIComponent('Registration successful! Please log in.'));

    } catch (err) {
        // If any error occurs after the file was uploaded, delete it from GCS
        if (gcsFileName) {
            console.log(`An error occurred. Deleting uploaded file from GCS: ${gcsFileName}`);
            try {
                await bucket.file(gcsFileName).delete();
            } catch (delError) {
                console.error("Critical: Failed to delete orphaned GCS file during error cleanup:", delError);
            }
        }
        // Pass the error to the main error handler
        next(err); 
    }
});

module.exports = router;