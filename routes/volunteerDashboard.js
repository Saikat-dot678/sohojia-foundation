// backend/routes/volunteerDashboard.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const {
showRegistrationPage,
handleMultiRegistration,
verifyFace,
} = require('../controllers/face');
const fpCtrl = require('../controllers/fingerprint');
const router = express.Router();
const upload = multer({ dest: 'tmp/' });
const {
  authorizeVolunteer
} = require('../middleware/authJwt');
// GET /volunteer-dashboard/:id/dashboard
router.get('/:id/dashboard',authorizeVolunteer, async (req, res) => {
  const volunteerId = Number(req.params.id);
  const pool = req.app.locals.sqlPool;

  try {
    // 1) Fetch the volunteer’s own data
    const [volRows] = await pool.query(
      `SELECT *
         FROM volunteers
        WHERE volunteer_id = ?
          AND status = 'active'
        LIMIT 1`,
      [volunteerId]
    );

    if (volRows.length === 0) {
      return res.status(404).send('Volunteer not found');
    }
    const volunteer = volRows[0];

    // 2) Fetch assigned students via volunteer_student → students
    const [assignedRows] = await pool.query(
      `SELECT s.student_id, s.name
         FROM students s
         JOIN volunteer_student_map vs ON s.student_id = vs.student_id
        WHERE vs.volunteer_id = ?`,
      [volunteerId]
    );
    // assignedRows is an array of { student_id, name }

    // 3) Render the dashboard template, passing both volunteer & assignedStudents
    return res.render('volunteer-dashboard.html', {
      volunteer,
      assignedStudents: assignedRows,
      currentYear: new Date().getFullYear()
    });
  } catch (err) {
    console.error('Error fetching volunteer or assigned students:', err);
    return res.status(500).send('Server error');
  }
});

// GET /volunteer-dashboard/:id/face/register
router.get('/:id/face/register',authorizeVolunteer, showRegistrationPage);

// POST /volunteer-dashboard/:id/face/register
router.post('/:id/face/register', upload.array('faces', 10), handleMultiRegistration);

// GET /volunteer-dashboard/:id/attendance
router.get('/:id/attendance',authorizeVolunteer, (req, res) => {
const volunteerId = req.params.id;
res.render('mark-attendance.html', { volunteerId });
});

// NEW ROUTE: To get detailed status for the attendance page
router.get('/:id/attendance-status', authorizeVolunteer, async (req, res) => {
    const volunteerId = Number(req.params.id);
    const sqlPool = req.app.locals.sqlPool;
    const mongoDb = req.app.locals.mongoDb; // Ensure you pass the MongoDB connection via app.locals

    try {
      // 1. Find the current active session in MySQL
      const istDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const dayName = istDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const timeIST = istDate.toTimeString().slice(0, 8);

      // MODIFIED: Added 15-minute grace period for check-out
      const [[session]] = await sqlPool.query(
        `SELECT * FROM volunteer_schedule
         WHERE volunteer_id = ? AND LOWER(day_of_week) = ? AND start_time <= ? AND ? <= ADDTIME(end_time, '00:15:00') LIMIT 1`,
        [volunteerId, dayName, timeIST, timeIST]
      );

      if (!session) {
        return res.json({ sessionActive: false, attendanceState: 'None' });
      }

      // 2. Check attendance status in MongoDB
      const today = istDate.toISOString().split('T')[0];
      const attendanceCollection = mongoDb.collection('Attendance');
      const attendanceRecord = await attendanceCollection.findOne({
        volunteer_id: volunteerId,
        session_id: session.id,
        session_date: today,
      });

      let attendanceState = 'None'; // Default state: Can Check-In
      if (attendanceRecord) {
        // MODIFIED: Check for 'Present' as the final state
        if (attendanceRecord.status === 'present') {
          attendanceState = 'Completed'; // 'Completed' is the state for the frontend UI logic
        } else if (attendanceRecord.status === 'Present') {
          attendanceState = 'CheckedIn'; // Can Check-Out
        }
      }

      res.json({
        sessionActive: true,
        attendanceState: attendanceState,
        sessionDetails: {
          location_lat: session.latitude,
          location_long: session.longitude,
        }
      });

    } catch (err) {
      console.error('Error fetching attendance status:', err);
      res.status(500).json({ error: 'Server error fetching status' });
    }
  });


// ...
// serve the options
router.get('/:id/fingerprint/register/options', authorizeVolunteer, fpCtrl.getRegistrationOptions);
router.get('/:id/fingerprint/register',  authorizeVolunteer,        fpCtrl.showRegistrationPage);
router.post('/:id/fingerprint/register',         express.json(), fpCtrl.registerFingerprint);
router.post('/:id/fingerprint/verify',           express.json(), fpCtrl.verifyFingerprint);
router.get('/:id/fingerprint/assertion-options',authorizeVolunteer, fpCtrl.getAssertionOptions);

// POST /volunteer-dashboard/:id/face/verify
router.post('/:id/face/verify', upload.single('face'), verifyFace);

// GET /volunteer-dashboard/:id/session/current
router.get('/:id/session/current', async (req, res) => {
const sqlPool = req.app.locals.sqlPool;
const { id } = req.params;

try {
    const [rows] = await sqlPool.query(
    `
    SELECT *
    FROM volunteer_schedule
    WHERE volunteer_id = ?
        AND day_of_week = DAYNAME(CURDATE())
        AND CURRENT_TIME() BETWEEN start_time AND end_time
    LIMIT 1
    `,
    [id]
    );

    if (rows.length > 0) {
    res.json({ active: true, session: rows[0] });
    } else {
    res.json({ active: false });
    }
} catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ error: 'Server error' });
}
});


module.exports = router;
