// backend/app.js
require('dotenv').config(); // Load environment variables from .env file
require('./cron/absenceCheck'); // Assuming this is a cron job or scheduled task file
require('./cron/updateLateStatus'); 
require('./cron/seasonalScheduleSwitcher.js');
const path           = require('path');
const express        = require('express');
const session        = require('express-session');
const { MongoClient } = require('mongodb'); // Assuming MongoClient is used directly for dbPromise setup
const nunjucks       = require('nunjucks');
const cookieParser = require('cookie-parser');
const sqlPool        = require('./config/db'); // Your MySQL connection pool
const adminConfig    = require('./config/admin'); // Your admin credentials configuration
// const csurf = require('csurf'); // Uncomment if you plan to use CSRF protection
const MongoStore = require('connect-mongo'); // REQUIRED FOR PRODUCTION-READY SESSIONS


// JWT middlewares - Ensure these paths are correct
const {
  authenticateJWT,
  authorizeAdmin,
  authorizeVolunteer,
  authorizeVolunteerOrAdmin,
  authorizeAdminOrOwnCoordinatorOrFoundationDirector,
  authorizeByRole
} = require('./middleware/authJwt');

// --- Route Imports ---
// IMPORTANT: Ensure these paths accurately reflect your file structure
const authRoutes      = require('./routes/auth');
const adminRoutes     = require('./routes/admin');
const districtRoutes  = require('./routes/districts');
const foundationRoutes = require('./routes/foundation');
const registerStdRoutes= require('./routes/registerStudent');
const registerVolRoutes= require('./routes/registerVolunteer');
const studentRoutes    = require('./routes/student');
const studentRoute    = require('./routes/studentRoutes'); // Review if 'studentRoutes' and 'studentRoute' are distinct or one is redundant
const studentListRt    = require('./routes/studentList');
const volunteerRoutes  = require('./routes/volunteer');
const volunteerListRt  = require('./routes/volunteerList'); // Volunteer list routes
const volunteerScheduleRouter = require('./routes/volunteerSchedule'); // Schedule routes for volunteer self-management & delete logic
const volunteerDashboard = require('./routes/volunteerDashboard');
const attendanceStatusRouter = require('./routes/attendanceStatus');
const volunteerAttendanceRouter = require('./routes/volunteerAttendance');
const additionRoutes = require('./routes/addition'); // Contains district, foundation, schedule additions etc.
const volunteerStudentRouter = require('./routes/volunteerStudent');
const editVolunteerRouter    = require('./routes/editVolunteer');
const eventRoutes = require('./routes/event'); // Event Add routes
const eventManagerRouter = require('./routes/eventManager'); // Event Manager dashboard
const registerEventManagerRouter = require('./routes/registerEventManager');
const eventReportRoutes = require('./routes/eventReportRoutes'); // Event Report display routes
const editEventRoutes = require('./routes/editEventRoutes'); // Edit specific event routes
const directorRoutes = require('./routes/director');
const registerDirectorRoutes = require('./routes/registerDirector');
const coordinatorRoutes = require('./routes/coordinator');
const registerCoordinatorRoutes = require('./routes/registerCoordinator');
const eventManagerListRoutes = require('./routes/event-managers');
const directorListRoutes = require('./routes/directors');
const coordinatorListRoutes = require('./routes/coordinators');
const studentAttendanceRoutes = require('./routes/studentAttendance');
const holidayManagementRoutes = require('./routes/holidayManagement');

// Admin Schedule Management Router
const adminScheduleManagementRouter = require('./routes/adminScheduleManagement'); 


