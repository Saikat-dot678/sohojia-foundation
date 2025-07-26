// routes/coordinators.js

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const { authenticateJWT, authorizeByRole } = require('../middleware/authJwt');
const canSeeCoordRoles = [
    'admin', 
    'center-program-director'
];
// GET /coordinators?foundation_id=...
router.get('/', authenticateJWT, authorizeByRole(canSeeCoordRoles), async (req, res, next) => {
  const { foundation_id } = req.query;

  if (!foundation_id) {
    return res.status(400).send('Foundation ID is required.');
  }

  try {
    const [foundationRows] = await pool.query(
      `SELECT name FROM foundations WHERE foundation_id = ?`,
      [foundation_id]
    );

    if (!foundationRows.length) {
      return res.status(404).send('Foundation not found');
    }
    const foundation = foundationRows[0];

    const [coordinatorRows] = await pool.query(
      `SELECT coordinator_id, name, email, phone 
       FROM center_program_coordinators 
       WHERE foundation_id = ? 
       ORDER BY name ASC`,
      [foundation_id]
    );

    res.render('coordinators-list.html', { 
      coordinators: coordinatorRows, 
      foundation,
      foundation_id 
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;