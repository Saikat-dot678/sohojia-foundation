 const { MongoClient } = require('mongodb');
 require('dotenv').config();

 // Directly connect; the modern driver enables new URL parsing & topology by default
 let dbPromise = MongoClient.connect(process.env.MONGO_URI)
   .then(client => client.db());

function getDb() {
  if (!_db) {
    throw new Error('MongoDB not initialized yet — call getDb() after startup.');
  }
  return _db;
}

module.exports = dbPromise;
