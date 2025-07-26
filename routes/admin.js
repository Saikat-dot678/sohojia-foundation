// routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const dbPromise = require('../config/mongo');

// GET /admin/dashboard
router.get('/', async (req, res, next) => {
  try {
    // 1) Aggregate totals from foundations table in MySQL
    const [[{ totalVolunteers }]] = await pool.query(
      'SELECT SUM(volunteer_count) AS totalVolunteers FROM foundations'
    );
    const [[{ totalStudents }]] = await pool.query(
      'SELECT SUM(student_count) AS totalStudents FROM foundations'
    );

    // 2) Connect to MongoDB and fetch districts
    const mongoDb = await dbPromise;
    const districts = await mongoDb
      .collection('districts')
      .find({}, { projection: { name: 1 } })
      .toArray();

    // 3) Render the dashboard template
    res.render('admin-dashboard', {
      admin: { name: 'Administrator' },
      totalVolunteers: totalVolunteers || 0,
      totalStudents: totalStudents || 0,
      districts: districts.map(d => ({
        id: d._id.toString(),
        name: d.name
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
