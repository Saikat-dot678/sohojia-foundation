// cron/absenceCheck.js

const cron = require('node-cron');
const pool = require('../config/db');
const dbPromise = require('../config/mongo');
const {
    getISTDateString,
    getISTTimeString,
    getISTDayName,
    getISTDateTime
} = require('../utils/dateHelper');

/**
 * This cron job runs periodically to check for volunteers who missed their
 * scheduled sessions and marks them as absent, skipping days that are
 * designated holidays for their foundation.
 */
const checkAbsence = async () => {
    try {
        const todayDate = getISTDateString();      // e.g., "2025-07-18"
        const nowISTTime = getISTTimeString();     // e.g., "14:30:00"
        const todayDay = getISTDayName();          // e.g., "friday"


        // Step 1: Get all volunteer sessions that have ended today
        const [endedSessions] = await pool.query(`
            SELECT id, volunteer_id, start_time, end_time, shift
            FROM volunteer_schedule
            WHERE LOWER(day_of_week) = ? AND end_time < ?
        `, [todayDay.toLowerCase(), nowISTTime]);

        if (endedSessions.length === 0) {
            console.log('[Absence Check] No ended sessions to process at this time.');
            return;
        }

        const db = await dbPromise;
        const absentCol = db.collection('Absent');
        const attendanceCol = db.collection('Attendance');

        // Step 2: To be efficient, get all unique volunteer IDs from the ended sessions
        const volunteerIds = [...new Set(endedSessions.map(s => s.volunteer_id))];

        // Step 3: Fetch the foundation ID for each of these volunteers in a single query
        const [volunteerData] = await pool.query(
            `SELECT volunteer_id, foundation_id FROM volunteers WHERE volunteer_id IN (?)`,
            [volunteerIds]
        );

        // Create a map for easy lookup: volunteer_id -> foundation_id
        const volunteerFoundationMap = new Map();
        volunteerData.forEach(v => {
            volunteerFoundationMap.set(v.volunteer_id, v.foundation_id);
        });

        // Step 4: Get all unique foundation IDs and fetch their holiday lists in a single query
        const foundationIds = [...new Set(volunteerData.map(v => v.foundation_id))];
        const holidayDocs = await db.collection('holidays').find({ foundation_id: { $in: foundationIds } }).toArray();

        // Create a map for easy holiday lookups: foundation_id -> Set of holiday dates
        const foundationHolidaysMap = new Map();
        holidayDocs.forEach(doc => {
            foundationHolidaysMap.set(doc.foundation_id, new Set(doc.holidays));
        });

        // Step 5: Process each ended session individually
        for (const session of endedSessions) {
            const foundationId = volunteerFoundationMap.get(session.volunteer_id);
            const holidays = foundationHolidaysMap.get(foundationId);

            // Step 5a: Check if today is a holiday for this volunteer's foundation
            if (holidays && holidays.has(todayDate)) {
                console.log(`[Absence Check] Skipping volunteer ${session.volunteer_id} for session ${session.id}. Reason: Holiday on ${todayDate}.`);
                continue; // Skip to the next session, do not mark as absent
            }

            // Step 5b: If it's not a holiday, proceed with the original absence check logic
            const sessionStartUTC = getISTDateTime(session.start_time);
            const sessionEndUTC = getISTDateTime(session.end_time);

            const attendance = await attendanceCol.findOne({
                volunteer_id: session.volunteer_id,
                timestamp: { $gte: sessionStartUTC, $lte: sessionEndUTC }
            });

            if (!attendance) {
                // Check if they are already marked absent for this specific session today
                const alreadyAbsent = await absentCol.findOne({
                    volunteer_id: session.volunteer_id,
                    session_date: todayDate,
                    session_id: session.id
                });

                if (!alreadyAbsent) {
                    await absentCol.insertOne({
                        volunteer_id: session.volunteer_id,
                        session_date: todayDate,
                        session_id: session.id,
                        shift: session.shift,
                        status: 'Absent',
                        timestamp: new Date()
                    });
                    
                }
            }
        }
    } catch (err) {
        console.error('[CRON ERROR] Absence Check Failed:', err);
    }
};

// Schedule the job to run. Every 10 minutes is good for testing.
cron.schedule('30 20 * * *', checkAbsence,{
    scheduled: true,
    timezone: "Asia/Kolkata"
});

console.log('Absence check cron job scheduled to run every 10 minutes.');

// Optional: To run the job immediately for a single test run
// checkAbsence();
