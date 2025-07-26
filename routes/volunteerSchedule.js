// routes/volunteerSchedule.js
const express = require('express');
const router  = express.Router({ mergeParams: true });
const Pool = require('../config/db');
const {
  authorizeVolunteerOrAdmin
} = require('../middleware/authJwt');
// GET /volunteer/:id/schedule
router.get('/:id/schedule',authorizeVolunteerOrAdmin, async (req, res, next) => {
  try {
    const volunteerId = parseInt(req.params.id, 10);
    if (isNaN(volunteerId)) {
      return res.status(400).send('Invalid volunteer ID');
    }

    // 1) Fetch volunteer basic info
    const [[vol]] = await Pool.query(
      `SELECT volunteer_id, name
         FROM volunteers
        WHERE volunteer_id = ?`,
      [volunteerId]
    );
    if (!vol) {
      return res.status(404).send('Volunteer not found');
    }

    // 2) Fetch schedule entries
    const [rows] = await Pool.query(
    `SELECT 
        day_of_week,
        shift,
        DATE_FORMAT(start_time, '%H:%i') AS start_time,
        DATE_FORMAT(end_time,   '%H:%i') AS end_time,
        class_standard AS class,
        subject,
        role
    FROM volunteer_schedule
    WHERE volunteer_id = ?
    ORDER BY
        FIELD(day_of_week,
        'Monday','Tuesday','Wednesday',
        'Thursday','Friday','Saturday','Sunday'
        ),
        FIELD(shift,'Morning','Afternoon','Evening')
    `, [volunteerId]
    );

    // 3) Organize into a lookup: schedule[day][shift] = entry
    const schedule = {};
    for (const r of rows) {
      schedule[r.day_of_week] = schedule[r.day_of_week] || {};
      schedule[r.day_of_week][r.shift] = r;
    }

    // 4) Render the schedule template
    res.render('schedule', {
      volunteer: vol,
      schedule,
      userRole: req.user.role
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
