// routes/coordinator.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { Storage } = require('@google-cloud/storage');
const pool = require('../config/db');
const { authenticateJWT, authorizeByRole } = require('../middleware/authJwt');

const SALT_ROUNDS = 10;
const BUCKET_NAME = process.env.BUCKET1; 
const gcs = new Storage();
const bucket = gcs.bucket(BUCKET_NAME);
const canSeeCoordRoles = [
    'admin', 
    'center-program-director', 
    'center-program-coordinator'
];
// Configure Multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        if (extOk && mimeOk) {
            return cb(null, true);
        }
        return cb(new Error('Only image files (.jpeg, .jpg, .png, .gif) are allowed.'));
    }
});

// GET coordinator dashboard
router.get('/:coordinator_id/dashboard', authenticateJWT, authorizeByRole(canSeeCoordRoles), async (req, res) => {
    const coordinatorId = parseInt(req.params.coordinator_id, 10);
    try {
        const [coordRows] = await pool.query(
            `SELECT c.*, f.name AS foundation_name
             FROM center_program_coordinators c
             LEFT JOIN foundations f ON c.foundation_id = f.foundation_id
             WHERE c.coordinator_id = ?`,
            [coordinatorId]
        );

        if (!coordRows.length) {
            return res.status(404).send('Coordinator not found.');
        }
        res.render('coordinator-dashboard.html', { coordinator: coordRows[0], currentYear: new Date().getFullYear(), currentUser: req.user });
    } catch (error) {
        console.error('Error fetching coordinator dashboard data:', error);
        res.status(500).send('Internal Server Error.');
    }
});

// GET form to edit coordinator details
router.get('/:coordinator_id/edit-details', authenticateJWT, async (req, res) => {
    const coordinatorId = parseInt(req.params.coordinator_id, 10);
    try {
        const [coordRows] = await pool.query(
            `SELECT coordinator_id, name, photo_url, aadhar_number, email, phone, alt_phone, address, bank_ifsc, bank_acc_no, reimbursement, education, education_description
             FROM center_program_coordinators WHERE coordinator_id = ? LIMIT 1;`,
            [coordinatorId]
        );
        if (!coordRows.length) return res.status(404).send('Coordinator not found.');
        res.render('edit-coordinator.html', { coordinator: coordRows[0] });
    } catch (error) {
        console.error('Error fetching coordinator details for edit:', error);
        res.status(500).send('Internal Server Error.');
    }
});

