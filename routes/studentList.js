// backend/routes/studentlist.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db'); // your mysql2 promise pool

// GET /students?foundation_id=123
router.get('/', async (req, res, next) => {
  const fid = req.query.foundation_id;
  if (!fid) {
    return res.status(400).send('foundation_id is required');
  }

  try {
    // 1) Fetch foundation info
    const [fRows] = await pool.query(
      `SELECT foundation_id, name
         FROM foundations
        WHERE foundation_id = ?`,
      [fid]
    );
    if (!fRows.length) {
      return res.status(404).send('Foundation not found');
    }
    const foundation = fRows[0];

    // 2) Fetch students for that foundation
    const [sRows] = await pool.query(
      `SELECT student_id, name, class
         FROM students
        WHERE foundation_id = ?
        ORDER BY name`,
      [fid]
    );
    foundation.students = sRows;

    // 3) Render the template
    res.render('Students-list', { foundation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
