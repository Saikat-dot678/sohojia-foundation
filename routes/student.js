const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student');

router.get('/:id', studentController.getStudentDashboard);

module.exports = router;
