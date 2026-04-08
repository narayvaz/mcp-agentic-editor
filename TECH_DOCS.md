# Technical Documentation: MCP Agentic Editor

This document provides technical details for developers and users running the MCP Agentic Editor locally on their iMac.

## 🏗 Architecture Overview

The MCP Agentic Editor is a full-stack application using **Express** as the backend and **Vite** as the frontend development server.

### 1. Backend (server.ts)
The backend is an Express server that handles:
- **API Routes:** `/api/seo-stats`, `/api/wp-status`, `/api/agent`, etc.
- **Vite Middleware:** In development mode, it uses `createViteServer` to serve the frontend.
- **Production Serving:** In production, it serves static files from the `dist/` directory.

### 2. Frontend (src/)
The frontend is a React application built with TypeScript:
- **Dashboard:** Real-time data visualization using `recharts`.
- **Agent Chat:** A custom chatbot interface using `motion` for animations.
- **Multimodal Support:** Handles file uploads (images, audio, video) and sends them to the Gemini API.

### 3. AI Integration
- Frontend `src/services/gemini.ts` calls the backend route `/api/agent`.
- Backend `server.ts` uses `@google/genai` to call Gemini.
- **Model:** `gemini-3-flash-preview`.
- **Capabilities:** Text generation, image analysis, audio/video processing.
- **Context:** The agent is provided with the current application state (e.g., "Currently viewing the dashboard").

### 4. Desktop Integration (Electron)
The application is configured to run as a native desktop app using **Electron**:
- **Main Process:** `electron/main.ts` manages the application lifecycle and window creation.
- **Embedded Backend:** In production desktop mode, Electron starts the bundled Express server and loads it via localhost.
- **Development:** Uses `concurrently` to run the Vite dev server and Electron window simultaneously.
- **Build:** Uses `electron-builder` to package the app into a macOS `.dmg` or `.app` file.

---

## 🛠 Development Commands

### Install Dependencies
```bash
npm install
```

### Start Web Development Server
```bash
npm run dev
```
- Accessible at `http://localhost:3000`.

### Start Desktop Development (Standalone Window)
```bash
npm run electron:dev
```
- Opens the app in a dedicated desktop window on your iMac.

### Build Native Installer (DMG)
```bash
npm run electron:build
```
- Generates a standalone installer in the `release/` folder.

---

## 🔒 Security & Privacy
- **Local Run:** When running locally, your data stays on your iMac.
- **API Keys:** The Gemini API key is managed via environment variables.
- **No External Tracking:** The app does not track your browser history or local files unless you explicitly upload them to the agent.

## 🧩 Component Documentation

### AgentChat.tsx
The core interaction component. It manages message history, file attachments, and calls the Gemini service.
- **Props:** `context` (string), `onClose` (function).
- **State:** `messages` (array), `input` (string), `attachments` (array).

### ContentReviewer.tsx
A specialized tool for reviewing news articles. It sends the article content to the agent for a detailed SEO and readability audit.

### ToolGenerator.tsx
A utility that allows the agent to generate new tools or features for the application by modifying the source code.