// POST updated coordinator details
router.post('/:coordinator_id/edit-details',
    authenticateJWT,
    upload.single('photo'),
    [
        // Validation rules
        body('current_password').notEmpty().withMessage('Current password is required.'),
        body('name').notEmpty().withMessage('Full Name is required.'),
        body('email').isEmail().withMessage('Invalid email format.'),
        body('phone').isMobilePhone('en-IN').withMessage('Please enter a valid Indian phone number.'),
        body('alt_phone').optional({ checkFalsy: true }).isMobilePhone('en-IN').withMessage('Please enter a valid alternate phone number.'),
        body('address').notEmpty().withMessage('Address is required.'),
        body('aadhar_number').isLength({ min: 12, max: 12 }).withMessage('Aadhar Number must be 12 digits.').isNumeric().withMessage('Aadhar Number must contain only digits.'),
        body('education').notEmpty().withMessage('Education is required.'),
        body('reimbursement').isFloat({ min: 0 }).withMessage('Reimbursement must be a non-negative number.'),
        body('bank_acc_no').isNumeric().withMessage('Bank Account Number must be numeric.'),
        body('bank_ifsc').isAlphanumeric().withMessage('Invalid IFSC Code format.'),
    ],
    async (req, res) => {
        const coordinatorId = parseInt(req.params.coordinator_id, 10);
        let gcsFileName;

        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const {
                current_password, name, email, phone, alt_phone, address, aadhar_number,
                education, education_description, reimbursement, bank_acc_no, bank_ifsc
            } = req.body;

            const [coordRows] = await pool.query(
                'SELECT password_hash, photo_url FROM center_program_coordinators WHERE coordinator_id = ?',
                [coordinatorId]
            );
            if (!coordRows.length) {
                return res.status(404).send('Coordinator not found.');
            }
            const coordinator = coordRows[0];
            const passwordMatches = await bcrypt.compare(current_password, coordinator.password_hash || '');
            if (!passwordMatches) {
                return res.status(403).send('Incorrect current password.');
            }

            const fieldsToUpdate = {
                name, email, phone, alt_phone, address, aadhar_number,
                education, education_description, reimbursement, bank_acc_no, bank_ifsc
            };

            if (req.file) {
                const ext = path.extname(req.file.originalname);
                gcsFileName = `coordinators/coord-${coordinatorId}-${Date.now()}${ext}`;
                const blob = bucket.file(gcsFileName);
                const blobStream = blob.createWriteStream({ resumable: false });
                
                await new Promise((resolve, reject) => {
                    blobStream.on('error', reject);
                    blobStream.on('finish', resolve);
                    blobStream.end(req.file.buffer);
                });
                
                fieldsToUpdate.photo_url = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsFileName}`;

                if (coordinator.photo_url) {
                    try {
                        const oldFileName = coordinator.photo_url.split(`${BUCKET_NAME}/`)[1];
                        if (oldFileName) await bucket.file(oldFileName).delete();
                    } catch (delError) {
                        console.error("Non-critical: Failed to delete old photo:", delError.message);
                    }
                }
            }
            
            fieldsToUpdate.updated_at = new Date();
            
            await pool.query('UPDATE center_program_coordinators SET ? WHERE coordinator_id = ?', [fieldsToUpdate, coordinatorId]);

            return res.redirect(`/coordinator-dashboard/${coordinatorId}/dashboard?success=Details updated successfully`);

        } catch (err) {
            console.error('Error updating coordinator details:', err);
            if (gcsFileName) {
                try {
                    await bucket.file(gcsFileName).delete();
                } catch (delError) {
                    console.error("Critical: Failed to delete orphaned GCS file:", delError);
                }
            }
            return res.status(500).send('Server error while updating details.');
        }
    }
);

// GET change password form
router.get('/:coordinator_id/change-password', authenticateJWT, async (req, res) => {
    const coordinatorId = parseInt(req.params.coordinator_id, 10);
    res.render('coordinator-change-password.html', { userId: coordinatorId, userRole: 'coordinator' });
});

// POST new password
router.post('/:coordinator_id/change-password',
    authenticateJWT,
    [
        body('current_password').notEmpty().withMessage('Current password is required.'),
        body('new_password').notEmpty().withMessage('New password cannot be empty.'),
        body('confirm_new_password').custom((value, { req }) => {
            if (value !== req.body.new_password) {
                throw new Error('Password confirmation does not match new password.');
            }
            return true;
        })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const coordinatorId = parseInt(req.params.coordinator_id, 10);
        const { current_password, new_password } = req.body;

        try {
            const [rows] = await pool.query('SELECT password_hash FROM center_program_coordinators WHERE coordinator_id = ?', [coordinatorId]);
            if (!rows.length) {
                return res.status(404).json({ message: 'User not found.' });
            }

            const storedHash = rows[0].password_hash || '';
            const passwordMatch = await bcrypt.compare(current_password, storedHash);
            if (!passwordMatch) {
                return res.status(403).json({ message: 'Incorrect current password.' });
            }

            const newPasswordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

            await pool.query('UPDATE center_program_coordinators SET password_hash = ?, updated_at = NOW() WHERE coordinator_id = ?', [newPasswordHash, coordinatorId]);

            return res.status(200).json({ message: 'Password changed successfully!' });
        } catch (error) {
            console.error('Error changing coordinator password:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }
);

module.exports = router;