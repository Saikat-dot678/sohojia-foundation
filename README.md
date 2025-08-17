Sohojia Foundation Monitoring System

A comprehensive, web-based monitoring system designed to support the Sohojia Foundation's mission of providing education and extracurricular activities to students in rural communities. The platform automates volunteer management, attendance tracking, and activity reporting, enabling the foundation to operate more efficiently and focus its resources on its educational goals.

---

# Table of Contents

1. About the Project
2. Key Features
3. Architecture Overview
4. Tech Stack
5. Getting Started
   - Prerequisites
   - Installation & Setup
   - Environment configuration (.env)
   - Run the application
6. Deployment & Nginx Configuration
7. Security & Privacy
8. Development Notes
9. Troubleshooting & FAQs
10. License
11. Acknowledgments & Contributors

---

# About the Project

The **Sohojia Foundation Monitoring System** is a web-based volunteer and activity monitoring system built for the Sohojia Foundation — a non-profit organization dedicated to empowering students in village communities (primarily in remote areas of West Bengal, India) through education, arts (painting, recitation), martial arts (karate), and science (weekly workshops and fairs).

Managing volunteers across multiple centers and rural locations is costly and time-consuming. This project replaces manual oversight with modern automation: location-aware schedules, biometric verification, role-based access control, automated reporting, and media management — all tailored to the Foundation's workflows.

**Vision:** Bring scientific thinking, quality education, and a creative perspective to under-served rural communities, using structured programs to uplift local living conditions.

**Mission:** Provide reliable monitoring and tools so the Foundation can scale quality education and extracurricular activities while keeping operational overheads low.

Key active chapters and programs include:
- **Amader Pathshala (Sirjan Chapter)** — Barshi village, Bankura. Offers structured education and runs the Bigyanusandhan Kendra (Science Center) for hands-on training.
- **Sokaler Pathshala (Bandwan Chapter)** — Launched in 2023; morning study sessions now serving 60+ students with 7 volunteers.
- **Creative Arts & Annual Events** — Painting exhibitions, recitations and a yearly event that showcased 200+ student paintings.

---

# Key Features

This system provides a robust feature set to manage volunteers, schedules, attendance, and events.

## 1. Hierarchical Role-Based Access Control (RBAC)
- **Role Structure:** Admin → Center Programme Director → Center Programme Coordinator → {Volunteer, Event Manager} → Student
- **Secure Authentication:** Email/password login, sessions handled with HttpOnly JWT cookies.
- **Granular Permissions:** Middleware (`middleware/authJwt.js`) enforces what each role can read or modify.

## 2. Advanced Volunteer & Staff Management
- **Unified Profile System:** Role promotions copy core volunteer data so profiles remain consistent across roles. Edits via volunteer dashboard sync automatically.
- **Dynamic Onboarding:** Admins may pre-register staff and volunteers; users complete registration with details later.
- **Account Lifecycle:** Admins can activate/deactivate accounts. Deactivation removes or archives related data as configured.

## 3. Multi-Factor Attendance Verification
- **Location-Based Check-in:** Device GPS must be within a configurable radius (default 100 meters) of scheduled coordinates.
- **Face Verification:** Python microservice using InsightFace (`buffalo_l`) generates and compares facial embeddings (initially built from multiple images per user).
- **Fingerprint Verification:** WebAuthn (passwordless) support for secure biometric check-ins.
- **Media Storage:** Images and embeddings stored to Google Cloud Storage buckets.

## 4. Comprehensive Schedule & Holiday Management
- **Dynamic Scheduling:** Create day/shift/subject-specific schedules with GPS coordinates.
- **Seasonal Schedules:** Cron jobs switch between summer/winter schedules automatically based on date.
- **Holidays:** Foundation-specific holiday rules respected by absence and attendance logic.

## 5. Event & Activity Reporting
- **Dynamic Event Types:** Track events like Karate classes, Painting sessions, Science fairs with custom fields.
- **Media Uploads:** Event photos upload directly to GCS.
- **Filterable Reports:** Exportable and filterable reports for attendance, volunteer activity, and event summaries.

## 6. Automated Cron Jobs
- **Absence Checking:** Automatically marks absent volunteers on missed sessions.
- **Lateness Tracking:** Marks check-ins as `late` when they are beyond a configurable threshold (default 15 minutes).
- **Season Switcher:** Applies seasonal start/end times to schedules.

---

# Architecture Overview

The project uses a hybrid microservice-oriented architecture: a monolithic Node.js application for the main business logic and a Python AI microservice for computationally intensive face recognition tasks.

graph TD
    subgraph "User's Browser"
        A[Frontend UI<br>HTML/CSS/JS/Nunjucks]
    end

    subgraph "Cloud Infrastructure"
        B(Nginx Reverse Proxy)
        C{Node.js Backend<br>(Docker on Linode)}
        D[Python AI Service<br>(InsightFace on Linode)]
        E[MySQL Database<br>(Aiven)]
        F[MongoDB Database<br>(MongoDB Atlas)]
        G[Google Cloud Storage<br>(User Photos, Embeddings, Event Media)]
    end

    A -- HTTP/S Requests --> B
    B -- Proxies to --> C
    C -- AI Tasks --> D
    C -- Relational Data --> E
    C -- Non-Relational Data --> F
    C -- File Operations --> G
    D -- File Operations --> G

---

# Tech Stack

Category	Technology
Backend	Node.js, Express.js
AI / Machine Learning	Python, InsightFace (buffalo_l), ONNX Runtime, OpenCV
Frontend	HTML, CSS, JavaScript, Nunjucks (templating)
Databases	MySQL (Aiven), MongoDB (Atlas)
Authentication	JSON Web Tokens (JWT), bcrypt, WebAuthn
File Handling	Multer (Node.js)
Scheduling	node-cron
Containerization	Docker, Docker Compose
Deployment & Hosting	Linode, Aiven, MongoDB Atlas, Google Cloud Storage, Nginx

