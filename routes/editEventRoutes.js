const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const dbPromise = require('../config/mongo');
const { authenticateJWT, authorizeEventManager } = require('../middleware/authJwt');

const router = express.Router();

// --- GCS & Multer Configuration ---
const BUCKET_NAME = process.env.BUCKET1; // Your GCS bucket name
const gcs = new Storage();
const bucket = gcs.bucket(BUCKET_NAME);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
}).any(); // .any() is crucial for handling a mix of files with varying field names

// --- Helper Functions ---
const formatDateForInput = (date) => {
    if (!date) return '';
    // Ensure date is a Date object if it's coming from MongoDB as ISODate
    const d = new Date(date);
    return d.toISOString().split('T')[0];
};

const deleteGcsFile = async (fileUrl) => {
    if (!fileUrl || !fileUrl.includes(BUCKET_NAME)) {
        // Not a GCS URL from our bucket, or invalid URL, do nothing
        return;
    }
    try {
        const fileName = fileUrl.split(`${BUCKET_NAME}/`)[1];
        if (fileName) {
            const file = bucket.file(fileName);
            const [exists] = await file.exists(); // Check if the file actually exists
            if (exists) {
                await file.delete();
                console.log(`Successfully deleted GCS file: ${fileName}`);
            } else {
                console.warn(`GCS file not found for deletion (may have been deleted already or never existed): ${fileName}`);
            }
        }
    } catch (err) {
        // Differentiate between "not found" (404) and other errors
        if (err.code === 404) {
            console.warn(`Failed to delete GCS file ${fileUrl}: Object not found. (Likely already removed)`);
        } else {
            console.error(`Failed to delete GCS file ${fileUrl} (unexpected error):`, err.message);
        }
    }
};

// --- GET Route to Select Event ---
router.get('/:manager_id/select', authenticateJWT, authorizeEventManager, async (req, res) => {
    try {
        const managerId = parseInt(req.params.manager_id, 10);
        const db = await dbPromise;

        // Fetch events owned by the specific manager
        const eventsPromise = db.collection('events').find(
            { manager_id: managerId }, 
            { projection: { event_type: 1, date: 1 } }
        ).sort({ date: -1 }).toArray();

        // ## CORRECTED: Fetch ALL sci-fair events, not just those owned by the manager ##
        const sciFairPromise = db.collection('sci-fair').find(
            {}, // Empty filter fetches all documents
            { projection: { event_type: 1, date: 1 } }
        ).sort({ date: -1 }).toArray();
        
        const [standardEvents, sciFairs] = await Promise.all([eventsPromise, sciFairPromise]);
        
        standardEvents.forEach(e => e.collectionType = 'events');
        sciFairs.forEach(e => e.collectionType = 'sci-fair');
        
        const allEvents = [...standardEvents, ...sciFairs].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.render('select-event-to-edit.html', { 
            events: allEvents, 
            managerId: managerId,
            formatDate: (date) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            currentYear: new Date().getFullYear() 
        });
    } catch (err) {
        console.error("Error fetching events for edit list:", err);
        res.status(500).send("Server error.");
    }
});

// --- GET Route to Render Edit Form ---
router.get('/:manager_id/edit/:collectionType/:eventId', authenticateJWT, authorizeEventManager, async (req, res) => {
    const { manager_id, collectionType, eventId } = req.params;
    if (!['events', 'sci-fair'].includes(collectionType)) return res.status(400).send("Invalid event category.");
    if (!ObjectId.isValid(eventId)) return res.status(400).send("Invalid event ID format.");

    try {
        const db = await dbPromise;
        const event = await db.collection(collectionType).findOne({ _id: new ObjectId(eventId) });
        if (!event) return res.status(404).send("Event not found.");
        if (event.manager_id !== parseInt(manager_id, 10) && collectionType !== 'sci-fair' ) return res.status(403).send("Access Denied.");

        res.render('edit-event-form.html', { 
            event, 
            eventJSON: JSON.stringify(event), // Pass the stringified event for the script
            managerId: manager_id, 
            collectionType: collectionType,
            formatDate: formatDateForInput
        });
    } catch (err) {
        console.error("Error fetching event for edit:", err);
        res.status(500).send("Server error.");
    }
});


