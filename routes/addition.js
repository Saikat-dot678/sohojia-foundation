const express = require('express');
const path = require('path');
const dbPromise = require('../config/mongo'); // MongoDB connection promise
const pool = require('../config/db'); // MySQL connection pool
const mysql = require('mysql2'); // Although imported, 'pool.execute' is used, which is fine.

const router = express.Router();

// --- District Management Routes ---
// GET route to serve the HTML form for adding a district
// Note: Duplicate route definitions are usually a bad idea.
// I'll keep one and remove the other.
router.get('/add-district', (req, res) => {
    // Assuming 'add-district.html' is a Nunjucks template now
    res.render('add-district.html'); // Use res.render if it's a Nunjucks template
    // Or if it's a static HTML file and you serve 'public' directly
    // res.sendFile(path.join(__dirname, '../public', 'add-district.html'));
});

// Handle the form submission for adding a district
router.post('/add-district', async (req, res) => {
    try {
        const db = await dbPromise;
        let { name } = req.body;

        // Trim and validate name
        if (typeof name === 'string') {
            name = name.trim();
        } else {
            name = '';
        }

        if (!name) {
            return res.status(400).send('District name is required');
        }

        // Check if district already exists (case-insensitive match)
        const existingDistrict = await db.collection('districts').findOne({
            name: { $regex: new RegExp(`^${name}$`, 'i') }
        });

        if (existingDistrict) {
            return res.redirect('/dashboard?error=District already exists!');
        }

        const district = {
            name,
            foundation_ids: []
        };

        await db.collection('districts').insertOne(district);

        return res.redirect('/dashboard?success=District added successfully!');

    } catch (err) {
        console.error('Error inserting district:', err);
        return res.status(500).send('Internal Server Error: Failed to add district.');
    }
});


// --- Foundation Management Routes ---
// GET route to serve the HTML form for adding a foundation
router.get('/add-foundation', (req, res) => {
    // Assuming 'add-foundation.html' is a Nunjucks template
    res.render('add-foundation.html'); 
});

// Get all districts for dropdown (API endpoint for frontend JS)
router.get('/api/districts', async (req, res) => {
    try {
        const db = await dbPromise;
        const districts = await db.collection('districts').find({}).toArray();
        return res.json(districts); // FIX: Return here
    } catch (err) {
        console.error('Error fetching districts:', err);
        return res.status(500).json({ error: 'Internal Server Error' }); // FIX: Return here
    }
});

// Add foundation (API endpoint)
router.post('/api/add-foundation', async (req, res) => {
    const { foundation_id, name, district_name } = req.body;
    const db = await dbPromise;

    // Basic validation
    if (!foundation_id || !name || !district_name) {
        return res.status(400).send('Missing required fields for foundation.');
    }

    try {
        const parsedFoundationId = parseInt(foundation_id, 10);
        if (isNaN(parsedFoundationId)) {
            return res.status(400).send('Invalid Foundation ID format.');
        }

        // 1. Insert foundation into MySQL
        const insertSQL = `INSERT INTO foundations (foundation_id, name) VALUES (?, ?)`;
        await pool.execute(insertSQL, [parsedFoundationId, name]);

        // 2. Update district in MongoDB
        await db.collection('districts').updateOne(
            { name: district_name },
            { $addToSet: { foundation_ids: parsedFoundationId } } // Ensure ID is parsed to int
        );

        // FIX: Redirect after successful operation and RETURN
        return res.redirect('/dashboard?success=Foundation added successfully!');

    } catch (err) {
        console.error('Error adding foundation:', err);
        // FIX: Distinguish unique key errors from others
        if (err.code === 'ER_DUP_ENTRY') { // MySQL duplicate entry error code
            return res.status(409).send('Foundation ID already exists.');
        }
        return res.status(500).send('Internal Server Error: Failed to add foundation.');
    }
});

// --- Volunteer Schedule Management Routes (Admin Addition) ---
// GET route to serve the HTML form for adding a volunteer schedule
router.get('/add-schedule', (req, res) => {
    // Assuming 'add-schedule.html' is a Nunjucks template
    res.render('add-schedule.html'); 
});

