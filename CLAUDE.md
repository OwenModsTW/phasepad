# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PhasePad is an Electron-based transparent overlay sticky notes application for Windows. It provides a desktop overlay system where users can create various types of notes (text, images, timers, todos, etc.) that float above all other windows. The application uses dual workspaces (Home/Work), persistent storage, and hotkey controls.

## Core Architecture

### Main Process (`main.js`)
- Creates and manages the transparent overlay BrowserWindow
- Handles global hotkeys (Alt+Q default toggle)
- Manages system tray integration
- Handles IPC communication for screenshots, file operations, and window management
- Integrates with Windows context menu for images

### Renderer Process (`overlay/overlay.js` - 8277 lines)
- Implements the complete note management system with 13 different note types
- Handles workspace switching (Home/Work)
- Manages note persistence to JSON files
- Implements search, archive, and tagging features
- Contains all UI logic for note creation, editing, and interaction

### Data Structure
- Notes are stored in `data/home-notes.json` and `data/work-notes.json`
- Each note has: id, type, title, content, position, size, color, tags, timestamps
- Configuration stored in `config.json` (hotkeys, data folder location)
- Workspace preference in `data/workspace-preference.json`

## Commands

```bash
# Development
npm start          # Run the application normally
npm run dev        # Run in development mode with dev tools

# Building
npm run build      # Build for current platform
npm run build-win  # Build specifically for Windows
npm run build-safe # Run security check before building
npm run dist       # Alias for build

# Security
npm run security-check  # Scan for potential secrets/sensitive files
```

## Key Implementation Details

### Note Types Implementation
Each note type has specific rendering and interaction logic in `overlay.js`:
- Text notes: Basic contenteditable divs
- Timer notes: Can detach to separate windows via IPC
- Image notes: Handle drag-drop and context menu integration
- Paint notes: Canvas-based drawing with tools
- Todo notes: Checkbox list management
- Table notes: Dynamic table creation/editing

### IPC Channels
Main process listens for:
- `toggle-overlay`: Show/hide overlay
- `create-timer-window`: Detach timer to separate window
- `open-area-selector`: Screenshot area selection
- `capture-screenshot`: Full screen capture
- `update-hotkeys`: Dynamic hotkey registration
- `get-data-folder`/`set-data-folder`: Data location management

### Hotkey System
- Configurable hotkeys stored in `config.json`
- Main process uses `globalShortcut` API
- Default: Alt+Q (toggle), Ctrl+Shift+N (new note), Ctrl+F (search), Ctrl+Shift+A (archive)

### Window Management
- Overlay window is transparent, frameless, always-on-top
- Uses `transparent: true` and `backgroundColor: '#00000000'`
- Click-through handled via CSS `pointer-events`
- Timer windows can detach as separate BrowserWindows

## Development Guidelines

### Working with the Overlay
- The overlay is a single large transparent window covering the entire screen
- Individual notes are absolutely positioned divs
- Background uses `backdrop-filter` for blur effect
- All interactions happen through the overlay window

### Adding New Note Types
1. Add type to `noteTypes` array in `overlay.js`
2. Implement `create[Type]NoteContent()` function
3. Add case in `renderNoteContent()` switch
4. Handle any special interactions/updates

### File Organization
- All UI code is in `overlay/overlay.js` (single large file)
- Styles in `overlay/overlay.css`
- Separate HTML for timer windows and screenshot selector
- Icons and assets in `media/` directory

### Data Persistence
- Notes auto-save on any change via `saveNotes()`
- Workspace preference saved separately
- Configuration changes require app restart for hotkeys

### Testing Approach
No automated tests currently exist. Manual testing required for:
- Note creation/editing/deletion
- Workspace switching
- Data persistence across restarts
- Hotkey functionality
- Screenshot features
- Timer detachment

## Security Considerations

The project includes `build/security-check.js` which scans for:
- Sensitive file patterns (keys, tokens, credentials)
- Dangerous content in code files
- Missing security configurations

Run `npm run security-check` before building for production.

## Known Limitations

- Windows-only (uses Windows-specific features)
- Single monitor support for overlay
- No automated testing framework
- All UI code in single 8000+ line file
- No component separation or modularization