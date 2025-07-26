// cron/seasonalScheduleSwitcher.js

const cron = require('node-cron');
const pool = require('../config/db');
const dbPromise = require('../config/mongo');

/**
 * Checks if the current date falls within a year-agnostic MM-DD range.
 * Handles ranges that cross over the new year (e.g., Nov 1 to Feb 28).
 * @param {string} startDateStr - The start date in "MM-DD" format.
 * @param {string} endDateStr - The end date in "MM-DD" format.
 * @returns {boolean} - True if the current date is within the range.
 */
function isDateInRange(startDateStr, endDateStr) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // getMonth() is 0-indexed
    const currentDay = now.getDate();

    const [startMonth, startDay] = startDateStr.split('-').map(Number);
    const [endMonth, endDay] = endDateStr.split('-').map(Number);

    const currentDateNum = currentMonth * 100 + currentDay;
    const startDateNum = startMonth * 100 + startDay;
    const endDateNum = endMonth * 100 + endDay;

    if (startDateNum <= endDateNum) {
        // Normal case: e.g., 03-15 to 10-31
        return currentDateNum >= startDateNum && currentDateNum <= endDateNum;
    } else {
        // Cross-year case: e.g., 11-01 to 02-28
        return currentDateNum >= startDateNum || currentDateNum <= endDateNum;
    }
}


const switchSeasonalSchedules = async () => {
    console.log('CRON: Running seasonal schedule switcher...');
    
    try {
        const db = await dbPromise;
        const seasonalRules = await db.collection('seasonal_schedules').find({}).toArray();

        for (const rule of seasonalRules) {
            let activeSeason = null;
            let seasonName = null;

            // Determine the currently active season based on today's date
            if (rule.summer && isDateInRange(rule.summer.start_date, rule.summer.end_date)) {
                activeSeason = rule.summer;
                seasonName = 'summer';
            } else if (rule.winter && isDateInRange(rule.winter.start_date, rule.winter.end_date)) {
                activeSeason = rule.winter;
                seasonName = 'winter';
            }

            if (!activeSeason) {
                // If no season is active, we don't need to do anything for this rule.
                continue;
            }

            // Get a representative schedule to check its current time in the database
            const representativeScheduleId = rule.schedule_ids[0];
            if (!representativeScheduleId) {
                continue; // Skip if there are no schedule IDs in the rule
            }

            const [scheduleCheck] = await pool.query(
                `SELECT start_time, end_time FROM volunteer_schedule WHERE id = ?`,
                [representativeScheduleId]
            );

            if (scheduleCheck.length === 0) {
                console.warn(`CRON: Schedule ID ${representativeScheduleId} not found in MySQL for rule ${rule._id}. Skipping.`);
                continue;
            }

            const currentDbStartTime = scheduleCheck[0].start_time;
            const currentDbEndTime = scheduleCheck[0].end_time;

            // ## CORRECTED LOGIC ##
            // Check if an update is needed. An update is needed if:
            // 1. The season has changed (e.g., from winter to summer).
            // OR
            // 2. The times in the database do not match the rule for the CURRENT season.
            const needsUpdate = (rule.lastUpdatedSeason !== seasonName) || 
                                (currentDbStartTime !== activeSeason.start_time) || 
                                (currentDbEndTime !== activeSeason.end_time);

            if (needsUpdate) {
                console.log(`CRON: UPDATE TRIGGERED for volunteer ${rule.volunteer_id}. Reason: ${rule.lastUpdatedSeason !== seasonName ? 'Season Changed' : 'Times Mismatch'}. Applying '${seasonName}' schedule.`);
                
                // Update the MySQL table with the correct seasonal times
                await pool.query(
                    `UPDATE volunteer_schedule SET start_time = ?, end_time = ? WHERE id IN (?)`,
                    [activeSeason.start_time, activeSeason.end_time, rule.schedule_ids]
                );

                // Update the MongoDB rule to reflect that this season's times are now set
                await db.collection('seasonal_schedules').updateOne(
                    { _id: rule._id },
                    { $set: { lastUpdatedSeason: seasonName } }
                );

                console.log(`CRON: Successfully updated ${rule.schedule_ids.length} schedules to '${seasonName}' timings.`);
            }
        }
    } catch (error) {
        console.error('CRON ERROR: Failed to run seasonal schedule switcher:', error);
    }
};

// For testing, you might run it more frequently. For production, once a day is fine.
cron.schedule('45 5 * * *', switchSeasonalSchedules, { // Every 5 minutes for testing
    scheduled: true,
    timezone: "Asia/Kolkata"
});

console.log('Seasonal schedule switching cron job is scheduled.');

module.exports = { switchSeasonalSchedules };
