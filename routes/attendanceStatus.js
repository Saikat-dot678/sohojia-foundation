const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const dbPromise = require('../config/mongo');

// Helpers to get IST dates and times
function getISTDate() {
// Return current date/time in IST as a Date object (server local time)
return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
);
}

function getISTDayName() {
return getISTDate()
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase();
}

function getISTTimeString() {
return getISTDate().toTimeString().slice(0, 8);
}

function getISTDateString() {
return getISTDate().toISOString().slice(0, 10);
}

// Build a JS Date object in UTC that corresponds to the given IST time on today's date
function getISTDateTimeUTC(timeStr) {
const todayISTDateStr = getISTDateString(); // e.g. '2025-05-26'
// Construct ISO 8601 string with IST offset (+05:30)
const isoIST = `${todayISTDateStr}T${timeStr}+05:30`;
return new Date(isoIST); // JS converts this to UTC internally
}

router.get(
'/volunteer/:volunteerId/attendance-button-status',
async (req, res) => {
    try {
    const volunteerId = parseInt(req.params.volunteerId, 10);
    const todayISTDate = getISTDateString();
    const nowISTTime = getISTTimeString();
    const currentDay = getISTDayName();

    // 1) Find the active schedule row in MySQL
    const [rows] = await pool.query(
        `SELECT *
        FROM volunteer_schedule
        WHERE volunteer_id = ?
        AND LOWER(day_of_week) = ?
        AND start_time <= ?
        AND end_time >= ?
        LIMIT 1`,
        [volunteerId, currentDay, nowISTTime, nowISTTime]
    );

    if (rows.length === 0) {
        return res.json({
        success: true,
        sessionActive: false,
        attendanceMarked: false,
        });
    }

    const session = rows[0];
    const sessionStart = getISTDateTimeUTC(session.start_time);
    const sessionEnd = getISTDateTimeUTC(session.end_time);

    // 2) Pull all attendance docs for today & volunteer
    const db = await dbPromise;
    const attendanceCollection = db.collection('Attendance');
    const docs = await attendanceCollection
        .find({
        volunteer_id: volunteerId,
        session_date: todayISTDate,
        })
        .toArray();

    // 3) Compare each doc.timestamp (UTC) against session window (UTC)
    let attendanceMarked = false;
    for (const doc of docs) {
    // doc.timestamp is ISODate with Z (UTC) but actually represents IST time.
    const recordTimestampUTC = new Date(doc.timestamp);

    // Convert this "fake UTC" timestamp back to real UTC by subtracting 5.5 hours
    //const recordTimestampUTC = new Date(recordTimestampFakeUTC.getTime() - 5.5 * 60 * 60 * 1000);

    // Now sessionStart and sessionEnd are UTC times converted from IST correctly
    if (recordTimestampUTC >= sessionStart && recordTimestampUTC <= sessionEnd) {
        attendanceMarked = true;
        break;
    }
    }


    // 4) Return flags + session coordinates
    return res.json({
        success: true,
        sessionActive: true,
        attendanceMarked,
        sessionDetails: {
        location_lat: session.latitude,
        location_long: session.longitude,
        start_time: session.start_time,
        end_time: session.end_time,
        },
    });
    } catch (err) {
    console.error('Error in attendance-button-status:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
    }
}
);

module.exports = router;