// --- Start the Express Application and Connect DB ---
async function start() {
  // 1) Connect MongoDB
  // This client is used by your dbPromise and should be connected once at startup.
  const mongoClient = new MongoClient(process.env.MONGO_URI);
  await mongoClient.connect(); // Explicitly connect the client before starting the server

  // 2) Initialize Express App
  const app = express();

  // 3) Express Middleware: Body parsers, cookies, sessions
  app.use(express.urlencoded({ extended: true })); 
  app.use(express.json()); 
  app.use(cookieParser());

    // --- ENVIRONMENT-AWARE SESSION & CSRF CONFIGURATION ---
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) { app.set('trust proxy', 1); }

    app.use(
        session({
            secret: process.env.SESSION_SECRET || 'a-very-strong-secret-key-for-dev',
            resave: false,
            saveUninitialized: false,
            // Configure session store to use MongoDB (production-ready)
            store: MongoStore.create({
                client: mongoClient, // Use the connected MongoClient
                dbName: process.env.MONGO_DB_NAME || 'sohojia_db', // Your MongoDB database name
                collectionName: 'sessions', // Collection name for sessions
                ttl: 24 * 60 * 60, // Session TTL in seconds (1 day, matches maxAge below)
                autoRemove: 'interval', // Auto-remove expired sessions
                autoRemoveInterval: 10, // Check for expired sessions every 10 minutes
            }),
            cookie: {
                secure: isProduction, // Set to true in production (HTTPS)
                httpOnly: true, // Prevent client-side JS access to cookie
                sameSite: 'lax', // Protect against CSRF attacks. 'lax' is a good default.
                domain: isProduction ? '.sai678.dev' : undefined, // Set domain ONLY in production
                maxAge: 24 * 60 * 60 * 1000 // Session max age in milliseconds (24 hours)
            }
        })
    );
    // app.use(csurf({ cookie: true })); 

  // 4) Nunjucks View Engine Configuration
  const env = nunjucks.configure(path.join(__dirname, 'public'), { // 'public' is the template directory
    autoescape: true, express: app,
    noCache: process.env.NODE_ENV !== 'production', // Disable caching in development
    watch: true // Watch for template file changes (requires 'chokidar')
  });
  app.set('view engine', 'html'); // Express view engine for '.html' files
  app.set('views', path.join(__dirname, 'public')); // Where to find view templates
  app.engine('html', env.render); // How to render '.html' files with Nunjucks

  // Add global helpers/functions/filters to the Nunjucks environment.
  // These will be accessible in all templates rendered by 'env'.
  env.addGlobal('formatDateHelper', (date) => {
    if (!date) return 'N/A';
    let d;
    try { d = new Date(date); if (isNaN(d.getTime())) { console.warn(`formatDateHelper: Invalid date passed: "${date}"`); return 'Invalid Date'; } }
    catch (e) { console.error(`formatDateHelper: Error creating Date from "${date}":`, e); return 'Date Error'; }
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  });

  env.addFilter('formatTime', (timeString) => {
    if (!timeString) return 'N/A';
    const parts = timeString.split(':');
    return `${parts[0] || '00'}:${parts[1] || '00'}`;
  });
  
  env.addFilter('safeJoin', (value, separator = ', ', fallback = 'N/A') => {
      if (Array.isArray(value)) { return value.filter(Boolean).join(separator); }
      else if (typeof value === 'string' && value.trim() !== '') { return value.split(',').map(s => s.trim()).filter(Boolean).join(separator); }
      return fallback;
  });
  function formatTimeForInput(timeString) {
      if (!timeString || typeof timeString !== 'string') {
          return '';
      }
      return timeString.substring(0, 5);
  }

  // 5) Make database pools/clients and configs available via app.locals
  app.locals.sqlPool     = sqlPool;
  app.locals.mongoDb     = mongoClient.db();
  app.locals.adminConfig = adminConfig;

  env.addFilter('formatTimeForInput', formatTimeForInput);
  // 6) Static File Serving
  // NOTE: If you have Nunjucks templates here, they will be served as static HTML
  // if accessed directly via /static/. Ensure all dynamic pages are rendered via routes.
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // --- Base Routes / Landing Pages (Explicitly render via Nunjucks) ---
  app.get('/', (req, res) => { res.render('index'); });
  app.get('/registration-choice', (req, res) => { res.render('registration-choice'); });
  app.get('/student-register', (req, res) => { res.render('Student-registration'); });
  app.get('/volunteer-register', (req, res) => { res.render('Volunteer-registration'); });
  app.get('/event-manager-register', (req, res) => { res.render('event-manager-registration'); });
  app.get('/center-program-coordinator-register', (req, res) => { res.render('coordinator-registration'); });
  app.get('/center-program-director-register', (req, res) => { res.render('director-registration'); });
  const canSeeStudentRoles = [
    'admin', 
    'center-program-director', 
    'center-program-coordinator',
    'event-manager',
    'volunteer',
    'student'
];

  // 7) Mount all your other API and UI Routers (with authentication/authorization middleware)
  app.use('/', authRoutes);
  app.use('/dashboard', authenticateJWT, authorizeAdmin, adminRoutes);
  app.use('/districts', authenticateJWT, authorizeAdmin, districtRoutes);
  app.use('/foundation', authenticateJWT,  foundationRoutes);
  app.use('/register-student', registerStdRoutes);
  app.use('/register-volunteer', registerVolRoutes);
  app.use('/student', authenticateJWT, authorizeByRole(canSeeStudentRoles), studentRoutes);
  app.use('/student-edit', authenticateJWT, studentRoute);
  app.use('/students', authenticateJWT, authorizeByRole(canSeeStudentRoles), studentListRt);
  app.use('/volunteer', authenticateJWT, volunteerRoutes);
  app.use('/volunteers', authenticateJWT, volunteerListRt);
  app.use('/volunteer-schedule', authenticateJWT, volunteerScheduleRouter); // Volunteer's own schedule and DELETE route
  app.use('/volunteer-dashboard', authenticateJWT, volunteerDashboard);
  app.use('/api', authenticateJWT, attendanceStatusRouter);
  app.use('/volunteer-attendance', authenticateJWT, volunteerAttendanceRouter);
  app.use('/addition', authenticateJWT, authorizeAdmin, additionRoutes); // Contains routes like /add-district, /add-foundation etc.
  app.use('/volunteer-student', authenticateJWT, volunteerStudentRouter);
  app.use('/edit-volunteer', authenticateJWT, editVolunteerRouter);
  app.use('/event-manager-dashboard', authenticateJWT, eventManagerRouter);
  app.use('/register-event-manager', registerEventManagerRouter);
  app.use('/event', eventRoutes); 
  app.use('/edit-event', editEventRoutes); 
  app.use('/events', eventReportRoutes); 
  app.use('/director-dashboard', directorRoutes);
  app.use('/register-director', registerDirectorRoutes);
  app.use('/coordinator-dashboard', coordinatorRoutes);
  app.use('/register-coordinator', registerCoordinatorRoutes);
  app.use('/event-managers', eventManagerListRoutes);
  app.use('/directors', directorListRoutes);
  app.use('/coordinators', coordinatorListRoutes);
  app.use('/student-attendance', studentAttendanceRoutes);
  app.use('/admin/holidays', holidayManagementRoutes);
  app.use('/admin/schedule-management', adminScheduleManagementRouter); 

  // Example route that needs `sqlPool` (Mark Attendance)
  app.get('/volunteers-mark/:id/mark-attendance', authenticateJWT, async (req, res) => {
    const volunteerId = req.params.id;
    const sqlPool = req.app.locals.sqlPool;

    try {
      const [rows] = await sqlPool.query(`
        SELECT *
        FROM volunteer_schedule
        WHERE volunteer_id = ?
          AND CURRENT_TIMESTAMP BETWEEN start_time AND end_time
        LIMIT 1
      `, [volunteerId]);
      const activeSession = rows.length ? rows[0] : null;
      res.render('mark-attendance', { volunteerId, activeSession });
    } catch (err) {
      console.error('Error fetching session:', err);
      res.status(500).send('Server error');
    }
  });

  app.post('/some-route', (req, res) => { res.status(404).json({ message: 'Not found' }); });
  app.get('/ping', (req, res) => res.send('pong'));

  // 8) 404 Not Found Handler (Catch-all for unmatched routes)
  app.use((req, res) => res.status(404).send('Not found'));

  // 9) Global Error Handler (Centralized error handling)
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Server error');
  });

  // 10) Start the Express server
  const port = process.env.PORT || 3000;
  app.listen(port, () => { console.log(`Server listening on http://localhost:${port}`); });

  // 11) Export Express app instance and database connections (if other modules need to require('./app'))
  module.exports = {
    app,
    sqlPool,
    mongoDb: mongoClient.db()
  };
}

// Catch any errors that occur during the server startup process
start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