// --- POST Route to Update Event ---
router.post('/:manager_id/update/:collectionType/:eventId', authenticateJWT, authorizeEventManager, upload, async (req, res) => {
    const { manager_id, collectionType, eventId } = req.params;
    const newFiles = req.files; // Array of newly uploaded files from Multer
    let newlyUploadedUrls = []; // Keep track of URLs uploaded in this request for rollback

    try {
        const db = await dbPromise;
        const originalEvent = await db.collection(collectionType).findOne({ _id: new ObjectId(eventId) });
        if (!originalEvent) throw new Error("Event not found.");
        if (originalEvent.event_type !== 'Science Fair' && originalEvent.manager_id !== parseInt(manager_id, 10)) {
            throw new Error("Authorization failed: You do not have permission to update this event.");
        }
        const eventData = req.body; // Form fields (excluding files, but including existing photo URLs as strings)

        // 1. Upload new files and create a map of their URLs
        const fileMap = new Map(); // Maps Multer fieldname to its GCS URL
        if (newFiles && newFiles.length > 0) {
            const uploadPromises = newFiles.map(file => {
                // Multer fieldname can be something like 'general_photos', 'class_data_photo_file[0]'
                const newFilename = `events/${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`;
                const blob = bucket.file(newFilename);
                const blobStream = blob.createWriteStream({ resumable: false });
                const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${newFilename}`;
                
                return new Promise((resolve, reject) => {
                    blobStream.on('error', (err) => {
                        console.error(`GCS upload stream error for ${file.fieldname}:`, err);
                        reject(err);
                    });
                    blobStream.on('finish', () => {
                        newlyUploadedUrls.push(publicUrl); // Add to rollback list
                        resolve({ fieldname: file.fieldname, url: publicUrl });
                    });
                    blobStream.end(file.buffer);
                });
            });
            const uploadedFileInfo = await Promise.all(uploadPromises);
            uploadedFileInfo.forEach(info => fileMap.set(info.fieldname, info.url));
        }
        
        // 2. Rebuild the final event object from form data
        const updatePayload = {
            date: eventData.date,
            time: eventData.time,
            description: eventData.description,
        };

        // General Photos: Combine kept old photos with newly uploaded ones
        // `eventData.existing_general_photos` can be a string, an array, or undefined.
        const keptGeneralPhotos = Array.isArray(eventData.existing_general_photos)
            ? eventData.existing_general_photos
            : (eventData.existing_general_photos ? [eventData.existing_general_photos] : []);

        updatePayload.photos = [...keptGeneralPhotos];
        // Add new general photos. Multer gives 'general_photos' as fieldname if uploaded
        const newGeneralFiles = newFiles.filter(f => f.fieldname === 'general_photos');
        newGeneralFiles.forEach(file => {
             // For multiple files with the same fieldname, Multer usually keeps the fieldname
             // as is, and `fileMap.get(file.fieldname)` will retrieve the correct URL.
             // If general_photos was array on form, Multer gives file.fieldname = "general_photos"
             // if general_photos was `general_photos[0]` etc, Multer gives file.fieldname = "general_photos[0]"
             // We need to iterate through newFiles and add the general ones based on their fieldname
            const url = fileMap.get(file.fieldname); // This would be the last one if multiple share same fieldname
            if (url) updatePayload.photos.push(url);
        });

        // Helper to rebuild a dynamic array of objects (like class_data, paintings, etc.)
        // It correctly handles new photo uploads and existing photo URLs.
        const rebuildNestedArray = (baseFieldName, photoFieldNamePrefix, photoUrlKey) => {
            const newArr = [];
            // Multer's body-parser automatically parses array fields from HTML names like `baseFieldName[index][prop]`
            const items = eventData[baseFieldName]; 
            
            if (items) {
                // Ensure items is always an array, even if only one item was submitted (Multer can send single object)
                const itemArray = Array.isArray(items) ? items : [items];

                itemArray.forEach((item, index) => {
                    const newItem = { ...item }; // Start with existing data for this item

                    // Find the newly uploaded photo for this specific item/index
                    // Multer's fieldname matches the `name` attribute from the frontend, e.g., 'class_data_photo_file[0]'
                    const uploadedPhoto = newFiles.find(f => f.fieldname === `${photoFieldNamePrefix}[${index}]`);
                    
                    if (uploadedPhoto) {
                        // If a new photo was uploaded, use its URL
                        newItem[photoUrlKey] = fileMap.get(uploadedPhoto.fieldname);
                    } else if (item[`${photoUrlKey}_existing`]) {
                        // If no new photo, but an existing URL was passed from frontend, keep it
                        newItem[photoUrlKey] = item[`${photoUrlKey}_existing`];
                    } else {
                        // If neither new photo nor existing URL, set to null
                        newItem[photoUrlKey] = null;
                    }

                    // Remove the temporary `_existing` URL field that came from frontend, as it's not part of schema
                    delete newItem[`${photoUrlKey}_existing`];

                    newArr.push(newItem);
                });
            }
            return newArr;
        };

        // Reconstruct all dynamic blocks with their correct photo keys
        updatePayload.class_data = rebuildNestedArray('class_data', 'class_data_photo_file', 'class_photo_url');
        updatePayload.paintings = rebuildNestedArray('paintings', 'paintings_image_file', 'image_url');
        updatePayload.workshop_experiments = rebuildNestedArray('workshop_experiments', 'workshop_experiments_photo_file', 'photo_url');
        updatePayload.winners = rebuildNestedArray('winners', 'winners_photo_file', 'winner_photo_url'); // This one for science fair

        // Handle event-specific top-level fields
        if (collectionType === 'sci-fair') {
            updatePayload.location = eventData.location;
            updatePayload.total_students_present = parseInt(eventData.total_students_present, 10) || 0;
            updatePayload.total_boys_present = parseInt(eventData.total_boys_present, 10) || 0;
            updatePayload.total_girls_present = parseInt(eventData.total_girls_present, 10) || 0;
            updatePayload.number_of_teachers = parseInt(eventData.number_of_teachers, 10) || 0;

            // `participating_schools` is a complex nested array from frontend, assuming Multer parses it well
            updatePayload.participating_schools = eventData.participating_schools || [];
            
            // Further processing for nested arrays within participating_schools for student_names
            if (Array.isArray(updatePayload.participating_schools)) {
                updatePayload.participating_schools.forEach(school => {
                    if (Array.isArray(school.experiments)) {
                        school.experiments.forEach(exp => {
                            if (typeof exp.student_names === 'string') {
                                exp.student_names = exp.student_names.split(',').map(s => s.trim()).filter(Boolean);
                            }
                            // Important: If original_id from frontend is empty string, convert to undefined/null for MongoDB
                            if (exp.original_id === '') delete exp.original_id; // Remove if not an existing ID
                        });
                    }
                     // Important: If original_id from frontend is empty string, convert to undefined/null for MongoDB
                     if (school.original_id === '') delete school.original_id; // Remove if not an existing ID
                });
            }

            // Ensure winners' student_names are correctly parsed into arrays
            if (Array.isArray(updatePayload.winners)) {
                updatePayload.winners.forEach(winner => {
                    if (typeof winner.student_names === 'string') {
                        winner.student_names = winner.student_names.split(',').map(s => s.trim()).filter(Boolean);
                    }
                    // Important: If original_id from frontend is empty string, convert to undefined/null for MongoDB
                    if (winner.original_id === '') delete winner.original_id; // Remove if not an existing ID
                });
            }

        } else { // Standard events (Karate, Painting, Recitation, Weekly Science Workshop)
            updatePayload.total_students_present = parseInt(eventData.total_students_present, 10) || 0;
            updatePayload.total_boys_present = parseInt(eventData.total_boys_present, 10) || 0;
            updatePayload.total_girls_present = parseInt(eventData.total_girls_present, 10) || 0;
            updatePayload.teacher_name = eventData.teacher_name;
            
            // Recitation names are sent as a comma-separated string from the top-level textarea
            if (eventData.recitation_names_top_level) {
                updatePayload.recitation_names = eventData.recitation_names_top_level.split(',').map(s => s.trim()).filter(Boolean);
            } else {
                updatePayload.recitation_names = []; // Ensure it's an empty array if not present
            }
            
            // For other nested arrays, ensure original_id is handled
            if (Array.isArray(updatePayload.class_data)) {
                updatePayload.class_data.forEach(item => {
                    if (item.original_id === '') delete item.original_id;
                });
            }
            if (Array.isArray(updatePayload.paintings)) {
                updatePayload.paintings.forEach(item => {
                    if (item.original_id === '') delete item.original_id;
                });
            }
            if (Array.isArray(updatePayload.workshop_experiments)) {
                updatePayload.workshop_experiments.forEach(item => {
                    if (item.original_id === '') delete item.original_id;
                });
            }
        }
        
        // 3. Identify and delete orphaned photos from GCS
        // Logic to get all current URLs from the ORIGINAL event object
        const getAllOldUrlsFromOriginalEvent = (eventObj) => {
            let urls = [];
            if (eventObj.photos) urls = urls.concat(eventObj.photos);
            if (eventObj.class_data) eventObj.class_data.forEach(item => { if (item.class_photo_url) urls.push(item.class_photo_url); });
            if (eventObj.paintings) eventObj.paintings.forEach(item => { if (item.image_url) urls.push(item.image_url); });
            if (eventObj.workshop_experiments) eventObj.workshop_experiments.forEach(item => { if (item.photo_url) urls.push(item.photo_url); });
            if (eventObj.winners) eventObj.winners.forEach(item => { if (item.winner_photo_url) urls.push(item.winner_photo_url); });
            return urls.filter(Boolean); // Filter out any null/undefined
        };
        
        // Logic to get all URLs present in the NEW `updatePayload` (including newly uploaded)
        const getAllNewUrlsFromPayload = (payload) => {
            let urls = [];
            if (payload.photos) urls = urls.concat(payload.photos);
            if (payload.class_data) payload.class_data.forEach(item => { if (item.class_photo_url) urls.push(item.class_photo_url); });
            if (payload.paintings) payload.paintings.forEach(item => { if (item.image_url) urls.push(item.image_url); });
            if (payload.workshop_experiments) payload.workshop_experiments.forEach(item => { if (item.photo_url) urls.push(item.photo_url); });
            if (payload.winners) payload.winners.forEach(item => { if (item.winner_photo_url) urls.push(item.winner_photo_url); });
            return urls.filter(Boolean); // Filter out any null/undefined
        };

        const allOldUrls = new Set(getAllOldUrlsFromOriginalEvent(originalEvent));
        const allNewUrlsInPayload = new Set(getAllNewUrlsFromPayload(updatePayload));
        
        // URLs from the original event that are no longer in the new payload.
        // This includes photos explicitly removed (from frontend JS arrays like `removedGeneralPhotoUrls`
        // or `removedNestedPhotoUrls`), and photos implicitly removed by being replaced.
        const photosToDelete = [];

        // Add URLs from `removedGeneralPhotoUrls` that the user explicitly removed
        // These URLs are NOT part of `updatePayload.photos` anymore
        const removedGeneralPhotos = Array.isArray(eventData.removed_general_photos)
            ? eventData.removed_general_photos
            : (eventData.removed_general_photos ? [eventData.removed_general_photos] : []);
        photosToDelete.push(...removedGeneralPhotos);

        // Add URLs from `removedNestedPhotoUrls` that the user explicitly removed
        if (eventData.removed_nested_photos) {
            for (const type in eventData.removed_nested_photos) {
                const urls = Array.isArray(eventData.removed_nested_photos[type]) ? eventData.removed_nested_photos[type] : [eventData.removed_nested_photos[type]];
                photosToDelete.push(...urls);
            }
        }
        
        // Add URLs that were in the original event but are neither in the new payload nor explicitly marked as removed
        // This catches photos replaced by new uploads or belonging to entirely removed dynamic blocks
        allOldUrls.forEach(oldUrl => {
            if (!allNewUrlsInPayload.has(oldUrl) && 
                !photosToDelete.includes(oldUrl)) { // Avoid duplicating if already marked for explicit removal
                photosToDelete.push(oldUrl);
            }
        });

        if (photosToDelete.length > 0) {
            // Delete all identified orphaned/removed photos in parallel
            await Promise.all(photosToDelete.map(url => deleteGcsFile(url)));
        }

        // 4. Execute the database update
        updatePayload.updated_at = new Date();
        await db.collection(collectionType).updateOne({ _id: new ObjectId(eventId) }, { $set: updatePayload });

        res.redirect(`/event-manager-dashboard/${manager_id}/dashboard?success=Event updated successfully!`);

    } catch (err) {
        // If an error occurs during update, delete any newly uploaded files to prevent orphans
        if (newlyUploadedUrls.length > 0) {
            console.warn("Attempting to rollback newly uploaded files due to update error.");
            await Promise.all(newlyUploadedUrls.map(url => deleteGcsFile(url)));
        }
        console.error(`Error updating event ${eventId}:`, err);
        res.status(500).send("Failed to update event.");
    }
});

// --- POST Route to Delete Event ---
router.post('/:manager_id/delete/:collectionType/:eventId', authenticateJWT, authorizeEventManager, async (req, res) => {
    const { manager_id, collectionType, eventId } = req.params;
    try {
        const db = await dbPromise;
        const event = await db.collection(collectionType).findOne({ _id: new ObjectId(eventId) });
        if (!event) return res.status(404).send("Event not found.");
        if (event.manager_id !== parseInt(manager_id, 10)) return res.status(403).send("Access Denied.");
        
        // Helper to get all photo URLs from an event object for deletion
        const getUrlsForDeletion = (eventObj) => {
            let urls = [];
            if (eventObj.photos) urls = urls.concat(eventObj.photos);
            if (eventObj.class_data) eventObj.class_data.forEach(item => { if (item.class_photo_url) urls.push(item.class_photo_url); });
            if (eventObj.paintings) eventObj.paintings.forEach(item => { if (item.image_url) urls.push(item.image_url); });
            if (eventObj.workshop_experiments) eventObj.workshop_experiments.forEach(item => { if (item.photo_url) urls.push(item.photo_url); });
            if (eventObj.winners) eventObj.winners.forEach(item => { if (item.winner_photo_url) urls.push(item.winner_photo_url); });
            return urls.filter(Boolean);
        };

        const photosToDelete = getUrlsForDeletion(event);

        if (photosToDelete.length > 0) {
            await Promise.all(photosToDelete.map(url => deleteGcsFile(url)));
        }
        await db.collection(collectionType).deleteOne({ _id: new ObjectId(eventId) });
        res.redirect(`/event-manager-dashboard/${manager_id}/dashboard?success=Event deleted successfully.`);
    } catch (err) {
        console.error(`Error deleting event ${eventId}:`, err);
        res.status(500).send("Failed to delete event.");
    }
});

module.exports = router;