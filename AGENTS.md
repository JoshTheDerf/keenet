# AGENTS.md

Guidance for AI agents working in the keeweb repository.

## What this is

KeeWeb is a password manager application. This is a web-based password manager compatible with KeePass databases.

## Commands

```bash
npm install
npm run dev              # Start development server
npm run build            # Build for production
npm run build:web        # Build web version
npm run test             # Run tests
```

## Architecture & Tech Stack

- **Frontend**: TypeScript + Vue 3
- **Build**: Vite + Capacitor for mobile
- **Database**: KeePass compatible database format
- **Deployment**: Web and mobile (Capacitor)

## Project Structure

- `src/` - Main source code
- `dist/` - Built output
- `dist-nc/` - Nextcloud compatible build
- `resources/` - Application resources
- `src-tauri/` - Desktop application (Tauri)
- `docs/` - Documentation

## Key Features

- Cross-platform password manager
- KeePass database compatibility
- Web and desktop applications
- Nextcloud integration available

## Important Notes

- Uses Vue 3 with Composition API
- Capacitor for mobile apps
- Tauri for desktop application
- Multiple build targets (web, Nextcloud, desktop)

## Deployment

This project can be deployed as:
- Web application via Cloudflare Workers (keenet.thederf.com)
- Nextcloud application
- Desktop application via Tauri
- Mobile application via Capacitor

## Gotchas

- Database format must remain KeePass compatible
- Encryption handling requires special care
- Multiple build targets have different configurations
- Web version has different capabilities than desktop