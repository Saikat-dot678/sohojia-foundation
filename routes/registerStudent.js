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

// Configure Multer to use memory storage to handle the file as a buffer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit for profile pictures
    },
}).single('photo'); // Expects a single file from an input field with name="photo"


// POST route to handle new student registration
// In your student registration router file

router.post('/', upload, async (req, res, next) => {
    let gcsFileName; // Variable to hold the GCS filename for potential cleanup

    try {
        const {
            student_id,
            name, roll_no, class: cls,
            address, father_name, mother_name,
            guardian_contact, guardian_email,
            hobby, password, confirm_password
        } = req.body;
        if (password !== confirm_password) {
            return res.status(400).send('Passwords do not match.');
        }
        const photoFile = req.file;
        const sid = parseInt(student_id, 10);

        // 1. Validate all required fields first
        if (
            isNaN(sid) || !name || !roll_no || !cls || !address ||
            !father_name || !mother_name || !guardian_contact ||
            !guardian_email || !hobby || !password || !photoFile
        ) {
            return res.status(400).send('All fields, including a photo, are required and must be valid.');
        }

        // 2. Check if student ID is valid
        const [rows] = await pool.query('SELECT * FROM students WHERE student_id = ?', [sid]);
        if (!rows.length) {
            return res.redirect('/?error=Unauthorized student ID');
        }

        const student = rows[0]; // Get the full student object

        // =================================================================
        // ** NEW EXPLICIT CHECK FOR ALREADY REGISTERED STUDENTS **
        // =================================================================
        if (student.password_hash) {
            // If a password hash already exists, this student has completed registration.
            return res.status(409).send('This student account has already been registered. Please proceed to the login page.');
        }
        // =================================================================

        const foundationId = student.foundation_id;
        
        // 3. Check for duplicate email
        const [emailRows] = await pool.query(
            `SELECT 1 FROM students WHERE guardian_email = ? AND student_id != ? LIMIT 1`,
            [guardian_email, sid]
        );
        if (emailRows.length) {
            return res.status(409).send('Email already registered with another student.');
        }

        // 4. Upload photo to Google Cloud Storage
        const ext = path.extname(photoFile.originalname);
        gcsFileName = `students/stu-${sid}-${Date.now()}${ext}`;
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

        // 6. Update student details in the database
        const sql = `
            UPDATE students SET
                name = ?, photo_url = ?, class = ?, roll_no = ?, address = ?,
                father_name = ?, mother_name = ?, guardian_contact = ?,
                guardian_email = ?, hobby = ?, password_hash = ?
            WHERE student_id = ?
        `;
        const params = [
            name, photoUrl, cls, roll_no, address,
            father_name, mother_name, guardian_contact,
            guardian_email, hobby, passwordHash, sid
        ];
        await pool.query(sql, params);

        // 7. Update foundation student count
        await pool.query(
            `UPDATE foundations SET student_count = student_count + 1 WHERE foundation_id = ?`,
            [foundationId]
        );

        // 8. Redirect to student dashboard
        return res.redirect('/?success=' + encodeURIComponent('Registration successful! Please log in.'));

    } catch (err) {
        if (gcsFileName) {
            console.log(`An error occurred. Deleting uploaded file: ${gcsFileName}`);
            try {
                await bucket.file(gcsFileName).delete();
            } catch (delError) {
                console.error("Critical: Failed to delete orphaned GCS file during error cleanup:", delError);
            }
        }
        next(err);
    }
});

module.exports = router;