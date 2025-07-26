// backend/controllers/schedule.js
const mysql = require('../config/db');

async function getCurrentSession(req, res) {
    const vid = req.params.id;
    const now = new Date();
    const [rows] = await mysql.query(
    `SELECT * FROM volunteer_schedule
        WHERE volunteer_id=?
        AND day_of_week=DAYNAME(?)
        AND start_time<=TIME(?)
        AND end_time>=TIME(?)
        LIMIT 1`,
    [vid, now, now, now]
    );
    if (!rows.length) return res.json(null);
    res.json(rows[0]);
}

module.exports = { getCurrentSession };
