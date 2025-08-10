# Node.js Photo Manager

This is a photo management application with a Node.js backend and a React (Vite) frontend.

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
    In the project's root directory, run one of:
    ```bash
    npm start         # plain Node (recommended during testing)
    # or
    npm run dev       # nodemon auto-restarts on backend file changes
    ```
    The backend runs on `http://localhost:5000`.

2.  **Start the Frontend (Vite) Dev Server:**
    In a separate terminal, navigate to the `client` directory and run:
    ```bash
    npm run dev       # Vite dev server on http://localhost:3000
    ```
    Additional scripts:
    ```bash
    npm run build     # production build to dist/
    npm run preview   # preview the production build on http://localhost:3000
    ```
    The Vite dev server proxies `/api/*` to `http://localhost:5000` as configured in `client/vite.config.js`.

## Security

This project uses short‑lived signed URLs for downloads by default. For details, configuration, and future hardening guidance (auth and packaging), see [`SECURITY.md`](SECURITY.md).

## CI

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Uses Node 22, runs `npm ci`, and performs a production audit (`npm audit --omit=dev`).
- Ensure local development matches CI by using Node 22. You can use nvm:
  ```bash
  nvm install 22
  nvm use 22
  ```

## Frontend (Vite) Note

- Frontend uses Vite with `@vitejs/plugin-react`.
- Entry point: `client/index.html` -> `src/main.jsx` -> `src/App.jsx` and components (`.jsx`).
- Dev server: `http://localhost:3000` with proxy to backend on `http://localhost:5000`.
- If you see JSX parse overlays, ensure JSX files use `.jsx` and clear Vite cache: `rm -rf client/node_modules/.vite`.

## Schema Documentation

See [`SCHEMA_DOCUMENTATION.md`](SCHEMA_DOCUMENTATION.md) for the project data/manifest schema and field definitions.

## Troubleshooting

- **Port 5000 in use**: kill old processes
  ```bash
  lsof -i :5000 -t | xargs -r kill
  lsof -i :5000 -t | xargs -r kill -9
  pkill -f "nodemon|node server.js" || true
  ```
- **Vite cache issues**: clear and restart
  ```bash
  rm -rf client/node_modules/.vite
  (cd client && npm run dev)
  ```