// POST route to handle adding a volunteer schedule via API
router.post('/api/add-schedule', async (req, res) => {
    const {
        volunteer_id, day_of_week, shift, class_standard, subject,
        latitude, longitude, role,
        summer_start_date, summer_end_date, summer_start_time, summer_end_time,
        winter_start_date, winter_end_date, winter_start_time, winter_end_time
    } = req.body;

    let start_time, end_time;
    if (shift === 'Morning') { start_time = '08:00:00'; end_time = '11:00:00'; }
    else if (shift === 'Afternoon') { start_time = '13:00:00'; end_time = '16:00:00'; }
    else if (shift === 'Evening') { start_time = '17:00:00'; end_time = '20:00:00'; }

    if (!volunteer_id || !day_of_week || !shift || !start_time || !latitude || !longitude) {
        return res.status(400).send('Missing required schedule fields.');
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const parsedVolunteerId = parseInt(volunteer_id, 10);
        if (isNaN(parsedVolunteerId)) throw new Error('Invalid Volunteer ID format.');

        const [volunteerExists] = await connection.query(`SELECT foundation_id FROM volunteers WHERE volunteer_id = ?`, [parsedVolunteerId]);
        if (volunteerExists.length === 0) throw new Error('Volunteer with this ID does not exist.');
        
        const foundationId = volunteerExists[0].foundation_id;
        const days = Array.isArray(day_of_week) ? day_of_week : [day_of_week];
        const createdScheduleIds = [];

        for (const day of days) {
            const [result] = await connection.query(`
                INSERT INTO volunteer_schedule 
                (volunteer_id, day_of_week, shift, start_time, end_time, class_standard, subject, latitude, longitude, role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                parsedVolunteerId, day, shift, start_time, end_time,
                class_standard || null, subject || null, parseFloat(latitude), parseFloat(longitude), role || 'teacher'
            ]);
            createdScheduleIds.push(result.insertId);
        }

        const hasSummer = summer_start_date && summer_end_date && summer_start_time && summer_end_time;
        const hasWinter = winter_start_date && winter_end_date && winter_start_time && winter_end_time;

        if (hasSummer || hasWinter) {
            const db = await dbPromise;
            const seasonalRule = {
                schedule_ids: createdScheduleIds, volunteer_id: parsedVolunteerId,
                foundation_id: foundationId, lastUpdatedSeason: null, createdAt: new Date()
            };

            if (hasSummer) {
                seasonalRule.summer = {
                    start_date: summer_start_date, // e.g., "03-15"
                    end_date: summer_end_date,     // e.g., "10-31"
                    start_time: summer_start_time,
                    end_time: summer_end_time,
                };
            }
            if (hasWinter) {
                seasonalRule.winter = {
                    start_date: winter_start_date, // e.g., "11-01"
                    end_date: winter_end_date,     // e.g., "03-14"
                    start_time: winter_start_time,
                    end_time: winter_end_time,
                };
            }
            
            await db.collection('seasonal_schedules').insertOne(seasonalRule);
        }

        await connection.commit();
        res.redirect('/dashboard?success=Schedule(s) added successfully!');

    } catch (err) {
        await connection.rollback();
        console.error('Failed to insert schedule:', err);
        res.status(500).send('Failed to add schedule: Internal Server Error.');
    } finally {
        connection.release();
    }
});

// --- Volunteer Management (Admin Addition) ---
router.get('/add-volunteer', (req, res) => {
    // Assuming 'add-volunteer.html' is a Nunjucks template
    res.render('add-volunteer.html');
});

// Add volunteer to MySQL if record exists with volunteer_id, name, and foundation_id
router.post('/api/add-volunteer', async (req, res) => {
    const { volunteer_id, name, foundation_id } = req.body;

    if (!volunteer_id || !name || !foundation_id) {
        return res.status(400).send('Missing required fields for volunteer.');
    }

    try {
        const parsedVolunteerId = parseInt(volunteer_id, 10);
        const parsedFoundationId = parseInt(foundation_id, 10);

        if (isNaN(parsedVolunteerId) || isNaN(parsedFoundationId)) {
            return res.status(400).send('Invalid ID format for volunteer or foundation.');
        }

        // Check if volunteer already exists
        const [existing] = await pool.query(
            `SELECT * FROM volunteers WHERE volunteer_id = ?`,
            [parsedVolunteerId]
        );

        if (existing.length > 0) {
            return res.status(409).send('Volunteer ID already exists.');
        }

        // Insert new volunteer
        await pool.query(
            `INSERT INTO volunteers (volunteer_id, name, foundation_id, status)
             VALUES (?, ?, ?, 'inactive')`, // Default status to 'inactive' for manual addition
            [parsedVolunteerId, name, parsedFoundationId]
        );

        return res.redirect('/dashboard?success=Volunteer added successfully!'); // FIX: Return here

    } catch (err) {
        console.error('Error adding volunteer:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('Volunteer with this ID already exists (duplicate entry).');
        }
        return res.status(500).send('Internal Server Error: Failed to add volunteer.');
    }
});

// --- Foundations API Endpoint for Dropdown ---
router.get('/api/foundations/:district_name', async (req, res) => {
    const db = await dbPromise;
    const { district_name } = req.params;

    try {
        const district = await db.collection('districts').findOne({ name: district_name });
        if (!district) {
            return res.status(404).json({ error: 'District not found' });
        }

        const foundationIds = district.foundation_ids || [];
        if (foundationIds.length === 0) {
            return res.json([]);
        }

        // Use placeholders and pass array directly for IN clause
        const placeholders = foundationIds.map(() => '?').join(',');
        const [foundations] = await pool.query(
            `SELECT foundation_id, name FROM foundations WHERE foundation_id IN (${placeholders})`,
            foundationIds
        );

        return res.json(foundations);
    } catch (err) {
        console.error('Error fetching foundations:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Volunteers API Endpoint for Dropdown ---
router.get('/api/volunteers/:foundation_id', async (req, res) => {
    const { foundation_id } = req.params;

    if (!foundation_id) {
        return res.status(400).json({ error: 'Foundation ID is required' });
    }

    try {
        const [volunteers] = await pool.query(
            `SELECT volunteer_id, name FROM volunteers WHERE foundation_id = ? AND status = 'active'`,
            [foundation_id]
        );
        return res.json(volunteers);
    } catch (err) {
        console.error('Error fetching volunteers:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Event Manager Management Routes (Admin Addition) ---
// GET route to serve the HTML form for adding an event manager
router.get('/add-event-manager', (req, res) => {
    // Assuming 'add-eventManager.html' is a Nunjucks template
    res.render('add-eventManager.html');
});

// POST route to handle form submission for adding an event manager from a volunteer
router.post('/api/add-event-manager', async (req, res) => {
    const { volunteer_id } = req.body;

    if (!volunteer_id) {
        return res.status(400).send('Missing required field: volunteer_id');
    }

    try {
        const selectedVolunteerId = parseInt(volunteer_id, 10);
        if (isNaN(selectedVolunteerId)) {
            return res.status(400).send('Invalid volunteer ID format.');
        }

        // 1. Check if an event manager with this ID already exists
        const [existingManager] = await pool.query(
            `SELECT * FROM event_managers WHERE manager_id = ?`,
            [selectedVolunteerId]
        );

        if (existingManager.length > 0) {
            return res.status(409).send('An Event Manager with this ID already exists.');
        }

        // 2. Fetch all data for the selected volunteer
        const [volunteerRows] = await pool.query(
            `SELECT * FROM volunteers WHERE volunteer_id = ?`,
            [selectedVolunteerId]
        );

        if (volunteerRows.length === 0) {
            return res.status(404).send('Selected volunteer not found.');
        }
        const volunteer = volunteerRows[0];

        // 3. Insert the new event manager, copying relevant data
        // The manager_id will be the same as the volunteer_id
        await pool.query(
            `INSERT INTO event_managers (
                manager_id, name, foundation_id, status, photo_url, password_hash,
                aadhar_number, email, phone, alt_phone, address, bank_ifsc,
                bank_acc_no, reimbursement, education, education_description,
                created_at, updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                volunteer.volunteer_id,       // Use volunteer_id as manager_id
                volunteer.name,
                volunteer.foundation_id,
                volunteer.photo_url,
                volunteer.password_hash,
                volunteer.aadhar_number,
                volunteer.email,
                volunteer.phone,
                volunteer.alt_phone,
                volunteer.address,
                volunteer.bank_ifsc,
                volunteer.bank_acc_no,
                volunteer.salary,             // Map 'salary' from volunteer to 'reimbursement' for manager
                volunteer.education,
                volunteer.education_description
            ]
        );

        return res.redirect('/dashboard?success=Event Manager added successfully!');

    } catch (err) {
        console.error('Error adding event manager from volunteer:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('An Event Manager with this ID already exists (duplicate entry).');
        }
        return res.status(500).send('Internal Server Error: Failed to add event manager.');
    }
});


// --- Center Program Director Management Routes (Admin Addition) ---
// GET route to serve the HTML form for adding a director
router.get('/add-director', (req, res) => {
    res.render('add-director.html');
});

// POST route to handle form submission for adding a director
router.post('/api/add-director', async (req, res) => {
    const { director_id, name, foundation_id } = req.body;

    if (!director_id || !name || !foundation_id) {
        return res.status(400).send('Missing required fields: director_id, name, foundation_id');
    }

    try {
        const parsedDirectorId = parseInt(director_id, 10);
        const parsedFoundationId = parseInt(foundation_id, 10);

        if (isNaN(parsedDirectorId) || isNaN(parsedFoundationId)) {
            return res.status(400).send('Invalid ID format for director or foundation.');
        }

        // Check if director already exists
        const [existing] = await pool.query(
            `SELECT * FROM center_program_directors WHERE director_id = ?`,
            [parsedDirectorId]
        );

        if (existing.length > 0) {
            return res.status(409).send('Director ID already exists.');
        }

        // Insert new director record
        await pool.query(
            `INSERT INTO center_program_directors (director_id, name, foundation_id, status)
             VALUES (?, ?, ?, 'inactive')`, // Default status to 'inactive'
            [parsedDirectorId, name, parsedFoundationId]
        );

        return res.redirect('/dashboard?success=Director added successfully!');

    } catch (err) {
        console.error('Error adding director:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('Director with this ID already exists (duplicate entry).');
        }
        return res.status(500).send('Internal Server Error: Failed to add director.');
    }
});


// --- Center Program Coordinator Management Routes (Admin Addition) ---
// GET route to serve the HTML form for adding a coordinator
router.get('/add-coordinator', (req, res) => {
    res.render('add-coordinator.html');
});

// POST route to handle form submission for adding a coordinator from a volunteer
router.post('/api/add-coordinator', async (req, res) => {
    const { volunteer_id } = req.body;

    if (!volunteer_id) {
        return res.status(400).send('Missing required field: volunteer_id');
    }

    try {
        const selectedVolunteerId = parseInt(volunteer_id, 10);
        if (isNaN(selectedVolunteerId)) {
            return res.status(400).send('Invalid volunteer ID format.');
        }

        // 1. Check if a coordinator with this ID already exists
        const [existingCoordinator] = await pool.query(
            `SELECT * FROM center_program_coordinators WHERE coordinator_id = ?`,
            [selectedVolunteerId]
        );

        if (existingCoordinator.length > 0) {
            return res.status(409).send('A Coordinator with this ID already exists.');
        }

        // 2. Fetch all data for the selected volunteer
        const [volunteerRows] = await pool.query(
            `SELECT * FROM volunteers WHERE volunteer_id = ?`,
            [selectedVolunteerId]
        );

        if (volunteerRows.length === 0) {
            return res.status(404).send('Selected volunteer not found.');
        }
        const volunteer = volunteerRows[0];

        // 3. Insert the new coordinator, copying relevant data
        await pool.query(
            `INSERT INTO center_program_coordinators (
                coordinator_id, name, foundation_id, status, photo_url, password_hash,
                aadhar_number, email, phone, alt_phone, address, bank_ifsc,
                bank_acc_no, reimbursement, education, education_description,
                created_at, updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                volunteer.volunteer_id,       // Use volunteer_id as coordinator_id
                volunteer.name,
                volunteer.foundation_id,
                volunteer.photo_url,
                volunteer.password_hash,
                volunteer.aadhar_number,
                volunteer.email,
                volunteer.phone,
                volunteer.alt_phone,
                volunteer.address,
                volunteer.bank_ifsc,
                volunteer.bank_acc_no,
                volunteer.salary,             // Map 'salary' to 'reimbursement'
                volunteer.education,
                volunteer.education_description
            ]
        );

        return res.redirect('/dashboard?success=Coordinator added successfully!');

    } catch (err) {
        console.error('Error adding coordinator from volunteer:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('A Coordinator with this ID already exists (duplicate entry).');
        }
        return res.status(500).send('Internal Server Error: Failed to add coordinator.');
    }
});

module.exports = router;