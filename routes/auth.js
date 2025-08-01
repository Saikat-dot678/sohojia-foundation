// routes/auth.js

/**
 * - Admins: hard‐coded username/password → issue JWT in cookie → redirect to /dashboard
 * - Volunteers: lookup in MySQL → verify bcrypt(hash) → issue JWT in cookie → redirect to volunteer dashboard
 * - Students: unchanged—use session as before → redirect to student page
 * - Event Managers: lookup in MySQL → verify bcrypt(hash) → issue JWT in cookie → redirect to event manager dashboard
 * - Center Program Directors: lookup in MySQL -> verify bcrypt(hash) -> issue JWT in cookie -> redirect to director dashboard
 * - Center Program Coordinators: lookup in MySQL -> verify bcrypt(hash) -> issue JWT in cookie -> redirect to coordinator dashboard
 */

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../config/db');
const adminCfg = require('../config/admin');

const JWT_SECRET    = process.env.JWT_SECRET || 'replace_with_very_long_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

// Helper to issue a token in an HttpOnly cookie
function setTokenCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });

  // Set cookie named “auth_token”
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // only over HTTPS in prod
    sameSite: 'lax',
    maxAge: (() => {
      // parse “2h” or “3600s” etc. For simplicity, if JWT_EXPIRES_IN ends with “h”:
      const num = parseInt(JWT_EXPIRES_IN.slice(0, -1), 10);
      if (JWT_EXPIRES_IN.endsWith('h') && !isNaN(num)) {
        return num * 60 * 60 * 1000;
      }
      // fallback to 2 hours
      return 2 * 60 * 60 * 1000;
    })()
  });
}

