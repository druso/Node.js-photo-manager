# Node.js Photo Manager

This is a photo management application with a Node.js backend and a React frontend.

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- npm

### Installation

1.  **Backend Dependencies:**
    Navigate to the project's root directory and run:
    ```bash
    npm install
    ```

2.  **Frontend Dependencies:**
    Navigate to the `client` directory and run:
    ```bash
    cd client
    npm install
    ```

### Running the Application

You need to have two terminals open to run both the backend and frontend servers concurrently.

1.  **Start the Backend Server:**
    In the project's root directory, run:
    ```bash
    node server.js
    ```
    The backend will be running on `http://localhost:5000`.

2.  **Start the Frontend Development Server:**
    In a separate terminal, navigate to the `client` directory and run:
    ```bash
    npm start
    ```
    The frontend will open automatically in your browser at `http://localhost:3000`.


## Security

This project uses short‑lived signed URLs for downloads by default. For details, configuration, and future hardening guidance (auth and packaging), see `SECURITY.md`.




node server.js

cd client
npm start