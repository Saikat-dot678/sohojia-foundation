// routes/districts.js

const express = require('express');
const router  = express.Router();

// MySQL pool (exports a mysql2/promise pool)
const Pool = require('../config/db');

// MongoDB connection promise (resolves to a Db instance)
const dbPromise = require('../config/mongo');

router.get('/:name', async (req, res) => {
  try {
    // 1) Await the MongoDB database
    const mongoDb = await dbPromise;

    // 2) Look up the district document by name
    const districtDoc = await mongoDb
      .collection('districts')
      .findOne({ name: req.params.name });

    if (!districtDoc) {
      return res.status(404).send('District not found');
    }

    // 3) Extract foundation IDs array
    const ids = Array.isArray(districtDoc.foundation_ids)
      ? districtDoc.foundation_ids
      : [];

    // 4) If there are no foundation IDs, render an empty list
    if (ids.length === 0) {
      return res.render('district-foundations', {
        district: { name: req.params.name, foundations: [] }
      });
    }

    // 5) Build SQL placeholders like "?, ?, ?"
    const placeholders = ids.map(() => '?').join(',');

    // 6) Query MySQL for those foundation records
    const [foundations] = await Pool.query(
      `
      SELECT
        foundation_id AS id,
        name,
        student_count,
        volunteer_count
      FROM foundations
      WHERE foundation_id IN (${placeholders})
      `,
      ids
    );

    // 7) Render the Nunjucks template with the results
    return res.render('district-foundation', {
      district: {
        name: req.params.name,
        foundations
      }
    });

  } catch (err) {
    console.error('Error in GET /districts/:name:', err);
    return res.status(500).send(`Server error: ${err.message}`);
  }
});

module.exports = router;
