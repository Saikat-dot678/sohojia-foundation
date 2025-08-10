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

// MODIFIED: This route now expects a JSON payload with an array of records.
// We add express.json() middleware to parse the incoming JSON body.
router.post('/:manager_id', authenticateJWT, isEventManager, express.json(), async (req, res) => {
    const managerId = parseInt(req.params.manager_id, 10);

    try {
        const { attendance_date, records } = req.body;

        // Basic validation
        if (!attendance_date || !Array.isArray(records) || records.length === 0) {
            return res.status(400).send('A date and at least one attendance record are required.');
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

        // Prepare an array of log documents to be inserted
        const attendanceLogs = records.map(record => ({
            manager_id: managerId,
            foundation_id: foundationId,
            date: attendance_date,
            shift: record.shift,
            class: record.class_name,
            boys_present: record.boys_present,
            girls_present: record.girls_present,
            total_students_present: record.boys_present + record.girls_present,
            students_absent: record.total_absent,
            createdAt: new Date() // UTC timestamp
        }));

        const db = await dbPromise;
        // Use insertMany to add all records in a single database operation
        await db.collection('student_attendance').insertMany(attendanceLogs);
        
        // Respond with success. The redirect will be handled by the frontend fetch logic.
        res.status(200).json({ success: true, message: 'Student attendance logged successfully!' });

    } catch (error) {
        console.error('Failed to log student attendance:', error);
        res.status(500).send('Internal Server Error.');
    }
});

module.exports = router;