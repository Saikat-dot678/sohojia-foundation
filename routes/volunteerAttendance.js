const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const dbPromise = require('../config/mongo');
const {
  authorizeVolunteerOrAdmin
} = require('../middleware/authJwt');

// Helper function to format duration from milliseconds
function formatDuration(ms) {
    if (!ms || ms < 0) return '--';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.round((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

// Helper function to format a date object into HH:MM (IST)
function formatTime(date) {
    if (!date) return '--';
    return new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata'
    }).format(new Date(date));
}


router.get('/:id/attendance', authorizeVolunteerOrAdmin, async (req, res) => {
  const sqlPool = req.app.locals.sqlPool;
  const mongoDb = req.app.locals.mongoDb;

  const volunteerId = parseInt(req.params.id);
  if (isNaN(volunteerId)) {
    return res.status(400).send('Invalid Volunteer ID');
  }

  const { start_date, end_date, status } = req.query;

  try {
    const mongoMatch = { volunteer_id: volunteerId };
    let absentMatch = { volunteer_id: volunteerId }; // Separate match for absent collection

    // Add date range filter if both start and end dates are provided
    if (start_date && end_date) {
        mongoMatch.session_date = { $gte: start_date, $lte: end_date };
        absentMatch.session_date = { $gte: start_date, $lte: end_date };
    }
    
    let presentLateLogs = [];
    let absentLogs = [];

    // Fetch logs based on the status filter
    if (status === 'present') {
        mongoMatch.status = { $in: ['present', 'Present'] }; // Case-insensitive fix
        presentLateLogs = await mongoDb.collection('Attendance').find(mongoMatch).toArray();
    } else if (status === 'late') {
        mongoMatch.status = 'late';
        presentLateLogs = await mongoDb.collection('Attendance').find(mongoMatch).toArray();
    } else if (status === 'absent') {
        absentLogs = await mongoDb.collection('Absent').find(absentMatch).toArray();
    } else { // 'all' or no filter
        presentLateLogs = await mongoDb.collection('Attendance').find(mongoMatch).toArray();
        absentLogs = await mongoDb.collection('Absent').find(absentMatch).toArray();
    }

    // Fetch schedules for this volunteer to determine end times
    const [schedules] = await pool.query('SELECT * FROM volunteer_schedule WHERE volunteer_id = ?', [volunteerId]);
    const scheduleMap = new Map(schedules.map(s => [s.id, s]));

    // Combine and process logs
    const allLogs = [...presentLateLogs, ...absentLogs].sort((a, b) => {
        return new Date(b.session_date) - new Date(a.session_date) || new Date(b.timestamp) - new Date(a.timestamp);
    });

    const formattedData = allLogs.map(log => {
        log.status = log.status ? log.status.toLowerCase() : 'unknown';
        log.duration = '--';
        log.exit_status = null;
        log.displayTime = '--';

        if (log.status !== 'absent' && log.check_in_time) {
            const startTime = new Date(log.check_in_time);
            const startTimeFormatted = formatTime(startTime);

            if (log.check_out_time) {
                const endTime = new Date(log.check_out_time);
                log.exit_status = 'On Time Exit';
                log.duration = formatDuration(endTime.getTime() - startTime.getTime());
                log.displayTime = `${startTimeFormatted} - ${formatTime(endTime)}`;
            } else {
                const schedule = scheduleMap.get(log.session_id);
                if (schedule) {
                    log.exit_status = 'No Exit';
                }
                log.displayTime = startTimeFormatted;
            }
        }
        return log;
    });

    res.render('attendance.html', {
      logs: formattedData,
      filters: {
          start_date: start_date || '',
          end_date: end_date || '',
          status: status || 'all'
      },
      volunteerId,
      userRole: req.user.role,
      currentYear: new Date().getFullYear()
    });

  } catch (error) {
    console.error('Error loading attendance page:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;