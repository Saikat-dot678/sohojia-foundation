// controllers/fingerprint.js
const path      = require('path');
const crypto    = require('crypto');
const dbPromise = require('../config/mongo');  // MongoDB promise
const pool      = require('../config/db');     // MySQL pool
// If you have a WebAuthn helper library, require it here:
// const { generateRegistrationOptions, verifyRegistrationResponse, ... } = require('../lib/webauthn');

// 1) GET /:id/fingerprint/register/options
//    -> return publicKeyCredentialCreationOptions
exports.getRegistrationOptions = async (req, res) => {
  try {
    const volunteerId = Number(req.params.id);
    // 1a) load volunteer so we have name/email
    const [rows] = await pool.query(
      'SELECT email, name FROM volunteers WHERE volunteer_id = ?',
      [volunteerId]
    );
    if (!rows.length) return res.status(404).end();

    const volunteer = rows[0];
    // 2) create a random challenge
    const challenge = crypto.randomBytes(32).toString('base64url');
    // 3) store it in session to verify later
    req.session.fingerprintChallenge = challenge;

    // 4) build creation options
    const publicKey = {
    challenge: challenge,                // already base64url
    rp: { name: 'SOHOJIA FOUNDATION' },
    user: {
        id: Buffer.from(String(volunteerId)).toString('base64url'),  // <-- encode here
        name: volunteer.email,
        displayName: volunteer.name
    },
    pubKeyCredParams: [ /* ... */ ],
    timeout: 60000,
    attestation: 'none'
    };

        res.json({ publicKey });
    } catch (err) {
        console.error('Error in getRegistrationOptions:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
    };

// 2) GET /:id/fingerprint/register
exports.showRegistrationPage = (req, res) => {
  res.sendFile(path.join(__dirname, '../public/fingerprint-register.html'));
};

// 3) POST /:id/fingerprint/register
//    -> receives attestation response from client
exports.registerFingerprint = async (req, res) => {
  const volunteerId = Number(req.params.id);
  const attestation = req.body;
  const expectedChallenge = req.session.fingerprintChallenge;
  if (!attestation || !expectedChallenge) {
    return res.status(400).json({ success: false, message: 'Missing attestation or challenge' });
  }

  try {
    // 3a) verify attestation with your WebAuthn library
    // const verification = await verifyRegistrationResponse({ attestation, expectedChallenge, origin: YOUR_ORIGIN });
    // if (!verification.verified) throw new Error('Attestation not verified');
    // const { credentialID, credentialPublicKey } = verification;

    // For demo, we’ll just accept any attestation object as a string:
    const credentialID         = attestation.id;
    const credentialPublicKey  = attestation.response.attestationObject;

    // 3b) upsert into MongoDB
    const db  = await dbPromise;
    const col = db.collection('Fingerprint');
    await col.updateOne(
      { volunteerId },
      { $set: { credentialID, credentialPublicKey } },
      { upsert: true }
    );

    // 3c) update MySQL flag
    await pool.query(
      `UPDATE volunteers
         SET fingerprint_registered = 1, updated_at = CURRENT_TIMESTAMP
       WHERE volunteer_id = ?`,
      [volunteerId]
    );

    res.json({ success: true, message: 'Fingerprint registered' });
  } catch (err) {
    console.error('Error in registerFingerprint:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// 1. GET /:id/fingerprint/assertion-options
exports.getAssertionOptions = async (req, res) => {
  try {
    const volunteerId = Number(req.params.id);
    // 1a) load stored credential from MongoDB
    const db    = await dbPromise;
    const col   = db.collection('Fingerprint');
    const rec   = await col.findOne({ volunteerId });
    if (!rec) return res.status(404).json({ error: 'No registered fingerprint' });

    // 2) generate a fresh challenge
    const challenge = crypto.randomBytes(32).toString('base64url');
    req.session.fingerprintAssertionChallenge = challenge;

    // 3) build the PublicKeyCredentialRequestOptions
    const publicKey = {
      challenge,
      allowCredentials: [
        {
          id: rec.credentialID,
          type: 'public-key',
          // optional: transports: ['usb','ble','nfc','internal']
        }
      ],
      userVerification: 'preferred', // or 'required'
      timeout: 60000
    };

    res.json({ publicKey });
  } catch (err) {
    console.error('Error in getAssertionOptions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};


// POST /:id/fingerprint/verify
exports.verifyFingerprint = async (req, res) => {
  const volunteerId = Number(req.params.id);
  const assertion   = req.body;
  const expectedChallenge = req.session.fingerprintAssertionChallenge;

  if (!assertion) {
    return res.status(400).json({ success: false, message: 'No assertion provided' });
  }

  try {
    // 1) (Demo) accept if IDs match—you should replace with real verifyAssertionResponse()
    const db         = await dbPromise;
    const col        = db.collection('Fingerprint');
    const record     = await col.findOne({ volunteerId });
    if (!record || assertion.id !== record.credentialID) {
      return res.status(401).json({ success: false, message: 'Credential mismatch' });
    }

    // 2) Determine IST date, time, and session
    const nowUTC   = new Date();
    const istNow   = new Date(nowUTC.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const today    = istNow.toISOString().slice(0, 10);
    const timeIST  = istNow.toTimeString().slice(0, 8);
    const dayName  = istNow.toLocaleDateString('en-US', {
                     weekday: 'long', timeZone: 'Asia/Kolkata'
                   }).toLowerCase();

    // MODIFIED: Added 15-minute grace period for check-out
    const [[ session ]] = await pool.query(
      `SELECT *
         FROM volunteer_schedule
        WHERE volunteer_id = ?
          AND LOWER(day_of_week) = ?
          AND start_time <= ?
          AND ? <= ADDTIME(end_time, '00:15:00')
        LIMIT 1`,
      [volunteerId, dayName, timeIST, timeIST]
    );
    if (!session) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    // 3) Handle Check-In vs Check-Out
    const attendanceCollection = db.collection('Attendance');
    const existingAttendance = await attendanceCollection.findOne({
        volunteer_id: volunteerId,
        session_id: session.id,
        session_date: today,
        status: 'Present'
    });

    if (existingAttendance) {
        // This is a CHECK-OUT
        await attendanceCollection.updateOne(
            { _id: existingAttendance._id },
            {
                $set: {
                    status: 'present', // MODIFIED: Final status is Present
                    check_out_time: nowUTC
                }
            }
        );
        return res.json({ success: true, message: 'Check-out successful. Attendance marked as Present.' });
    } else {
        // This is a CHECK-IN
        await attendanceCollection.insertOne({
            volunteer_id: volunteerId,
            session_id:   session.id,
            session_date: today,
            shift:        session.shift,
            status: 'Present',
            check_in_time: nowUTC,
            check_out_time: null,
            timestamp:    nowUTC
        });
        return res.json({ success: true, message: 'Check-in successful.' });
    }
  } catch (err) {
    console.error('Error in verifyFingerprint:', err);
    return res.status(500).json({ success: false, message: 'Verification/attendance failed' });
  }
};
