const express = require('express');
const path = require('path');
const dbPromise = require('../config/mongo'); // Your MongoDB connection promise
const pool = require('../config/db');      // Your MySQL connection pool
const multer = require('multer');          // For handling multipart/form-data
const { Storage } = require('@google-cloud/storage'); // Official Google Cloud Storage client

const { authenticateJWT, authorizeEventManager } = require('../middleware/authJwt');

const router = express.Router();

// --- Google Cloud Storage & Multer Configuration ---

const BUCKET_NAME = process.env.BUCKET1; // Your actual GCS bucket name

const storage = new Storage(); // Automatically uses GOOGLE_APPLICATION_CREDENTIALS
const bucket = storage.bucket(BUCKET_NAME);

// Use multer's memory storage engine to handle the file as a buffer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // Limit file size to 10MB
    },
}).any();


// --- Helper function to delete files from GCS on error ---
const deleteGCSFiles = async (files) => {
    if (!files || files.length === 0) return;
    console.log(`Cleaning up ${files.length} uploaded files from GCS due to an error.`);
    for (const file of files) {
        const gcsFileName = file.filename; 
        try {
            await bucket.file(gcsFileName).delete();
        } catch (err) {
            console.error(`Failed to delete GCS file ${gcsFileName}:`, err);
        }
    }
};

// --- Event Data Routes ---

// GET routes
router.get('/:manager_id/add-event', authenticateJWT, authorizeEventManager, (req, res) => {
    const managerIdFromURL = parseInt(req.params.manager_id, 10);
    const authenticatedManagerId = parseInt(req.user.id, 10);
    if (managerIdFromURL !== authenticatedManagerId && req.user.role !== 'admin') {
        return res.status(403).send('Access denied.');
    }
    res.render('event-choice.html', { managerId: authenticatedManagerId });
});

router.get('/:manager_id/add-event-form', authenticateJWT, authorizeEventManager, (req, res) => {
    const managerIdFromURL = parseInt(req.params.manager_id, 10);
    const authenticatedManagerId = parseInt(req.user.id, 10);
    if (managerIdFromURL !== authenticatedManagerId && req.user.role !== 'admin') {
        return res.status(403).send('Access denied.');
    }
    res.render('add-event-form.html', { managerId: authenticatedManagerId });
});


