// routes/event-managers.js

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const {authenticateJWT, authorizeByRole} = require('../middleware/authJwt');

const allowRoles = ['admin', 
    'center-program-director', 
    'center-program-coordinator'];
// GET /event-managers?foundation_id=...
router.get('/',authenticateJWT, authorizeByRole(allowRoles),async (req, res, next) => {
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

    const [managerRows] = await pool.query(
      `SELECT manager_id, name, email, phone 
       FROM event_managers 
       WHERE foundation_id = ? 
       ORDER BY name ASC`,
      [foundation_id]
    );

    res.render('event-managers-list.html', { 
      eventManagers: managerRows, 
      foundation,
      foundation_id 
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;