// cron/updateLateStatus.js

const cron = require('node-cron');
const pool = require('../config/db'); // MySQL connection pool
const dbPromise = require('../config/mongo'); // MongoDB connection promise
const { ObjectId } = require('mongodb');

/**
 * Combines a date string (YYYY-MM-DD) and a time string (HH:mm:ss) into a UTC Date object.
 * It correctly interprets the input time as being in the IST timezone.
 * @param {string} dateStr - The date string, e.g., "2025-07-12"
 * @param {string} timeStr - The IST time string, e.g., "14:00:00"
 * @returns {Date} A JavaScript Date object representing the moment in UTC.
 */
function createUTCDateTimeFromIST(dateStr, timeStr) {
  // Creates an ISO-8601 string with the IST timezone offset (+05:30)
  const isoString = `${dateStr}T${timeStr}+05:30`;
  return new Date(isoString);
}

/**
 * This function fetches today's attendance logs marked as 'present'
 * and updates them to 'late' if the check-in time is more than 15 minutes
 * after the scheduled start time.
 */
const updateLateAttendanceStatus = async () => {
  console.log('Running cron job: Checking for late attendance...');
  
  try {
    const db = await dbPromise;
    const attendanceCollection = db.collection('Attendance');

    // ## MODIFIED: 1. Get today's date ##
    const today = new Date();
    const todayDateString = today.toISOString().split('T')[0];
    
    console.log(`Processing attendance for date: ${todayDateString}`);

    // ## MODIFIED: 2. Fetch all 'present' logs from today ##
    const presentLogs = await attendanceCollection.find({
      session_date: todayDateString,
      status: 'Present'
    }).toArray();

    if (presentLogs.length === 0) {
      console.log(`No "present" logs found for today. Job finished.`);
      return;
    }

    // 3. Get all session IDs from the logs to query MySQL efficiently
    const sessionIds = [...new Set(presentLogs.map(log => log.session_id))];
    
    // 4. Fetch the corresponding schedules from MySQL
    const [scheduleRows] = await pool.query(
      'SELECT id, start_time FROM volunteer_schedule WHERE id IN (?)',
      [sessionIds]
    );

    // 5. Create a map for quick schedule lookups
    const scheduleMap = new Map();
    scheduleRows.forEach(schedule => {
      scheduleMap.set(schedule.id, schedule);
    });


    // 6. Iterate through logs and check for lateness
    const updatesToPerform = [];
    for (const log of presentLogs) {
      const schedule = scheduleMap.get(log.session_id);

      if (schedule) {
        const attendanceTimeUTC = log.timestamp; 
        const scheduledStartTimeUTC = createUTCDateTimeFromIST(log.session_date, schedule.start_time);
        const lateThreshold = new Date(scheduledStartTimeUTC.getTime() + (15 * 60 * 1000));

        if (attendanceTimeUTC > lateThreshold) {
          updatesToPerform.push(
            attendanceCollection.updateOne(
              { _id: new ObjectId(log._id) },
              { $set: { status: 'late' } }
            )
          );
        }
      }
    }

    // 7. Execute all updates in parallel
    if (updatesToPerform.length > 0) {
      await Promise.all(updatesToPerform);
    } else {
      console.log('No logs needed to be updated to "late".');
    }

    console.log('Cron job finished successfully.');

  } catch (error) {
    console.error('Error running late attendance cron job:', error);
  }
};


cron.schedule('15 20 * * *', updateLateAttendanceStatus, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});


module.exports = {
    updateLateAttendanceStatus
};