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

const SALT_ROUNDS = 12; // Define salt rounds for bcrypt hashing

// --- Event Manager Registration Route ---

router.post('/', upload, async (req, res, next) => {
    let gcsFileName; // Variable to hold the GCS filename for potential cleanup on error

    try {
        // 1. Ensure file was uploaded
        if (!req.file) {
            return res.status(400).send('Photo upload is required.');
        }

        const photoFile = req.file;

        // 2. Destructure and validate all text fields
        const {
            manager_id,
            name,
            email,
            phone,
            password,
            confirm_password,
            aadhar_number,
            address,
            education,
            reimbursement,
            bank_acc_no,
            bank_ifsc
        } = req.body;
        if (password !== confirm_password) {
            return res.status(400).send('Passwords do not match.');
        }
        const manId = parseInt(manager_id, 10);
        const reimbursementValue = parseFloat(reimbursement);

        if (
            isNaN(manId) || !name || !email || !phone || !password ||
            !aadhar_number || !address || !education ||
            isNaN(reimbursementValue) || !bank_acc_no || !bank_ifsc
        ) {
            return res.status(400).send('All fields are required and must be valid.');
        }

        // 3. Check if manager exists and is not already registered
        const [managerRows] = await pool.query('SELECT * FROM event_managers WHERE manager_id = ?', [manId]);

        if (!managerRows.length) {
            return res.redirect('/?error=Unauthorized registration attempt');
        }
        
        const managerData = managerRows[0];
        if (managerData.password_hash) {
            // Redirect to the login page with a clear warning message
            return res.status(409).send('This student account has already been registered. Please proceed to the login page.');
            return res.redirect('/?warning=' + encodeURIComponent('This Manager ID has already been registered. Please log in.'));
        }

        const foundationId = managerData.foundation_id;

        // 4. Upload photo to Google Cloud Storage
        const ext = path.extname(photoFile.originalname);
        gcsFileName = `event_managers/em-${manId}-${Date.now()}${ext}`; // Store filename for cleanup
        
        const blob = bucket.file(gcsFileName);
        const blobStream = blob.createWriteStream({ resumable: false });

        await new Promise((resolve, reject) => {
            blobStream.on('error', reject);
            blobStream.on('finish', resolve);
            blobStream.end(photoFile.buffer);
        });
        
        const photoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;

        // 5. Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // 6. Update existing event manager record
        const updateSql = `
            UPDATE event_managers SET
                name = ?, photo_url = ?, password_hash = ?, aadhar_number = ?,
                email = ?, phone = ?, address = ?, education = ?,
                reimbursement = ?, bank_acc_no = ?, bank_ifsc = ?,
                status = 'active', created_at = NOW(), updated_at = NOW()
            WHERE manager_id = ?
        `;
        const params = [
            name, photoUrl, passwordHash, aadhar_number,
            email, phone, address, education,
            reimbursementValue, bank_acc_no, bank_ifsc,
            manId
        ];
        await pool.query(updateSql, params);

        // 7. Redirect to login page on success
        return res.redirect('/?success=' + encodeURIComponent('Registration successful! Please log in.'));

    } catch (err) {
        // If an error occurs after the file was uploaded, delete it from GCS
        if (gcsFileName) {
            console.log(`An error occurred. Deleting uploaded file from GCS: ${gcsFileName}`);
            try {
                await bucket.file(gcsFileName).delete();
            } catch (delError) {
                console.error("Critical: Failed to delete orphaned GCS file during error cleanup:", delError);
            }
        }
        // Pass the error to your main Express error handler
        next(err); 
    }
});

module.exports = router;