---

# Getting Started

Follow these steps to get a local copy up and running for development.

## Prerequisites
- Git
- Node.js (v18 or higher recommended)
- npm (comes with Node)
- Python 3.10 or higher
- pip
- Docker & Docker Compose (for running the whole stack)

## Installation & Setup

Clone the repository:

git clone https://github.com/Saikat-dot678/sohojia-foundation.git
cd sohojia-foundation

### Create and configure your `.env` file
Create a file named `.env` in the project root. Copy the contents of `.env.example` and fill in your credentials.

> ⚠️ **Do not** commit `.env` to version control. Add it to `.gitignore`.

#### Example `.env.example`

# Server
PORT=3000
NODE_ENV="development"

# MySQL (Aiven)
SQL_HOST=your_sql_host
SQL_PORT=your_sql_port
SQL_USER=your_sql_user
SQL_PASS=your_sql_password
SQL_DATABASE=sohojia_foundation
MYSQL_CA_PATH=path/to/your/ca.pem

# MongoDB (Atlas)
MONGO_URI=your_mongodb_atlas_connection_string

# Session & JWT
SESSION_SECRET=a_very_long_and_random_session_secret
JWT_SECRET=another_very_long_and_random_jwt_secret
JWT_EXPIRES_IN=2h

# Default admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=a_strong_and_secure_password

# Google Cloud Storage
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/gcloud_service_account.json
GCLOUD_PROJECT=your_gcloud_project_id
BUCKET1=your-primary-image-bucket-name
BUCKET2=your-embeddings-bucket-name

### Install dependencies

# For the Node.js backend
npm install

# For the Python service (from the python-service/ or scripts/ directory)
cd python-service/  # or scripts/
pip install -r requirements.txt
cd ..

## Run the application

**Option A — Docker Compose (recommended for local dev of the full stack):**

docker-compose up --build

**Option B — Run services manually (development):**
1. Start MySQL and MongoDB (local or connected cloud instances)
2. Start Node backend:

npm run dev
# or
node server.js

3. Start Python AI service:

cd python-service/
python app.py

---

# Deployment & Nginx Configuration

Production uses Docker containers on a Linode instance with Nginx as a reverse proxy. Below is an example Nginx configuration. Replace `your_domain.com` appropriately and adjust paths for SSL certs.

# /etc/nginx/sites-available/your_domain.com

server {
    listen 80;
    server_name your_domain.com www.your_domain.com;
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your_domain.com www.your_domain.com;

    client_max_body_size 10M;

    ssl_certificate /etc/letsencrypt/live/your_domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your_domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    access_log /var/log/nginx/your_domain.access.log;
    error_log /var/log/nginx/your_domain.error.log;

    location / {
        proxy_pass http://localhost:3000; # Node.js app
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

### Obtaining an SSL certificate (Let's Encrypt / Certbot)

On Ubuntu with snap:

sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx

Test and reload nginx after certbot completes:

sudo nginx -t
sudo systemctl reload nginx

---

# Security & Privacy

- **Authentication:** JWT tokens stored in secure, HttpOnly cookies.
- **Password Storage:** Passwords hashed with `bcrypt`.
- **Biometric Data:** Facial images and embeddings are treated as sensitive — keep storage buckets private, use proper IAM service accounts, and rotate service keys.
- **Data Retention:** Configure retention and archival policies for media and logs according to Foundation policy and local regulations.

---

# Development Notes

- **AI Service:** The Python service exposes endpoints like `/generate-embedding` and `/verify-face` and uses InsightFace with ONNX Runtime for performance.
- **Database design:** MySQL stores relational entities (users, roles, schedules). MongoDB stores logs, embeddings metadata, and large non-relational objects.
- **File uploads:** Multer middleware handles uploads and streams final files to Google Cloud Storage.
- **Cron jobs:** `node-cron` tasks handle absence checking, lateness updates, and seasonal schedule switching.

## Recommended local workflow
1. Start DB services (or use cloud dev instances).
2. Start Node backend in `nodemon`/`npm run dev`.
3. Start Python AI service in a separate terminal.
4. Use browser to access the UI and create test users and schedules.

---

# Troubleshooting & FAQs

**Q: Face verification failing for many users?**
- Ensure the Python service is running and can access the GCS bucket.
- Confirm embeddings were created with enough images per user (10 recommended by the project) and that model files are present.
- Check logs in the Python service for image-read or ONNX errors.

**Q: Cron jobs not running?**
- Confirm `node-cron` code is active and the process is running inside the container. In some production setups, ensure only one instance runs scheduled jobs.

**Q: File upload size errors in production?**
- Increase `client_max_body_size` in Nginx and adjust Multer limits if needed.

---

# Contributing

Contributions are welcome! If you'd like to contribute:
1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes: `git commit -m "feat: describe your change"`
4. Push and open a Pull Request

Please follow the code style and add tests where applicable.

---

# License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.

---

# Acknowledgments & Contributors

This project stands on the shoulders of great open-source projects and cloud platforms. Special thanks to:

- Node.js, Express.js
- Python, InsightFace, ONNX Runtime
- Docker & Docker Compose
- MySQL (Aiven), MongoDB Atlas
- Google Cloud Storage
- Linode

**Authors & Maintainers**
- Saikat-dot678 — Project Lead & Developer

If you'd like to join the project or help onboard the Foundation staff, please open an issue or contact the repo maintainers.

---

*Thank you for supporting the Sohojia Foundation — together we can make quality education accessible to more children in rural communities.*
