// routes/registerCoordinator.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const bcrypt  = require('bcrypt');
const pool    = require('../config/db');
const { Storage } = require('@google-cloud/storage');

const BUCKET_NAME = process.env.BUCKET1; 
const gcs = new Storage();
const bucket = gcs.bucket(BUCKET_NAME);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
}).single('photo');

const SALT_ROUNDS = 12;

router.post('/', upload, async (req, res, next) => {
    let gcsFileName;

    try {
        if (!req.file) {
            return res.status(400).send('Photo upload is required.');
        }

        const {
            coordinator_id, name, email, phone, password, confirm_password, aadhar_number,
            address, education, reimbursement, bank_acc_no, bank_ifsc
        } = req.body;
        if (password !== confirm_password) {
            return res.status(400).send('Passwords do not match.');
        }
        const coordId = parseInt(coordinator_id, 10);
        const reimbursementValue = parseFloat(reimbursement);

        if (isNaN(coordId) || !name || !email || !phone || !password || !aadhar_number || !address || !education || isNaN(reimbursementValue) || !bank_acc_no || !bank_ifsc) {
            return res.status(400).send('All fields are required and must be valid.');
        }

        const [coordRows] = await pool.query('SELECT * FROM center_program_coordinators WHERE coordinator_id = ?', [coordId]);

        if (!coordRows.length) {
            return res.redirect('/?error=Unauthorized registration attempt');
        }
        
        const coordData = coordRows[0];
        if (coordData.password_hash) {
            return res.redirect('/?warning=' + encodeURIComponent('This Coordinator ID has already been registered. Please log in.'));
        }

        const ext = path.extname(req.file.originalname);
        gcsFileName = `coordinators/coord-${coordId}-${Date.now()}${ext}`;
        
        const blob = bucket.file(gcsFileName);
        const blobStream = blob.createWriteStream({ resumable: false });

        await new Promise((resolve, reject) => {
            blobStream.on('error', reject);
            blobStream.on('finish', resolve);
            blobStream.end(req.file.buffer);
        });
        
        const photoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const updateSql = `
            UPDATE center_program_coordinators SET
                name = ?, photo_url = ?, password_hash = ?, aadhar_number = ?,
                email = ?, phone = ?, address = ?, education = ?,
                reimbursement = ?, bank_acc_no = ?, bank_ifsc = ?,
                status = 'active', created_at = NOW(), updated_at = NOW()
            WHERE coordinator_id = ?
        `;
        const params = [
            name, photoUrl, passwordHash, aadhar_number, email, phone, 
            address, education, reimbursementValue, bank_acc_no, bank_ifsc,
            coordId
        ];
        await pool.query(updateSql, params);

        return res.redirect('/?success=' + encodeURIComponent('Registration successful! Please log in.'));

    } catch (err) {
        if (gcsFileName) {
            try {
                await bucket.file(gcsFileName).delete();
            } catch (delError) {
                console.error("Critical: Failed to delete orphaned GCS file:", delError);
            }
        }
        next(err); 
    }
});

module.exports = router;