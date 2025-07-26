const pool = require('../config/db'); // Adjust path as needed

// Render student dashboard
exports.getStudentDashboard = async (req, res) => {
  const studentId = req.params.id;

  try {
    const [rows] = await pool.query(
      `SELECT s.*, f.name AS foundation_name 
       FROM students s 
       JOIN foundations f ON s.foundation_id = f.foundation_id 
       WHERE s.student_id = ?`,
      [studentId]
    );

    if (!rows.length) {
      return res.status(404).send('Student not found');
    }

    const student = rows[0];

    res.render('Students-dashboard', {
      student: {
        student_id: student.student_id,
        name: student.name,
        photo_url: student.photo_url,
        roll_no: student.roll_no,
        class: student.class,
        address: student.address,
        father_name: student.father_name,
        mother_name: student.mother_name,
        guardian_contact: student.guardian_contact,
        guardian_email: student.guardian_email,
        hobby: student.hobby,
      },
      foundation: {
        name: student.foundation_name
      },
      currentYear: new Date().getFullYear(),
      userRole: req.user.role  
    });

  } catch (error) {
    console.error('Error fetching student dashboard:', error);
    res.status(500).send('Server error');
  }
};
