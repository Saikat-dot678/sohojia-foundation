const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // MySQL promise pool
const dbPromise = require('../config/mongo'); // MongoDB connection promise
const {authorizeManagementRoles} = require('../middleware/authJwt');
// GET /foundation/:id
router.get('/:id',authorizeManagementRoles, async (req, res, next) => {
  const foundationId = parseInt(req.params.id, 10);
  const { volunteer_id, start_date, end_date } = req.query;

  try {
    const db = await dbPromise;

    // 1. Fetch foundation details and staff from MySQL
    const [foundationRows] = await pool.query('SELECT * FROM foundations WHERE foundation_id = ?', [foundationId]);
    if (!foundationRows.length) {
      return res.status(404).send('Foundation not found');
    }
    const foundation = foundationRows[0];

    const [eventManagers] = await pool.query('SELECT manager_id, name FROM event_managers WHERE foundation_id = ?', [foundationId]);
    const [directors] = await pool.query('SELECT director_id, name FROM center_program_directors WHERE foundation_id = ?', [foundationId]);
    const [coordinators] = await pool.query('SELECT coordinator_id, name FROM center_program_coordinators WHERE foundation_id = ?', [foundationId]);
    const [foundationVolunteers] = await pool.query('SELECT volunteer_id, name FROM volunteers WHERE foundation_id = ?', [foundationId]);

    // 2. Build the MongoDB match query based on filters
    const mongoMatch = {};
    const foundationVolunteerIds = foundationVolunteers.map(v => v.volunteer_id);
    
    // Base query is for all volunteers in the foundation
    if (foundationVolunteerIds.length > 0) {
        mongoMatch.volunteer_id = { $in: foundationVolunteerIds };
    } else {
        mongoMatch.volunteer_id = { $in: [] }; // Handle case with no volunteers
    }

    // If a specific volunteer ID is provided, narrow the filter
    if (volunteer_id) {
        mongoMatch.volunteer_id = parseInt(volunteer_id, 10);
    }

    // Add date range to filter if provided
    if (start_date && end_date) {
        mongoMatch.session_date = { $gte: start_date, $lte: end_date };
    }

    // 3. Fetch logs from both MongoDB collections based on the final filter
    const presentLateLogs = await db.collection('Attendance').find(mongoMatch).toArray();
    const absentLogs = await db.collection('Absent').find(mongoMatch).toArray();

    // 4. Combine, sort, and format all fetched logs
    const allLogs = [...presentLateLogs, ...absentLogs].sort((a, b) => {
        const dateComparison = b.session_date.localeCompare(a.session_date);
        if (dateComparison !== 0) return dateComparison;
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    // 5. Always calculate the summary for all volunteers displayed in the logs
    const summaryMap = new Map();
    foundationVolunteers.forEach(v => {
        // Only include volunteers that could have logs based on the filter
        if (!volunteer_id || parseInt(volunteer_id) === v.volunteer_id) {
            summaryMap.set(v.volunteer_id, { name: v.name, present: 0, late: 0, absent: 0 });
        }
    });

    allLogs.forEach(log => {
        if (summaryMap.has(log.volunteer_id)) {
            const currentStats = summaryMap.get(log.volunteer_id);
            if (currentStats.hasOwnProperty(log.status)) {
                currentStats[log.status]++;
            }
        }
    });

    const summary = [];
    for (const [id, data] of summaryMap.entries()) {
        summary.push({ volunteer_id: id, name: data.name, stats: data });
    }

    // 6. Calculate stats for the top bar ONLY if a single volunteer was filtered
    let individualStats = null;
    if (volunteer_id) {
        const volunteerSummary = summary.find(s => s.volunteer_id === parseInt(volunteer_id));
        if (volunteerSummary) {
            individualStats = volunteerSummary.stats;
        }
    }
    const studentAttendanceMatch = { foundation_id: foundationId };
    if (start_date && end_date) {
        studentAttendanceMatch.date = { $gte: start_date, $lte: end_date };
    }
    const studentAttendanceLogs = await db.collection('student_attendance')
        .find(studentAttendanceMatch)
        .sort({ date: -1, createdAt: -1 })
        .toArray();

    res.render('foundation-details', { 
        foundation,
        eventManagers,
        directors,
        coordinators,
        logs: allLogs,
        stats: individualStats, // Stats for the top bar (individual view)
        summary, // Aggregated data for the new summary table
        studentAttendanceLogs,
        filters: req.query,
        currentUser: req.user 
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;