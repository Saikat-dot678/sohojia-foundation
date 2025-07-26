const express = require('express');
const router = express.Router();
const {
  authorizeVolunteerOrAdmin
} = require('../middleware/authJwt');
router.get('/:id/attendance', authorizeVolunteerOrAdmin, async (req, res) => {
  const sqlPool = req.app.locals.sqlPool;
  const mongoDb = req.app.locals.mongoDb;

  const volunteerId = parseInt(req.params.id);
  if (isNaN(volunteerId)) {
    return res.status(400).send('Invalid Volunteer ID');
  }

  const month = parseInt(req.query.month) || (new Date()).getMonth() + 1;
  const year = parseInt(req.query.year) || (new Date()).getFullYear();
  const view = req.query.view === 'absent' ? 'absent' : 'attended';

  const monthStr = month.toString().padStart(2, '0');

  try {
    let records = [];

    if (view === 'attended') {
      records = await mongoDb.collection('Attendance')
        .find({
          volunteer_id: volunteerId,
          session_date: { $regex: `^${year}-${monthStr}` }
        })
        .sort({ session_date: 1 })
        .toArray();
    } else {
      records = await mongoDb.collection('Absent')
        .find({
          volunteer_id: volunteerId,
          session_date: { $regex: `^${year}-${monthStr}` }
        })
        .sort({ session_date: 1 })
        .toArray();
    }

    // Convert UTC timestamps to IST (Indian Standard Time) and format
    const formattedData = records.map(record => {
      const istDate = record.timestamp
        ? new Date(record.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : null;

      return {
        ...record,
        timestamp_ist: istDate
      };
    });

    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    res.render('attendance', {
      data: formattedData,
      currentYear: year,
      currentMonth: month,
      view,
      volunteerId,
      months,
      userRole: req.user.role
    });

  } catch (error) {
    console.error('Error loading attendance page:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
