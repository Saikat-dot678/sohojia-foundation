// backend/config/db.js
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const caPath = path.resolve(__dirname, process.env.MYSQL_CA_PATH);

const pool = mysql.createPool({
  host:     process.env.SQL_HOST,
  port:     process.env.SQL_PORT,
  user:     process.env.SQL_USER,
  password: process.env.SQL_PASS,
  database: process.env.SQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: true,
    // Use the resolved absolute path here
    ca: fs.readFileSync(caPath),
  }
});
pool.getConnection()
  .then(connection => {
    console.log('Successfully connected to Aiven MySQL!');
    connection.release();
  })
  .catch(err => {
    console.error('Error connecting to Aiven MySQL:', err.message);
    process.exit(1);
  });
module.exports = pool;