// POST route to handle all form submissions
router.post('/:manager_id/api/add-event-data', authenticateJWT, authorizeEventManager, upload, async (req, res) => {
    const db = await dbPromise;
    const eventData = req.body;
    const filesToUpload = req.files;
    let uploadedFileNames = []; // To keep track of files for cleanup on error

    try {
        const managerId = parseInt(req.user.id, 10);
        if (parseInt(req.params.manager_id, 10) !== managerId) {
            throw new Error('Access Denied: URL parameter does not match authenticated user.');
        }

        // --- Manually upload files from memory to GCS ---
        if (filesToUpload && filesToUpload.length > 0) {
            const uploadPromises = filesToUpload.map(file => {
                const ext = path.extname(file.originalname);
                const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
                const newFilename = `events/${file.fieldname}-${uniqueSuffix}${ext}`;
                const blob = bucket.file(newFilename);
                const blobStream = blob.createWriteStream({ resumable: false });
                return new Promise((resolve, reject) => {
                    blobStream.on('error', err => reject(err));
                    blobStream.on('finish', () => resolve({ fieldname: file.fieldname, filename: newFilename }));
                    blobStream.end(file.buffer);
                });
            });

            const uploadedFilesInfo = await Promise.all(uploadPromises);
            uploadedFileNames = uploadedFilesInfo; 
            
            // --- Associate Files with Parsed JSON Data ---
            const publicUrlBase = `https://storage.googleapis.com/${BUCKET_NAME}/`;
            const fileMap = new Map(uploadedFilesInfo.map(f => [f.fieldname, publicUrlBase + f.filename]));

            eventData.photos = uploadedFilesInfo
                .filter(f => f.fieldname === 'general_photos')
                .map(f => publicUrlBase + f.filename);

            if (eventData.class_data_json) {
                eventData.class_data = JSON.parse(eventData.class_data_json);
                eventData.class_data.forEach((data, index) => {
                    const photoUrl = fileMap.get(`class_photos_${index}`);
                    if (photoUrl) data.class_photo_url = photoUrl;
                });
            }
            if (eventData.paintings_json) {
                eventData.paintings = JSON.parse(eventData.paintings_json);
                eventData.paintings.forEach((painting) => {
                    const photoUrl = fileMap.get(painting.image_key);
                    if (photoUrl) painting.image_url = photoUrl;
                });
            }
            if (eventData.workshop_experiments_json) {
                eventData.workshop_experiments = JSON.parse(eventData.workshop_experiments_json);
                eventData.workshop_experiments.forEach((exp) => {
                    const photoUrl = fileMap.get(exp.photo_key);
                    if (photoUrl) exp.photo_url = photoUrl;
                });
            }
            // ** THIS IS THE CORRECTED BLOCK TO HANDLE WINNER PHOTOS **
            if (eventData.winners_json) {
                eventData.winners = JSON.parse(eventData.winners_json);
                eventData.winners.forEach((winner) => {
                    const photoUrl = fileMap.get(winner.photo_key);
                    if (photoUrl) winner.winner_photo_url = photoUrl;
                });
            }
        }
        
        // Parse any remaining JSON fields that didn't have photos associated
        if (!eventData.class_data && eventData.class_data_json) eventData.class_data = JSON.parse(eventData.class_data_json);
        if (!eventData.paintings && eventData.paintings_json) eventData.paintings = JSON.parse(eventData.paintings_json);
        if (!eventData.workshop_experiments && eventData.workshop_experiments_json) eventData.workshop_experiments = JSON.parse(eventData.workshop_experiments_json);
        if (!eventData.winners && eventData.winners_json) eventData.winners = JSON.parse(eventData.winners_json);
        if (eventData.participating_schools_json) eventData.participating_schools = JSON.parse(eventData.participating_schools_json);

        // Clean up raw JSON fields from the body
        delete eventData.class_data_json;
        delete eventData.participating_schools_json;
        delete eventData.winners_json;
        delete eventData.paintings_json;
        delete eventData.workshop_experiments_json;
        
        // --- Validation and Final Data Prep ---
        if (!eventData.event_type || !eventData.date || !eventData.time) {
            throw new Error('Missing essential event details (event type, date, or time).');
        }

        const [managerRows] = await pool.query('SELECT foundation_id FROM event_managers WHERE manager_id = ? LIMIT 1', [managerId]);
        if (managerRows.length === 0) throw new Error('Authenticated manager not found.');

        eventData.manager_id = managerId;
        eventData.foundation_id = managerRows[0].foundation_id;
        eventData.created_at = new Date();

        // --- Route to the correct DB handler based on Event Type ---
        if (eventData.event_type === 'Science Fair') {
            await handleScienceFair(db, eventData, res);
        } else if (['Painting', 'Weekly Science Workshop'].includes(eventData.event_type)) {
            await handleUniqueEvent(db, eventData, res);
        } else {
            await handleUpdatableEvent(db, eventData, res);
        }

    } catch (err) {
        console.error('Error in add-event-data route:', err.message, err);
        await deleteGCSFiles(uploadedFileNames);
        res.status(500).send(err.message || 'Internal Server Error while adding event data.');
    }
});


// --- Database Handlers (These do not need changes) ---

async function handleScienceFair(db, eventData, res) {
    const newSciFairEvent = {
        event_type: "Science Fair",
        date: eventData.date,
        time: eventData.time,
        location: eventData.location,
        description: eventData.description,
        photos: eventData.photos || [],
        total_students_present: parseInt(eventData.sf_total_students_present, 10) || 0,
        total_boys_present: parseInt(eventData.sf_total_boys_present, 10) || 0,
        total_girls_present: parseInt(eventData.sf_total_girls_present, 10) || 0,
        number_of_teachers: parseInt(eventData.number_of_teachers, 10) || 0,
        participating_schools: eventData.participating_schools || [],
        winners: eventData.winners || [],
        manager_id: eventData.manager_id,
        foundation_id: eventData.foundation_id,
        created_at: eventData.created_at,
    };
    const result = await db.collection('sci-fair').insertOne(newSciFairEvent);
    if (!result.acknowledged) throw new Error('Failed to insert Science Fair data.');
    res.status(200).send('Science Fair data added successfully!');
}

