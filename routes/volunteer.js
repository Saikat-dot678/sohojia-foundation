// backend/routes/volunteers.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const dbPromise = require('../config/mongo');
const adminConfig = require('../config/admin');
const { authenticateJWT, authorizeAdmin,authorizeByRole } = require('../middleware/authJwt');
const allowRoles = [ 'admin', 
    'center-program-director', 
    'center-program-coordinator'];
// GET /volunteers/:id/dashboard
router.get('/:id',authenticateJWT, authorizeByRole(allowRoles), async (req, res, next) => {
  try {
    const volunteerId = req.params.id;

    // 1) Fetch volunteer + foundation
    const [volRows] = await pool.query(
      `SELECT v.*, f.name AS foundation_name
       FROM volunteers v
       JOIN foundations f ON v.foundation_id = f.foundation_id
       WHERE v.volunteer_id = ?`,
      [volunteerId]
    );
    if (!volRows.length) return res.status(404).send('Volunteer not found');
    const volunteer = volRows[0];

    // 2) Fetch assigned students
    const [stuRows] = await pool.query(
        `SELECT s.student_id AS id, s.name, f.name AS foundation_name
        FROM students s
        JOIN volunteer_student_map vsm ON s.student_id = vsm.student_id
        JOIN foundations f ON s.foundation_id = f.foundation_id
        WHERE vsm.volunteer_id = ?`,
        [volunteerId]
    );


    volunteer.students = stuRows;

    // 3) Render the template
    res.render('Volunteers-dashboard', { volunteer,  userRole: req.user.role, currentYear: new Date().getFullYear()  });
  } catch (err) {
    next(err);
  }
});

// This route must be protected so only admins can access it
router.post('/:id/status', authenticateJWT, authorizeAdmin, async (req, res) => {
    const { new_status, admin_password } = req.body;
    const volunteerId = parseInt(req.params.id, 10);

    if (!new_status || !admin_password || !volunteerId) {
        return res.status(400).send('Missing required fields.');
    }

    if (new_status !== 'active' && new_status !== 'inactive') {
        return res.status(400).send('Invalid status value.');
    }

    // 1. Verify Admin Password
    if (admin_password !== adminConfig.password) {
        return res.status(401).send('Incorrect admin password.');
    }

    const mysqlConnection = await pool.getConnection();
    const mongoDb = await dbPromise;

    try {
        await mysqlConnection.beginTransaction();

        // 2. Update the status in MySQL
        await mysqlConnection.query(
            'UPDATE volunteers SET status = ? WHERE volunteer_id = ?',
            [new_status, volunteerId]
        );

        // 3. If making inactive, delete all related data
        if (new_status === 'inactive') {
            // Delete schedules from MySQL
            await mysqlConnection.query(
                'DELETE FROM volunteer_schedule WHERE volunteer_id = ?',
                [volunteerId]
            );

            // Delete fingerprint data from MongoDB
            await mongoDb.collection('Fingerprint').deleteOne({ volunteerId: volunteerId });

            // Set biometric registration flags to 0 in MySQL
            await mysqlConnection.query(
                'UPDATE volunteers SET face_registered = 0, fingerprint_registered = 0 WHERE volunteer_id = ?',
                [volunteerId]
            );

            // Delete all student assignments from MySQL
            await mysqlConnection.query( 
                'DELETE FROM volunteer_student_map WHERE volunteer_id = ?',
                [volunteerId]
            );
            // Delete face data files from the local filesystem
            const facesDir = path.join(__dirname, '..', 'uploads', 'faces');
            const files = await fs.readdir(facesDir);
            const volunteerFaceFiles = files.filter(file => file.startsWith(`${volunteerId}_`));
            
            for (const file of volunteerFaceFiles) {
                await fs.unlink(path.join(facesDir, file));
            }
        }

        // If all operations succeed, commit the transaction
        await mysqlConnection.commit();
        res.status(200).send(`Volunteer status successfully updated to ${new_status}.`);

    } catch (error) {
        // If any error occurs, roll back the transaction
        await mysqlConnection.rollback();
        console.error('Failed to update volunteer status:', error);
        res.status(500).send('An internal server error occurred.');
    } finally {
        // Always release the connection
        mysqlConnection.release();
    }
});
module.exports = router;