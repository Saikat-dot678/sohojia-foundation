// routes/event-manager-dashboard.js

/**
 * Event Manager Dashboard Routes:
 * 1) GET  /:manager_id/dashboard       → render the manager's dashboard
 * 2) GET  /:manager_id/edit-details    → render the “Edit Details” form
 * 3) POST /:manager_id/edit-details    → verify password, update allowed fields, handle photo
 * 4) GET  /:manager_id/change-password → render the “Change Password” form
 * 5) POST /:manager_id/change-password → verify current password, update to new password
 *
 * Uses:
 * - MySQL pool (assumed to be `pool` from '../config/db')
 * - Multer for optional photo upload
 * - Bcrypt for password hashing and verification
 * - Express-validator for input validation (for POST routes)
 * - Custom authentication/authorization middleware (`authJwt`)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { Storage } = require('@google-cloud/storage'); // Import GCS client

const pool = require('../config/db'); // Your MySQL connection pool
const { authenticateJWT, authorizeEventManagerOrAdmin, authorizeEventManager,authorizeByRole } = require('../middleware/authJwt');
const allowRoles = ['admin', 
    'center-program-director', 
    'center-program-coordinator',
    'event-manager'];
const SALT_ROUNDS = 10;

// --- Google Cloud Storage & Multer Configuration ---

// !! IMPORTANT: Make sure this is your actual GCS bucket name !!
const BUCKET_NAME = process.env.BUCKET1; 

// Instantiate a GCS client
const gcs = new Storage();
const bucket = gcs.bucket(BUCKET_NAME);

// Configure Multer to use memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif/;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = allowed.test(file.mimetype);
        if (extOk && mimeOk) {
            return cb(null, true);
        }
        return cb(new Error('Only .png, .jpg, .jpeg, and .gif formats are allowed for photos.'));
    }
});


// ──────────────────────────────────────────────────────────────────────────────
// 1) GET /:manager_id/dashboard
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:manager_id/dashboard', authenticateJWT, authorizeByRole(allowRoles), async (req, res) => {
    const managerId = parseInt(req.params.manager_id, 10);
    const authenticatedUserId = req.user.id;


    try {
        const [managerRows] = await pool.query(
            `SELECT em.*, f.name AS foundation_name
             FROM event_managers em
             LEFT JOIN foundations f ON em.foundation_id = f.foundation_id
             WHERE em.manager_id = ?`,
            [managerId]
        );

        if (!managerRows.length) {
            return res.status(404).send('Event Manager not found.');
        }

        const manager = managerRows[0];
        res.render('event-manager.html', { manager, currentYear: new Date().getFullYear(), currentUser: req.user });
    } catch (error) {
        console.error('Error fetching event manager dashboard data:', error);
        res.status(500).send('Internal Server Error.');
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// 2) GET /:manager_id/edit-details
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:manager_id/edit-details', authenticateJWT, authorizeEventManagerOrAdmin, async (req, res) => {
    const managerId = parseInt(req.params.manager_id, 10);
    const authenticatedUserId = req.user.id;

    if (managerId !== parseInt(authenticatedUserId, 10) && req.user.role !== 'admin') {
        return res.status(403).send('Access denied. You can only edit your own details.');
    }

    try {
        const [managerRows] = await pool.query(
            `SELECT
                manager_id, name, photo_url, aadhar_number,
                email, phone, alt_phone, address,
                bank_ifsc, bank_acc_no, reimbursement,
                education, education_description
             FROM event_managers
             WHERE manager_id = ?
             LIMIT 1;`,
            [managerId]
        );

        if (!managerRows.length) {
            return res.status(404).send('Event Manager not found.');
        }

        const manager = managerRows[0];
        res.render('edit-event-manager.html', { manager });
    } catch (error) {
        console.error('Error fetching event manager details for edit:', error);
        res.status(500).send('Internal Server Error.');
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// 3) POST /:manager_id/edit-details
// ──────────────────────────────────────────────────────────────────────────────

// POST /:manager_id/edit-details (UPDATED with GCS)
router.post('/:manager_id/edit-details',
    authenticateJWT,
    authorizeEventManagerOrAdmin,
    upload.single('photo'), // Multer middleware
    [
        // Validation rules (unchanged)
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
        body('bank_ifsc').matches(/^[A-Za-z]{4}[0-9]{7}$/).withMessage('Invalid IFSC Code format.'),
    ],
    async (req, res) => {
        const managerId = parseInt(req.params.manager_id, 10);
        let gcsFileName; // To hold the name of a new file for potential cleanup on error

        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const {
                current_password, name, email, phone, alt_phone, address, aadhar_number,
                education, education_description, reimbursement, bank_acc_no, bank_ifsc
            } = req.body;

            // 1. Fetch current user data and verify password
            const [managerRows] = await pool.query(
                'SELECT password_hash, photo_url FROM event_managers WHERE manager_id = ?',
                [managerId]
            );
            if (!managerRows.length) {
                return res.status(404).send('Event Manager not found.');
            }
            const manager = managerRows[0];
            const passwordMatches = await bcrypt.compare(current_password, manager.password_hash || '');
            if (!passwordMatches) {
                return res.status(403).send('Incorrect current password.');
            }

            // 2. Build dynamic SQL update fields
            const fields = [];
            const params = [];
            
            function maybeAdd(fieldName, value) {
                if (value !== undefined && value !== null && String(value).trim() !== '') {
                    fields.push(`${fieldName} = ?`);
                    params.push(String(value).trim());
                }
            }
            
            maybeAdd('name', name);
            maybeAdd('email', email);
            maybeAdd('phone', phone);
            maybeAdd('alt_phone', alt_phone);
            maybeAdd('address', address);
            maybeAdd('aadhar_number', aadhar_number);
            maybeAdd('education', education);
            maybeAdd('education_description', education_description);
            maybeAdd('bank_acc_no', bank_acc_no);
            maybeAdd('bank_ifsc', bank_ifsc);

            const reimbNum = parseFloat(reimbursement);
            if (!isNaN(reimbNum)) {
                fields.push('reimbursement = ?');
                params.push(reimbNum);
            }
            
            // 3. Handle optional photo upload to GCS
            if (req.file) {
                const ext = path.extname(req.file.originalname);
                gcsFileName = `event_managers/em-${managerId}-${Date.now()}${ext}`;
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

                // Delete old photo from GCS if it exists
                if (manager.photo_url) {
                    try {
                        const oldFileName = manager.photo_url.split(`${BUCKET_NAME}/`)[1];
                        if (oldFileName) await bucket.file(oldFileName).delete();
                    } catch (delError) {
                        console.error("Non-critical: Failed to delete old photo:", delError.message);
                    }
                }
            }

            // 4. Execute the update if there are fields to update
            if (fields.length > 0) {
                fields.push('updated_at = NOW()');
                const updateSql = `UPDATE event_managers SET ${fields.join(', ')} WHERE manager_id = ?`;
                params.push(managerId);
                await pool.query(updateSql, params);
            }

            // 5. Redirect back to the dashboard
            return res.redirect(`/event-manager-dashboard/${managerId}/dashboard`);

        } catch (err) {
            console.error('Error in POST /edit-details:', err);
            // If an error occurs after a new file was uploaded, delete it from GCS
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

// ──────────────────────────────────────────────────────────────────────────────
// 4) GET /:manager_id/change-password
// ──────────────────────────────────────────────────────────────────────────────
router.get('/:manager_id/change-password', authenticateJWT, authorizeEventManager, async (req, res) => {
    const managerId = parseInt(req.params.manager_id, 10);
    const authenticatedUserId = req.user.id;

    if (managerId !== parseInt(authenticatedUserId, 10) && req.user.role !== 'admin') {
        return res.status(403).send('Access denied. You can only change your own password.');
    }

    try {
        const [rows] = await pool.query(
            `SELECT manager_id FROM event_managers WHERE manager_id = ? LIMIT 1`,
            [managerId]
        );
        if (!rows.length) {
            return res.status(404).send('Event Manager not found.');
        }

        res.render('eventmanager-change-password.html', {
            userId: rows[0].manager_id,
            userRole: 'event-manager'
        });
    } catch (error) {
        console.error('Error rendering change password page:', error);
        res.status(500).send('Internal Server Error.');
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// 5) POST /:manager_id/change-password
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:manager_id/change-password', authenticateJWT, authorizeEventManagerOrAdmin,
    
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
        const managerIdFromUrl = parseInt(req.params.manager_id, 10);
        const authenticatedUserId = req.user.id;
        const authenticatedUserRole = req.user.role;

        if (managerIdFromUrl !== parseInt(authenticatedUserId, 10) && authenticatedUserRole !== 'admin') {
            return res.status(403).send('Access denied. Mismatch in user ID or insufficient privileges.');
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { current_password, new_password } = req.body;

        try {
            // 5.1) Fetch stored hash
            const [rows] = await pool.query(
                `SELECT password_hash FROM event_managers WHERE manager_id = ?`,
                [authenticatedUserId]
            );

            if (!rows.length) {
                return res.status(404).send('User not found.');
            }

            const storedHash = rows[0].password_hash || '';
            const passwordMatch = await bcrypt.compare(current_password, storedHash);
            if (!passwordMatch) {
                // Updated message for incorrect password
                return res.status(403).send('Incorrect current password.');
            }

            // 5.2) Hash the new password
            const newPasswordHash = await bcrypt.hash(new_password, SALT_ROUNDS);

            // 5.3) Update the password hash in the database
            const [updateResult] = await pool.query(
                `UPDATE event_managers SET password_hash = ?, updated_at = NOW() WHERE manager_id = ?`,
                [newPasswordHash, authenticatedUserId]
            );

            if (updateResult.affectedRows > 0) {
                return res.status(200).json({ message: 'Password changed successfully!' });
            } else {
                return res.status(500).send('Failed to update password. No changes made.');
            }

        } catch (error) {
            console.error('Error changing event manager password:', error);
            res.status(500).send('Internal Server Error: Failed to change password.');
        }
    });

module.exports = router;