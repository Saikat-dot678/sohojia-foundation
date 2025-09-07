// routes/passwordReset.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/db'); // MySQL connection pool
const dbPromise = require('../config/mongo'); // MongoDB connection promise
const nodemailer = require('nodemailer');

require('dotenv').config();

const SALT_ROUNDS = 12;

// --- Nodemailer Transporter Setup ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// --- Role to Table Mapping (for MySQL user lookup) ---
const roleConfig = {
    student: {
        tableName: 'students',
        idColumn: 'student_id',
        emailColumn: 'guardian_email'
    },
    volunteer: {
        tableName: 'volunteers',
        idColumn: 'volunteer_id',
        emailColumn: 'email'
    },
    director: {
        tableName: 'center_program_directors',
        idColumn: 'director_id',
        emailColumn: 'email'
    }
};

// --- 1. Request Password Reset ---
router.post('/request-password-reset', async (req, res) => {
    const { email, role } = req.body;
    const config = roleConfig[role];

    if (!config) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }

    try {
        // Find user in MySQL to get their ID
        const query = `SELECT ${config.idColumn} FROM ${config.tableName} WHERE ${config.emailColumn} = ? LIMIT 1`;
        const [rows] = await pool.query(query, [email]);

        if (rows.length === 0) {
            return res.status(200).json({ message: 'If an account matching that email and role exists, a reset link will be sent.' });
        }

        const userId = rows[0][config.idColumn];

        // Generate secure token and expiry (10 minutes)
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Store hashed token in MongoDB
        const mongoDb = await dbPromise;
        const resetCollection = mongoDb.collection('password_resets');
        await resetCollection.insertOne({
            userId: userId,
            userRole: role,
            tokenHash: tokenHash,
            expiresAt: expiresAt,
            createdAt: new Date()
        });

        // Send email with plaintext token
        const resetLink = `${process.env.BASE_URL}/reset-password.html?token=${token}`; // Assumes BASE_URL is set in .env
        const mailOptions = {
            from: `"Sohojia Foundation Admin" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Sohojia Foundation Password Reset Request',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <h2>Password Reset Request</h2>
                    <p>Hello,</p>
                    <p>We received a request to reset the password for your account associated with the role: <strong>${role}</strong>.</p>
                    <p>Click the link below to set a new password:</p>
                    <p style="text-align: center; margin: 20px 0;">
                        <a href="${resetLink}" style="background-color: #f34f4c; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Your Password</a>
                    </p>
                    <p>This link will expire in <strong>10 minutes</strong>.</p>
                    <p>If you did not request a password reset, please ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #eee;">
                    <p style="font-size: 0.9em; color: #777;">Sohojia Foundation</p>
                </div>`
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'If an account matching that email and role exists, a reset link will be sent.' });

    } catch (err) {
        console.error('Password reset request error:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// --- 2. Process Password Reset ---
router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ message: 'Token and new password are required.' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const mysqlConnection = await pool.getConnection();
    const mongoDb = await dbPromise;
    const resetCollection = mongoDb.collection('password_resets');
    
    await mysqlConnection.beginTransaction();

    try {
        // Find valid token in MongoDB and ensure it hasn't expired
        const resetRecord = await resetCollection.findOne({
            tokenHash: hashedToken,
            expiresAt: { $gt: new Date() }
        });

        if (!resetRecord) {
            await mysqlConnection.rollback();
            return res.status(400).json({ message: 'Invalid or expired password reset token.' });
        }

        const { userId, userRole } = resetRecord;
        const config = roleConfig[userRole];

        // Hash new password using bcrypt
        const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password in MySQL based on role, with cascading logic for volunteers
        if (userRole === 'volunteer') {
            // Cascade update: Volunteer -> Coordinator -> Event Manager
            await mysqlConnection.query(
                `UPDATE volunteers SET password_hash = ? WHERE volunteer_id = ?`,
                [newPasswordHash, userId]
            );
            await mysqlConnection.query(
                `UPDATE event_managers SET password_hash = ? WHERE manager_id = ?`,
                [newPasswordHash, userId]
            );
            await mysqlConnection.query(
                `UPDATE center_program_coordinators SET password_hash = ? WHERE coordinator_id = ?`,
                [newPasswordHash, userId]
            );
        } else {
            // Standard update for non-cascading roles (student, director)
            await mysqlConnection.query(
                `UPDATE ${config.tableName} SET password_hash = ? WHERE ${config.idColumn} = ?`,
                [newPasswordHash, userId]
            );
        }

        // Invalidate used token by deleting it from MongoDB
        await resetCollection.deleteOne({ _id: resetRecord._id });

        await mysqlConnection.commit();
        res.status(200).json({ message: 'Password updated successfully. You can now log in with your new password.' });

    } catch (err) {
        await mysqlConnection.rollback();
        console.error('Password reset processing error:', err);
        res.status(500).json({ message: 'Internal server error during password update.' });
    } finally {
        mysqlConnection.release();
    }
});

module.exports = router;