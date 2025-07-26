const express = require('express');
const router = express.Router();
const dbPromise = require('../config/mongo');
const pool = require('../config/db');
const { authenticateJWT } = require('../middleware/authJwt');

// Middleware to ensure user is an event manager
const isEventManager = (req, res, next) => {
    if (req.user && req.user.role === 'event-manager') {
        return next();
    }
    return res.status(403).send('Access Denied: Only Event Managers can perform this action.');
};

// GET route to display the attendance form
router.get('/:manager_id', authenticateJWT, isEventManager, (req, res) => {
    const managerId = req.params.manager_id;
    res.render('student-attendance-form.html', { managerId });
});

// POST route to submit the attendance data
router.post('/:manager_id', authenticateJWT, isEventManager, async (req, res) => {
    const managerId = parseInt(req.params.manager_id, 10);

    try {
        const {
            attendance_date,
            shift, // 'Morning', 'Afternoon', or 'Evening'
            class_name,
            boys_present,
            girls_present,
            total_absent
        } = req.body;

        // Basic validation
        if (!attendance_date || !shift || !class_name || boys_present === '' || girls_present === '' || total_absent === '') {
            return res.status(400).send('All fields are required.');
        }

        // Get the manager's foundation_id from MySQL
        const [managerRows] = await pool.query(
            'SELECT foundation_id FROM event_managers WHERE manager_id = ?',
            [managerId]
        );

        if (managerRows.length === 0) {
            return res.status(404).send('Event Manager not found.');
        }
        const foundationId = managerRows[0].foundation_id;

        // Prepare the document to be inserted into MongoDB
        const attendanceLog = {
            manager_id: managerId,
            foundation_id: foundationId,
            date: attendance_date,
            shift: shift,
            class: class_name,
            boys_present: parseInt(boys_present, 10),
            girls_present: parseInt(girls_present, 10),
            total_students_present: parseInt(boys_present, 10) + parseInt(girls_present, 10),
            students_absent: parseInt(total_absent, 10),
            createdAt: new Date() // UTC timestamp
        };

        const db = await dbPromise;
        await db.collection('student_attendance').insertOne(attendanceLog);
        
        // Redirect back to the manager's dashboard with a success message
        res.redirect(`/event-manager-dashboard/${managerId}/dashboard?success=Student attendance logged successfully!`);

    } catch (error) {
        console.error('Failed to log student attendance:', error);
        res.status(500).send('Internal Server Error.');
    }
});

module.exports = router;