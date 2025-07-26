// middleware/authJwt.js

const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_very_long_secret';

/**
 * Reads token from HttpOnly cookie “auth_token” (or Authorization header) and verifies.
 * On success: sets req.user = { id, role } and calls next().
 * On failure: sends 401.
 */
function authenticateJWT(req, res, next) {
    let token = null;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }
    if (!token && req.cookies) {
        token = req.cookies['auth_token'];
    }
    if (!token) {
        // This is not an error if the user might be a student using a session.
        // We will just proceed without a req.user for JWT.
        // Routes that strictly require a JWT will fail later.
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) {
            // Invalid token, but don't block the request yet, could be a student.
            console.error('JWT verify error:', err.message);
            return next();
        }
        // payload.sub = admin|string or volunteer_id|number, etc.
        // payload.role = 'admin' or 'volunteer', etc.
        req.user = { id: payload.sub, role: payload.role };
        next();
    });
}

/**
 * Only admins can pass
 */
function authorizeAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).send('Admin privileges required.');
    }
    next();
}

/**
 * Only volunteers can pass and only for their own data
 */
function authorizeVolunteer(req, res, next) {
    if (!req.user || req.user.role !== 'volunteer') {
        return res.status(403).send('Volunteer privileges required.');
    }
    
    const volId = parseInt(req.params.volunteer_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);
    
    if (volId === userId) {
        return next(); // Volunteer is accessing their own data
    }

    return res.status(403).send('Access denied. You can only access your own data.');
}

/**
 * Admin OR the volunteer themself can pass
 */
function authorizeVolunteerOrAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).send('Not authenticated.');
    }

    if (req.user.role === 'admin') {
        return next(); // Admins can access all routes
    }

    const volId = parseInt(req.params.volunteer_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);
    
    if (req.user.role === 'volunteer' && volId === userId) {
        return next(); // Volunteers can access only their own data
    }

    return res.status(403).send('Access denied.');
}

/**
 * Only event managers can pass and only for their own data
 */
function authorizeEventManager(req, res, next) {
    if (!req.user || req.user.role !== 'event-manager') {
        return res.status(403).send('Event Manager privileges required.');
    }

    const managerId = parseInt(req.params.manager_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (managerId === userId) {
        return next(); // Event managers can access their own data
    }
    
    return res.status(403).send('Access denied. You can only access your own data.');
}

/**
 * Admin OR the event manager themself can pass
 */
function authorizeEventManagerOrAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).send('Not authenticated.');
    }

    if (req.user.role === 'admin') {
        return next();
    }

    const managerId = parseInt(req.params.manager_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (req.user.role === 'event-manager' && managerId === userId) {
        return next();
    }
    
    return res.status(403).send('Access denied.');
}


// ==========================================================
// NEWLY ADDED FUNCTIONS FOR STUDENTS
// ==========================================================

/**
 * Only the logged-in student themself can pass. Uses session.
 */
function authorizeStudent(req, res, next) {
    // Check for session-based user first
    if (!req.session.user || req.session.user.role !== 'student') {
        return res.status(401).send('Not authenticated as a student.');
    }
    
    const studentIdFromParams = parseInt(req.params.id, 10);
    const studentIdFromSession = parseInt(req.session.user.id, 10);
    
    // Check if the ID in the URL matches the ID in the session
    if (studentIdFromParams === studentIdFromSession) {
        return next(); // Allow access
    }

    return res.status(403).send('Access denied. You can only access your own profile.');
}

/**
 * Admin (using JWT) OR the student themself (using session) can pass.
 */
function authorizeStudentOrAdmin(req, res, next) {
    // Case 1: Admin is logged in (checks JWT)
    if (req.user && req.user.role === 'admin') {
        return next();
    }

    // Case 2: Student is logged in (checks session)
    if (req.session.user && req.session.user.role === 'student') {
        const studentIdFromParams = parseInt(req.params.id, 10);
        const studentIdFromSession = parseInt(req.session.user.id, 10);
        
        if (studentIdFromParams === studentIdFromSession) {
            return next(); // Allow access
        }
    }

    // If neither case is met, deny access
    return res.status(403).send('Access denied.');
}
/**
 * Only center program directors can pass and only for their own data
 */
