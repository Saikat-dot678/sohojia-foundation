// routes/holidayManagement.js

const express = require('express');
const router = express.Router();
const dbPromise = require('../config/mongo');
const pool = require('../config/db'); // For checking if foundation exists
const { authenticateJWT, authorizeAdmin } = require('../middleware/authJwt');

// Middleware to protect all routes in this file
router.use(authenticateJWT, authorizeAdmin);

// GET route to display the initial management page
router.get('/', (req, res) => {
    res.render('manage-holidays.html', {
        message: req.query.success || req.query.error,
        messageType: req.query.success ? 'success' : (req.query.error ? 'error' : null),
        foundationId: req.query.foundationId || ''
    });
});

// POST route to view holidays for a specific foundation
router.post('/view', async (req, res) => {
    const { foundationId } = req.body;

    if (!foundationId) {
        return res.redirect('/admin/holidays?error=Foundation ID is required.');
    }

    try {
        // Check if foundation exists in MySQL
        const [fRows] = await pool.query('SELECT name FROM foundations WHERE foundation_id = ?', [foundationId]);
        if (fRows.length === 0) {
            return res.redirect(`/admin/holidays?error=Foundation with ID ${foundationId} not found.&foundationId=${foundationId}`);
        }
        const foundationName = fRows[0].name;

        const db = await dbPromise;
        const holidayDoc = await db.collection('holidays').findOne({ foundation_id: parseInt(foundationId, 10) });

        // ## CORRECTED: Always render the management section if the foundation is valid ##
        res.render('manage-holidays.html', {
            foundationId,
            foundationName,
            holidays: holidayDoc ? holidayDoc.holidays.sort() : [] // Pass an empty array if no holidays exist
        });

    } catch (err) {
        console.error('Error fetching holidays:', err);
        res.redirect(`/admin/holidays?error=Server error fetching holidays.&foundationId=${foundationId}`);
    }
});

// POST route to add a new holiday
router.post('/add', async (req, res) => {
    const { foundationId, holiday_date } = req.body;

    if (!foundationId || !holiday_date) {
        return res.redirect(`/admin/holidays?error=Both Foundation ID and date are required.&foundationId=${foundationId}`);
    }

    try {
        const db = await dbPromise;
        await db.collection('holidays').updateOne(
            { foundation_id: parseInt(foundationId, 10) },
            { $addToSet: { holidays: holiday_date } },
            { upsert: true }
        );

        // Redirect back to the same view, which will now show the new holiday
        // We'll simulate a POST to /view to refresh the data
        res.redirect(307, `/admin/holidays/view?foundationId=${foundationId}&success=Holiday added successfully.`);

    } catch (err) {
        console.error('Error adding holiday:', err);
        res.redirect(`/admin/holidays?error=Server error adding holiday.&foundationId=${foundationId}`);
    }
});

// POST route to delete a holiday
router.post('/delete', async (req, res) => {
    const { foundationId, holiday_date } = req.body;

    if (!foundationId || !holiday_date) {
        return res.redirect(`/admin/holidays?error=Both Foundation ID and date are required to delete.&foundationId=${foundationId}`);
    }

    try {
        const db = await dbPromise;
        await db.collection('holidays').updateOne(
            { foundation_id: parseInt(foundationId, 10) },
            { $pull: { holidays: holiday_date } }
        );

        // Redirect back to the same view to refresh the data
        res.redirect(307, `/admin/holidays/view?foundationId=${foundationId}&success=Holiday deleted successfully.`);

    } catch (err) {
        console.error('Error deleting holiday:', err);
        res.redirect(`/admin/holidays?error=Server error deleting holiday.&foundationId=${foundationId}`);
    }
});

// ## NEW GET route to handle redirects from add/delete ##
// This prevents the "Cannot POST" error after an action
router.get('/view', async (req, res) => {
    const { foundationId, success, error } = req.query;

    if (!foundationId) {
        return res.redirect('/admin/holidays');
    }

    try {
        const [fRows] = await pool.query('SELECT name FROM foundations WHERE foundation_id = ?', [foundationId]);
        if (fRows.length === 0) {
            return res.redirect(`/admin/holidays?error=Foundation with ID ${foundationId} not found.`);
        }
        const foundationName = fRows[0].name;

        const db = await dbPromise;
        const holidayDoc = await db.collection('holidays').findOne({ foundation_id: parseInt(foundationId, 10) });

        res.render('manage-holidays.html', {
            foundationId,
            foundationName,
            holidays: holidayDoc ? holidayDoc.holidays.sort() : [],
            message: success || error,
            messageType: success ? 'success' : 'error'
        });

    } catch (err) {
        console.error('Error fetching holidays:', err);
        res.redirect(`/admin/holidays?error=Server error fetching holidays.&foundationId=${foundationId}`);
    }
});


module.exports = router;