async function handleUniqueEvent(db, eventData, res) {
    const baseEvent = {
        date: eventData.date,
        time: eventData.time,
        description: eventData.description,
        photos: eventData.photos || [],
        total_students_present: parseInt(eventData.total_students_present, 10) || 0,
        total_boys_present: parseInt(eventData.total_boys_present, 10) || 0,
        total_girls_present: parseInt(eventData.total_girls_present, 10) || 0,
        teacher_name: eventData.teacher_name,
        manager_id: eventData.manager_id,
        foundation_id: eventData.foundation_id,
        created_at: eventData.created_at,
    };
    let newEvent;
    if (eventData.event_type === 'Painting') {
        newEvent = { ...baseEvent, event_type: 'Painting', paintings: eventData.paintings || [] };
    } else if (eventData.event_type === 'Weekly Science Workshop') {
        newEvent = { ...baseEvent, event_type: 'Weekly Science Workshop', workshop_experiments: eventData.workshop_experiments || [] };
    } else {
        throw new Error("Invalid event type for unique handling.");
    }
    const result = await db.collection('events').insertOne(newEvent);
    if (!result.acknowledged) throw new Error('Failed to insert new event data.');
    res.status(200).send('New event data added successfully!');
}

async function handleUpdatableEvent(db, eventData, res) {
    const existingEvent = await db.collection('events').findOne({
        foundation_id: eventData.foundation_id,
        date: eventData.date,
        event_type: eventData.event_type
    });
    if (existingEvent) {
        const newClassData = eventData.class_data || [];
        const mergedClassData = existingEvent.class_data || [];
        newClassData.forEach(newClass => {
            const existingClassIndex = mergedClassData.findIndex(
                existingClass => existingClass.class_standard === newClass.class_standard
            );
            if (existingClassIndex !== -1) {
                mergedClassData[existingClassIndex] = newClass;
            } else {
                mergedClassData.push(newClass);
            }
        });
        const updates = {
            $set: { updated_at: new Date(), class_data: mergedClassData },
            $addToSet: { photos: { $each: eventData.photos || [] } }
        };
        if (eventData.description) {
            updates.$set.description = eventData.description;
        }
        if (eventData.event_type === 'Recitation' && eventData.recitation_names) {
            const newNames = eventData.recitation_names.split(',').map(s => s.trim()).filter(Boolean);
            const existingNames = existingEvent.recitation_names || [];
            const allNames = Array.from(new Set([...existingNames, ...newNames]));
            updates.$set.recitation_names = allNames;
        }
        await db.collection('events').updateOne({ _id: existingEvent._id }, updates);
        res.status(200).send('Event data updated successfully.');
    } else {
        const newStandardEvent = {
            event_type: eventData.event_type,
            date: eventData.date,
            time: eventData.time,
            description: eventData.description,
            photos: eventData.photos || [],
            total_students_present: parseInt(eventData.total_students_present, 10) || 0,
            total_boys_present: parseInt(eventData.total_boys_present, 10) || 0,
            total_girls_present: parseInt(eventData.total_girls_present, 10) || 0,
            teacher_name: eventData.teacher_name,
            class_data: eventData.class_data || [],
            ...(eventData.event_type === 'Recitation' && { recitation_names: eventData.recitation_names.split(',').map(s => s.trim()).filter(Boolean) }),
            manager_id: eventData.manager_id,
            foundation_id: eventData.foundation_id,
            created_at: eventData.created_at,
        };
        const result = await db.collection('events').insertOne(newStandardEvent);
        if (!result.acknowledged) throw new Error('Failed to insert new event data.');
        res.status(200).send('New event data added successfully!');
    }
}

module.exports = router;