// POST /login
router.post('/login', async (req, res) => {
  const { username, password, role } = req.body;

  try {
    if (role === 'admin') {
      // —————————————
      // 1) Admin login (hard‐coded)
      // —————————————
      if (username === adminCfg.username && password === adminCfg.password) {
        // Issue JWT with role='admin'. We can set sub: 'admin' or sub: username
        setTokenCookie(res, { sub: 'admin', role: 'admin' });
        return res.redirect('/dashboard');
      } else {
        return res.status(401).send('Invalid admin credentials.');
      }
    }

    // —————————————
    // 2) Volunteer login → issue JWT
    // —————————————
    if (role === 'volunteers') {
      const volunteerId = parseInt(username, 10);
      if (isNaN(volunteerId)) {
        return res.status(400).send('Invalid volunteer ID.');
      }

      const [rows] = await pool.query(
        'SELECT volunteer_id, password_hash, status FROM volunteers WHERE volunteer_id = ? LIMIT 1',
        [volunteerId]
      );
      if (!rows.length) {
        return res.status(401).send('Volunteer not found.');
      }

      const user = rows[0];
      if (user.status !== 'active') {
        return res.status(403).send('Volunteer is not active.');
      }

      const match = await bcrypt.compare(password, user.password_hash || '');
      if (!match) {
        return res.status(401).send('Incorrect password.');
      }

      // Issue JWT: sub = volunteer_id, role = 'volunteer'
      setTokenCookie(res, { sub: user.volunteer_id, role: 'volunteer' });
      return res.redirect(`/volunteer-dashboard/${user.volunteer_id}/dashboard`);
    }

    // —————————————
    // 3) Event Manager login → issue JWT
    // —————————————
    if (role === 'event-managers') {
      const managerId = parseInt(username, 10); // Assuming username is event_manager_id
      if (isNaN(managerId)) {
        return res.status(400).send('Invalid event manager ID.');
      }

      const [rows] = await pool.query(
        'SELECT manager_id, password_hash, status FROM event_managers WHERE manager_id = ? LIMIT 1',
        [managerId]
      );
      if (!rows.length) {
        return res.status(401).send('Event Manager not found.');
      }

      const user = rows[0];
      if (user.status !== 'active') { // Assuming event managers also have a status
        return res.status(403).send('Event Manager is not active.');
      }

      const match = await bcrypt.compare(password, user.password_hash || '');
      if (!match) {
        return res.status(401).send('Incorrect password.');
      }

      // Issue JWT: sub = manager_id, role = 'event-manager'
      setTokenCookie(res, { sub: user.manager_id, role: 'event-manager' });
      return res.redirect(`/event-manager-dashboard/${user.manager_id}/dashboard`);
    }

    // —————————————
    // 4) Center Program Director login → issue JWT
    // —————————————
    if (role === 'center-program-directors') {
      const directorId = parseInt(username, 10);
      if (isNaN(directorId)) {
        return res.status(400).send('Invalid Director ID.');
      }

      const [rows] = await pool.query(
        'SELECT director_id, password_hash, status FROM center_program_directors WHERE director_id = ? LIMIT 1',
        [directorId]
      );
      if (!rows.length) {
        return res.status(401).send('Center Program Director not found.');
      }

      const user = rows[0];
      if (user.status !== 'active') {
        return res.status(403).send('Center Program Director is not active.');
      }

      const match = await bcrypt.compare(password, user.password_hash || '');
      if (!match) {
        return res.status(401).send('Incorrect password.');
      }

      // Issue JWT: sub = director_id, role = 'center-program-director'
      setTokenCookie(res, { sub: user.director_id, role: 'center-program-director' });
      return res.redirect(`/director-dashboard/${user.director_id}/dashboard`);
    }

    // —————————————
    // 5) Center Program Coordinator login → issue JWT
    // —————————————
    if (role === 'center-program-coordinators') {
      const coordinatorId = parseInt(username, 10);
      if (isNaN(coordinatorId)) {
        return res.status(400).send('Invalid Coordinator ID.');
      }

      const [rows] = await pool.query(
        'SELECT coordinator_id, password_hash, status FROM center_program_coordinators WHERE coordinator_id = ? LIMIT 1',
        [coordinatorId]
      );
      if (!rows.length) {
        return res.status(401).send('Center Program Coordinator not found.');
      }

      const user = rows[0];
      if (user.status !== 'active') {
        return res.status(403).send('Center Program Coordinator is not active.');
      }

      const match = await bcrypt.compare(password, user.password_hash || '');
      if (!match) {
        return res.status(401).send('Incorrect password.');
      }

      // Issue JWT: sub = coordinator_id, role = 'center-program-coordinator'
      setTokenCookie(res, { sub: user.coordinator_id, role: 'center-program-coordinator' });
      return res.redirect(`/coordinator-dashboard/${user.coordinator_id}/dashboard`);
    }


    // —————————————
    // 6) Student login (session‐based, unchanged)
    // —————————————
    if (role === 'students') {
      // “username” is student_id string
      const studentId = parseInt(username, 10);
      if (isNaN(studentId)) {
        return res.status(400).send('Invalid student ID.');
      }

      const [rows] = await pool.query(
        'SELECT student_id, password_hash, name FROM students WHERE student_id = ? LIMIT 1',
        [studentId]
      );
      if (!rows.length) {
        return res.status(401).send('Student not found.');
      }

      const student = rows[0];
      const match = await bcrypt.compare(password, student.password_hash || '');
      if (!match) {
        return res.status(401).send('Incorrect password.');
      }
      
      setTokenCookie(res, { sub: student.student_id, role: 'student' });
      return res.redirect(`/student/${student.student_id}`);
    }

    // If role is something else:
    return res.status(400).send('Unknown role.');
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Internal server error.');
  }
});

// POST /logout
router.get('/logout', (req, res) => {
  // Clear the token cookie
  res.clearCookie('auth_token');
  
  if (req.session) {
    req.session.destroy(() => {
      return res.redirect('/');
    });
  } else {
    return res.redirect('/');
  }
});

module.exports = router;