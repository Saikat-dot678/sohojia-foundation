const express = require('express');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const pool = require('../config/db'); // Your MySQL connection pool
const {authenticateJWT, authorizeStudent} = require('../middleware/authJwt');
const router = express.Router();

// --- GCS Configuration ---
const BUCKET_NAME = process.env.BUCKET1; // Make sure this is your bucket name
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// --- Multer setup specifically for student profile photos ---
const uploadStudentPhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile pics
}).single('photo'); // Expects a single file from an input field named "photo"



// // GET route for the main student dashboard
// router.get('/:id', authorizeStudent, async (req, res) => {
//     try {
//         const studentId = req.params.id;
//         const [studentRows] = await pool.query('SELECT * FROM students WHERE student_id = ?', [studentId]);
//         if (studentRows.length === 0) return res.status(404).send('Student not found.');
//         const student = studentRows[0];

//         const [foundationRows] = await pool.query('SELECT name FROM foundations WHERE foundation_id = ?', [student.foundation_id]);
//         const foundation = foundationRows.length > 0 ? foundationRows[0] : { name: 'N/A' };

//         res.render('student-dashboard.html', { student, foundation });
//     } catch (err) {
//         console.error('Error fetching student dashboard:', err);
//         res.status(500).send('Server error.');
//     }
// });

// GET route for the "Edit Details" page
router.get('/:id/edit',authenticateJWT, async (req, res) => {
    try {
        const studentId = req.params.id;
        // Fetch all editable fields
        const [rows] = await pool.query('SELECT student_id, name, photo_url, class, roll_no, address, father_name, mother_name, guardian_contact, guardian_email, hobby FROM students WHERE student_id = ?', [studentId]);
        if (rows.length === 0) return res.status(404).send('Student not found.');

        res.render('edit-student.html', { student: rows[0] });
    } catch (err) {
        console.error('Error rendering edit page:', err);
        res.status(500).send('Server error.');
    }
});


// POST route to handle updating student details, now with file upload
router.post('/:id/edit',authenticateJWT, uploadStudentPhoto, async (req, res) => {
    try {
        const studentId = req.params.id;
        const { roll_no, class: studentClass, address, father_name, mother_name, guardian_contact, guardian_email, hobby, current_password } = req.body;
        const newPhotoFile = req.file;

        // 1. Verify current password
        const [rows] = await pool.query('SELECT password_hash, photo_url FROM students WHERE student_id = ?', [studentId]);
        if (rows.length === 0) return res.status(404).send('Student not found.');
        
        const student = rows[0];
        const match = await bcrypt.compare(current_password, student.password_hash);
        if (!match) return res.status(401).send('Incorrect password. Details not updated.');
        
        let newPhotoUrl = student.photo_url; // Keep old URL by default

        // 2. If a new photo is uploaded, handle it
        if (newPhotoFile) {
            // A. Upload new photo to GCS
            const ext = path.extname(newPhotoFile.originalname);
            const fileName = `students/${studentId}-${Date.now()}${ext}`;
            const blob = bucket.file(fileName);
            const blobStream = blob.createWriteStream({ resumable: false });

            await new Promise((resolve, reject) => {
                blobStream.on('error', reject);
                blobStream.on('finish', resolve);
                blobStream.end(newPhotoFile.buffer);
            });
            
            newPhotoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`;

            // B. Delete old photo from GCS, if it exists
            if (student.photo_url) {
                try {
                    const oldFileName = student.photo_url.split(`${BUCKET_NAME}/`)[1];
                    await bucket.file(oldFileName).delete();
                } catch (delError) {
                    console.error("Failed to delete old profile picture, but continuing:", delError.message);
                }
            }
        }
        
        // 3. Update the student's details in the database
        const updateQuery = `
            UPDATE students 
            SET roll_no = ?, class = ?, photo_url = ?, address = ?, father_name = ?, 
                mother_name = ?, guardian_contact = ?, guardian_email = ?, hobby = ?
            WHERE student_id = ?
        `;
        await pool.query(updateQuery, [roll_no, studentClass, newPhotoUrl, address, father_name, mother_name, guardian_contact, guardian_email, hobby, studentId]);

        // Redirect back to the dashboard
        res.redirect(`/student/${studentId}`);

    } catch (err) {
        console.error('Error updating student details:', err);
        res.status(500).send('Server error.');
    }
});


// GET and POST for password change (remains unchanged)
router.get('/:id/change-password', (req, res) => {
    res.render('change-password-student.html', { studentId: req.params.id });
});

router.post('/:id/change-password-student', async (req, res) => {
    // ... logic from previous step is correct and remains the same
    try {
        const studentId = req.params.id;
        const { old_password, new_password, confirm_password } = req.body;
        if (new_password !== confirm_password) return res.status(400).send('New passwords do not match.');
        const [rows] = await pool.query('SELECT password_hash FROM students WHERE student_id = ?', [studentId]);
        if (rows.length === 0) return res.status(404).send('Student not found.');
        const match = await bcrypt.compare(old_password, rows[0].password_hash);
        if (!match) return res.status(401).send('Incorrect old password.');
        const newPasswordHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE students SET password_hash = ? WHERE student_id = ?', [newPasswordHash, studentId]);
        res.send('Password updated successfully! You can now <a href="/">log in</a> again.');
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).send('Server error.');
    }
});


module.exports = router;