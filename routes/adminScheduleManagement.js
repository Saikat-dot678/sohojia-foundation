const express = require('express');
const router = express.Router();
const sqlPool = require('../config/db');
const dbPromise = require('../config/mongo');
const { ObjectId } = require('mongodb');
const { authenticateJWT, authorizeAdmin } = require('../middleware/authJwt');

// Helper to format time for display
const formatTimeForInput = (timeString) => {
    if (!timeString) return '';
    return timeString.substring(0, 5); // Returns HH:MM
};

// GET route to display the initial search form
router.get('/', authenticateJWT, authorizeAdmin, (req, res) => {
    res.render('admin-manage-volunteer-schedule.html', {
        searchVolunteerId: req.query.volunteerId || '',
        message: req.query.success || req.query.error,
        messageType: req.query.success ? 'success' : 'error'
    });
});

// POST route to search for a volunteer's schedule
router.post('/view', authenticateJWT, authorizeAdmin, async (req, res) => {
    const volunteerId = parseInt(req.body.volunteerId, 10);
    if (isNaN(volunteerId)) {
        return res.redirect('/admin/schedule-management?error=Invalid Volunteer ID');
    }

    try {
        // Fetch volunteer details
        const [volunteerRows] = await sqlPool.query(`SELECT name FROM volunteers WHERE volunteer_id = ?`, [volunteerId]);
        if (volunteerRows.length === 0) {
            return res.redirect(`/admin/schedule-management?error=Volunteer not found&volunteerId=${volunteerId}`);
        }
        const volunteerName = volunteerRows[0].name;

        // Fetch all schedule entries from MySQL
        const [scheduleEntries] = await sqlPool.query(`SELECT * FROM volunteer_schedule WHERE volunteer_id = ? ORDER BY id`, [volunteerId]);

        // Fetch all seasonal rules from MongoDB that contain any of this volunteer's schedule IDs
        const scheduleIds = scheduleEntries.map(s => s.id);
        const db = await dbPromise;
        const seasonalRules = await db.collection('seasonal_schedules').find({ schedule_ids: { $in: scheduleIds } }).toArray();

        // Map seasonal rules to the schedules they apply to for easy access in the template
        scheduleEntries.forEach(entry => {
            entry.seasonalRule = seasonalRules.find(rule => rule.schedule_ids.includes(entry.id)) || null;
        });

        res.render('admin-manage-volunteer-schedule.html', {
            searchVolunteerId: volunteerId,
            volunteerName: volunteerName,
            schedules: scheduleEntries
        });

    } catch (err) {
        console.error('Error fetching schedule for admin:', err);
        res.redirect(`/admin/schedule-management?error=Server error fetching schedule&volunteerId=${volunteerId}`);
    }
});

// POST route to UPDATE a specific schedule entry
router.post('/update/:scheduleId', authenticateJWT, authorizeAdmin, async (req, res) => {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    const {
        volunteer_id, day_of_week, shift, start_time, end_time,
        class_standard, subject, latitude, longitude, role,
        seasonal_rule_id, summer_start_date, summer_end_date, summer_start_time, summer_end_time,
        winter_start_date, winter_end_date, winter_start_time, winter_end_time
    } = req.body;

    const connection = await sqlPool.getConnection();
    try {
        await connection.beginTransaction();

        // Update the main schedule entry in MySQL
        await connection.query(
            `UPDATE volunteer_schedule SET 
                day_of_week = ?, shift = ?, start_time = ?, end_time = ?, 
                class_standard = ?, subject = ?, latitude = ?, longitude = ?, role = ?
             WHERE id = ?`,
            [day_of_week, shift, start_time, end_time, class_standard, subject, parseFloat(latitude), parseFloat(longitude), role, scheduleId]
        );

        // If a seasonal rule is being updated
        if (seasonal_rule_id && ObjectId.isValid(seasonal_rule_id)) {
            const db = await dbPromise;
            const updateFields = {};
            if (summer_start_date && summer_end_date && summer_start_time && summer_end_time) {
                updateFields['summer'] = { start_date: summer_start_date, end_date: summer_end_date, start_time: summer_start_time, end_time: summer_end_time };
            }
            if (winter_start_date && winter_end_date && winter_start_time && winter_end_time) {
                updateFields['winter'] = { start_date: winter_start_date, end_date: winter_end_date, start_time: winter_start_time, end_time: winter_end_time };
            }
            
            // Reset lastUpdatedSeason so the cron job re-evaluates the times
            updateFields['lastUpdatedSeason'] = null;

            await db.collection('seasonal_schedules').updateOne(
                { _id: new ObjectId(seasonal_rule_id) },
                { $set: updateFields }
            );
        }

        await connection.commit();
        res.redirect(`/admin/schedule-management?success=Schedule ID ${scheduleId} updated successfully.&volunteerId=${volunteer_id}`);

    } catch (err) {
        await connection.rollback();
        console.error(`Error updating schedule ${scheduleId}:`, err);
        res.redirect(`/admin/schedule-management?error=Error updating schedule&volunteerId=${volunteer_id}`);
    } finally {
        connection.release();
    }
});

// POST route to DELETE a specific schedule entry
router.post('/delete/:scheduleId', authenticateJWT, authorizeAdmin, async (req, res) => {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    const { volunteer_id, seasonal_rule_id } = req.body;

    const connection = await sqlPool.getConnection();
    try {
        await connection.beginTransaction();

        // Delete the schedule from MySQL
        await connection.query(`DELETE FROM volunteer_schedule WHERE id = ?`, [scheduleId]);

        // If it was part of a seasonal rule, remove its ID from the MongoDB document
        if (seasonal_rule_id && ObjectId.isValid(seasonal_rule_id)) {
            const db = await dbPromise;
            const result = await db.collection('seasonal_schedules').findOneAndUpdate(
                { _id: new ObjectId(seasonal_rule_id) },
                { $pull: { schedule_ids: scheduleId } },
                { returnDocument: 'after' }
            );

            // If the schedule_ids array is now empty, delete the entire rule
            if (result.value && result.value.schedule_ids.length === 0) {
                await db.collection('seasonal_schedules').deleteOne({ _id: new ObjectId(seasonal_rule_id) });
            }
        }

        await connection.commit();
        res.redirect(`/admin/schedule-management?success=Schedule ID ${scheduleId} deleted successfully.&volunteerId=${volunteer_id}`);

    } catch (err) {
        await connection.rollback();
        console.error(`Error deleting schedule ${scheduleId}:`, err);
        res.redirect(`/admin/schedule-management?error=Error deleting schedule&volunteerId=${volunteer_id}`);
    } finally {
        connection.release();
    }
});

module.exports = router;
