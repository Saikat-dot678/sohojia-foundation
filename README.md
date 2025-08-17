🚀 Sohojia Foundation Monitoring System
<p align="center">
<img src="https://www.sohojia.org/static/media/sohojia.27a716b5.png" alt="Sohojia Foundation Logo" width="150">
</p>

<p align="center">
A web-based volunteer and activity monitoring system designed to support the <strong>Sohojia Foundation's</strong> mission of providing education and extracurricular activities to rural students.
</p>

📖 Table of Contents
About the Project

Key Features

Architecture Overview

Tech Stack

Getting Started

Deployment & Nginx Configuration

Security & Privacy

Development Notes

Troubleshooting & FAQs

License

Acknowledgments & Contributors

📖 About The Project
The Sohojia Foundation Monitoring System is a web-based volunteer and activity monitoring system built for the Sohojia Foundation — a non-profit organization dedicated to empowering students in village communities (primarily in remote areas of West Bengal, India) through education, arts (painting, recitation), martial arts (karate), and science (weekly workshops and fairs).

Managing volunteers across multiple centers and rural locations is costly and time-consuming. This project replaces manual oversight with modern automation: location-aware schedules, biometric verification, role-based access control, automated reporting, and media management — all tailored to the Foundation's workflows.

🎯 Vision: Bring scientific thinking, quality education, and a creative perspective to under-served rural communities, using structured programs to uplift local living conditions.

🤝 Mission: Provide reliable monitoring and tools so the Foundation can scale quality education and extracurricular activities while keeping operational overheads low.

Key active chapters and programs include:

Amader Pathshala (Sirjan Chapter) — Barshi village, Bankura. Offers structured education and runs the Bigyanusandhan Kendra (Science Center) for hands-on training.

Sokaler Pathshala (Bandwan Chapter) — Launched in 2023; morning study sessions now serving 60+ students with 7 volunteers.

Creative Arts & Annual Events — Painting exhibitions, recitations and a yearly event that showcased 200+ student paintings.

✨ Key Features
1. 🔐 Hierarchical Role-Based Access Control (RBAC)
Role Structure: Admin → Center Programme Director → Center Programme Coordinator → {Volunteer, Event Manager} → Student.

Secure Authentication: Email/password login, sessions handled with HttpOnly JWT cookies.

Granular Permissions: Middleware (middleware/authJwt.js) enforces what each role can read or modify.

2. 👥 Advanced Volunteer & Staff Management
Unified Profile System: Role promotions copy core volunteer data so profiles remain consistent. Edits via volunteer dashboard sync automatically.

Dynamic Onboarding: Admins may pre-register staff and volunteers; users complete registration with details later.

Account Lifecycle: Admins can activate/deactivate accounts. Deactivation removes or archives related data as configured.

3. ✅ Multi-Factor Attendance Verification
📍 Location-Based Check-in: Device GPS must be within a configurable radius (default 100 meters) of scheduled coordinates.

😊 Face Verification: Python microservice using InsightFace (buffalo_l) generates and compares facial embeddings.

👆 Fingerprint Verification: WebAuthn (passwordless) support for secure biometric check-ins.

📂 Media Storage: Images and embeddings stored to Google Cloud Storage buckets.

4. 🗓️ Comprehensive Schedule & Holiday Management
Dynamic Scheduling: Create day/shift/subject-specific schedules with GPS coordinates.

Seasonal Schedules: Cron jobs switch between summer/winter schedules automatically based on date.

Holidays: Foundation-specific holiday rules respected by absence and attendance logic.

5. 🎉 Event & Activity Reporting
Dynamic Event Types: Track events like Karate classes, Painting sessions, Science fairs with custom fields.

Media Uploads: Event photos upload directly to GCS.

Filterable Reports: Exportable and filterable reports for attendance, volunteer activity, and event summaries.

6. 🤖 Automated Cron Jobs
Absence Checking: Automatically marks absent volunteers on missed sessions.

Lateness Tracking: Marks check-ins as late when they are beyond a configurable threshold (default 15 minutes).

Season Switcher: Applies seasonal start/end times to schedules.

🏗️ Architecture Overview
The project uses a hybrid architecture combining a monolithic Node.js application with a Python microservice for AI tasks.

Code snippet

graph TD
    subgraph "💻 User's Browser"
        A[Frontend UI <br> HTML/CSS/JS]
    end

    subgraph "☁️ Cloud Infrastructure"
        B(Nginx Reverse Proxy)
        C{Node.js Backend <br> (Docker on Linode)}
        D[Python AI Service <br> (InsightFace on Linode)]
        E[MySQL Database <br> (Aiven)]
        F[MongoDB Database <br> (MongoDB Atlas)]
        G[Google Cloud Storage <br> (User Photos, Embeddings, Event Media)]
    end

    A -- HTTP/S Requests --> B
    B -- Proxies to --> C
    C -- 🧠 AI Tasks --> D
    C -- 🗃️ Relational Data --> E
    C -- 📄 Non-Relational Data --> F
    C -- 📂 File Operations --> G
    D -- 📂 File Operations --> G
