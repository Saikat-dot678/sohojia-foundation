const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // MySQL promise pool
const dbPromise = require('../config/mongo'); // MongoDB connection promise
const {authorizeManagementRoles} = require('../middleware/authJwt');

// Helper function to format duration from milliseconds
function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.round((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

// Helper function to format a date object into HH:MM (IST)
function formatTime(date) {
    if (!date) return '';
    return new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false, // Use 24-hour format
        timeZone: 'Asia/Kolkata'
    }).format(new Date(date));
}

// GET /foundation/:id
router.get('/:id',authorizeManagementRoles, async (req, res, next) => {
  const foundationId = parseInt(req.params.id, 10);
  const { volunteer_id, start_date, end_date, shift } = req.query;

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
    const foundationVolunteerIds = foundationVolunteers.map(v => v.volunteer_id);

    let schedules = [];
    if (foundationVolunteerIds.length > 0) {
        const [scheduleRows] = await pool.query('SELECT * FROM volunteer_schedule WHERE volunteer_id IN (?)', [foundationVolunteerIds]);
        schedules = scheduleRows;
    }
    const scheduleMap = new Map(schedules.map(s => [s.id, s]));

    // 2. Build the MongoDB match query based on filters
    const mongoMatch = {};
    if (foundationVolunteerIds.length > 0) {
        mongoMatch.volunteer_id = { $in: foundationVolunteerIds };
    } else {
        mongoMatch.volunteer_id = { $in: [] };
    }

    if (volunteer_id) {
        mongoMatch.volunteer_id = parseInt(volunteer_id, 10);
    }
    if (start_date && end_date) {
        mongoMatch.session_date = { $gte: start_date, $lte: end_date };
    }
    
    // FIX: Use a case-insensitive regex for the shift filter to handle data variations.
    if (shift && shift.toLowerCase() !== 'all') {
        // This will match 'morning', 'Morning', 'MORNING', etc. exactly.
        mongoMatch.shift = { $regex: `^${shift}$`, $options: 'i' };
    }

    // 3. Fetch logs
    const presentLateLogs = await db.collection('Attendance').find(mongoMatch).toArray();
    const absentLogs = await db.collection('Absent').find(mongoMatch).toArray();

    presentLateLogs.forEach(log => { if (log.status) log.status = log.status.toLowerCase(); });
    absentLogs.forEach(log => { if (log.status) log.status = log.status.toLowerCase(); });

    // 4. Combine, sort, and format all fetched logs
    const allLogs = [...presentLateLogs, ...absentLogs].sort((a, b) => {
        const dateComparison = b.session_date.localeCompare(a.session_date);
        if (dateComparison !== 0) return dateComparison;
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    allLogs.forEach(log => {
        log.duration = '--';
        log.exit_status = null;
        log.displayTime = '--';

        if (log.status === 'absent' || !log.check_in_time) {
            return;
        }
        
        const startTime = new Date(log.check_in_time);
        let endTime;

        const startTimeFormatted = formatTime(startTime);

        if (log.check_out_time) {
            endTime = new Date(log.check_out_time);
            log.exit_status = 'On Time Exit';
            const durationMs = endTime.getTime() - startTime.getTime();
            log.duration = formatDuration(durationMs);
            const endTimeFormatted = formatTime(endTime);
            log.displayTime = `${startTimeFormatted} - ${endTimeFormatted}`;
        } else {
            const schedule = scheduleMap.get(log.session_id);
            if (schedule && schedule.end_time) {
                log.exit_status = 'No Exit';
            }
            log.displayTime = startTimeFormatted;
        }
    });

    // 5. Calculate the summary
    const summaryMap = new Map();
    foundationVolunteers.forEach(v => {
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
        summary.push({ 
            volunteer_id: id, 
            name: data.name, 
            stats: {
                present: data.present,
                late: data.late,
                absent: data.absent
            } 
        });
    }

    // 6. Calculate stats for the top bar
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
        stats: individualStats,
        summary,
        studentAttendanceLogs,
        filters: req.query,
        currentUser: req.user 
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;