function authorizeCenterProgramDirector(req, res, next) {
    if (!req.user || req.user.role !== 'center-program-director') {
        return res.status(403).send('Center Program Director privileges required.');
    }

    const directorId = parseInt(req.params.director_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (directorId === userId) {
        return next();
    }
    
    return res.status(403).send('Access denied. You can only access your own data.');
}
/**
 * Only center program coordinators can pass and only for their own data
 */
function authorizeCenterProgramCoordinator(req, res, next) {
    if (!req.user || req.user.role !== 'center-program-coordinator') {
        return res.status(403).send('Center Program Coordinator privileges required.');
    }

    const coordinatorId = parseInt(req.params.coordinator_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (coordinatorId === userId) {
        return next();
    }
    
    return res.status(403).send('Access denied. You can only access your own data.');
}
/**
 * Admin has full access. Directors and Coordinators can only access their own data.
 */
async function authorizeAdminOrOwnCoordinatorOrFoundationDirector(req, res, next) {
  if (!req.user) {
    return res.status(401).send('Not authenticated.');
  }

  const { role, id } = req.user;
  const userId = parseInt(id, 10);
  const targetCoordinatorId = parseInt(req.params.coordinator_id, 10);

  // Admins can always access
  if (role === 'admin') {
    return next();
  }

  // The coordinator can access their own dashboard
  if (role === 'center-program-coordinator' && userId === targetCoordinatorId) {
    return next();
  }

  // A director can access if they are in the same foundation
  if (role === 'center-program-director') {
    try {
      // Get the director's foundation ID
      const [directorRows] = await pool.query(
        'SELECT foundation_id FROM center_program_directors WHERE director_id = ?',
        [userId]
      );
      
      // Get the target coordinator's foundation ID
      const [coordinatorRows] = await pool.query(
        'SELECT foundation_id FROM center_program_coordinators WHERE coordinator_id = ?',
        [targetCoordinatorId]
      );

      if (directorRows.length > 0 && coordinatorRows.length > 0) {
        const directorFoundationId = directorRows[0].foundation_id;
        const coordinatorFoundationId = coordinatorRows[0].foundation_id;

        // Grant access if the foundations match
        if (directorFoundationId === coordinatorFoundationId) {
          return next();
        }
      }
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).send('Internal Server Error during authorization.');
    }
  }

  // If none of the above conditions are met, deny access
  return res.status(403).send('Access Denied.');
}


// --- Other specific middleware functions remain unchanged ---

function authorizeCenterProgramDirectorOrAdmin(req, res, next) {
    if (!req.user) return res.status(401).send('Not authenticated.');
    if (req.user.role === 'admin') return next();

    const directorId = parseInt(req.params.director_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (req.user.role === 'center-program-director' && directorId === userId) return next();
    
    return res.status(403).send('Access denied.');
}

function authorizeCenterProgramCoordinatorOrAdmin(req, res, next) {
    if (!req.user) return res.status(401).send('Not authenticated.');
    if (req.user.role === 'admin') return next();

    const coordinatorId = parseInt(req.params.coordinator_id || req.params.id, 10);
    const userId = parseInt(req.user.id, 10);

    if (req.user.role === 'center-program-coordinator' && coordinatorId === userId) return next();
    
    return res.status(403).send('Access denied.');
}

async function authorizeManagementRoles(req, res, next) {
  if (!req.user) {
    return res.status(401).send('Not authenticated.');
  }

  const { role, id } = req.user;

  // 1. Admin has universal access
  if (role === 'admin') {
    return next();
  }

  // 2. ONLY proceed with DB checks for Director or Coordinator roles
  if (role === 'center-program-director' || role === 'center-program-coordinator') {
    try {
      const userId = parseInt(id, 10);

      // ## CORRECTED LINE: Check req.params for ':id' and req.query for 'foundation_id' ##
      const foundationIdFromUrl = parseInt(req.params.id || req.query.foundation_id, 10);

      if (isNaN(foundationIdFromUrl)) {
        return res.status(400).send('Invalid or missing Foundation ID in the request.');
      }

      let query;
      let params;

      if (role === 'center-program-director') {
        query = 'SELECT foundation_id FROM center_program_directors WHERE director_id = ?';
        params = [userId];
      } else { // The role must be center-program-coordinator
        query = 'SELECT foundation_id FROM center_program_coordinators WHERE coordinator_id = ?';
        params = [userId];
      }

      const [rows] = await pool.query(query, params);

      // Check if user was found and if their foundation ID matches the URL's foundation ID
      if (rows.length > 0 && rows[0].foundation_id === foundationIdFromUrl) {
        return next(); // Grant access
      } else {
        // Deny access if they don't belong to the foundation
        return res.status(403).send('Access denied. You can only view your own foundation details.');
      }

    } catch (error) {
      console.error('Authorization error in authorizeManagementRoles:', error);
      return res.status(500).send('Internal Server Error during authorization.');
    }
  }

  // 3. If the role is not Admin, Director, or Coordinator, deny access
  return res.status(403).send('Access denied. Your role is not authorized to view this page.');
}
function authorizeByRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).send('Not authenticated.');
    }

    const { role } = req.user;

    if (allowedRoles.includes(role)) {
      return next(); // User's role is in the allowed list, grant access.
    }

    // If the role is not in the list, deny access.
    return res.status(403).send('Access Denied: You do not have the required permissions.');
  };
}

module.exports = {
    authenticateJWT,
    authorizeAdmin,
    authorizeVolunteer,
    authorizeVolunteerOrAdmin,
    authorizeEventManager,
    authorizeEventManagerOrAdmin,
    authorizeStudent,
    authorizeStudentOrAdmin,
    authorizeCenterProgramDirector,
    authorizeCenterProgramDirectorOrAdmin,
    authorizeCenterProgramCoordinator,
    authorizeCenterProgramCoordinatorOrAdmin,
    authorizeAdminOrOwnCoordinatorOrFoundationDirector,
    authorizeManagementRoles,
    authorizeByRole
};