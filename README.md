## ✨ Key Features

  * **Automated Volunteer Tracking**

      * **Schedule Management:** Admins can create and assign location-based schedules for all volunteers.
      * **Biometric Presence Verification:** To ensure accurate attendance, the system verifies a volunteer's presence using:
          * **Location-Based Check-in:** Confirms volunteers are at the scheduled center.
          * **Face Verification:** A **Python** service powered by the `buffalo_l` model from InsightFace generates facial embeddings from initial pictures and later verifies identity.
          * **Fingerprint Verification:** Utilizes the **WebAuthn API** for secure, passwordless authentication.
      * **Secure Image Storage:** Volunteer images and facial embeddings are stored securely in **Google Cloud Storage** buckets.

  * **Hierarchical Role Management**

      * **Secure Authentication:** Uses JSON Web Tokens (JWT) for managing user sessions and securing API endpoints.
      * **Clear Hierarchy:** `Admin` \> `Center Programme Director` \> `Center Programme Coordinator` \> (`Volunteer`, `Event Manager`) \> `Student`
      * **Defined Permissions:** Each role has specific permissions, from the Admin with full system control to Volunteers who can manage their assigned students.

-----

## 🛠️ Tech Stack

  * **Backend:** `Node.js`, `Express.js`
  * **AI / Machine Learning:** `Python` (for InsightFace facial recognition)
  * **Databases:**
      * `MySQL` (for relational data)
      * `MongoDB` (for non-relational data)
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

  * Node.js and npm installed
  * Python installed (for the verification service)
  * Docker and Docker Compose installed
  * Git

### Installation

1.  **Clone the repository**

    ```sh
    git clone https://github.com/your-username/sohojia-foundation.git
    ```

2.  **Navigate to the project directory**

    ```sh
    cd sohojia-foundation
    ```

3.  **Create a `.env` file**
    Create a `.env` file in the root directory and add the necessary environment variables. **Do not commit this file to Git.**

    ```env
    # Server Configuration
    PORT=3000
    NODE_ENV="development"

    # MySQL Database Connection (Aiven)
    SQL_HOST=your_sql_host
    SQL_PORT=your_sql_port
    SQL_USER=your_sql_user
    SQL_PASS=your_sql_password
    SQL_DATABASE=your_sql_database_name
    MYSQL_CA_PATH=path/to/your/ca.pem

    # MongoDB Connection (MongoDB Atlas)
    MONGO_URI=your_mongodb_atlas_uri

    # Session and JWT Secrets
    SESSION_SECRET=a_very_long_and_random_session_secret
    JWT_SECRET=another_very_long_and_random_jwt_secret
    JWT_EXPIRES_IN=2h

    # Default Admin Credentials
    ADMIN_USERNAME=admin_user
    ADMIN_PASSWORD=a_strong_and_secure_password

    # Google Cloud Storage Configuration
    GOOGLE_APPLICATION_CREDENTIALS=path/to/your/gcloud_service_account.json
    GCLOUD_PROJECT=your_gcloud_project_id
    BUCKET1='your-primary-image-bucket-name'
    BUCKET2='your-embeddings-bucket-name'
    ```

4.  **Install Dependencies**

    ```sh
    npm install
    ```

5.  **Run the application**

    ```sh
    npm start
    ```
