-----

# Sohojia Foundation Monitoring System

    

A web-based volunteer and activity monitoring system designed to support the Sohojia Foundation's mission of providing education and extracurricular activities to rural students.

-----

## 📖 Table of Contents

  * [About The Project](https://www.google.com/search?q=%23-about-the-project)
  * [Key Features](https://www.google.com/search?q=%23-key-features)
  * [Architecture Overview](https://www.google.com/search?q=%23-architecture-overview)
  * [Tech Stack](https://www.google.com/search?q=%23-tech-stack)
  * [Getting Started](https://www.google.com/search?q=%23-getting-started)
      * [Prerequisites](https://www.google.com/search?q=%23prerequisites)
      * [Installation & Setup](https://www.google.com/search?q=%23installation--setup)
  * [Deployment](https://www.google.com/search?q=%23-deployment)
  * [License](https://www.google.com/search?q=%23-license)

-----

## 📖 About The Project

The **Sohojia Foundation** is a non-profit organization dedicated to empowering students in village communities through education, arts (painting, recitation), martial arts (karate), and science (weekly workshops, science fairs).

As a non-profit, physically managing and tracking our dedicated volunteers across different centers is a significant logistical and financial challenge. This project aims to solve that problem by providing a robust, automated monitoring system. The system ensures volunteers are present at their scheduled locations and times, replacing manual oversight with modern technology and allowing the foundation to focus its resources on the students.

-----

## ✨ Key Features

  * **Automated Volunteer Tracking**

      * **Schedule Management:** Admins can create and assign location-based schedules for all volunteers.
      * **Biometric Presence Verification:** To ensure accurate attendance, the system verifies a volunteer's presence using:
          * **Location-Based Check-in:** Confirms volunteers are at the scheduled center using their device's location.
          * **Face Verification:** A **Python** service powered by the `buffalo_l` model from InsightFace generates facial embeddings from 10 initial pictures and later verifies their identity by comparing a new picture against this embedding.
          * **Fingerprint Verification:** Utilizes the **WebAuthn API** for secure, passwordless authentication and presence verification.
      * **Secure Image Storage:** Volunteer images and facial embeddings are stored securely in **Google Cloud Storage** buckets.

  * **Hierarchical Role Management**

      * **Secure Authentication:** Uses JSON Web Tokens (JWT) for managing user sessions and securing API endpoints.
      * **Clear Hierarchy:** The system enforces a strict permission structure.
        ```
        Admin
          └── Center Programme Director
              └── Center Programme Coordinator
                  ├── Volunteer
                  │   └── Student
                  └── Event Manager
        ```
      * **Defined Permissions:**
          * **Admin:** Has full control. Can add all other roles, manage schedules, holidays, and monitor all system activity.
          * **Volunteer:** Can view their schedule and add/manage their assigned students.
          * **Event Manager:** Manages event data and can record student attendance for specific events.

-----

## 🏗️ Architecture Overview

This project uses a microservice-oriented architecture to separate concerns. The main application handles user management and business logic, while a specialized service handles computationally intensive AI tasks.

```
+---------------------------------+      +--------------------------------+
|        Node.js Backend          |      |       Python AI Service        |
| (Express.js)                    |      | (InsightFace)                  |
| - REST API                      |<---->| - /generate-embedding          |
| - User Auth (JWT)               |      | - /verify-face                 |
| - Scheduling & Role Logic       |      |                                |
+---------------------------------+      +--------------------------------+
```

-----

## 🛠️ Tech Stack

  * **Backend:** `Node.js`, `Express.js`
  * **AI / Machine Learning:** `Python` (for InsightFace facial recognition)
  * **Frontend:** `HTML`, `CSS`, `JavaScript`
  * **Databases:**
      * `MySQL` (for relational data like users, roles, and schedules)
      * `MongoDB` (for non-relational data like logs or facial embeddings)
  * **Authentication:** `JSON Web Token (JWT)`, `WebAuthn`
  * **Containerization:** `Docker`
  * **Deployment & Hosting:**
      * **Application:** `Linode`
      * **Databases:** `Aiven` for MySQL, `MongoDB Atlas` for MongoDB
      * **File Storage:** `Google Cloud Storage`

-----

## 🚀 Getting Started

To get a local copy up and running, follow these steps.

### Prerequisites

  * Git
  * Node.js & npm
  * Python
  * Docker & Docker Compose

### Installation & Setup

1.  **Clone the repository**

    ```sh
    git clone https://github.com/Saikat-dot678/sohojia-foundation.git
    ```

2.  **Navigate to the project directory**

    ```sh
    cd sohojia-foundation
    ```

3.  **Create and configure your environment file**
    Create a file named `.env` in the project root. Copy the contents of `.env.example` below into it and fill in your actual credentials and paths.

    ⚠️ **Important:** Do not commit your `.env` file to version control. Add it to your `.gitignore` file.

    **.env.example**

    ```env
    # Server Configuration
    PORT=3000
    NODE_ENV="development"

    # MySQL Database Connection (Aiven)
    SQL_HOST=your_sql_host
    SQL_PORT=your_sql_port
    SQL_USER=your_sql_user
    SQL_PASS=your_sql_password
    SQL_DATABASE=sohojia_foundation
    MYSQL_CA_PATH=path/to/your/ca.pem

    # MongoDB Connection (MongoDB Atlas)
    MONGO_URI=your_mongodb_atlas_connection_string

    # Session and JWT Secrets
    SESSION_SECRET=a_very_long_and_random_session_secret
    JWT_SECRET=another_very_long_and_random_jwt_secret
    JWT_EXPIRES_IN=2h

    # Default Admin Credentials
    ADMIN_USERNAME=admin
    ADMIN_PASSWORD=a_strong_and_secure_password

    # Google Cloud Storage Configuration
    GOOGLE_APPLICATION_CREDENTIALS=path/to/your/gcloud_service_account.json
    GCLOUD_PROJECT=your_gcloud_project_id
    BUCKET1='your-primary-image-bucket-name'
    BUCKET2='your-embeddings-bucket-name'
    ```

4.  **Install dependencies**

    ```sh
    # For the Node.js backend
    npm install

    # For the Python service (navigate to its directory first)
    cd python-service/
    pip install -r requirements.txt
    cd ..
    ```

5.  **Run the application**
    The easiest way to run the entire stack is with Docker Compose.

    ```sh
    docker-compose up --build
    ```

    Alternatively, you can run each service manually in separate terminals.

-----

## ☁️ Deployment

The production environment is hosted on a combination of cloud services:

  * The main **Node.js application** and **Python service** are containerized with Docker and deployed on a **Linode** server.
  * The **MySQL** database is managed by **Aiven**.
  * The **MongoDB** database is hosted on **MongoDB Atlas**.
  * All media files, such as volunteer photos and facial embeddings, are stored in **Google Cloud Storage** for scalability and reliability.

-----

## 📜 License

This project is licensed under the MIT License. See the `LICENSE` file for more details.


## 🙏 Acknowledgments

A project of this scale would not be possible without the incredible open-source software and services that power it. We would like to extend our gratitude to the following:

* **Key Technologies:**
    * [Node.js](https://nodejs.org/) - For the core backend runtime environment.
    * [Python](https://www.python.org/) - For powering our machine learning services.
    * [Docker](https://www.docker.com/) - For containerizing our application for consistent deployment.
    * [MySQL](https://www.mysql.com/) & [MongoDB](https://www.mongodb.com/) - For our data storage needs.

* **APIs & Services:**
    * [InsightFace](https://github.com/deepinsight/insightface) - For the powerful `buffalo_l` facial recognition model.
    * [Google Cloud](https://cloud.google.com/) - For reliable and scalable object storage.
    * [Linode](https://www.linode.com/), [Aiven](https://aiven.io/), and [MongoDB Atlas](https://www.mongodb.com/atlas) - For providing the infrastructure that hosts our live application.

* **Authors & Contributors:**
    * **Saikat-dot678** - *Project Lead & Developer*
