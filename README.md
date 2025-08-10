# Node.js Photo Manager

This is a photo management application with a Node.js backend and a React frontend.

## Getting Started

### Prerequisites

- Node.js (v22 LTS required)
- npm (v10 or newer)

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

## CI

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Uses Node 22, runs `npm ci`, and performs a production audit (`npm audit --omit=dev`).
- Ensure local development matches CI by using Node 22. You can use nvm:
  ```bash
  nvm install 22
  nvm use 22
  ```

## Frontend (CRA) Note

- The client is bootstrapped with Create React App (CRA) via `react-scripts@5`.
- React itself is on latest stable (`react@19`), but CRA’s toolchain (webpack, svgo, resolve-url-loader, webpack-dev-server) can report advisories in audits.
- These advisories are typically dev-only and do not affect the backend security posture. We’re intentionally keeping the frontend unchanged for now.
- If we want to reduce audit noise in the future, consider migrating from CRA to a modern bundler (e.g., Vite). This is optional and can be planned later.