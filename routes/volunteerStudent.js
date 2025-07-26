// routes/volunteerStudent.js

const express = require('express');
const pool    = require('../config/db');    // Your MySQL2 pool
const path    = require('path');
const router  = express.Router({ mergeParams: true });
const {
  authorizeVolunteer
} = require('../middleware/authJwt');
// --------------------------------------------------
// (Optional) Middleware: ensure volunteer is logged in
// You can also compare req.session.volunteer_id === req.params.volunteer_id
// --------------------------------------------------
function ensureVolunteerMatchesParam(req, res, next) {
  // Example check (uncomment if using sessions):
  // if (!req.session.volunteer_id || 
  //     req.session.volunteer_id !== Number(req.params.volunteer_id)) {
  //   return res.status(403).send('Forbidden');
  // }
  next();
}

// --------------------------------------------------
// 1) GET /volunteer/:volunteer_id/add-student
//    → Render the Nunjucks template add-student.html,
//      passing volunteer_id so form’s action is correct.
// --------------------------------------------------
router.get(
  '/:volunteer_id/add-student',authorizeVolunteer,
  ensureVolunteerMatchesParam,
  (req, res) => {
    const { volunteer_id } = req.params;
    return res.render('add-student', { volunteer_id });
  }
);

// --------------------------------------------------
// 2) POST /volunteer/:volunteer_id/add-student
//    Volunteer submits { student_id, name }.
//    Steps:
//     a) Find this volunteer’s foundation_id.
//     b) If student does NOT exist in `students`, INSERT a stub row.
//        If student DOES exist, skip student INSERT entirely (so password stays intact).
//     c) Always INSERT IGNORE into `volunteer_student` map.
// --------------------------------------------------
router.post(
  '/:volunteer_id/add-student',
  ensureVolunteerMatchesParam,
  async (req, res) => {
    const { volunteer_id } = req.params;
    const { student_id, name } = req.body;

    // Basic validation
    if (!student_id || !name) {
      return res.status(400).send('Missing required fields: student_id and name.');
    }

    try {
      // ----- (a) Find the volunteer’s foundation_id -----
      const [volRows] = await pool.query(
        `SELECT foundation_id
            FROM volunteers
          WHERE volunteer_id = ?
            AND status = 'active'
          LIMIT 1`,
        [volunteer_id]
      );

      if (volRows.length === 0) {
        return res.status(404).send('Volunteer not found or inactive.');
      }
      const foundationId = volRows[0].foundation_id;
      if (foundationId == null) {
        return res.status(400).send('You are not assigned to any foundation.');
      }

      // ----- (b) Check if student already exists -----
      //
      // We only INSERT a new student row if student_id is not already in `students`.
      // If the student exists, we skip any INSERT/UPDATE on `students`—so password is never touched.
      const [studentExists] = await pool.query(
        `SELECT 1 
           FROM students 
          WHERE student_id = ? 
          LIMIT 1`,
        [student_id]
      );

      if (studentExists.length === 0) {
        // Student does NOT exist → insert a stub row.
        // Because `password_hash` is NOT NULL, we supply an empty string (`''`) as a placeholder.
        // All other columns in `students` are nullable and will be NULL by default.
        await pool.query(
          `INSERT INTO students
             (student_id, name, foundation_id)
           VALUES (?, ?, ?)`,
          [student_id, name, foundationId]
        );
      }
      // If student DOES exist, we do NOT run any INSERT INTO students or UPDATE students here.
      // That ensures the existing student's password and other fields are not modified.

      // ----- (c) Insert into volunteer_student mapping table -----
      //
      // We use INSERT IGNORE so that if the pair (volunteer_id, student_id)
      // already exists, MySQL simply skips it and does NOT error.
      // If you defined a PRIMARY KEY(volunteer_id,student_id) on this table,
      // INSERT IGNORE respects that unique constraint.
      await pool.query(
        `INSERT IGNORE INTO volunteer_student_map
           (volunteer_id, student_id)
         VALUES (?, ?)`,
        [volunteer_id, student_id]
      );

      // ----- Done: Redirect or send success -----
      // For example, redirect back to the volunteer’s dashboard:
      return res.redirect(`/volunteer-dashboard/${volunteer_id}/dashboard`);
      // Or if you prefer an AJAX/JSON response:
      // return res.status(201).json({ message: 'Student added/mapped successfully' });
    } catch (err) {
      console.error('Error in POST /volunteer/:volunteer_id/add-student:', err);
      return res.status(500).send('Internal Server Error');
    }
  }
);

module.exports = router;