🛠️ Tech Stack
<p align="center">
<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
<img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express.js">
<img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
<img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL">
<img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB">
<img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
<img src="https://img.shields.io/badge/Nginx-009639?style=for-the-badge&logo=nginx&logoColor=white" alt="Nginx">
<img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white" alt="Google Cloud">
</p>

🚀 Getting Started
Follow these steps to get a local copy up and running for development.

Prerequisites
Git

Node.js (v18 or higher recommended)

npm (comes with Node)

Python 3.10 or higher

pip

Docker & Docker Compose

Installation & Setup
Clone the repository:

Bash

git clone https://github.com/Saikat-dot678/sohojia-foundation.git
cd sohojia-foundation
Create and configure your .env file:
Create a file named .env in the project root. Copy the contents of the example below and fill in your credentials.

⚠️ Important: Do not commit .env to version control. It is already in .gitignore.

Code snippet

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
Install dependencies:

Bash

# For the Node.js backend
npm install

# For the Python service
pip install -r python-service/requirements.txt
Run the application:

Option A (Recommended): Docker Compose

Bash

docker-compose up --build
Option B: Manually
Run each service in a separate terminal after starting your databases.

☁️ Deployment & Nginx Configuration
The production environment runs as a Docker container on a Linode server, proxied by Nginx.

Below is a sample Nginx configuration. Replace your_domain.com and adjust paths for your SSL certificates.

Nginx

# /etc/nginx/sites-available/your_domain.com

# HTTP Server Block - Redirects all traffic to HTTPS
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

-----

### 📜 Obtaining an SSL Certificate (Let's Encrypt / Certbot)

On Ubuntu with snap:

```sh
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx
```

Test and reload nginx after certbot completes:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

-----

## 🔒 Security & Privacy

  * **Authentication:** JWT tokens stored in secure, HttpOnly cookies.
  * **Password Storage:** Passwords hashed with `bcrypt`.
  * **Biometric Data:** Facial images and embeddings are treated as sensitive — keep storage buckets private, use proper IAM service accounts, and rotate service keys.
  * **Data Retention:** Configure retention and archival policies for media and logs according to Foundation policy and local regulations.

-----

## 💻 Development Notes

  * **AI Service:** The Python service exposes endpoints like `/generate-embedding` and `/verify-face` and uses InsightFace with ONNX Runtime for performance.
  * **Database Design:** MySQL stores relational entities (users, roles, schedules). MongoDB stores logs, embeddings metadata, and large non-relational objects.
  * **File Uploads:** Multer middleware handles uploads and streams final files to Google Cloud Storage.
  * **Cron Jobs:** `node-cron` tasks handle absence checking, lateness updates, and seasonal schedule switching.

### workflow

1.  Start DB services (or use cloud dev instances).
2.  Start Node backend with `nodemon` or `npm run dev`.
3.  Start Python AI service in a separate terminal.
4.  Use a browser to access the UI and create test users and schedules.

-----

## 🔧 Troubleshooting & FAQs

**❓ Q: Face verification failing for many users?**

  * Ensure the Python service is running and can access the GCS bucket.
  * Confirm embeddings were created with enough images (10 recommended).
  * Check Python service logs for image-read or ONNX errors.

**❓ Q: Cron jobs not running?**

  * Confirm `node-cron` is active and the process is running. In production, ensure only one instance runs scheduled jobs.

**❓ Q: File upload size errors in production?**

  * Increase `client_max_body_size` in your Nginx configuration.

-----

## 🤝 Contributing

Contributions are welcome\! If you'd like to contribute:

1.  Fork the repo
2.  Create a feature branch: `git checkout -b feat/my-feature`
3.  Commit your changes: `git commit -m "feat: describe your change"`
4.  Push and open a Pull Request

Please follow the code style and add tests where applicable.

-----

## 📜 License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.

-----

## 🙏 Acknowledgments & Contributors

This project stands on the shoulders of great open-source projects and cloud platforms. Special thanks to:

  * Node.js, Express.js
  * Python, InsightFace, ONNX Runtime
  * Docker & Docker Compose
  * MySQL (Aiven), MongoDB Atlas
  * Google Cloud Storage
  * Linode

**Authors & Maintainers**

  * **Saikat-dot678** — *Project Lead & Developer*

-----

*Thank you for supporting the Sohojia Foundation — together we can make quality education accessible to more children in rural communities. ❤️*
