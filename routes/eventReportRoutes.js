const express = require('express');
const { ObjectId } = require('mongodb'); // Used for _id, though not in find() for strings
const dbPromise = require('../config/mongo'); // Your MongoDB connection promise

const router = express.Router();

// This middleware is REMOVED from here.
// formatDateHelper is now added globally in app.js using env.addGlobal.
/*
router.use((req, res, next) => {
    res.locals.formatDateHelper = (date) => { ... };
    next();
});
*/

// A single, powerful route to handle all event reporting
// Accessible at /events/report
router.get('/report', async (req, res) => {
    try {
        const db = await dbPromise; // Get MongoDB database instance
        const { type, range } = req.query; // Filters from frontend query parameters

        // 1. Get a distinct list of all available event types for the filter dropdowns
        const eventTypesPromise = db.collection('events').distinct('event_type');
        // Efficiently check if 'sci-fair' collection has any documents to determine if 'Science Fair' is a valid type
        const sciFairCheckPromise = db.collection('sci-fair').findOne({}, { projection: { _id: 1 } }); 

        const [standardTypes, sciFairDoc] = await Promise.all([eventTypesPromise, sciFairCheckPromise]);

        let allEventTypes = [...standardTypes];
        // Ensure 'Science Fair' is an option if any documents exist in its collection
        if (sciFairDoc) {
            if (!allEventTypes.includes("Science Fair")) { // Avoid duplicates
                allEventTypes.push("Science Fair");
            }
        }
        allEventTypes.sort(); // Sort alphabetically for a clean UI dropdown
        
        let events = [];
        if (type) { // Only fetch events if an event 'type' filter is provided
            // 2. Build the MongoDB query object
            const query = { event_type: type }; // Start with the event type filter
            
            // 3. Add time range filter to the query
            if (range && range !== 'all') {
                const now = new Date();
                let startDate;

                // Calculate startDate based on the selected range filter
                switch (range) {
                    case '1m': startDate = new Date(now.setMonth(now.getMonth() - 1)); break;
                    case '3m': startDate = new Date(now.setMonth(now.getMonth() - 3)); break;
                    case '6m': startDate = new Date(now.setMonth(now.getMonth() - 6)); break;
                    case '1y': startDate = new Date(now.setFullYear(now.getFullYear() - 1)); break;
                    default: startDate = null; // Fallback for invalid/unrecognized range values
                }

                if (startDate) {
                    // Dates in your DB are stored as 'YYYY-MM-DD' strings.
                    // For $gte queries to work correctly on string dates, the comparison value
                    // must also be a 'YYYY-MM-DD' string. Lexicographical comparison works for this format.
                    query.date = { $gte: startDate.toISOString().split('T')[0] };
                }
            }

            // 4. Query the correct MongoDB collection based on the selected event type
            if (type === 'Science Fair') {
                events = await db.collection('sci-fair').find(query).sort({ date: -1 }).toArray();
            } else {
                events = await db.collection('events').find(query).sort({ date: -1 }).toArray();
            }
        }
        
        // 5. Render the event report page with the fetched data and filter selections
        res.render('event-report.html', { // Render the main report template
            eventTypes: allEventTypes,
            selectedType: type || '', // Pass the selected type (or empty string if none) for filter UI
            selectedRange: range || 'all', // Pass the selected range (or 'all' if none) for filter UI
            events: events, // The array of events to display
            currentYear: new Date().getFullYear() // For the footer copyright year
            // formatDateHelper and safeJoin are available globally via Nunjucks `env.addGlobal`, so no need to pass them here
        });

    } catch (err) {
        console.error("Error fetching event report:", err);
        // Respond with an error status and message to the client
        res.status(500).send("Error loading report page. Please try again later.");
    }
});

module.exports = router;
