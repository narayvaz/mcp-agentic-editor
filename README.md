# Azat Studio

A high-performance, agent-driven dashboard for managing SEO, WordPress health, and content reviews. Built with React, TypeScript, and Tailwind CSS.

## Local Setup (iMac Terminal)

To run this application locally on your iMac:

### 1. Prerequisites
- Node.js 20+ and npm installed.
- Gemini API key.

### 2. Open the Project
```bash
cd ~/Downloads/mcp-agentic-editor
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment
Create a `.env` file:
```bash
cp .env.example .env
```

Edit `.env` and set:
```env
GEMINI_API_KEY="your_real_key_here"
PORT=3000
```

### 5. Run the App in Browser (Dev)
Start the development server:
```bash
npm run dev
```

### 6. Run as a Native Desktop App (Dev)
```bash
npm run electron:dev
```

### 7. Build a Standalone DMG (Installer)
This creates a `.dmg` installer for iMac:
```bash
npm run electron:build
```

Output files are placed in:
- `release/Azat-Studio-<version>-arm64.dmg`
- `release/Azat-Studio-<version>-arm64.zip`

### 8. Access the Browser App
If running `npm run dev`, open:
- http://localhost:3000

---

## Tech Stack
- **Frontend:** React 19, TypeScript, Vite
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **Charts:** Recharts
- **Animations:** Motion (formerly Framer Motion)
- **Backend:** Express + Vite middleware
- **Desktop Packaging:** Electron + electron-builder
- **AI Integration:** Google Gemini API via `/api/agent`

## Project Structure
- `src/App.tsx`: Main application layout and routing.
- `src/components/`: Reusable UI components (Dashboard, Sidebar, AgentChat, etc.).
- `src/services/`: Frontend API integration services.
- `src/main.tsx`: Application entry point.
- `server.ts`: Express backend for API routes and Vite middleware.
- `electron/main.ts`: Electron desktop entry point.

## Agent Capabilities
The built-in MCP Agent can:
- **Analyze Content:** Review news articles for SEO and readability.
- **Multimodal Support:** Process images, audio, and video uploaded to the chat.
- **AI Q&A:** Uses Gemini through the backend endpoint.
- **WordPress Health:** Monitor site performance and suggest optimizations.
