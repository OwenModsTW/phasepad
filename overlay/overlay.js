const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let notes = [];
let archivedNotes = [];
let activeNote = null;
let currentWorkspace = 'home';
let workspaceData = {
  home: { notes: [], archivedNotes: [] },
  work: { notes: [], archivedNotes: [] }
};
let isDragging = false;
let isResizing = false;
let dragOffset = { x: 0, y: 0 };
let resizeStart = { width: 0, height: 0, x: 0, y: 0 };
let isArchivePanelVisible = false;
let reminderCheckInterval = null;

// Configuration management
let appConfig = {
  dataPath: path.join(require('os').homedir(), 'PhasePad', 'data'),
  hotkeys: {
    toggleOverlay: 'Alt+Q',
    newNote: 'Ctrl+Shift+N',
    search: 'Ctrl+F',
    archive: 'Ctrl+Shift+A'
  },
  confirmDelete: true,
  checkForUpdates: true,
  theme: 'default' // Default theme setting
};
const configPath = path.join(require('os').homedir(), 'PhasePad', 'config.json');

const noteColors = [
  '#ffd700', // yellow
  '#ff69b4', // pink
  '#90ee90', // green
  '#87ceeb', // blue
  '#dda0dd', // purple
  '#ffa500', // orange
  '#ffffff', // white
  '#d3d3d3'  // gray
];

// Helper function to get note type icon
function getNoteTypeIcon(type) {
  const iconMap = {
    'text': '../media/textnote.png',
    'file': '../media/fileicon.png', 
    'image': '../media/imagenote.png',
    'paint': '../media/paintnote.png',
    'todo': '../media/todonote.png',
    'reminder': '../media/remindernote.png',
    'web': '../media/webnote.png',
    'table': '../media/tablenote.png',
    'location': '../media/locationnote.png',
    'calculator': '../media/calculatornote.png',
    'timer': '../media/timernote.png',
    'folder': '../media/foldernote.png',
    'code': '../media/codenote.png',
    'document': '../media/documenticon.png',
  };
  return iconMap[type] || '../media/textnote.png';
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('overlay-container');
  container.classList.add('fade-in');
  
  loadNotes();
  setupEventListeners();
  loadCustomizationPreferences();
  
  // Check for updates if enabled
  if (appConfig.checkForUpdates !== false) {
    checkForUpdates();
  }
  setupIPCListeners();
  setupSearchFunctionality();
  setupKeyboardShortcuts();
  setupWorkspaceSwitcher();
  initializeOverlayColor();
  startReminderChecker();
});

function setupIPCListeners() {
  ipcRenderer.on('fade-in', () => {
    const container = document.getElementById('overlay-container');
    container.classList.remove('fade-out');
    container.classList.add('fade-in');
    
    // Close any detached timer windows when overlay opens
    notes.forEach(note => {
      if (note.type === 'timer' && note.detached) {
        ipcRenderer.invoke('close-timer-window', note.id);
        note.detached = false;
      }
    });
  });
  
  ipcRenderer.on('fade-out', () => {
    const container = document.getElementById('overlay-container');
    container.classList.remove('fade-in');
    container.classList.add('fade-out');
    
    // Detach any running timer notes
    notes.forEach(note => {
      if (note.type === 'timer' && note.timerRunning && !note.detached) {
        const noteElement = document.getElementById(note.id);
        if (noteElement) {
          const rect = noteElement.getBoundingClientRect();
          ipcRenderer.invoke('create-timer-window', {
            id: note.id,
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            title: note.title || getTimerAutoTitle(note),
            timerType: note.timerType,
            timerDuration: note.timerDuration,
            timerRemaining: note.timerRemaining,
            timerRunning: note.timerRunning
          });
          note.detached = true;
        }
      }
    });
    saveNotes();
  });
  
  ipcRenderer.on('focus-on-note', (event, noteId) => {
    focusOnNote(noteId);
  });
  
  // Handle timer widget actions
  ipcRenderer.on('timer-widget-action', (event, data) => {
    const { noteId, action } = data;
    
    switch (action) {
      case 'toggle':
        toggleTimer(noteId);
        break;
      case 'complete':
        const note = notes.find(n => n.id === noteId);
        if (note) {
          note.timerRemaining = 0;
          note.timerRunning = false;
          note.detached = false;
          playTimerSound();
          showTimerNotification(note);
          saveNotes();
        }
        break;
      case 'return':
        // Show overlay and focus on timer note
        ipcRenderer.invoke('show-overlay-and-focus-note', noteId);
        const returnNote = notes.find(n => n.id === noteId);
        if (returnNote) {
          returnNote.detached = false;
          saveNotes();
        }
        break;
    }
  });
  
  // Handle timer widget updates
  ipcRenderer.on('timer-widget-update', (event, data) => {
    const { noteId, timerRemaining } = data;
    const note = notes.find(n => n.id === noteId);
    if (note) {
      note.timerRemaining = timerRemaining;
      updateTimerDisplay(noteId);
      updateTimerProgress(noteId);
      saveNotes();
    }
  });
  
  // Handle global shortcut commands
  ipcRenderer.on('create-new-note', (event, noteType) => {
    console.log('Received create-new-note command for type:', noteType);
    createNewNote(window.innerWidth / 2, window.innerHeight / 2, noteType);
  });
  
  // Handle search focus
  ipcRenderer.on('focus-search', () => {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  });
  
  // Handle archive toggle
  ipcRenderer.on('toggle-archive', () => {
    const archiveBtn = document.getElementById('archive-btn');
    if (archiveBtn) {
      archiveBtn.click();
    }
  });
}

// Helper function to get timer auto title
function getTimerAutoTitle(note) {
  if (note.title && note.title.trim()) return note.title;
  
  switch (note.timerType) {
    case 'pomodoro': return 'Pomodoro Timer';
    case 'short-break': return 'Short Break';
    case 'long-break': return 'Long Break';
    case 'custom': return `${Math.floor(note.timerDuration / 60)} min Timer`;
    default: return 'Timer';
  }
}

function focusOnNote(noteId) {
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    // Minimize all other notes
    document.querySelectorAll('.note').forEach(note => {
      if (note.id !== noteId) {
        note.classList.add('search-minimized');
      } else {
        note.classList.remove('search-minimized');
      }
    });
    
    // Scroll note into view
    noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add visual highlight to focused note
    noteElement.classList.add('focused');
    
    // Set a flag to track we're in search focus mode
    document.body.classList.add('search-focus-mode');
    
    // Remove focus mode after 3 seconds or on any click
    const clearFocus = () => {
      document.querySelectorAll('.note').forEach(note => {
        note.classList.remove('search-minimized');
        note.classList.remove('focused');
      });
      document.body.classList.remove('search-focus-mode');
    };
    
    // Clear focus after 5 seconds
    setTimeout(clearFocus, 5000);
    
    // Also clear on any click outside the focused note
    const clickHandler = (e) => {
      if (!noteElement.contains(e.target)) {
        clearFocus();
        document.removeEventListener('click', clickHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', clickHandler);
    }, 100);
  }
}


function setupEventListeners() {
  // New note button with type selector
  const newNoteBtn = document.getElementById('new-note-btn');
  const noteTypeSelector = document.getElementById('note-type-selector');
  
  newNoteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    noteTypeSelector.classList.toggle('active');
  });
  
  // Note type options
  document.querySelectorAll('.note-type-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const noteType = e.currentTarget.dataset.type;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      createNewNote(centerX, centerY, noteType);
      noteTypeSelector.classList.remove('active');
    });
  });

  // Document dropdown functionality
  const newDocumentBtn = document.getElementById('new-document-btn');
  const documentTypeSelector = document.getElementById('document-type-selector');
  
  newDocumentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    documentTypeSelector.classList.toggle('active');
  });
  
  // Document type options
  document.querySelectorAll('.document-type-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const documentType = e.currentTarget.dataset.type;
      createNewDocument(documentType);
      documentTypeSelector.classList.remove('active');
    });
  });
  
  // Hide button
  document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('fade-out');
    // Don't close the window, just hide it - the main process will handle hiding
  });
  
  // Archive button
  document.getElementById('archive-btn').addEventListener('click', () => {
    toggleArchivePanel();
  });

  // Saved documents button
  document.getElementById('saved-docs-btn').addEventListener('click', () => {
    toggleSavedDocumentsPanel();
  });

  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => {
    showSettingsModal();
  });
  
  // Overlay color picker
  const overlayColorPicker = document.getElementById('overlay-color-picker');
  const overlayColorOptions = document.getElementById('overlay-color-options');
  
  overlayColorPicker.addEventListener('click', (e) => {
    overlayColorOptions.classList.toggle('active');
    e.stopPropagation();
  });
  
  // Close color picker when clicking outside
  document.addEventListener('click', () => {
    overlayColorOptions.classList.remove('active');
  });
  
  // Handle color option clicks
  document.querySelectorAll('.overlay-color-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const color = e.target.dataset.color;
      changeOverlayColor(color);
      overlayColorOptions.classList.remove('active');
      e.stopPropagation();
    });
  });

  // Opacity slider
  const opacitySlider = document.getElementById('opacity-slider');
  const overlayContainer = document.getElementById('overlay-container');
  
  opacitySlider.addEventListener('input', (e) => {
    const opacity = e.target.value / 100;
    const savedColor = localStorage.getItem('overlay-color') || '#4a90e2';
    
    // Convert hex to rgb
    const r = parseInt(savedColor.slice(1, 3), 16);
    const g = parseInt(savedColor.slice(3, 5), 16);
    const b = parseInt(savedColor.slice(5, 7), 16);
    
    // Apply new opacity while keeping the color
    // Note: If background image is enabled, the background opacity setting should be used instead
    // But the main opacity slider should still work for the color overlay
    overlayContainer.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  });
  
  // Escape key to minimize overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Check if we're in an input field or have any modal open
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return; // Let the other handler deal with it
      }
      
      // Check if any modal is open
      const modals = document.querySelectorAll('.screenshot-modal, .share-modal');
      if (modals.length > 0) {
        modals.forEach(modal => modal.remove());
        return;
      }
      
      // Otherwise, minimize the overlay
      e.preventDefault();
      ipcRenderer.send('toggle-overlay');
    }
  });
  
  // Close dropdowns when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#new-note-btn') && !e.target.closest('.note-type-selector')) {
      noteTypeSelector.classList.remove('active');
    }
    if (!e.target.closest('#new-document-btn') && !e.target.closest('.document-type-selector')) {
      documentTypeSelector.classList.remove('active');
    }
    if (!e.target.closest('.color-picker') && !e.target.closest('.color-options')) {
      document.querySelectorAll('.color-options').forEach(picker => {
        picker.classList.remove('active');
      });
    }
  });
}

function changeOverlayColor(color) {
  const overlayContainer = document.getElementById('overlay-container');
  const overlayColorPicker = document.getElementById('overlay-color-picker');
  
  // Convert hex to rgb
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  
  // Get current opacity
  const opacitySlider = document.getElementById('opacity-slider');
  const opacity = opacitySlider.value / 100;
  
  // Apply new color with current opacity
  overlayContainer.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  overlayColorPicker.style.backgroundColor = color;
  
  // Save color preference
  localStorage.setItem('overlay-color', color);
}

function getCurrentOverlayColor() {
  const overlayContainer = document.getElementById('overlay-container');
  const style = window.getComputedStyle(overlayContainer);
  return style.backgroundColor;
}

function initializeOverlayColor() {
  const savedColor = localStorage.getItem('overlay-color') || '#4a90e2';
  changeOverlayColor(savedColor);
}

function setupWorkspaceSwitcher() {
  // Update workspace UI to match loaded preference
  document.querySelectorAll('.workspace-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`workspace-${currentWorkspace}`).classList.add('active');
  
  // Add event listeners for workspace buttons
  document.getElementById('workspace-home').addEventListener('click', () => {
    switchWorkspace('home');
  });
  
  document.getElementById('workspace-work').addEventListener('click', () => {
    switchWorkspace('work');
  });
}

function switchWorkspace(workspace) {
  if (workspace === currentWorkspace) return;
  
  // Save current workspace data
  workspaceData[currentWorkspace] = {
    notes: [...notes],
    archivedNotes: [...archivedNotes]
  };
  
  // Switch to new workspace
  currentWorkspace = workspace;
  notes = [...workspaceData[workspace].notes];
  archivedNotes = [...workspaceData[workspace].archivedNotes];
  
  // Update UI
  document.querySelectorAll('.workspace-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`workspace-${workspace}`).classList.add('active');
  
  // Clear current notes display and render new workspace notes
  const notesContainer = document.getElementById('notes-container');
  notesContainer.innerHTML = '';
  
  // Render notes for new workspace
  notes.forEach(note => {
    renderNote(note);
  });
  
  // Hide archive panel if open and clear it
  if (isArchivePanelVisible) {
    toggleArchivePanel();
  }
  
  // Clear any active search
  clearSearch();
  
  // Save workspace preference and notes
  saveNotes();
  saveWorkspacePreference();
}

function saveWorkspacePreference() {
  try {
    const prefsPath = path.join(appConfig.dataPath, 'workspace-preference.json');
    const dataDir = appConfig.dataPath;
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(prefsPath, JSON.stringify({ currentWorkspace }));
  } catch (error) {
    console.error('Error saving workspace preference:', error);
  }
}

function loadWorkspacePreference() {
  try {
    const prefsPath = path.join(appConfig.dataPath, 'workspace-preference.json');
    
    if (fs.existsSync(prefsPath)) {
      const data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      const workspace = data.currentWorkspace;
      // Validate workspace value
      if (workspace === 'home' || workspace === 'work') {
        return workspace;
      }
    }
  } catch (error) {
    console.error('Error loading workspace preference:', error);
  }
  return 'home';
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      // Allow Escape to clear focus from inputs
      if (e.key === 'Escape') {
        e.target.blur();
        clearSearch();
      }
      return;
    }
    
    // Note: Ctrl+N, Ctrl+Shift+F, and Ctrl+Shift+C are handled globally by main process
    
    // Ctrl+F: Focus search
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
    
    // Escape: Clear search
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
    }
    
    // Ctrl+Shift+N: Quick note type menu
    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      const newNoteBtn = document.getElementById('new-note-btn');
      if (newNoteBtn) {
        newNoteBtn.click();
      }
    }
  });
}

function clearSearch() {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');
  
  if (searchInput) {
    searchInput.value = '';
    currentSearchQuery = '';
  }
  if (searchResults) {
    searchResults.classList.remove('active');
    searchResults.innerHTML = '';
  }
  if (searchClear) {
    searchClear.style.display = 'none';
  }
  
  // Clear note highlights
  clearNoteHighlights();
}

function getOptimalWidth(type) {
  switch (type) {
    case 'text': return 280;
    case 'file': return 300;
    case 'image': return 320;
    case 'paint': return 400;
    case 'todo': return 320;
    case 'reminder': return 350;
    case 'web': return 420;       // Increased for better button layout
    case 'table': return 450;
    case 'location': return 380;  // Increased for address fields
    case 'calculator': return 300;
    case 'timer': return 350;     // Increased for 3-column preset layout
    case 'folder': return 320;    // Size for folder contents
    case 'code': return 450;      // Wider for code content
    case 'document': return 800;   // Much wider for Word-like experience
    default: return 280;
  }
}

function getOptimalHeight(type) {
  switch (type) {
    case 'text': return 200;
    case 'file': return 180;
    case 'image': return 250;
    case 'paint': return 320;
    case 'todo': return 250;
    case 'reminder': return 280;
    case 'web': return 400;      // Increased to show preview button and all fields
    case 'table': return 300;
    case 'location': return 320;  // Increased to show all fields and buttons
    case 'calculator': return 380;
    case 'timer': return 360;     // Increased to show all presets, controls and progress
    case 'folder': return 280;    // Height for folder contents
    case 'code': return 320;      // Height for code with toolbar
    case 'document': return 600;   // Much taller for Word-like experience
    default: return 200;
  }
}

function createNewNote(x, y, type = 'text', documentType = 'word') {
  const note = {
    id: `note-${Date.now()}`,
    type: type,
    title: '',
    content: '',
    filePath: '',
    imagePath: '',
    paintData: '',
    todoItems: type === 'todo' ? [{ id: Date.now(), text: '', completed: false }] : [],
    reminderDateTime: '',
    reminderMessage: '',
    reminderTriggered: false,
    webUrl: '',
    webTitle: '',
    webDescription: '',
    tableData: type === 'table' ? [
      ['Header 1', 'Header 2', 'Header 3'],
      ['Row 1, Col 1', 'Row 1, Col 2', 'Row 1, Col 3'],
      ['Row 2, Col 1', 'Row 2, Col 2', 'Row 2, Col 3']
    ] : [],
    locationAddress: '',
    locationName: '',
    locationNotes: '',
    calculatorDisplay: '0',
    calculatorHistory: [],
    timerDuration: 25 * 60, // 25 minutes in seconds (Pomodoro default)
    timerRemaining: 25 * 60,
    timerRunning: false,
    timerType: 'pomodoro', // pomodoro, short-break, long-break, custom
    codeContent: '', // code content for code notes
    codeLanguage: 'javascript', // programming language for syntax highlighting
    ocrImagePath: '', // path to image for OCR processing
    ocrExtractedText: '', // text extracted from OCR
    tags: [], // array of tag strings
    folderItems: [], // array of note IDs contained in this folder
    parentFolder: null, // ID of parent folder if this note is in a folder
    documentContent: type === 'document' ? '<p><br></p>' : '', // rich text content for documents
    documentTitle: type === 'document' ? 'Untitled Document' : '', // document title
    documentSaved: type === 'document' ? false : true, // whether document is saved
    documentPath: type === 'document' ? null : null, // saved document file path
    documentType: type === 'document' ? documentType : null, // document subtype (word, markdown, spreadsheet, meeting)
    x: x - 125,
    y: y - 90,
    width: getOptimalWidth(type),
    height: getOptimalHeight(type),
    color: type === 'folder' ? '#FFA726' : '#ffd700' // Orange for folders, yellow for others
  };
  
  notes.push(note);
  renderNote(note);
  saveNotes();
}

function createNewDocument(type = 'word') {
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  
  // Create a note with the specific document subtype
  createNewNote(centerX, centerY, 'document', type);
}

function renderNote(note) {
  const noteElement = document.createElement('div');
  noteElement.className = `note ${note.type}-note`;
  noteElement.id = note.id;
  noteElement.style.left = `${note.x}px`;
  noteElement.style.top = `${note.y}px`;
  noteElement.style.width = `${note.width}px`;
  noteElement.style.height = `${note.height}px`;
  noteElement.style.backgroundColor = note.color;
  
  const typeIcon = `<img src="${getNoteTypeIcon(note.type)}" class="note-type-icon-img" alt="${note.type}" title="${note.type} note">`;
  const typeName = note.type === 'text' ? 'Text Note' : note.type === 'file' ? 'File Note' : note.type === 'image' ? 'Image Note' : note.type === 'paint' ? 'Paint Note' : note.type === 'todo' ? 'Todo Note' : note.type === 'reminder' ? 'Reminder Note' : note.type === 'web' ? 'Web Note' : note.type === 'table' ? 'Table Note' : note.type === 'location' ? 'Location Note' : note.type === 'calculator' ? 'Calculator Note' : note.type === 'folder' ? 'Folder Note' : note.type === 'code' ? 'Code Snippet' : note.type === 'document' ? 'Document' : 'Timer Note';
  
  let contentHTML = '';
  if (note.type === 'text') {
    contentHTML = `<textarea class="note-content" placeholder="Type your note here..." spellcheck="true">${note.content || ''}</textarea>`;
  } else if (note.type === 'file') {
    contentHTML = `
      <div class="note-content">
        ${note.filePath ? `
          <div class="file-link" data-file-path="${note.filePath}">
            <span class="file-icon">[F]</span>
            <span class="file-name">${path.basename(note.filePath)}</span>
          </div>
        ` : `
          <div class="file-link" data-note-id="${note.id}">
            <span class="file-icon">[D]</span>
            <span>Click to select file</span>
          </div>
        `}
      </div>
    `;
  } else if (note.type === 'image') {
    contentHTML = `
      <div class="note-content">
        ${note.imagePath ? `
          <img class="image-preview" src="${note.imagePath}" onclick="openFile('${note.imagePath}')" />
        ` : `
          <div class="image-placeholder" onclick="showImageOptions('${note.id}')">
            <span style="font-size: 24px;">[IMAGE]</span>
            <span>Click to add image</span>
            <span style="font-size: 12px; opacity: 0.7;">or take screenshot</span>
          </div>
        `}
      </div>
    `;
  } else if (note.type === 'paint') {
    contentHTML = `
      <div class="note-content">
        <div class="paint-toolbar">
          <div class="paint-tool active" data-tool="brush">B</div>
          <div class="paint-tool" data-tool="eraser">E</div>
          <div class="color-swatch active" style="background: #000" data-color="#000"></div>
          <div class="color-swatch" style="background: #f00" data-color="#f00"></div>
          <div class="color-swatch" style="background: #0f0" data-color="#0f0"></div>
          <div class="color-swatch" style="background: #00f" data-color="#00f"></div>
          <input type="range" class="brush-size" min="1" max="20" value="3">
          <div class="paint-tool" onclick="clearCanvas('${note.id}')">X</div>
        </div>
        <canvas class="paint-canvas" id="canvas-${note.id}"></canvas>
      </div>
    `;
  } else if (note.type === 'todo') {
    const completedCount = note.todoItems ? note.todoItems.filter(item => item.completed).length : 0;
    const totalCount = note.todoItems ? note.todoItems.length : 0;
    const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    
    contentHTML = `
      <div class="note-content">
        <div class="todo-progress">
          <span>${completedCount}/${totalCount}</span>
          <div class="todo-progress-bar">
            <div class="todo-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <span>${Math.round(progressPercent)}%</span>
        </div>
        <ul class="todo-list" id="todo-list-${note.id}">
          ${note.todoItems ? note.todoItems.map(item => `
            <li class="todo-item" data-id="${item.id}">
              <div class="todo-checkbox ${item.completed ? 'checked' : ''}" onclick="toggleTodo('${note.id}', '${item.id}')">
                ${item.completed ? '✓' : ''}
              </div>
              <textarea class="todo-text ${item.completed ? 'completed' : ''}" 
                        placeholder="Enter task..." 
                        onblur="updateTodoText('${note.id}', '${item.id}', this.value)"
                        rows="1">${item.text}</textarea>
              <span class="todo-delete" onclick="deleteTodo('${note.id}', '${item.id}')"> × </span>
            </li>
          `).join('') : ''}
        </ul>
        <div class="todo-add" onclick="addTodo('${note.id}')">
          <div class="todo-add-icon">+</div>
          <span>Add new task</span>
        </div>
      </div>
    `;
  } else if (note.type === 'reminder') {
    const now = new Date();
    const reminderDate = note.reminderDateTime ? new Date(note.reminderDateTime) : null;
    let status = 'pending';
    let statusText = 'No reminder set';
    
    if (reminderDate) {
      if (note.reminderTriggered) {
        status = 'triggered';
        statusText = 'Reminder triggered';
      } else if (reminderDate < now) {
        status = 'expired';
        statusText = 'Reminder expired';
      } else {
        status = 'pending';
        statusText = `Reminder set for ${reminderDate.toLocaleString()}`;
      }
    }
    
    // Format datetime for input (datetime-local requires local time, not UTC)
    const formatForInput = (dateStr) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      // Get local date components
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    
    contentHTML = `
      <div class="note-content">
        <div class="reminder-form">
          <div class="reminder-datetime">
            <label style="font-size: 12px; color: #666;">When:</label>
            <input type="datetime-local" 
                   class="datetime-input" 
                   id="reminder-datetime-${note.id}"
                   value="${formatForInput(note.reminderDateTime)}"
                   onchange="updateReminderDateTime('${note.id}', this.value)">
          </div>
          <textarea class="reminder-message" 
                    placeholder="What should I remind you about?"
                    onblur="updateReminderMessage('${note.id}', this.value)">${note.reminderMessage || ''}</textarea>
          <div class="reminder-status ${status}">
            <span>[ALARM]</span>
            <span>${statusText}</span>
          </div>
          <div class="reminder-actions">
            <button class="reminder-btn primary" onclick="testReminder('${note.id}')">Test Notification</button>
            <button class="reminder-btn" onclick="resetReminder('${note.id}')">Reset</button>
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'web') {
    contentHTML = `
      <div class="note-content">
        <div class="web-form">
          <div class="web-url-input">
            <label style="font-size: 12px; color: #666; margin-bottom: 4px; display: block;">Website URL:</label>
            <input type="url" 
                   class="web-url" 
                   id="web-url-${note.id}"
                   placeholder="https://example.com"
                   value="${note.webUrl || ''}"
                   onblur="updateWebUrl('${note.id}', this.value)"
                   style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px;">
          </div>
          <div class="web-title-input" style="margin-top: 12px;">
            <label style="font-size: 12px; color: #666; margin-bottom: 4px; display: block;">Title (optional):</label>
            <input type="text" 
                   class="web-title" 
                   id="web-title-${note.id}"
                   placeholder="Website title"
                   value="${note.webTitle || ''}"
                   onblur="updateWebTitle('${note.id}', this.value)"
                   style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px;">
          </div>
          <textarea class="web-description" 
                    placeholder="Description or notes about this website..."
                    onblur="updateWebDescription('${note.id}', this.value)"
                    style="width: 100%; min-height: 60px; margin-top: 12px; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px; resize: vertical; font-family: inherit;">${note.webDescription || ''}</textarea>
          <div class="web-actions" style="margin-top: 12px; display: flex; gap: 8px;">
            <button class="web-btn primary" onclick="openWebUrl('${note.id}')" ${!note.webUrl ? 'disabled' : ''}>Open Website</button>
            <button class="web-btn" onclick="copyWebUrl('${note.id}')" ${!note.webUrl ? 'disabled' : ''}>Copy URL</button>
            <button class="web-btn" onclick="toggleWebPreview('${note.id}')" ${!note.webUrl ? 'disabled' : ''}>Preview</button>
          </div>
          <div class="web-preview" id="web-preview-${note.id}" style="display: none; margin-top: 12px;">
            <iframe src="${note.webUrl || 'about:blank'}" 
                    style="width: 100%; height: 200px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px;"
                    sandbox="allow-scripts allow-same-origin"
                    loading="lazy"></iframe>
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'table') {
    const tableData = note.tableData || [['']];
    contentHTML = `
      <div class="note-content">
        <div class="table-container">
          <div class="table-toolbar">
            <button class="table-btn" onclick="addTableRow('${note.id}')">+ Row</button>
            <button class="table-btn" onclick="addTableColumn('${note.id}')">+ Column</button>
            <button class="table-btn" onclick="removeTableRow('${note.id}')">- Row</button>
            <button class="table-btn" onclick="removeTableColumn('${note.id}')">- Column</button>
          </div>
          <div class="table-wrapper">
            <table class="data-table" id="table-${note.id}">
              ${tableData.map((row, rowIndex) => `
                <tr data-row="${rowIndex}">
                  ${row.map((cell, colIndex) => `
                    <td data-col="${colIndex}">
                      <input type="text" 
                             class="table-cell" 
                             value="${cell || ''}"
                             onblur="updateTableCell('${note.id}', ${rowIndex}, ${colIndex}, this.value)"
                             ${rowIndex === 0 ? 'style="font-weight: bold; background: rgba(0,0,0,0.05);"' : ''}
                      />
                    </td>
                  `).join('')}
                </tr>
              `).join('')}
            </table>
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'location') {
    contentHTML = `
      <div class="note-content">
        <div class="location-form">
          <div class="location-name-input">
            <label style="font-size: 12px; color: #666; margin-bottom: 4px; display: block;">Place Name:</label>
            <input type="text" 
                   class="location-name" 
                   id="location-name-${note.id}"
                   placeholder="Restaurant, Store, etc."
                   value="${note.locationName || ''}"
                   onblur="updateLocationName('${note.id}', this.value)"
                   style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px;">
          </div>
          <div class="location-address-input" style="margin-top: 12px;">
            <label style="font-size: 12px; color: #666; margin-bottom: 4px; display: block;">Address:</label>
            <input type="text" 
                   class="location-address" 
                   id="location-address-${note.id}"
                   placeholder="123 Main St, City, State"
                   value="${note.locationAddress || ''}"
                   onblur="updateLocationAddress('${note.id}', this.value)"
                   style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px;">
          </div>
          <textarea class="location-notes" 
                    placeholder="Notes about this location..."
                    onblur="updateLocationNotes('${note.id}', this.value)"
                    style="width: 100%; min-height: 60px; margin-top: 12px; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 14px; resize: vertical; font-family: inherit;">${note.locationNotes || ''}</textarea>
          <div class="location-actions" style="margin-top: 12px; display: flex; gap: 8px;">
            <button class="location-btn primary" onclick="openLocationMaps('${note.id}')" ${!note.locationAddress ? 'disabled' : ''}>View on Maps</button>
            <button class="location-btn" onclick="copyLocationAddress('${note.id}')" ${!note.locationAddress ? 'disabled' : ''}>Copy Address</button>
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'calculator') {
    contentHTML = `
      <div class="note-content">
        <div class="calculator">
          <div class="calculator-display" id="calc-display-${note.id}">${note.calculatorDisplay || '0'}</div>
          <div class="calculator-buttons">
            <button class="calc-btn calc-clear" onclick="calculatorClear('${note.id}')">C</button>
            <button class="calc-btn calc-operator" onclick="calculatorInput('${note.id}', '/')">÷</button>
            <button class="calc-btn calc-operator" onclick="calculatorInput('${note.id}', '*')">×</button>
            <button class="calc-btn calc-operator" onclick="calculatorBackspace('${note.id}')">⌫</button>
            
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '7')">7</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '8')">8</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '9')">9</button>
            <button class="calc-btn calc-operator" onclick="calculatorInput('${note.id}', '-')">−</button>
            
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '4')">4</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '5')">5</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '6')">6</button>
            <button class="calc-btn calc-operator" onclick="calculatorInput('${note.id}', '+')">+</button>
            
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '1')">1</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '2')">2</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '3')">3</button>
            <button class="calc-btn calc-equals" onclick="calculatorEquals('${note.id}')" rowspan="2">=</button>
            
            <button class="calc-btn calc-zero" onclick="calculatorInput('${note.id}', '0')">0</button>
            <button class="calc-btn calc-number" onclick="calculatorInput('${note.id}', '.')">.</button>
          </div>
          <div class="calculator-history" id="calc-history-${note.id}">
            ${note.calculatorHistory ? note.calculatorHistory.slice(-3).map(entry => `
              <div class="calc-history-entry">${entry}</div>
            `).join('') : ''}
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'timer') {
    const minutes = Math.floor(note.timerRemaining / 60);
    const seconds = note.timerRemaining % 60;
    contentHTML = `
      <div class="note-content">
        <div class="timer-container">
          <div class="timer-display" id="timer-display-${note.id}">
            ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}
          </div>
          <div class="timer-presets">
            <button class="timer-preset ${note.timerType === 'pomodoro' ? 'active' : ''}" 
                    onclick="setTimerPreset('${note.id}', 'pomodoro', 25)">
              Pomodoro<br><small>25 min</small>
            </button>
            <button class="timer-preset ${note.timerType === 'short-break' ? 'active' : ''}" 
                    onclick="setTimerPreset('${note.id}', 'short-break', 5)">
              Short Break<br><small>5 min</small>
            </button>
            <button class="timer-preset ${note.timerType === 'long-break' ? 'active' : ''}" 
                    onclick="setTimerPreset('${note.id}', 'long-break', 15)">
              Long Break<br><small>15 min</small>
            </button>
          </div>
          <div class="timer-custom">
            <input type="number" 
                   class="timer-input" 
                   id="timer-input-${note.id}"
                   min="1" 
                   max="999" 
                   value="${Math.floor(note.timerDuration / 60)}"
                   onchange="setCustomTimer('${note.id}', this.value)">
            <span class="timer-label">minutes</span>
          </div>
          <div class="timer-controls">
            <button class="timer-btn timer-start" onclick="toggleTimer('${note.id}')" id="timer-btn-${note.id}">
              ${note.timerRunning ? 'Pause' : 'Start'}
            </button>
            <button class="timer-btn timer-reset" onclick="resetTimer('${note.id}')">Reset</button>
            ${note.timerRunning ? `<button class="timer-btn timer-detach" onclick="detachTimer('${note.id}')" title="Keep timer visible when overlay closes">📌</button>` : ''}
          </div>
          <div class="timer-progress">
            <div class="timer-progress-bar">
              <div class="timer-progress-fill" 
                   id="timer-progress-${note.id}"
                   style="width: ${((note.timerDuration - note.timerRemaining) / note.timerDuration) * 100}%">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'folder') {
    contentHTML = `
      <div class="note-content folder-content">
        <div class="folder-drop-zone" data-folder-id="${note.id}">
          <div class="folder-header">
            <span>📂 Drag notes here to organize them</span>
            <span class="folder-count">${(note.folderItems || []).length} items</span>
          </div>
          <div class="folder-items" id="folder-items-${note.id}">
            ${(note.folderItems || []).map(itemId => {
              const item = notes.find(n => n.id === itemId) || archivedNotes.find(n => n.id === itemId);
              if (!item) return '';
              const itemTypeIcon = `<img src="${getNoteTypeIcon(item.type)}" class="note-type-icon-img" alt="${escapeHtml(item.type)}">`;
              return `
                <div class="folder-item" 
                     onclick="focusNoteFromFolder('${itemId}')" 
                     title="${escapeHtml(item.title || 'Untitled')}"
                     draggable="true"
                     onmousedown="startFolderItemDrag(event, '${itemId}', '${note.id}')"
                     ondragstart="handleFolderItemDragStart(event, '${itemId}', '${note.id}')"
                     ondragend="handleFolderItemDragEnd(event)">
                  <span class="folder-item-icon">${itemTypeIcon}</span>
                  <span class="folder-item-title">${escapeHtml(item.title || 'Untitled')}</span>
                  <button class="folder-item-remove" onclick="removeNoteFromFolder(event, '${note.id}', '${itemId}')" title="Remove from folder">×</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  } else if (note.type === 'code') {
    contentHTML = `
      <div class="note-content code-content">
        <div class="code-toolbar">
          <select class="code-language-select" onchange="updateCodeLanguage('${note.id}', this.value)">
            <option value="javascript" ${note.codeLanguage === 'javascript' ? 'selected' : ''}>JavaScript</option>
            <option value="python" ${note.codeLanguage === 'python' ? 'selected' : ''}>Python</option>
            <option value="html" ${note.codeLanguage === 'html' ? 'selected' : ''}>HTML</option>
            <option value="css" ${note.codeLanguage === 'css' ? 'selected' : ''}>CSS</option>
            <option value="json" ${note.codeLanguage === 'json' ? 'selected' : ''}>JSON</option>
            <option value="sql" ${note.codeLanguage === 'sql' ? 'selected' : ''}>SQL</option>
            <option value="bash" ${note.codeLanguage === 'bash' ? 'selected' : ''}>Bash</option>
            <option value="csharp" ${note.codeLanguage === 'csharp' ? 'selected' : ''}>C#</option>
            <option value="cpp" ${note.codeLanguage === 'cpp' ? 'selected' : ''}>C++</option>
            <option value="java" ${note.codeLanguage === 'java' ? 'selected' : ''}>Java</option>
            <option value="php" ${note.codeLanguage === 'php' ? 'selected' : ''}>PHP</option>
            <option value="ruby" ${note.codeLanguage === 'ruby' ? 'selected' : ''}>Ruby</option>
            <option value="go" ${note.codeLanguage === 'go' ? 'selected' : ''}>Go</option>
            <option value="rust" ${note.codeLanguage === 'rust' ? 'selected' : ''}>Rust</option>
            <option value="typescript" ${note.codeLanguage === 'typescript' ? 'selected' : ''}>TypeScript</option>
          </select>
          <button class="code-copy-btn" onclick="copyCodeToClipboard('${note.id}')" title="Copy to clipboard">Copy</button>
        </div>
        <div class="code-editor-container">
          <textarea class="code-editor" id="code-editor-${note.id}" placeholder="Enter your code here..." onInput="updateCodeContent('${note.id}', this.value)">${note.codeContent || ''}</textarea>
          <pre class="code-preview" id="code-preview-${note.id}"><code class="language-${note.codeLanguage}">${escapeHtml(note.codeContent || '')}</code></pre>
        </div>
      </div>
    `;
  } else if (note.type === 'document') {
    // Render different document types based on documentType
    const docType = note.documentType || 'word';
    
    if (docType === 'word') {
      contentHTML = `
        <div class="note-content document-content">
          <div class="document-toolbar">
          <div class="document-title-container">
            <input type="text" class="document-title-input" placeholder="Document Title" value="${note.documentTitle || ''}" 
                   onblur="updateDocumentTitle('${note.id}', this.value)">
            <input type="text" class="document-tags-input" placeholder="Tags (comma separated)" value="${(note.tags || []).join(', ')}" 
                   onblur="updateDocumentTags('${note.id}', this.value)">
          </div>
          <div class="document-format-controls">
            <!-- Font controls -->
            <select class="format-select" onchange="applyDocumentFontFamily('${note.id}', this.value)" title="Font Family">
              <option value="Times New Roman, serif">Times New Roman</option>
              <option value="Arial, sans-serif">Arial</option>
              <option value="Calibri, sans-serif">Calibri</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Helvetica, sans-serif">Helvetica</option>
              <option value="Verdana, sans-serif">Verdana</option>
              <option value="Courier New, monospace">Courier New</option>
            </select>
            <select class="format-select" onchange="applyDocumentFontSize('${note.id}', this.value)" title="Font Size">
              <option value="8">8</option>
              <option value="9">9</option>
              <option value="10">10</option>
              <option value="11">11</option>
              <option value="12" selected>12</option>
              <option value="14">14</option>
              <option value="16">16</option>
              <option value="18">18</option>
              <option value="20">20</option>
              <option value="24">24</option>
              <option value="28">28</option>
              <option value="32">32</option>
              <option value="36">36</option>
              <option value="48">48</option>
            </select>
            <div class="format-separator"></div>
            
            <!-- Text formatting -->
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'bold')" title="Bold (Ctrl+B)">
              <strong>B</strong>
            </button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'italic')" title="Italic (Ctrl+I)">
              <em>I</em>
            </button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'underline')" title="Underline (Ctrl+U)">
              <u>U</u>
            </button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'strikeThrough')" title="Strikethrough">
              <s>S</s>
            </button>
            <div class="format-separator"></div>
            
            <!-- Text color -->
            <div class="color-picker-container">
              <button class="format-btn color-btn" onclick="toggleColorPicker('${note.id}', 'text')" title="Text Color">
                A<span class="color-indicator" style="background: #000000;"></span>
              </button>
              <div class="color-picker-dropdown" id="text-color-${note.id}">
                <div class="color-grid">
                  <div class="color-option" data-color="#000000" style="background: #000000;" title="Black"></div>
                  <div class="color-option" data-color="#FF0000" style="background: #FF0000;" title="Red"></div>
                  <div class="color-option" data-color="#00FF00" style="background: #00FF00;" title="Green"></div>
                  <div class="color-option" data-color="#0000FF" style="background: #0000FF;" title="Blue"></div>
                  <div class="color-option" data-color="#FFFF00" style="background: #FFFF00;" title="Yellow"></div>
                  <div class="color-option" data-color="#FF00FF" style="background: #FF00FF;" title="Magenta"></div>
                  <div class="color-option" data-color="#00FFFF" style="background: #00FFFF;" title="Cyan"></div>
                  <div class="color-option" data-color="#800000" style="background: #800000;" title="Maroon"></div>
                  <div class="color-option" data-color="#008000" style="background: #008000;" title="Dark Green"></div>
                  <div class="color-option" data-color="#000080" style="background: #000080;" title="Navy"></div>
                  <div class="color-option" data-color="#808080" style="background: #808080;" title="Gray"></div>
                  <div class="color-option" data-color="#C0C0C0" style="background: #C0C0C0;" title="Silver"></div>
                </div>
              </div>
            </div>
            <div class="color-picker-container">
              <button class="format-btn color-btn" onclick="toggleColorPicker('${note.id}', 'highlight')" title="Highlight Color">
                🖍<span class="color-indicator" style="background: #FFFF00;"></span>
              </button>
              <div class="color-picker-dropdown" id="highlight-color-${note.id}">
                <div class="color-grid">
                  <div class="color-option" data-color="transparent" style="background: white; border: 1px solid #ccc;" title="No Highlight">×</div>
                  <div class="color-option" data-color="#FFFF00" style="background: #FFFF00;" title="Yellow"></div>
                  <div class="color-option" data-color="#00FF00" style="background: #00FF00;" title="Green"></div>
                  <div class="color-option" data-color="#00FFFF" style="background: #00FFFF;" title="Cyan"></div>
                  <div class="color-option" data-color="#FF00FF" style="background: #FF00FF;" title="Magenta"></div>
                  <div class="color-option" data-color="#FFB6C1" style="background: #FFB6C1;" title="Pink"></div>
                  <div class="color-option" data-color="#FFA500" style="background: #FFA500;" title="Orange"></div>
                  <div class="color-option" data-color="#90EE90" style="background: #90EE90;" title="Light Green"></div>
                </div>
              </div>
            </div>
            <div class="format-separator"></div>
            
            <!-- Alignment -->
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'justifyLeft')" title="Align Left">⬅</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'justifyCenter')" title="Center">⬄</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'justifyRight')" title="Align Right">➡</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'justifyFull')" title="Justify">⬌</button>
            <div class="format-separator"></div>
            
            <!-- Lists -->
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'insertUnorderedList')" title="Bullet List">• List</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'insertOrderedList')" title="Numbered List">1. List</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'outdent')" title="Decrease Indent">⬅ Outdent</button>
            <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'indent')" title="Increase Indent">➡ Indent</button>
            <div class="format-separator"></div>
            
            <!-- Document actions -->
            <button class="format-btn" onclick="saveDocument('${note.id}')" title="Save Document">💾 Save</button>
            <button class="format-btn" onclick="exportDocument('${note.id}')" title="Export Document">📤 Export</button>
          </div>
        </div>
        <div class="document-editor-container">
          <div class="document-page" id="document-page-${note.id}">
            <div class="document-editor" 
                 contenteditable="true" 
                 id="document-editor-${note.id}"
                 onInput="updateDocumentContent('${note.id}')"
                 onFocus="this.style.backgroundColor='white'"
                 onBlur="updateDocumentContent('${note.id}')"
                 spellcheck="true"
                 style="cursor: text;"
                 data-placeholder="Start writing your document...">${note.documentContent || '<p><br></p>'}</div>
          </div>
        </div>
      </div>
    `;
    
    } else if (docType === 'markdown') {
      // Use the same Word editor but with monospace font for markdown
      contentHTML = `
        <div class="note-content document-content">
          <div class="document-toolbar">
            <div class="document-title-container">
              <input type="text" class="document-title-input" placeholder="Markdown Document" value="${note.documentTitle || ''}" 
                     onblur="updateDocumentTitle('${note.id}', this.value)">
              <input type="text" class="document-tags-input" placeholder="Tags (comma separated)" value="${(note.tags || []).join(', ')}" 
                     onblur="updateDocumentTags('${note.id}', this.value)">
            </div>
            <div class="document-format-controls">
              <!-- Basic formatting -->
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'bold')" title="Bold">B</button>
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'italic')" title="Italic">I</button>
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'underline')" title="Underline">U</button>
              <div class="format-separator"></div>
              
              <!-- Lists -->
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'insertUnorderedList')" title="Bullet List">• List</button>
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'insertOrderedList')" title="Numbered List">1. List</button>
              <div class="format-separator"></div>
              
              <!-- Document actions -->
              <button class="format-btn" onclick="saveDocument('${note.id}')" title="Save Document">💾 Save</button>
              <button class="format-btn" onclick="exportMarkdownDocument('${note.id}')" title="Export Markdown">📤 Export</button>
            </div>
          </div>
          <div class="document-editor-container">
            <div class="document-page" id="document-page-${note.id}">
              <div class="document-editor" 
                   contenteditable="true" 
                   id="document-editor-${note.id}"
                   onInput="updateDocumentContent('${note.id}')"
                   onFocus="this.style.backgroundColor='white'"
                   onBlur="updateDocumentContent('${note.id}')"
                   spellcheck="true"
                   style="cursor: text; font-family: 'Courier New', monospace; font-size: 13px; background: #fafafa;"
                   data-placeholder="# Start writing in Markdown...">${note.documentContent || '# Welcome to Markdown\\n\\nStart typing in **Markdown** syntax!'}</div>
            </div>
          </div>
        </div>
      `;
      
    } else if (docType === 'spreadsheet') {
      contentHTML = `
        <div class="note-content spreadsheet-document-content">
          <div class="spreadsheet-toolbar">
            <input type="text" class="document-title-input" placeholder="Spreadsheet Title" value="${note.documentTitle || ''}" 
                   onblur="updateDocumentTitle('${note.id}', this.value)">
            <input type="text" class="document-tags-input" placeholder="Tags (comma separated)" value="${(note.tags || []).join(', ')}" 
                   onblur="updateDocumentTags('${note.id}', this.value)">
            <div class="spreadsheet-actions">
              <button class="format-btn" onclick="addSpreadsheetRow('${note.id}')" title="Add Row">+ Row</button>
              <button class="format-btn" onclick="addSpreadsheetColumn('${note.id}')" title="Add Column">+ Col</button>
              <button class="format-btn" onclick="deleteSpreadsheetRow('${note.id}')" title="Delete Row">- Row</button>
              <button class="format-btn" onclick="deleteSpreadsheetColumn('${note.id}')" title="Delete Column">- Col</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="insertFormula('${note.id}', 'SUM')" title="Sum Formula">∑</button>
              <button class="format-btn" onclick="insertFormula('${note.id}', 'AVERAGE')" title="Average Formula">AVG</button>
              <button class="format-btn" onclick="insertFormula('${note.id}', 'COUNT')" title="Count Formula">#</button>
              <button class="format-btn" onclick="insertFormula('${note.id}', 'MAX')" title="Max Formula">MAX</button>
              <button class="format-btn" onclick="insertFormula('${note.id}', 'MIN')" title="Min Formula">MIN</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="formatSpreadsheetCells('${note.id}', 'currency')" title="Currency Format">$</button>
              <button class="format-btn" onclick="formatSpreadsheetCells('${note.id}', 'percent')" title="Percent Format">%</button>
              <button class="format-btn" onclick="formatSpreadsheetCells('${note.id}', 'date')" title="Date Format">📅</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="showSpreadsheetColorPicker('${note.id}', 'background')" title="Cell Background Color">Color</button>
              <button class="format-btn" onclick="showSpreadsheetColorPicker('${note.id}', 'text')" title="Text Color">A</button>
              <button class="format-btn" onclick="formatSpreadsheetText('${note.id}', 'bold')" title="Bold Text">B</button>
              <button class="format-btn" onclick="formatSpreadsheetText('${note.id}', 'italic')" title="Italic Text">I</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="calculateSpreadsheet('${note.id}')" title="Recalculate">🔄</button>
              <button class="format-btn" onclick="saveDocument('${note.id}')" title="Save">💾</button>
              <button class="format-btn" onclick="exportSpreadsheetCSV('${note.id}')" title="Export CSV">📊</button>
            </div>
          </div>
          <div class="spreadsheet-container" id="spreadsheet-${note.id}">
            <!-- Spreadsheet will be initialized dynamically -->
          </div>
        </div>
      `;
      
    } else if (docType === 'meeting') {
      const today = new Date().toLocaleDateString();
      const meetingTemplate = note.documentContent || `<h1>Meeting Notes</h1>
<p><strong>Date:</strong> ${today}</p>
<p><strong>Time:</strong> </p>
<p><strong>Location:</strong> </p>
<p><strong>Attendees:</strong> </p>

<h2>Agenda</h2>
<p>• </p>
<p>• </p>
<p>• </p>

<h2>Discussion</h2>
<p></p>

<h2>Action Items</h2>
<p>• <strong>Task:</strong> _____________ <strong>Assigned to:</strong> _____________ <strong>Due:</strong> _____________</p>
<p>• <strong>Task:</strong> _____________ <strong>Assigned to:</strong> _____________ <strong>Due:</strong> _____________</p>

<h2>🔑 Decisions Made</h2>
<p></p>

<h2>📅 Next Steps</h2>
<p></p>`;
      
      contentHTML = `
        <div class="note-content document-content">
          <div class="document-toolbar">
            <div class="document-title-container">
              <input type="text" class="document-title-input" placeholder="Meeting Notes" value="${note.documentTitle || ''}" 
                     onblur="updateDocumentTitle('${note.id}', this.value)">
              <input type="text" class="document-tags-input" placeholder="Tags (comma separated)" value="${(note.tags || []).join(', ')}" 
                     onblur="updateDocumentTags('${note.id}', this.value)">
            </div>
            <div class="document-format-controls">
              <!-- Basic formatting -->
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'bold')" title="Bold">B</button>
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'italic')" title="Italic">I</button>
              <button class="format-btn" onclick="applyDocumentFormat('${note.id}', 'underline')" title="Underline">U</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="insertMeetingSection('${note.id}')" title="Add Section">Add Section</button>
              <div class="format-separator"></div>
              <button class="format-btn" onclick="saveDocument('${note.id}')" title="Save">💾 Save</button>
              <button class="format-btn" onclick="exportDocument('${note.id}')" title="Export">📤 Export</button>
            </div>
          </div>
          <div class="document-editor-container">
            <div class="document-editor" 
                 contenteditable="true" 
                 id="document-editor-${note.id}"
                 onInput="updateDocumentContent('${note.id}')"
                 onFocus="this.style.backgroundColor='white'"
                 onBlur="updateDocumentContent('${note.id}')"
                 spellcheck="true"
                 style="cursor: text;"
                 data-placeholder="Meeting notes...">${meetingTemplate}</div>
          </div>
        </div>
      `;
    }
  }
  
  // Use different headers for document types vs regular notes
  if (note.type === 'document') {
    // Minimal header for document types (no redundant title/tags inputs)
    noteElement.innerHTML = `
      <div class="document-header">
        <div class="document-header-actions">
          <span class="note-minimize" title="Collapse/Expand">—</span>
          <span class="note-close" title="Close">&times;</span>
        </div>
      </div>
      ${contentHTML}
      <div class="resize-handle resize-se"></div>
    `;
  } else {
    // Regular note header with color picker, title, and tags
    noteElement.innerHTML = `
      <div class="note-header">
        <span style="font-size: 12px; opacity: 0.7;" class="note-type-info">
          <span class="note-type-icon">${typeIcon}</span>
          <span class="note-type-name">${typeName}</span>
          <span class="note-title-display" style="display: none;"></span>
          ${note.type === 'todo' ? '<span class="todo-header-add" onclick="addTodo(\'' + note.id + '\')" title="Add new task">+</span>' : ''}
        </span>
        <div class="note-actions">
          <div class="color-picker" style="background-color: ${escapeHtml(note.color)}">
            <div class="color-options">
              ${noteColors.map(color => `
                <div class="color-option" style="background-color: ${escapeHtml(color)}" data-color="${escapeHtml(color)}"></div>
              `).join('')}
            </div>
          </div>
          <span class="note-minimize" title="Collapse/Expand">—</span>
          ${['text', 'file', 'image', 'paint', 'todo', 'table', 'code'].includes(note.type) ? 
            '<span class="note-share" onclick="showShareOptions(\'' + note.id + '\')" title="Share note"><img src="../media/share.png" class="note-action-icon" alt="Share"></span>' : ''}
          ${['text', 'paint', 'todo', 'table', 'code'].includes(note.type) ? 
            '<span class="note-email" onclick="emailNote(\'' + note.id + '\')" title="Email note"><img src="../media/emailicon.png" class="note-action-icon" alt="Email"></span>' : ''}
          <span class="note-archive" onclick="archiveNote('${note.id}')" title="Archive note"><img src="../media/foldernote.png" class="note-action-icon" alt="Archive"></span>
          <span class="note-close">&times;</span>
        </div>
      </div>
      <input class="note-title" placeholder="Title..." value="${escapeHtml(note.title || '')}">
      <div class="note-tags-container">
        <input class="note-tags-input" placeholder="Add tags (comma separated)..." value="${escapeHtml((note.tags || []).join(', '))}">
        <div class="note-tags-display">
          ${(note.tags || []).map(tag => `<span class="note-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      ${contentHTML}
      <div class="resize-handle resize-se"></div>
    `;
  }
  
  setupNoteEventListeners(noteElement, note);
  
  // Apply collapsed state if needed
  if (note.collapsed) {
    noteElement.classList.add('collapsed');
    
    // Change minimize button to maximize
    const minimizeBtn = noteElement.querySelector('.note-minimize');
    if (minimizeBtn) {
      minimizeBtn.textContent = '□';
      minimizeBtn.title = 'Expand';
    }
    
    // Show title in header if it exists
    const titleDisplay = noteElement.querySelector('.note-title-display');
    const titleInput = noteElement.querySelector('.note-title');
    const noteTitle = note.title || '';
    
    if (noteTitle.trim()) {
      titleDisplay.textContent = ` - ${noteTitle}`;
      titleDisplay.style.display = 'inline';
    }
  }
  
  document.getElementById('notes-container').appendChild(noteElement);
  
  // Hide note if it's in a folder and not currently opened
  if (note.parentFolder && !note.isOpenFromFolder) {
    noteElement.style.display = 'none';
  }
  
  // Focus on title if new note
  if (!note.title && !note.content && note.type === 'text') {
    noteElement.querySelector('.note-title').focus();
  }
  
  // Setup paint canvas if it's a paint note
  if (note.type === 'paint') {
    setupPaintCanvas(note);
  }
  
  // Setup todo note functionality
  if (note.type === 'todo') {
    setupTodoNote(note);
  }
  
  // Setup document functionality
  if (note.type === 'document') {
    const docType = note.documentType || 'word';
    if (docType === 'word') {
      setupDocumentNote(note);
    } else if (docType === 'markdown') {
      setupMarkdownDocument(note);
    } else if (docType === 'spreadsheet') {
      setupSpreadsheetDocument(note);
    } else if (docType === 'meeting') {
      setupMeetingDocument(note);
    }
  }
}

function setupNoteEventListeners(noteElement, note) {
  // Handle different header types
  const header = noteElement.querySelector('.note-header') || noteElement.querySelector('.document-header');
  const titleInput = noteElement.querySelector('.note-title');
  const colorPicker = noteElement.querySelector('.color-picker');
  const colorOptions = noteElement.querySelector('.color-options');
  const closeBtn = noteElement.querySelector('.note-close');
  const minimizeBtn = noteElement.querySelector('.note-minimize');
  const resizeHandle = noteElement.querySelector('.resize-se');
  
  // Dragging - handle both header types
  if (header) {
    header.addEventListener('mousedown', (e) => {
      // For document headers, allow dragging anywhere except on buttons
      // For note headers, avoid dragging on note actions
      if (note.type === 'document') {
        if (!e.target.closest('.note-minimize') && !e.target.closest('.note-close')) {
          startDragging(e, note);
        }
      } else {
        if (!e.target.closest('.note-actions')) {
          startDragging(e, note);
        }
      }
    });
  }
  
  // Title editing (only for regular notes, not documents)
  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      note.title = e.target.value;
      
      // Update title display if note is collapsed
      if (note.collapsed) {
        const titleDisplay = noteElement.querySelector('.note-title-display');
        const noteTitle = e.target.value.trim();
        
        if (noteTitle) {
          titleDisplay.textContent = ` - ${noteTitle}`;
          titleDisplay.style.display = 'inline';
        } else {
          titleDisplay.style.display = 'none';
          titleDisplay.textContent = '';
        }
      }
      
      saveNotes();
    });
  }
  
  // Tags editing (only for regular notes, not documents)
  const tagsInput = noteElement.querySelector('.note-tags-input');
  if (tagsInput) {
    tagsInput.addEventListener('input', (e) => {
      const tagString = e.target.value;
      note.tags = tagString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      // Update tags display
      const tagsDisplay = noteElement.querySelector('.note-tags-display');
      if (tagsDisplay) {
        tagsDisplay.innerHTML = note.tags.map(tag => `<span class="note-tag">${tag}</span>`).join('');
      }
      
      saveNotes();
    });
  }
  
  // Content editing for text notes
  if (note.type === 'text') {
    const textarea = noteElement.querySelector('.note-content');
    textarea.addEventListener('input', (e) => {
      note.content = e.target.value;
      saveNotes();
      generateAutoTitle(note.id);
    });
  }
  
  // File link handling for file notes
  if (note.type === 'file') {
    const fileLink = noteElement.querySelector('.file-link');
    if (fileLink) {
      fileLink.addEventListener('click', () => {
        const filePath = fileLink.dataset.filePath;
        const noteId = fileLink.dataset.noteId;
        
        if (filePath) {
          openFile(filePath);
        } else if (noteId) {
          selectFile(noteId);
        }
      });
    }
  }
  
  // Color picker (only for regular notes, not documents)
  if (colorPicker && colorOptions) {
    colorPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      colorOptions.classList.toggle('active');
    });
    
    colorOptions.addEventListener('click', (e) => {
      if (e.target.classList.contains('color-option')) {
        const newColor = e.target.dataset.color;
        note.color = newColor;
        noteElement.style.backgroundColor = newColor;
        colorPicker.style.backgroundColor = newColor;
        colorOptions.classList.remove('active');
        saveNotes();
      }
    });
  }
  
  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
    if (note.type === 'document') {
      // For documents, close means close, not delete
      closeDocument(note.id);
    } else if (note.parentFolder) {
      // If note is in a folder, just hide it instead of deleting
      hideNoteFromFolder(note.id);
    } else {
      // If not in folder, delete as normal
      deleteNote(note.id);
    }
    });
  }
  
  // Minimize button
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => toggleNoteCollapse(note.id));
  }
  
  // Resize handle
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => startResizing(e, note));
  }
}

function toggleNoteCollapse(noteId) {
  const noteElement = document.getElementById(noteId);
  const note = notes.find(n => n.id === noteId);
  
  if (noteElement && note) {
    note.collapsed = !note.collapsed;
    
    const titleDisplay = noteElement.querySelector('.note-title-display');
    const typeName = noteElement.querySelector('.note-type-name');
    const titleInput = noteElement.querySelector('.note-title');
    const minimizeBtn = noteElement.querySelector('.note-minimize');
    
    if (note.collapsed) {
      noteElement.classList.add('collapsed');
      
      // Change button to maximize
      minimizeBtn.textContent = '□';
      minimizeBtn.title = 'Expand';
      
      // Show title in header if it exists
      const noteTitle = titleInput ? titleInput.value.trim() : '';
      if (noteTitle) {
        titleDisplay.textContent = ` - ${noteTitle}`;
        titleDisplay.style.display = 'inline';
      }
    } else {
      noteElement.classList.remove('collapsed');
      
      // Change button back to minimize
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Collapse/Expand';
      
      // Hide title display when expanded
      titleDisplay.style.display = 'none';
      titleDisplay.textContent = '';
    }
    
    saveNotes();
  }
}

function showImageOptions(noteId) {
  const modal = document.createElement('div');
  modal.className = 'screenshot-modal';
  modal.innerHTML = `
    <h3>Add Image</h3>
    <div style="display: flex; gap: 16px; margin-top: 16px;">
      <button class="toolbar-btn" onclick="selectImage('${noteId}')">
        <span class="btn-icon">[F]</span>
        Choose File
      </button>
      <button class="toolbar-btn" onclick="showScreenshotOptions('${noteId}')">
        <span class="btn-icon">📸</span>
        Take Screenshot
      </button>
      <button class="toolbar-btn" onclick="takeAreaScreenshot('${noteId}')">
        <span class="btn-icon">[S]</span>
        Select Area
      </button>
    </div>
    <button class="toolbar-btn" style="margin-top: 16px;" onclick="this.parentElement.remove()">
      Cancel
    </button>
  `;
  document.body.appendChild(modal);
}

async function showScreenshotOptions(noteId) {
  document.querySelector('.screenshot-modal').remove();
  
  const sources = await ipcRenderer.invoke('get-sources');
  
  const modal = document.createElement('div');
  modal.className = 'screenshot-modal';
  modal.innerHTML = `
    <h3>Select Window or Screen</h3>
    <div class="screenshot-sources">
      ${sources.map(source => `
        <div class="screenshot-source" onclick="captureScreenshot('${noteId}', '${source.id}')">
          <img src="${source.thumbnail.toDataURL()}" />
          <span class="screenshot-source-name">${source.name}</span>
        </div>
      `).join('')}
    </div>
    <button class="toolbar-btn" style="margin-top: 16px;" onclick="this.parentElement.remove()">
      Cancel
    </button>
  `;
  document.body.appendChild(modal);
}

async function captureScreenshot(noteId, sourceId) {
  document.querySelector('.screenshot-modal').remove();
  
  try {
    const result = await ipcRenderer.invoke('capture-screenshot', sourceId);
    if (result.success) {
      const note = notes.find(n => n.id === noteId);
      if (note) {
        // Convert data URL to a temporary file path or use it directly
        note.imagePath = result.dataUrl;
        
        // Re-render the note
        const noteElement = document.getElementById(noteId);
        renderNote(note);
        noteElement.remove();
        
        saveNotes();
      }
    } else {
      alert(`Screenshot failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    alert('Screenshot capture failed');
  }
}

async function selectFile(noteId) {
  const result = await ipcRenderer.invoke('open-file-dialog');
  if (!result.canceled && result.filePaths.length > 0) {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      note.filePath = result.filePaths[0];
      const noteElement = document.getElementById(noteId);
      renderNote(note);
      noteElement.remove();
      saveNotes();
    }
  }
}

async function selectImage(noteId) {
  const result = await ipcRenderer.invoke('open-image-dialog');
  if (!result.canceled && result.filePaths.length > 0) {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      note.imagePath = result.filePaths[0];
      const noteElement = document.getElementById(noteId);
      renderNote(note);
      noteElement.remove();
      saveNotes();
    }
  }
  document.querySelector('.screenshot-modal')?.remove();
}

async function openFile(filePath) {
  const result = await ipcRenderer.invoke('open-file', filePath);
  if (result.error) {
    alert(`Could not open file: ${result.error}`);
  } else {
    // Close overlay when file opens successfully
    setTimeout(() => {
      ipcRenderer.send('fade-out');
      setTimeout(() => window.close(), 300);
    }, 500); // Small delay to let file open first
  }
}

function startDragging(e, note) {
  isDragging = true;
  activeNote = note;
  
  const noteElement = document.getElementById(note.id);
  const rect = noteElement.getBoundingClientRect();
  
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDragging);
}

function drag(e) {
  if (!isDragging || !activeNote) return;
  
  const noteElement = document.getElementById(activeNote.id);
  const newX = e.clientX - dragOffset.x;
  const newY = e.clientY - dragOffset.y;
  
  noteElement.style.left = `${newX}px`;
  noteElement.style.top = `${newY}px`;
  
  activeNote.x = newX;
  activeNote.y = newY;
  
  // Update folder drop zone visual feedback
  updateFolderDropFeedback(e);
}

function stopDragging(e) {
  if (isDragging && activeNote) {
    // Check if dropped over a folder
    const droppedOnFolder = checkFolderDropTarget(e, activeNote);
    
    // If note was in a folder but not dropped on another folder, remove it from the original folder
    if (!droppedOnFolder && activeNote.parentFolder) {
      const folder = notes.find(n => n.id === activeNote.parentFolder);
      if (folder && folder.folderItems) {
        folder.folderItems = folder.folderItems.filter(id => id !== activeNote.id);
        updateFolderDisplay(activeNote.parentFolder);
      }
      activeNote.parentFolder = null;
      
      // Make sure the note is visible when removed from folder
      const noteElement = document.getElementById(activeNote.id);
      if (noteElement) {
        noteElement.style.display = 'block';
      }
    }
    
    saveNotes();
  }
  
  // Clear folder drop feedback
  document.querySelectorAll('.folder-drop-zone.drag-over').forEach(zone => {
    zone.classList.remove('drag-over');
  });
  
  isDragging = false;
  activeNote = null;
  
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', stopDragging);
}

function startResizing(e, note) {
  isResizing = true;
  activeNote = note;
  
  resizeStart.width = note.width;
  resizeStart.height = note.height;
  resizeStart.x = e.clientX;
  resizeStart.y = e.clientY;
  
  document.addEventListener('mousemove', resize);
  document.addEventListener('mouseup', stopResizing);
  e.preventDefault();
}

function resize(e) {
  if (!isResizing || !activeNote) return;
  
  const noteElement = document.getElementById(activeNote.id);
  
  const deltaX = e.clientX - resizeStart.x;
  const deltaY = e.clientY - resizeStart.y;
  
  const newWidth = Math.max(200, resizeStart.width + deltaX);
  const newHeight = Math.max(150, resizeStart.height + deltaY);
  
  noteElement.style.width = `${newWidth}px`;
  noteElement.style.height = `${newHeight}px`;
  
  activeNote.width = newWidth;
  activeNote.height = newHeight;
  
  // Update paint canvas if it's a paint note
  if (activeNote.type === 'paint') {
    const canvas = document.getElementById(`canvas-${activeNote.id}`);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      
      // Store current drawing
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Update canvas size
      const canvasWidth = newWidth;
      const canvasHeight = newHeight - 80; // Account for header and toolbar
      
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      
      // Restore drawing
      ctx.putImageData(imageData, 0, 0);
    }
  }
}

function stopResizing() {
  if (isResizing && activeNote) {
    saveNotes();
  }
  
  isResizing = false;
  activeNote = null;
  
  document.removeEventListener('mousemove', resize);
  document.removeEventListener('mouseup', stopResizing);
}

async function deleteNote(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Check if document is unsaved
  if (note.type === 'document' && !note.documentSaved) {
    const saveChoice = await showDocumentSavePrompt(note);
    if (saveChoice === 'cancel') {
      return; // User cancelled
    } else if (saveChoice === 'save') {
      await saveDocument(noteId);
    }
  }
  
  // Check if confirmation is needed
  if (appConfig.confirmDelete) {
    const confirmed = await showDeleteConfirmation(note);
    if (!confirmed) {
      return; // User cancelled
    }
  }
  
  // If it's a timer note, stop the timer and close any detached window
  if (note.type === 'timer') {
    stopTimer(noteId);
    if (note.detached) {
      ipcRenderer.invoke('close-timer-window', noteId);
    }
  }
  
  // Remove note from any parent folder
  if (note.parentFolder) {
    const parentFolder = notes.find(n => n.id === note.parentFolder);
    if (parentFolder && parentFolder.folderItems) {
      parentFolder.folderItems = parentFolder.folderItems.filter(id => id !== noteId);
      updateFolderDisplay(note.parentFolder);
    }
  }
  
  // Also check all folders in case the note is referenced without parentFolder set
  notes.forEach(n => {
    if (n.type === 'folder' && n.folderItems && n.folderItems.includes(noteId)) {
      n.folderItems = n.folderItems.filter(id => id !== noteId);
      updateFolderDisplay(n.id);
    }
  });
  
  notes = notes.filter(n => n.id !== noteId);
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.remove();
  }
  saveNotes();
}

function saveNotes() {
  // Update current workspace data
  workspaceData[currentWorkspace] = {
    notes: [...notes],
    archivedNotes: [...archivedNotes]
  };
  
  saveWorkspaceData();
}

function saveWorkspaceData() {
  try {
    const dataDir = appConfig.dataPath;
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Save home workspace
    const homeNotesPath = path.join(dataDir, 'home-notes.json');
    fs.writeFileSync(
      homeNotesPath,
      JSON.stringify(workspaceData.home, null, 2)
    );
    
    // Save work workspace  
    const workNotesPath = path.join(dataDir, 'work-notes.json');
    fs.writeFileSync(
      workNotesPath,
      JSON.stringify(workspaceData.work, null, 2)
    );
  } catch (error) {
    console.error('Error saving workspace data:', error);
  }
}

function loadNotes() {
  // Load config first
  loadConfig();
  
  // Load workspace preference first
  currentWorkspace = loadWorkspacePreference();
  
  // Load workspace-specific notes
  const homeNotesPath = path.join(appConfig.dataPath, 'home-notes.json');
  const workNotesPath = path.join(appConfig.dataPath, 'work-notes.json');
  
  // Load home workspace data
  if (fs.existsSync(homeNotesPath)) {
    try {
      const homeData = JSON.parse(fs.readFileSync(homeNotesPath, 'utf8'));
      workspaceData.home = {
        notes: homeData.notes || [],
        archivedNotes: homeData.archivedNotes || []
      };
    } catch (error) {
      console.error('Error loading home workspace data:', error);
      workspaceData.home = { notes: [], archivedNotes: [] };
    }
  }
  
  // Load work workspace data
  if (fs.existsSync(workNotesPath)) {
    try {
      const workData = JSON.parse(fs.readFileSync(workNotesPath, 'utf8'));
      workspaceData.work = {
        notes: workData.notes || [],
        archivedNotes: workData.archivedNotes || []
      };
    } catch (error) {
      console.error('Error loading work workspace data:', error);
      workspaceData.work = { notes: [], archivedNotes: [] };
    }
  }
  
  // Check for legacy notes.json file and migrate if needed
  const legacyNotesPath = path.join(appConfig.dataPath, 'notes.json');
  if (fs.existsSync(legacyNotesPath)) {
    try {
      const legacyData = JSON.parse(fs.readFileSync(legacyNotesPath, 'utf8'));
      if (legacyData.notes || legacyData.archivedNotes) {
        // Migrate legacy data to home workspace if home is empty
        if (workspaceData.home.notes.length === 0 && workspaceData.home.archivedNotes.length === 0) {
          workspaceData.home = {
            notes: legacyData.notes || [],
            archivedNotes: legacyData.archivedNotes || []
          };
          // Save the migrated data
          saveWorkspaceData();
          // Remove legacy file
          fs.unlinkSync(legacyNotesPath);
        }
      }
    } catch (error) {
      console.error('Error migrating legacy notes:', error);
      // If there's an error, just skip the migration
    }
  }
  
  // Set current workspace notes
  notes = [...workspaceData[currentWorkspace].notes];
  archivedNotes = [...workspaceData[currentWorkspace].archivedNotes];
  
  notes.forEach(note => {
    // Ensure all notes have required properties
    if (!note.hasOwnProperty('title')) note.title = '';
    if (!note.hasOwnProperty('type')) note.type = 'text';
    if (!note.hasOwnProperty('filePath')) note.filePath = '';
    if (!note.hasOwnProperty('imagePath')) note.imagePath = '';
    if (!note.hasOwnProperty('paintData')) note.paintData = '';
    if (!note.hasOwnProperty('todoItems')) note.todoItems = [];
    if (!note.hasOwnProperty('canvasWidth')) note.canvasWidth = null;
    if (!note.hasOwnProperty('canvasHeight')) note.canvasHeight = null;
    if (!note.hasOwnProperty('reminderDateTime')) note.reminderDateTime = '';
    if (!note.hasOwnProperty('reminderMessage')) note.reminderMessage = '';
    if (!note.hasOwnProperty('reminderTriggered')) note.reminderTriggered = false;
    
    // Reset detached state on load
    if (note.detached) {
      note.detached = false;
    }
    
    // Restart any running timers
    if (note.type === 'timer' && note.timerRunning) {
      startTimer(note.id);
    }
    
    renderNote(note);
  });
}

// Configuration management functions
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      appConfig = { ...appConfig, ...config };
    }
    
    // Ensure documents folder exists
    ensureDocumentsFolder();
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

function ensureDocumentsFolder() {
  try {
    const documentsDir = path.join(appConfig.dataPath, 'documents');
    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
      console.log('Created documents folder:', documentsDir);
    }
  } catch (error) {
    console.error('Error creating documents folder:', error);
  }
}

function copyDirectorySync(src, dest) {
  try {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (let entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        copyDirectorySync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch (error) {
    console.error('Error copying directory:', error);
  }
}

function saveConfig() {
  try {
    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2));
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

function getCurrentDataPath() {
  return appConfig.dataPath;
}

async function changeDataFolder() {
  const { dialog, getCurrentWindow } = require('@electron/remote');
  const currentWindow = getCurrentWindow();
  
  const result = await dialog.showOpenDialog(currentWindow, {
    properties: ['openDirectory'],
    title: 'Select Data Folder',
    buttonLabel: 'Select Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const newPath = result.filePaths[0];
    const oldPath = appConfig.dataPath;
    
    // Check if data files exist in the new location
    const homeNotesExist = fs.existsSync(path.join(newPath, 'home-notes.json'));
    const workNotesExist = fs.existsSync(path.join(newPath, 'work-notes.json'));
    
    if (homeNotesExist || workNotesExist) {
      // Data exists in new location
      const choice = await dialog.showMessageBox(currentWindow, {
        type: 'question',
        buttons: ['Use Existing Data', 'Move Current Data', 'Cancel'],
        defaultId: 2,
        message: 'Data files found in the selected folder',
        detail: 'Would you like to use the existing data in this folder, or move your current data there?'
      });
      
      if (choice.response === 0) {
        // Use existing data
        appConfig.dataPath = newPath;
        saveConfig();
        loadNotes();
        updateDataPathDisplay();
      } else if (choice.response === 1) {
        // Move current data
        moveDataToNewLocation(oldPath, newPath);
      }
    } else {
      // No data in new location
      const choice = await dialog.showMessageBox(currentWindow, {
        type: 'question',
        buttons: ['Create New', 'Move Existing', 'Cancel'],
        defaultId: 2,
        message: 'No data files found in the selected folder',
        detail: 'Would you like to create new data files there, or move your existing data?'
      });
      
      if (choice.response === 0) {
        // Create new data
        appConfig.dataPath = newPath;
        saveConfig();
        // Create empty data files
        saveWorkspaceData();
        updateDataPathDisplay();
      } else if (choice.response === 1) {
        // Move existing data
        moveDataToNewLocation(oldPath, newPath);
      }
    }
  }
}

function moveDataToNewLocation(oldPath, newPath) {
  try {
    // Ensure new directory exists
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    
    // Move data files
    const filesToMove = ['home-notes.json', 'work-notes.json', 'workspace-preference.json', 'saved-documents.json'];
    
    filesToMove.forEach(file => {
      const oldFile = path.join(oldPath, file);
      const newFile = path.join(newPath, file);
      
      if (fs.existsSync(oldFile)) {
        fs.copyFileSync(oldFile, newFile);
      }
    });
    
    // Move documents folder if it exists
    const oldDocumentsDir = path.join(oldPath, 'documents');
    const newDocumentsDir = path.join(newPath, 'documents');
    
    if (fs.existsSync(oldDocumentsDir)) {
      // Copy entire documents directory
      copyDirectorySync(oldDocumentsDir, newDocumentsDir);
    }
    
    // Update config
    appConfig.dataPath = newPath;
    
    // Ensure documents folder exists in new location
    ensureDocumentsFolder();
    saveConfig();
    
    // Reload notes from new location
    loadNotes();
    updateDataPathDisplay();
    
    const { dialog, getCurrentWindow } = require('@electron/remote');
    dialog.showMessageBox(getCurrentWindow(), {
      type: 'info',
      message: 'Data moved successfully',
      detail: `Your data has been moved to: ${newPath}`
    });
  } catch (error) {
    console.error('Error moving data:', error);
    const { dialog, getCurrentWindow } = require('@electron/remote');
    dialog.showMessageBox(getCurrentWindow(), {
      type: 'error',
      message: 'Error moving data',
      detail: error.message
    });
  }
}

async function resetAllData() {
  const { dialog, getCurrentWindow } = require('@electron/remote');
  const currentWindow = getCurrentWindow();
  
  const choice = await dialog.showMessageBox(currentWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Reset All Data'],
    defaultId: 0,
    message: 'Are you sure you want to reset all data?',
    detail: 'This will permanently delete all your notes and settings. This action cannot be undone.'
  });
  
  if (choice.response === 1) {
    // Clear all data
    workspaceData = {
      home: { notes: [], archivedNotes: [] },
      work: { notes: [], archivedNotes: [] }
    };
    notes = [];
    archivedNotes = [];
    
    // Save empty data
    saveWorkspaceData();
    
    // Clear the display
    document.getElementById('notes-container').innerHTML = '';
    
    // Close settings modal
    closeSettingsModal();
    
    dialog.showMessageBox(currentWindow, {
      type: 'info',
      message: 'Data reset complete',
      detail: 'All notes and settings have been reset.'
    });
  }
}

function updateDataPathDisplay() {
  const pathElement = document.getElementById('current-data-path');
  if (pathElement) {
    pathElement.textContent = `Current data folder: ${getCurrentDataPath()}`;
  }
}

// Hotkey configuration functions
function showHotkeysConfig() {
  const existingModal = document.querySelector('.hotkeys-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.className = 'hotkeys-modal';
  modal.innerHTML = `
    <div class="hotkeys-modal-content">
      <h3>Configure Hotkeys</h3>
      <div class="hotkeys-list">
        <div class="hotkey-item">
          <label>Toggle Overlay:</label>
          <input type="text" 
                 id="hotkey-toggleOverlay" 
                 class="hotkey-input" 
                 value="${escapeHtml(appConfig.hotkeys.toggleOverlay)}" 
                 placeholder="Click and press keys"
                 readonly>
          <button class="hotkey-clear" onclick="clearHotkey('toggleOverlay')">Clear</button>
        </div>
        <div class="hotkey-item">
          <label>New Note:</label>
          <input type="text" 
                 id="hotkey-newNote" 
                 class="hotkey-input" 
                 value="${escapeHtml(appConfig.hotkeys.newNote || '')}" 
                 placeholder="Click and press keys"
                 readonly>
          <button class="hotkey-clear" onclick="clearHotkey('newNote')">Clear</button>
        </div>
        <div class="hotkey-item">
          <label>Search:</label>
          <input type="text" 
                 id="hotkey-search" 
                 class="hotkey-input" 
                 value="${escapeHtml(appConfig.hotkeys.search || '')}" 
                 placeholder="Click and press keys"
                 readonly>
          <button class="hotkey-clear" onclick="clearHotkey('search')">Clear</button>
        </div>
        <div class="hotkey-item">
          <label>Archive:</label>
          <input type="text" 
                 id="hotkey-archive" 
                 class="hotkey-input" 
                 value="${escapeHtml(appConfig.hotkeys.archive || '')}" 
                 placeholder="Click and press keys"
                 readonly>
          <button class="hotkey-clear" onclick="clearHotkey('archive')">Clear</button>
        </div>
      </div>
      <div class="hotkeys-info">
        <small>Click on an input field and press your desired key combination</small>
      </div>
      <div class="hotkeys-buttons">
        <button class="hotkeys-save" onclick="saveHotkeys()">Save</button>
        <button class="hotkeys-cancel" onclick="closeHotkeysConfig()">Cancel</button>
        <button class="hotkeys-reset" onclick="resetHotkeys()">Reset to Defaults</button>
      </div>
    </div>
    <div class="hotkeys-modal-backdrop" onclick="closeHotkeysConfig()"></div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners for hotkey capture
  const inputs = modal.querySelectorAll('.hotkey-input');
  inputs.forEach(input => {
    input.addEventListener('click', function() {
      this.value = 'Press keys...';
      this.classList.add('recording');
    });
    
    input.addEventListener('keydown', function(e) {
      if (!this.classList.contains('recording')) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // Build the hotkey string
      let keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Meta');
      
      // Add the actual key if it's not a modifier
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        // Format the key properly
        let key = e.key;
        if (key.length === 1) {
          key = key.toUpperCase();
        } else {
          // Handle special keys
          key = key.charAt(0).toUpperCase() + key.slice(1);
        }
        keys.push(key);
      }
      
      if (keys.length > 0 && keys.some(k => !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(k))) {
        this.value = keys.join('+');
        this.classList.remove('recording');
      }
    });
    
    input.addEventListener('blur', function() {
      if (this.classList.contains('recording')) {
        this.value = appConfig.hotkeys[this.id.replace('hotkey-', '')] || '';
        this.classList.remove('recording');
      }
    });
  });
}

function closeHotkeysConfig() {
  const modal = document.querySelector('.hotkeys-modal');
  if (modal) {
    modal.remove();
  }
}

function clearHotkey(key) {
  const input = document.getElementById(`hotkey-${key}`);
  if (input) {
    input.value = '';
  }
}

function resetHotkeys() {
  document.getElementById('hotkey-toggleOverlay').value = 'Alt+Q';
  document.getElementById('hotkey-newNote').value = 'Ctrl+Shift+N';
  document.getElementById('hotkey-search').value = 'Ctrl+F';
  document.getElementById('hotkey-archive').value = 'Ctrl+Shift+A';
}

async function saveHotkeys() {
  const newHotkeys = {
    toggleOverlay: document.getElementById('hotkey-toggleOverlay').value || '',
    newNote: document.getElementById('hotkey-newNote').value || '',
    search: document.getElementById('hotkey-search').value || '',
    archive: document.getElementById('hotkey-archive').value || ''
  };
  
  // Check for duplicates
  const values = Object.values(newHotkeys).filter(v => v);
  const uniqueValues = [...new Set(values)];
  if (values.length !== uniqueValues.length) {
    const { dialog, getCurrentWindow } = require('@electron/remote');
    dialog.showMessageBox(getCurrentWindow(), {
      type: 'warning',
      message: 'Duplicate hotkeys detected',
      detail: 'Each hotkey must be unique. Please use different key combinations.'
    });
    return;
  }
  
  // Update config
  appConfig.hotkeys = newHotkeys;
  saveConfig();
  
  // Update hotkeys in main process
  ipcRenderer.invoke('update-hotkeys', newHotkeys);
  
  // Close modal
  closeHotkeysConfig();
  
  const { dialog, getCurrentWindow } = require('@electron/remote');
  dialog.showMessageBox(getCurrentWindow(), {
    type: 'info',
    message: 'Hotkeys saved',
    detail: 'Your hotkey configuration has been updated.'
  });
}

async function takeAreaScreenshot(noteId) {
  document.querySelector('.screenshot-modal')?.remove();
  
  try {
    const bounds = await ipcRenderer.invoke('start-area-screenshot');
    if (bounds) {
      // Get the first screen source for area capture
      const sources = await ipcRenderer.invoke('get-sources');
      const screenSource = sources.find(s => s.name.includes('Screen') || s.name.includes('Entire'));
      
      if (screenSource) {
        const result = await ipcRenderer.invoke('capture-screenshot', screenSource.id, bounds);
        if (result.success) {
          const note = notes.find(n => n.id === noteId);
          if (note) {
            note.imagePath = result.dataUrl;
            
            // Re-render the note
            const noteElement = document.getElementById(noteId);
            renderNote(note);
            noteElement.remove();
            
            saveNotes();
          }
        } else {
          alert(`Screenshot failed: ${result.error}`);
        }
      } else {
        alert('No screen source found for screenshot');
      }
    }
  } catch (error) {
    console.error('Area screenshot failed:', error);
    alert('Area screenshot failed');
  }
}

function setupPaintCanvas(note) {
  const canvas = document.getElementById(`canvas-${note.id}`);
  const ctx = canvas.getContext('2d');
  const noteElement = document.getElementById(note.id);
  
  // Function to update canvas size based on note dimensions
  const updateCanvasSize = () => {
    const noteRect = noteElement.getBoundingClientRect();
    const newWidth = note.width;
    const newHeight = note.height - 80; // Account for header and toolbar
    
    // Store current drawing if canvas exists and has content
    let imageData = null;
    if (canvas.width > 0 && canvas.height > 0) {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    
    // Update canvas dimensions
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Set CSS size to match
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;
    
    // Restore drawing if we had one
    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
    
    // Restore paint data if available
    if (note.paintData) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = note.paintData;
    }
  };
  
  // Initial canvas size setup
  updateCanvasSize();
  
  // Load existing paint data
  if (note.paintData) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = note.paintData;
  }
  
  let isDrawing = false;
  let currentTool = 'brush';
  let currentColor = '#000';
  let currentSize = 3;
  
  // Setup toolbar events
  const toolbar = noteElement.querySelector('.paint-toolbar');
  
  // Tool selection
  toolbar.querySelectorAll('.paint-tool[data-tool]').forEach(tool => {
    tool.addEventListener('click', (e) => {
      toolbar.querySelectorAll('.paint-tool[data-tool]').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentTool = e.target.dataset.tool;
      canvas.style.cursor = currentTool === 'eraser' ? 'grab' : 'crosshair';
    });
  });
  
  // Color selection
  toolbar.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      toolbar.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      e.target.classList.add('active');
      currentColor = e.target.dataset.color;
    });
  });
  
  // Brush size
  const sizeSlider = toolbar.querySelector('.brush-size');
  sizeSlider.addEventListener('input', (e) => {
    currentSize = e.target.value;
  });
  
  // Drawing events
  let lastX = 0;
  let lastY = 0;
  
  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    // Since canvas maintains its original size, coordinates are 1:1
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    // Since canvas maintains its original size, coordinates are 1:1
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (currentTool === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentColor;
    } else if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    }
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    lastX = x;
    lastY = y;
  });
  
  canvas.addEventListener('mouseup', () => {
    if (isDrawing) {
      isDrawing = false;
      // Save canvas data
      note.paintData = canvas.toDataURL();
      saveNotes();
    }
  });
  
  canvas.addEventListener('mouseout', () => {
    isDrawing = false;
  });
}

function clearCanvas(noteId) {
  const canvas = document.getElementById(`canvas-${noteId}`);
  const ctx = canvas.getContext('2d');
  const note = notes.find(n => n.id === noteId);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (note) {
    note.paintData = '';
    saveNotes();
  }
}

function setupTodoNote(note) {
  const noteElement = document.getElementById(note.id);
  
  // Auto-resize textarea inputs
  noteElement.querySelectorAll('.todo-text').forEach(textarea => {
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
    
    // Trigger initial resize
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });
}

function addTodo(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Save current values from all todo text fields
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    const todoTextElements = noteElement.querySelectorAll('.todo-text');
    todoTextElements.forEach((textarea, index) => {
      if (note.todoItems && note.todoItems[index]) {
        note.todoItems[index].text = textarea.value;
      }
    });
  }
  
  const newTodo = {
    id: Date.now(),
    text: '',
    completed: false
  };
  
  if (!note.todoItems) {
    note.todoItems = [];
  }
  note.todoItems.push(newTodo);
  
  // Update only the todo list content instead of re-rendering entire note
  const todoListElement = noteElement.querySelector('.todo-list');
  if (todoListElement) {
    // Add the new todo item to the existing list
    const newTodoHTML = `
      <li class="todo-item" data-id="${newTodo.id}">
        <div class="todo-checkbox" onclick="toggleTodo('${note.id}', '${newTodo.id}')"></div>
        <textarea class="todo-text" 
                  placeholder="Enter task..." 
                  onblur="updateTodoText('${note.id}', '${newTodo.id}', this.value)"
                  rows="1">${newTodo.text}</textarea>
        <span class="todo-delete" onclick="deleteTodo('${note.id}', '${newTodo.id}')"> × </span>
      </li>
    `;
    todoListElement.insertAdjacentHTML('beforeend', newTodoHTML);
    
    // Focus on the new todo item
    const newTextarea = todoListElement.querySelector(`[data-id="${newTodo.id}"] .todo-text`);
    if (newTextarea) {
      newTextarea.focus();
    }
  }
  
  saveNotes();
  generateAutoTitle(noteId);
}

function deleteTodo(noteId, todoId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.todoItems = note.todoItems.filter(item => item.id != parseInt(todoId));
  
  // Re-render the note
  const noteElement = document.getElementById(noteId);
  noteElement.remove();
  renderNote(note);
  
  saveNotes();
}


function updateTodoProgress(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const completedCount = note.todoItems.filter(item => item.completed).length;
  const totalCount = note.todoItems.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  
  const progressElement = document.querySelector(`#${noteId} .todo-progress`);
  if (progressElement) {
    progressElement.innerHTML = `
      <span>${completedCount}/${totalCount}</span>
      <div class="todo-progress-bar">
        <div class="todo-progress-fill" style="width: ${progressPercent}%"></div>
      </div>
      <span>${Math.round(progressPercent)}%</span>
    `;
  }
}

async function emailNote(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Prepare email content
  let subject = note.title || 'Note from PhasePad';
  let body = '';
  let attachmentCreated = false;
  let attachmentInfo = '';
  
  // Add title if available
  if (note.title) {
    body += `${note.title}\n${'='.repeat(note.title.length)}\n\n`;
  }
  
  // Add tags if available
  if (note.tags && note.tags.length > 0) {
    body += `Tags: ${note.tags.join(', ')}\n\n`;
  }
  
  // Handle special cases with attachments
  switch (note.type) {
    case 'paint':
      body += `Drawing Note\n\n`;
      if (note.paintData) {
        // Copy image to clipboard
        await copyPaintToClipboard(note);
        attachmentCreated = true;
        attachmentInfo = `\nATTACHMENT INFO:\nYour drawing has been copied to the clipboard.\nSimply paste (Ctrl+V) it into your email as an attachment.\n\n`;
      }
      body += note.content || '';
      break;
      
    case 'text':
      body += note.content || '';
      break;
      
    case 'code':
      body += `Code (${note.codeLanguage || 'Plain'}):\n\n${note.codeContent || ''}`;
      break;
      
    case 'todo':
      body += 'Tasks:\n';
      if (note.todoItems) {
        note.todoItems.forEach(item => {
          body += `${item.completed ? '✓' : '☐'} ${item.text}\n`;
        });
      }
      break;
      
    case 'table':
      body += 'Table Data:\n\n';
      if (note.tableData && note.tableData.length > 0) {
        note.tableData.forEach((row, i) => {
          body += `Row ${i + 1}: ${row.join(' | ')}\n`;
        });
      }
      break;
      
    default:
      body += note.content || '';
  }
  
  // Add attachment info if needed
  body += attachmentInfo;
  
  // Add creation date
  if (note.createdAt) {
    body += `---\nCreated: ${new Date(note.createdAt).toLocaleString()}`;
  }
  body += `\nSent from PhasePad`;
  
  // Show success message if attachment was created (only for paint notes)
  if (attachmentCreated && note.type === 'paint') {
    alert('Drawing copied to clipboard! You can now paste it directly into your email (Ctrl+V).');
  }
  
  // Create mailto link
  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  
  // Use a temporary anchor element to trigger the email client without opening a window
  const tempLink = document.createElement('a');
  tempLink.href = mailtoLink;
  tempLink.style.display = 'none';
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
}

async function copyPaintToClipboard(note) {
  if (!note.paintData) return false;
  
  try {
    // Convert base64 data URL to blob
    const response = await fetch(note.paintData);
    const blob = await response.blob();
    
    // Copy to clipboard using the Clipboard API
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob
      })
    ]);
    
    return true;
  } catch (error) {
    console.error('Error copying paint to clipboard:', error);
    // Fallback: try to create a temporary download for manual copy
    try {
      const response = await fetch(note.paintData);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(note.title || 'drawing').replace(/[^a-zA-Z0-9]/g, '_')}_drawing.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (fallbackError) {
      console.error('Fallback download also failed:', fallbackError);
      return false;
    }
  }
}


function archiveNote(noteId) {
  const noteIndex = notes.findIndex(n => n.id === noteId);
  if (noteIndex === -1) return;
  
  const note = notes[noteIndex];
  note.archivedAt = new Date().toISOString();
  
  // If it's a timer note, stop the timer and close any detached window
  if (note.type === 'timer') {
    stopTimer(noteId);
    if (note.detached) {
      ipcRenderer.invoke('close-timer-window', noteId);
      note.detached = false;
    }
  }
  
  // Move to archived notes
  archivedNotes.push(note);
  notes.splice(noteIndex, 1);
  
  // Remove from display
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.remove();
  }
  
  saveNotes();
}

function restoreNote(noteId) {
  const noteIndex = archivedNotes.findIndex(n => n.id === noteId);
  if (noteIndex === -1) return;
  
  const note = archivedNotes[noteIndex];
  delete note.archivedAt;
  
  // Reset timer state if it's a timer note
  if (note.type === 'timer') {
    note.timerRunning = false;
    note.detached = false;
    // Reset to initial duration
    note.timerRemaining = note.timerDuration;
  }
  
  // Move back to active notes
  notes.push(note);
  archivedNotes.splice(noteIndex, 1);
  
  // Render the restored note
  renderNote(note);
  
  // Update archive panel
  if (isArchivePanelVisible) {
    showArchivePanel();
  }
  
  saveNotes();
}

function toggleArchivePanel() {
  if (isArchivePanelVisible) {
    hideArchivePanel();
  } else {
    showArchivePanel();
  }
}

function showArchivePanel() {
  hideArchivePanel(); // Remove existing panel
  
  const panel = document.createElement('div');
  panel.className = 'archive-panel';
  panel.id = 'archive-panel';
  
  panel.innerHTML = `
    <div class="archive-header">
      <h3 style="margin: 0; font-size: 16px;">Archived Notes</h3>
      <span style="cursor: pointer; font-size: 18px;" onclick="hideArchivePanel()">×</span>
    </div>
    <div id="archive-list">
      ${archivedNotes.length === 0 ? 
        '<p style="text-align: center; opacity: 0.7; font-size: 14px;">No archived notes</p>' :
        archivedNotes.map(note => {
          const preview = note.content || note.title || note.filePath || 'Untitled';
          const escapedPreview = escapeHtml(preview.substring(0, 30)) + (preview.length > 30 ? '...' : '');
          return `
            <div class="archive-item" onclick="restoreNote('${note.id}')">
              <div class="archive-item-info">
                <div class="archive-item-title">${escapeHtml(note.title || 'Untitled')}</div>
                <div class="archive-item-preview">${escapedPreview}</div>
              </div>
              <div class="archive-item-restore" title="Restore note">↶</div>
            </div>
          `;
        }).join('')
      }
    </div>
  `;
  
  document.body.appendChild(panel);
  isArchivePanelVisible = true;
}

function hideArchivePanel() {
  const panel = document.getElementById('archive-panel');
  if (panel) {
    panel.remove();
  }
  isArchivePanelVisible = false;
}

function startReminderChecker() {
  // Check reminders every minute
  reminderCheckInterval = setInterval(checkReminders, 60000);
  // Also check immediately
  checkReminders();
}

function checkReminders() {
  const now = new Date();
  
  notes.forEach(note => {
    if (note.type === 'reminder' && note.reminderDateTime && !note.reminderTriggered) {
      const reminderDate = new Date(note.reminderDateTime);
      
      // Check if reminder time has passed (with 1-minute tolerance)
      if (reminderDate <= now && (now - reminderDate) < 120000) { // 2 minutes tolerance
        triggerReminder(note);
      }
    }
  });
}

function triggerReminder(note) {
  note.reminderTriggered = true;
  saveNotes();
  
  // Show desktop notification
  if (Notification.permission === 'granted') {
    const notification = new Notification('PhasePad Reminder', {
      body: note.reminderMessage || note.title || 'You have a reminder!',
      icon: '../media/LogoWhite.png',
      tag: `reminder-${note.id}`,
      requireInteraction: true
    });
    
    notification.onclick = () => {
      // Show the overlay and focus on the reminder note
      ipcRenderer.invoke('show-overlay-and-focus-note', note.id);
      notification.close();
    };
  }
  
  // Re-render the note to update status
  const noteElement = document.getElementById(note.id);
  if (noteElement) {
    noteElement.remove();
    renderNote(note);
  }
}

function updateReminderDateTime(noteId, dateTimeValue) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // The datetime-local input provides local time, store it as-is
  // It will be interpreted as local time when creating Date objects
  note.reminderDateTime = dateTimeValue;
  note.reminderTriggered = false; // Reset trigger status when date changes
  saveNotes();
  
  // Re-render to update status
  const noteElement = document.getElementById(noteId);
  noteElement.remove();
  renderNote(note);
}

function updateReminderMessage(noteId, message) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.reminderMessage = message;
  if (!note.title && message) {
    note.title = message.substring(0, 30) + (message.length > 30 ? '...' : '');
  }
  saveNotes();
}

function resetReminder(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.reminderTriggered = false;
  saveNotes();
  
  // Re-render to update status
  const noteElement = document.getElementById(noteId);
  noteElement.remove();
  renderNote(note);
}

function testReminder(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Request notification permission if not granted
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showTestNotification(note);
      }
    });
  } else if (Notification.permission === 'granted') {
    showTestNotification(note);
  } else {
    alert('Notification permission is denied. Please enable notifications in your browser settings.');
  }
}

function showTestNotification(note) {
  const notification = new Notification('PhasePad Test Reminder', {
    body: note.reminderMessage || 'This is a test notification',
    icon: '../media/LogoWhite.png',
    tag: `test-reminder-${note.id}`
  });
  
  notification.onclick = () => {
    ipcRenderer.invoke('show-overlay-and-focus-note', note.id);
    notification.close();
  };
  
  // Auto-close after 5 seconds
  setTimeout(() => {
    notification.close();
  }, 5000);
}

// Request notification permission on startup
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Web Note functions
function updateWebUrl(noteId, url) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.webUrl = url;
  saveNotes();
  
  // Update button states
  const noteElement = document.getElementById(noteId);
  const openBtn = noteElement.querySelector('button[onclick*="openWebUrl"]');
  const copyBtn = noteElement.querySelector('button[onclick*="copyWebUrl"]');
  const previewBtn = noteElement.querySelector('button[onclick*="toggleWebPreview"]');
  
  if (openBtn) {
    openBtn.disabled = !url;
  }
  if (copyBtn) {
    copyBtn.disabled = !url;
  }
  if (previewBtn) {
    previewBtn.disabled = !url;
  }
  
  // Update preview iframe
  const iframe = noteElement.querySelector('iframe');
  if (iframe && url) {
    iframe.src = url;
  }
  
  // Generate auto-title if needed
  generateAutoTitle(noteId);
}

function updateWebTitle(noteId, title) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.webTitle = title;
  saveNotes();
  generateAutoTitle(noteId);
}

function updateWebDescription(noteId, description) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.webDescription = description;
  saveNotes();
  generateAutoTitle(noteId);
}

function toggleWebPreview(noteId) {
  const previewElement = document.getElementById(`web-preview-${noteId}`);
  const button = document.querySelector(`button[onclick="toggleWebPreview('${noteId}')"]`);
  
  if (!previewElement || !button) return;
  
  if (previewElement.style.display === 'none') {
    previewElement.style.display = 'block';
    button.textContent = 'Hide Preview';
    
    // Expand note height to accommodate preview
    const noteElement = document.getElementById(noteId);
    const currentHeight = parseInt(noteElement.style.height);
    noteElement.style.height = (currentHeight + 220) + 'px';
  } else {
    previewElement.style.display = 'none';
    button.textContent = 'Preview';
    
    // Shrink note height back
    const noteElement = document.getElementById(noteId);
    const currentHeight = parseInt(noteElement.style.height);
    noteElement.style.height = (currentHeight - 220) + 'px';
  }
}

function openWebUrl(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.webUrl) return;
  
  // Open URL in default browser
  require('electron').shell.openExternal(note.webUrl);
}

function copyWebUrl(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.webUrl) return;
  
  // Copy URL to clipboard
  navigator.clipboard.writeText(note.webUrl).then(() => {
    // Show brief feedback
    const noteElement = document.getElementById(noteId);
    const copyBtn = noteElement.querySelector('button[onclick*="copyWebUrl"]');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.background = '#28a745';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = '';
      }, 1000);
    }
  }).catch(err => {
    console.error('Failed to copy URL:', err);
    alert('Failed to copy URL to clipboard');
  });
}

// Table Note functions
function updateTableCell(noteId, rowIndex, colIndex, value) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData) return;
  
  // Ensure the row exists
  if (!note.tableData[rowIndex]) {
    note.tableData[rowIndex] = [];
  }
  
  // Update the cell value
  note.tableData[rowIndex][colIndex] = value;
  saveNotes();
}

function addTableRow(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData) return;
  
  const colCount = note.tableData[0] ? note.tableData[0].length : 3;
  const newRow = new Array(colCount).fill('');
  note.tableData.push(newRow);
  
  // Re-render the note
  const noteElement = document.getElementById(noteId);
  const newNoteElement = renderNote(note);
  noteElement.remove();
  saveNotes();
}

function addTableColumn(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData) return;
  
  // Add a new column to each row
  note.tableData.forEach(row => {
    row.push('');
  });
  
  // Re-render the note
  const noteElement = document.getElementById(noteId);
  const newNoteElement = renderNote(note);
  noteElement.remove();
  saveNotes();
}

function removeTableRow(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData || note.tableData.length <= 1) return;
  
  note.tableData.pop();
  
  // Re-render the note
  const noteElement = document.getElementById(noteId);
  const newNoteElement = renderNote(note);
  noteElement.remove();
  saveNotes();
}

function removeTableColumn(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData || note.tableData[0].length <= 1) return;
  
  // Remove last column from each row
  note.tableData.forEach(row => {
    if (row.length > 0) {
      row.pop();
    }
  });
  
  // Re-render the note
  const noteElement = document.getElementById(noteId);
  const newNoteElement = renderNote(note);
  noteElement.remove();
  saveNotes();
}

// Location Note functions
function updateLocationName(noteId, name) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.locationName = name;
  saveNotes();
}

function updateLocationAddress(noteId, address) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.locationAddress = address;
  saveNotes();
  
  // Update button states
  const noteElement = document.getElementById(noteId);
  const mapsBtn = noteElement.querySelector('button[onclick*="openLocationMaps"]');
  const copyBtn = noteElement.querySelector('button[onclick*="copyLocationAddress"]');
  
  if (mapsBtn) {
    mapsBtn.disabled = !address;
  }
  if (copyBtn) {
    copyBtn.disabled = !address;
  }
}

function updateLocationNotes(noteId, notes_text) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.locationNotes = notes_text;
  saveNotes();
}

function openLocationMaps(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.locationAddress) return;
  
  // Create a Google Maps URL with the address
  const encodedAddress = encodeURIComponent(note.locationAddress);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  
  // Open in default browser
  require('electron').shell.openExternal(mapsUrl);
}

function copyLocationAddress(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.locationAddress) return;
  
  // Copy address to clipboard
  navigator.clipboard.writeText(note.locationAddress).then(() => {
    // Show brief feedback
    const noteElement = document.getElementById(noteId);
    const copyBtn = noteElement.querySelector('button[onclick*="copyLocationAddress"]');
    if (copyBtn) {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.background = '#28a745';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = '';
      }, 1000);
    }
  }).catch(err => {
    console.error('Failed to copy address:', err);
    alert('Failed to copy address to clipboard');
  });
}

// Calculator Note functions
let calculatorOperator = '';
let calculatorPrevious = '';
let calculatorWaitingForOperand = false;

function calculatorInput(noteId, input) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const display = document.getElementById(`calc-display-${noteId}`);
  
  if (['+', '-', '*', '/'].includes(input)) {
    handleOperator(noteId, input, display, note);
  } else {
    handleNumber(noteId, input, display, note);
  }
}

function handleNumber(noteId, input, display, note) {
  if (calculatorWaitingForOperand) {
    note.calculatorDisplay = input;
    calculatorWaitingForOperand = false;
  } else {
    note.calculatorDisplay = note.calculatorDisplay === '0' ? input : note.calculatorDisplay + input;
  }
  
  display.textContent = note.calculatorDisplay;
  saveNotes();
}

function handleOperator(noteId, nextOperator, display, note) {
  const inputValue = parseFloat(note.calculatorDisplay);
  
  if (calculatorPrevious === '') {
    calculatorPrevious = inputValue;
  } else if (calculatorOperator) {
    const currentValue = calculatorPrevious || 0;
    const newValue = calculate(currentValue, inputValue, calculatorOperator);
    
    note.calculatorDisplay = `${parseFloat(newValue.toFixed(7))}`;
    display.textContent = note.calculatorDisplay;
    calculatorPrevious = newValue;
  }
  
  calculatorWaitingForOperand = true;
  calculatorOperator = nextOperator;
  saveNotes();
}

function calculate(firstValue, secondValue, operator) {
  switch (operator) {
    case '+':
      return firstValue + secondValue;
    case '-':
      return firstValue - secondValue;
    case '*':
      return firstValue * secondValue;
    case '/':
      return firstValue / secondValue;
    default:
      return secondValue;
  }
}

function calculatorEquals(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const display = document.getElementById(`calc-display-${noteId}`);
  const inputValue = parseFloat(note.calculatorDisplay);
  
  if (calculatorPrevious !== '' && calculatorOperator && !calculatorWaitingForOperand) {
    const newValue = calculate(calculatorPrevious, inputValue, calculatorOperator);
    
    // Add to history
    const calculation = `${calculatorPrevious} ${calculatorOperator} ${inputValue} = ${parseFloat(newValue.toFixed(7))}`;
    if (!note.calculatorHistory) {
      note.calculatorHistory = [];
    }
    note.calculatorHistory.push(calculation);
    
    // Keep only last 10 entries
    if (note.calculatorHistory.length > 10) {
      note.calculatorHistory = note.calculatorHistory.slice(-10);
    }
    
    note.calculatorDisplay = `${parseFloat(newValue.toFixed(7))}`;
    display.textContent = note.calculatorDisplay;
    
    // Update history display
    const historyElement = document.getElementById(`calc-history-${noteId}`);
    if (historyElement) {
      historyElement.innerHTML = note.calculatorHistory.slice(-3).map(entry => `
        <div class="calc-history-entry">${entry}</div>
      `).join('');
    }
    
    calculatorPrevious = '';
    calculatorOperator = '';
    calculatorWaitingForOperand = true;
    
    saveNotes();
  }
}

function calculatorClear(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const display = document.getElementById(`calc-display-${noteId}`);
  
  note.calculatorDisplay = '0';
  display.textContent = note.calculatorDisplay;
  
  calculatorPrevious = '';
  calculatorOperator = '';
  calculatorWaitingForOperand = false;
  
  saveNotes();
}

function calculatorBackspace(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const display = document.getElementById(`calc-display-${noteId}`);
  
  if (note.calculatorDisplay.length > 1) {
    note.calculatorDisplay = note.calculatorDisplay.slice(0, -1);
  } else {
    note.calculatorDisplay = '0';
  }
  
  display.textContent = note.calculatorDisplay;
  saveNotes();
}

// Auto-title generation system
function generateAutoTitle(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Only generate auto-title if user hasn't set a title and has interacted with content
  if (note.title && note.title.trim()) return;
  
  let autoTitle = '';
  
  switch (note.type) {
    case 'text':
      if (note.content && note.content.trim()) {
        autoTitle = note.content.trim().split('\n')[0].substring(0, 30);
        if (note.content.length > 30) autoTitle += '...';
      }
      break;
      
    case 'web':
      if (note.webTitle && note.webTitle.trim()) {
        autoTitle = note.webTitle.trim();
      } else if (note.webUrl) {
        try {
          const url = new URL(note.webUrl);
          autoTitle = url.hostname.replace('www.', '');
        } catch (e) {
          autoTitle = note.webUrl.substring(0, 30);
        }
      }
      break;
      
    case 'location':
      if (note.locationName && note.locationName.trim()) {
        autoTitle = note.locationName.trim();
      } else if (note.locationAddress && note.locationAddress.trim()) {
        autoTitle = note.locationAddress.trim().split(',')[0];
      }
      break;
      
    case 'file':
      if (note.filePath) {
        autoTitle = path.basename(note.filePath);
      }
      break;
      
    case 'todo':
      const totalTasks = note.todoItems ? note.todoItems.length : 0;
      const completedTasks = note.todoItems ? note.todoItems.filter(item => item.completed).length : 0;
      if (totalTasks > 0) {
        autoTitle = `Todo List (${completedTasks}/${totalTasks})`;
      }
      break;
      
    case 'reminder':
      if (note.reminderMessage && note.reminderMessage.trim()) {
        autoTitle = note.reminderMessage.trim().substring(0, 30);
        if (note.reminderMessage.length > 30) autoTitle += '...';
      } else if (note.reminderDateTime) {
        const date = new Date(note.reminderDateTime);
        autoTitle = `Reminder for ${date.toLocaleDateString()}`;
      }
      break;
      
    case 'table':
      if (note.tableData && note.tableData.length > 0) {
        const firstRow = note.tableData[0];
        if (firstRow && firstRow[0] && firstRow[0].trim()) {
          autoTitle = firstRow[0].trim().substring(0, 30);
          if (firstRow[0].length > 30) autoTitle += '...';
        } else {
          autoTitle = `Table (${note.tableData.length} rows)`;
        }
      }
      break;
      
    case 'calculator':
      if (note.calculatorHistory && note.calculatorHistory.length > 0) {
        autoTitle = 'Calculator';
      }
      break;
      
    case 'paint':
      autoTitle = 'Drawing';
      break;
      
    case 'image':
      if (note.imagePath) {
        autoTitle = path.basename(note.imagePath);
      }
      break;
      
    case 'timer':
      switch (note.timerType) {
        case 'pomodoro':
          autoTitle = 'Pomodoro Timer';
          break;
        case 'short-break':
          autoTitle = 'Short Break';
          break;
        case 'long-break':
          autoTitle = 'Long Break';
          break;
        case 'custom':
          autoTitle = `${Math.floor(note.timerDuration / 60)} min Timer`;
          break;
      }
      break;
      
    case 'code':
      if (note.codeContent && note.codeContent.trim()) {
        // Try to extract a function name or first meaningful line
        const lines = note.codeContent.split('\n').filter(line => line.trim());
        if (lines.length > 0) {
          const firstLine = lines[0].trim();
          // Look for function definitions
          const funcMatch = firstLine.match(/(?:function|def|class|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          if (funcMatch) {
            autoTitle = `${note.codeLanguage.toUpperCase()}: ${funcMatch[1]}`;
          } else {
            autoTitle = `${note.codeLanguage.toUpperCase()}: ${firstLine.substring(0, 25)}${firstLine.length > 25 ? '...' : ''}`;
          }
        } else {
          autoTitle = `${note.codeLanguage.toUpperCase()} Code`;
        }
      }
      break;
  }
  
  // Update the title display in collapsed view
  if (autoTitle) {
    updateNoteTitleDisplay(noteId, autoTitle);
  }
}

function updateNoteTitleDisplay(noteId, title) {
  const noteElement = document.getElementById(noteId);
  if (!noteElement) return;
  
  const titleDisplay = noteElement.querySelector('.note-title-display');
  if (titleDisplay && noteElement.classList.contains('collapsed')) {
    titleDisplay.textContent = ` - ${title}`;
    titleDisplay.style.display = 'inline';
  }
}

// Add auto-title generation to other note type updates
function updateTodoText(noteId, todoId, text) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const todoItem = note.todoItems.find(item => item.id === parseInt(todoId));
  if (todoItem) {
    todoItem.text = text;
    saveNotes();
    generateAutoTitle(noteId);
  }
}

function toggleTodo(noteId, todoId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const todoItem = note.todoItems.find(item => item.id === parseInt(todoId));
  if (todoItem) {
    todoItem.completed = !todoItem.completed;
    
    const checkbox = document.querySelector(`[data-id="${todoId}"] .todo-checkbox`);
    const textElement = document.querySelector(`[data-id="${todoId}"] .todo-text`);
    
    if (checkbox) {
      if (todoItem.completed) {
        checkbox.classList.add('checked');
        checkbox.textContent = '✓';
      } else {
        checkbox.classList.remove('checked');
        checkbox.textContent = '';
      }
    }
    
    if (textElement) {
      if (todoItem.completed) {
        textElement.classList.add('completed');
      } else {
        textElement.classList.remove('completed');
      }
    }
    
    // Update progress bar
    updateTodoProgress(noteId);
    saveNotes();
    generateAutoTitle(noteId);
  }
}

// Update other functions to trigger auto-title
function updateReminderMessage(noteId, message) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.reminderMessage = message;
  saveNotes();
  generateAutoTitle(noteId);
}

function updateLocationName(noteId, name) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.locationName = name;
  saveNotes();
  generateAutoTitle(noteId);
}

function updateLocationAddress(noteId, address) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.locationAddress = address;
  saveNotes();
  
  // Update button states
  const noteElement = document.getElementById(noteId);
  const mapsBtn = noteElement.querySelector('button[onclick*="openLocationMaps"]');
  const copyBtn = noteElement.querySelector('button[onclick*="copyLocationAddress"]');
  
  if (mapsBtn) {
    mapsBtn.disabled = !address;
  }
  if (copyBtn) {
    copyBtn.disabled = !address;
  }
  
  generateAutoTitle(noteId);
}

function updateTableCell(noteId, rowIndex, colIndex, value) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.tableData) return;
  
  // Ensure the row exists
  if (!note.tableData[rowIndex]) {
    note.tableData[rowIndex] = [];
  }
  
  // Update the cell value
  note.tableData[rowIndex][colIndex] = value;
  saveNotes();
  generateAutoTitle(noteId);
}

// Timer Note functions
const timers = {};

function setTimerPreset(noteId, type, minutes) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.timerType = type;
  note.timerDuration = minutes * 60;
  note.timerRemaining = minutes * 60;
  note.timerRunning = false;
  
  // Update display
  updateTimerDisplay(noteId);
  
  // Update preset buttons
  const noteElement = document.getElementById(noteId);
  noteElement.querySelectorAll('.timer-preset').forEach(btn => {
    btn.classList.remove('active');
  });
  noteElement.querySelector(`.timer-preset[onclick*="${type}"]`).classList.add('active');
  
  // Update custom input
  document.getElementById(`timer-input-${noteId}`).value = minutes;
  
  // Reset button text
  document.getElementById(`timer-btn-${noteId}`).textContent = 'Start';
  
  saveNotes();
}

function setCustomTimer(noteId, minutes) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const min = Math.max(1, Math.min(999, parseInt(minutes) || 1));
  note.timerType = 'custom';
  note.timerDuration = min * 60;
  note.timerRemaining = min * 60;
  note.timerRunning = false;
  
  // Update display
  updateTimerDisplay(noteId);
  
  // Update preset buttons
  const noteElement = document.getElementById(noteId);
  noteElement.querySelectorAll('.timer-preset').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Reset button text
  document.getElementById(`timer-btn-${noteId}`).textContent = 'Start';
  
  saveNotes();
}

function toggleTimer(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.timerRunning = !note.timerRunning;
  
  const button = document.getElementById(`timer-btn-${noteId}`);
  if (button) {
    button.textContent = note.timerRunning ? 'Pause' : 'Start';
  }
  
  if (note.timerRunning) {
    startTimer(noteId);
  } else {
    stopTimer(noteId);
  }
  
  // Update detached window if exists
  if (note.detached) {
    ipcRenderer.invoke('update-timer-window', noteId, {
      timerRunning: note.timerRunning,
      timerRemaining: note.timerRemaining
    });
  }
  
  saveNotes();
}

function startTimer(noteId) {
  if (timers[noteId]) return;
  
  timers[noteId] = setInterval(() => {
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.timerRunning) {
      stopTimer(noteId);
      return;
    }
    
    note.timerRemaining--;
    
    if (note.timerRemaining <= 0) {
      note.timerRemaining = 0;
      note.timerRunning = false;
      stopTimer(noteId);
      
      // Play notification sound and show alert
      playTimerSound();
      showTimerNotification(note);
      
      document.getElementById(`timer-btn-${noteId}`).textContent = 'Start';
    }
    
    updateTimerDisplay(noteId);
    updateTimerProgress(noteId);
    
    // Update detached window if exists
    if (note.detached) {
      ipcRenderer.invoke('update-timer-window', noteId, {
        timerRemaining: note.timerRemaining,
        timerRunning: note.timerRunning
      });
    }
    
    saveNotes();
  }, 1000);
}

function stopTimer(noteId) {
  if (timers[noteId]) {
    clearInterval(timers[noteId]);
    delete timers[noteId];
  }
}

function resetTimer(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.timerRemaining = note.timerDuration;
  note.timerRunning = false;
  
  stopTimer(noteId);
  updateTimerDisplay(noteId);
  updateTimerProgress(noteId);
  
  document.getElementById(`timer-btn-${noteId}`).textContent = 'Start';
  
  saveNotes();
}

function updateTimerDisplay(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const display = document.getElementById(`timer-display-${noteId}`);
  if (!display) return;
  
  const minutes = Math.floor(note.timerRemaining / 60);
  const seconds = note.timerRemaining % 60;
  display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerProgress(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const progressBar = document.getElementById(`timer-progress-${noteId}`);
  if (!progressBar) return;
  
  const progress = ((note.timerDuration - note.timerRemaining) / note.timerDuration) * 100;
  progressBar.style.width = `${progress}%`;
}

function playTimerSound() {
  // Create a simple beep sound
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}

function showTimerNotification(note) {
  let message = 'Timer completed!';
  
  switch (note.timerType) {
    case 'pomodoro':
      message = 'Pomodoro session completed! Time for a break.';
      break;
    case 'short-break':
      message = 'Short break over! Ready to focus again?';
      break;
    case 'long-break':
      message = 'Long break finished! Feeling refreshed?';
      break;
  }
  
  if (Notification.permission === 'granted') {
    const notification = new Notification('PhasePad Timer', {
      body: message,
      icon: '../media/LogoWhite.png',
      tag: `timer-${note.id}`
    });
    
    notification.onclick = () => {
      ipcRenderer.invoke('show-overlay-and-focus-note', note.id);
      notification.close();
    };
  }
}

// Auto-title for timer notes
function generateTimerAutoTitle(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || note.type !== 'timer') return;
  
  if (!note.title || !note.title.trim()) {
    let autoTitle = '';
    switch (note.timerType) {
      case 'pomodoro':
        autoTitle = 'Pomodoro Timer';
        break;
      case 'short-break':
        autoTitle = 'Short Break';
        break;
      case 'long-break':
        autoTitle = 'Long Break';
        break;
      case 'custom':
        autoTitle = `${Math.floor(note.timerDuration / 60)} min Timer`;
        break;
    }
    updateNoteTitleDisplay(noteId, autoTitle);
  }
}

// Function to manually detach a timer
function detachTimer(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.timerRunning) return;
  
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    const rect = noteElement.getBoundingClientRect();
    ipcRenderer.invoke('create-timer-window', {
      id: note.id,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      title: note.title || getTimerAutoTitle(note),
      timerType: note.timerType,
      timerDuration: note.timerDuration,
      timerRemaining: note.timerRemaining,
      timerRunning: note.timerRunning
    });
    note.detached = true;
    
    // Hide overlay after detaching
    setTimeout(() => {
      ipcRenderer.send('fade-out');
    }, 300);
    
    saveNotes();
  }
}

// Folder functionality
function updateFolderDropFeedback(event) {
  // Remove existing drag-over classes
  document.querySelectorAll('.folder-drop-zone.drag-over').forEach(zone => {
    zone.classList.remove('drag-over');
  });
  
  if (!isDragging || !activeNote) return;
  
  // Temporarily hide the dragged note to get element below it
  const draggedElement = document.getElementById(activeNote.id);
  const originalDisplay = draggedElement ? draggedElement.style.display : null;
  if (draggedElement) {
    draggedElement.style.display = 'none';
  }
  
  // Get element under cursor
  const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
  
  // Restore the dragged note's visibility
  if (draggedElement && originalDisplay !== null) {
    draggedElement.style.display = originalDisplay;
  }
  
  if (!elementBelow) return;
  
  // Find folder drop zone
  const folderDropZone = elementBelow.closest('.folder-drop-zone');
  if (folderDropZone) {
    const folderId = folderDropZone.getAttribute('data-folder-id');
    
    // Don't highlight if it's the same note or invalid drop target
    if (folderId && folderId !== activeNote.id) {
      const folder = notes.find(n => n.id === folderId);
      if (folder && folder.type === 'folder') {
        // Check for circular reference
        if (activeNote.type !== 'folder' || !isNoteInFolderHierarchy(folderId, activeNote.id)) {
          folderDropZone.classList.add('drag-over');
        }
      }
    }
  }
}

function checkFolderDropTarget(event, draggedNote) {
  if (!event || !draggedNote) return false;
  
  // Temporarily hide the dragged note to get element below it
  const draggedElement = document.getElementById(draggedNote.id);
  const originalDisplay = draggedElement ? draggedElement.style.display : null;
  if (draggedElement) {
    draggedElement.style.display = 'none';
  }
  
  // Get the element at the mouse position
  const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
  
  // Restore the dragged note's visibility
  if (draggedElement && originalDisplay !== null) {
    draggedElement.style.display = originalDisplay;
  }
  
  if (!elementBelow) return false;
  
  // Find if we're over a folder drop zone
  const folderDropZone = elementBelow.closest('.folder-drop-zone');
  if (!folderDropZone) return false;
  
  // Get the folder ID from the drop zone
  const folderId = folderDropZone.getAttribute('data-folder-id');
  if (!folderId || folderId === draggedNote.id) return false;
  
  const folder = notes.find(n => n.id === folderId);
  if (!folder || folder.type !== 'folder') return false;
  
  // Prevent circular references
  if (draggedNote.type === 'folder' && (draggedNote.id === folderId || isNoteInFolderHierarchy(folderId, draggedNote.id))) {
    return false;
  }
  
  // Add note to folder
  if (draggedFolderItem && sourceFolder) {
    // This is a folder item being moved between folders
    addNoteToFolder(draggedFolderItem, folderId);
  } else if (draggedNote) {
    // This is a regular note being added to a folder
    addNoteToFolder(draggedNote.id, folderId);
  }
  
  return true; // Note was dropped on a folder
}

function addNoteToFolder(noteId, folderId) {
  const note = notes.find(n => n.id === noteId);
  const folder = notes.find(n => n.id === folderId);
  
  if (!note || !folder || folder.type !== 'folder') return;
  
  // Remove note from current folder if it's already in one
  if (note.parentFolder) {
    const currentFolder = notes.find(n => n.id === note.parentFolder);
    if (currentFolder && currentFolder.folderItems) {
      currentFolder.folderItems = currentFolder.folderItems.filter(id => id !== noteId);
      updateFolderDisplay(note.parentFolder);
    }
  }
  
  // Add note to new folder
  if (!folder.folderItems) folder.folderItems = [];
  if (!folder.folderItems.includes(noteId)) {
    folder.folderItems.push(noteId);
  }
  
  // Set parent folder reference
  note.parentFolder = folderId;
  
  // Hide the note from main view
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.style.display = 'none';
  }
  
  // Update folder display
  updateFolderDisplay(folderId);
  
  saveNotes();
}

function isNoteInFolderHierarchy(checkFolderId, targetNoteId) {
  const checkFolder = notes.find(n => n.id === checkFolderId);
  if (!checkFolder || !checkFolder.folderItems) return false;
  
  return checkFolder.folderItems.some(itemId => {
    if (itemId === targetNoteId) return true;
    const item = notes.find(n => n.id === itemId);
    if (item && item.type === 'folder') {
      return isNoteInFolderHierarchy(itemId, targetNoteId);
    }
    return false;
  });
}

function updateFolderDisplay(folderId) {
  const folder = notes.find(n => n.id === folderId);
  if (!folder || folder.type !== 'folder') return;
  
  const folderItemsContainer = document.getElementById(`folder-items-${folderId}`);
  const folderCountSpan = document.querySelector(`#${folderId} .folder-count`);
  
  if (folderItemsContainer) {
    folderItemsContainer.innerHTML = (folder.folderItems || []).map(itemId => {
      const item = notes.find(n => n.id === itemId) || archivedNotes.find(n => n.id === itemId);
      if (!item) return '';
      const itemTypeIcon = `<img src="${getNoteTypeIcon(item.type)}" class="note-type-icon-img" alt="${escapeHtml(item.type)}">`;
      return `
        <div class="folder-item" 
             onclick="focusNoteFromFolder('${itemId}')" 
             title="${escapeHtml(item.title || 'Untitled')}"
             draggable="true"
             onmousedown="startFolderItemDrag(event, '${itemId}', '${folderId}')"
             ondragstart="handleFolderItemDragStart(event, '${itemId}', '${folderId}')"
             ondragend="handleFolderItemDragEnd(event)">
          <span class="folder-item-icon">${itemTypeIcon}</span>
          <span class="folder-item-title">${escapeHtml(item.title || 'Untitled')}</span>
          <button class="folder-item-remove" onclick="removeNoteFromFolder(event, '${folderId}', '${itemId}')" title="Remove from folder">×</button>
        </div>
      `;
    }).join('');
  }
  
  if (folderCountSpan) {
    folderCountSpan.textContent = `${(folder.folderItems || []).length} items`;
  }
}

function focusNoteFromFolder(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Mark note as opened from folder
  note.isOpenFromFolder = true;
  
  // Create the note element if it doesn't exist or was hidden
  let noteElement = document.getElementById(noteId);
  if (!noteElement) {
    // Re-create the note element
    renderNote(note);
    noteElement = document.getElementById(noteId);
  }
  
  if (noteElement) {
    // Make sure the note is visible
    noteElement.style.display = 'block';
    noteElement.style.visibility = 'visible';
    noteElement.style.opacity = '1';
    
    // Bring note to front
    const allNotes = document.querySelectorAll('.note');
    const maxZ = Math.max(...Array.from(allNotes).map(n => parseInt(n.style.zIndex || 1)));
    noteElement.style.zIndex = maxZ + 1;
    
    // Scroll to the note and highlight it
    noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add a temporary highlight effect
    noteElement.style.boxShadow = '0 0 20px rgba(74, 144, 226, 0.8)';
    setTimeout(() => {
      noteElement.style.boxShadow = '';
    }, 1000);
  }
}

function hideNoteFromFolder(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (note) {
    // Clear the opened from folder flag
    note.isOpenFromFolder = false;
  }
  
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.style.display = 'none';
  }
}

function removeNoteFromFolder(event, folderId, noteId) {
  event.stopPropagation();
  
  const folder = notes.find(n => n.id === folderId);
  const note = notes.find(n => n.id === noteId);
  
  if (!folder || !note) return;
  
  // Remove from folder
  if (folder.folderItems) {
    folder.folderItems = folder.folderItems.filter(id => id !== noteId);
  }
  
  // Clear parent reference
  note.parentFolder = null;
  
  // Show the note again in main view
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.style.display = 'block';
  }
  
  // Update folder display
  updateFolderDisplay(folderId);
  
  saveNotes();
}

// Code note functionality
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateCodeContent(noteId, content) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.codeContent = content;
  
  // Update preview
  const preview = document.getElementById(`code-preview-${noteId}`);
  const code = preview.querySelector('code');
  if (code) {
    code.textContent = content;
    // Trigger syntax highlighting if Prism.js is available
    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(code);
    }
  }
  
  saveNotes();
  generateAutoTitle(noteId);
}

function updateCodeLanguage(noteId, language) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.codeLanguage = language;
  
  // Update preview language
  const preview = document.getElementById(`code-preview-${noteId}`);
  const code = preview.querySelector('code');
  if (code) {
    code.className = `language-${language}`;
    // Trigger syntax highlighting if Prism.js is available
    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(code);
    }
  }
  
  saveNotes();
}

function copyCodeToClipboard(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.codeContent) return;
  
  navigator.clipboard.writeText(note.codeContent).then(() => {
    // Show visual feedback
    const btn = document.querySelector(`#${noteId} .code-copy-btn`);
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    }
  }).catch(err => {
    console.error('Failed to copy code:', err);
  });
}

// Share functionality  
function showShareOptions(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Create share modal
  const existingModal = document.querySelector('.share-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.className = 'share-modal';
  modal.innerHTML = `
    <div class="share-modal-content">
      <h3>Share Note</h3>
      <p><strong>${escapeHtml(note.title || 'Untitled Note')}</strong></p>
      <div class="share-options">
        <button class="share-btn" onclick="exportAsMarkdown('${noteId}')">
          Save as Markdown
        </button>
        <button class="share-btn" onclick="exportAsJSON('${noteId}')">
          Save as JSON
        </button>
        ${['image', 'paint', 'table'].includes(note.type) ? 
          `<button class="share-btn" onclick="exportAsPNG('${noteId}')">Export as PNG</button>` : ''}
        <button class="share-btn" onclick="copyToClipboard('${noteId}')">
          Copy to Clipboard
        </button>
        <div class="share-divider">Share Options</div>
        <button class="share-btn" onclick="createShareableFile('${noteId}')">
          🔗 Create Shareable File
        </button>
        <button class="share-btn" onclick="generateShareText('${noteId}')">
          📱 Generate Share Text
        </button>
      </div>
      <button class="share-close" onclick="closeShareModal()">Close</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeShareModal();
    }
  });
}

function closeShareModal() {
  const modal = document.querySelector('.share-modal');
  if (modal) {
    modal.remove();
  }
}

function exportAsMarkdown(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  let markdown = '';
  
  // Title
  if (note.title) {
    markdown += `# ${note.title}\n\n`;
  }
  
  // Tags
  if (note.tags && note.tags.length > 0) {
    markdown += `**Tags:** ${note.tags.join(', ')}\n\n`;
  }
  
  // Content based on note type
  switch (note.type) {
    case 'text':
      markdown += note.content || '';
      break;
    case 'code':
      markdown += `## Code (${note.codeLanguage})\n\n`;
      markdown += '```' + note.codeLanguage + '\n';
      markdown += note.codeContent || '';
      markdown += '\n```';
      break;
    case 'todo':
      markdown += '## Tasks\n\n';
      if (note.todoItems) {
        note.todoItems.forEach(item => {
          markdown += `- [${item.completed ? 'x' : ' '}] ${item.text}\n`;
        });
      }
      break;
    case 'web':
      if (note.webUrl) markdown += `**URL:** [${note.webTitle || note.webUrl}](${note.webUrl})\n\n`;
      if (note.webDescription) markdown += note.webDescription;
      break;
    case 'location':
      if (note.locationName) markdown += `**Location:** ${note.locationName}\n\n`;
      if (note.locationAddress) markdown += `**Address:** ${note.locationAddress}\n\n`;
      if (note.locationNotes) markdown += note.locationNotes;
      break;
    case 'reminder':
      if (note.reminderDateTime) {
        markdown += `**Reminder:** ${new Date(note.reminderDateTime).toLocaleString()}\n\n`;
      }
      if (note.reminderMessage) markdown += note.reminderMessage;
      break;
    case 'folder':
      markdown += '## Folder Contents\n\n';
      if (note.folderItems && note.folderItems.length > 0) {
        note.folderItems.forEach(itemId => {
          const item = notes.find(n => n.id === itemId) || archivedNotes.find(n => n.id === itemId);
          if (item) {
            markdown += `- ${item.title || 'Untitled'} (${item.type})\n`;
          }
        });
      }
      break;
    default:
      markdown += note.content || '';
  }
  
  // Save to file
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(note.title || 'note').replace(/[^a-zA-Z0-9]/g, '_')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  closeShareModal();
}

function exportAsJSON(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Create clean export object
  const exportData = {
    id: note.id,
    type: note.type,
    title: note.title,
    content: note.content,
    tags: note.tags,
    createdAt: new Date().toISOString(),
    ...getTypeSpecificData(note)
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(note.title || 'note').replace(/[^a-zA-Z0-9]/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  closeShareModal();
}

function getTypeSpecificData(note) {
  const data = {};
  
  switch (note.type) {
    case 'code':
      data.codeContent = note.codeContent;
      data.codeLanguage = note.codeLanguage;
      break;
    case 'todo':
      data.todoItems = note.todoItems;
      break;
    case 'web':
      data.webUrl = note.webUrl;
      data.webTitle = note.webTitle;
      data.webDescription = note.webDescription;
      break;
    case 'location':
      data.locationName = note.locationName;
      data.locationAddress = note.locationAddress;
      data.locationNotes = note.locationNotes;
      break;
    case 'reminder':
      data.reminderDateTime = note.reminderDateTime;
      data.reminderMessage = note.reminderMessage;
      break;
    case 'folder':
      data.folderItems = note.folderItems;
      break;
  }
  
  return data;
}

function showSettingsModal() {
  console.log('=== SHOW SETTINGS MODAL CALLED ===');
  // Create settings modal
  const existingModal = document.querySelector('.settings-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.innerHTML = `
    <div class="settings-modal-content">
      <h3>PhasePad Settings</h3>
      <div class="settings-section">
        <h4>General</h4>
        <div class="settings-options">
          <div class="settings-toggle-item">
            <label class="settings-toggle">
              <input type="checkbox" id="startup-toggle">
              <span class="settings-toggle-slider"></span>
            </label>
            <span class="settings-toggle-label">Start with Windows</span>
          </div>
          <div class="settings-toggle-item">
            <label class="settings-toggle">
              <input type="checkbox" id="confirm-delete-toggle">
              <span class="settings-toggle-slider"></span>
            </label>
            <span class="settings-toggle-label">Confirm before deleting notes</span>
          </div>
          <div class="settings-toggle-item">
            <label class="settings-toggle">
              <input type="checkbox" id="check-updates-toggle">
              <span class="settings-toggle-slider"></span>
            </label>
            <span class="settings-toggle-label">Check for updates automatically</span>
          </div>
        </div>
        <div class="settings-info">
          <small>Customize PhasePad behavior and notifications</small>
        </div>
      </div>
      <div class="settings-section">
        <h4>Appearance & Customization</h4>
        <div class="settings-options">
          <div class="settings-item">
            <label>Theme</label>
            <select id="theme-selector" class="settings-select">
              <option value="default">Default Blue</option>
              <option value="dark">Dark Mode</option>
              <option value="light">Light Mode</option>
              <option value="purple">Purple Dream</option>
              <option value="green">Forest Green</option>
              <option value="red">Ruby Red</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="settings-item">
            <label>Font</label>
            <select id="font-selector" class="settings-select">
              <option value="system">System Default</option>
            </select>
          </div>
        </div>
        <div class="settings-info">
          <small>Customize the appearance of PhasePad</small>
        </div>
      </div>
      <div class="settings-section">
        <h4>Hotkeys</h4>
        <div class="settings-options">
          <button class="settings-btn" onclick="showHotkeysConfig()">
            Configure Hotkeys
          </button>
        </div>
        <div class="settings-info">
          <small>Customize keyboard shortcuts for PhasePad</small>
        </div>
      </div>
      <div class="settings-section">
        <h4>Data Management</h4>
        <div class="settings-options">
          <button class="settings-btn" onclick="changeDataFolder()">
            Change Data Folder
          </button>
          <button class="settings-btn reset-btn" onclick="resetAllData()">
            Reset All Data
          </button>
        </div>
        <div class="settings-info">
          <small id="current-data-path">Current data folder: ${getCurrentDataPath()}</small>
        </div>
      </div>
      <div class="settings-section">
        <h4>Import & Export</h4>
        <div class="settings-options">
          <button class="settings-btn" onclick="importFromJSON()">
            📥 Import JSON Notes
          </button>
          <button class="settings-btn" onclick="exportAllAsJSON()">
            💾 Export All Notes (Backup)
          </button>
          <button class="settings-btn" onclick="importFromMarkdown()">
            Import Markdown Files
          </button>
        </div>
        <div class="settings-info">
          <small>Import notes from backup files or export all your notes for backup.</small>
        </div>
      </div>
      <div class="settings-section">
        <h4>About</h4>
        <div class="settings-info">
          <small>PhasePad - Desktop sticky notes application<br>
          Version 1.0.2</small>
        </div>
      </div>
      <button class="settings-close" onclick="closeSettingsModal()">Close</button>
    </div>
    <div class="settings-modal-backdrop" onclick="closeSettingsModal()"></div>
  `;
  
  document.body.appendChild(modal);
  console.log('=== MODAL APPENDED TO DOM ===');
  
  // Load and set startup toggle state
  loadStartupToggleState();
  
  // Add event listener for startup toggle
  const startupToggle = document.getElementById('startup-toggle');
  if (startupToggle) {
    startupToggle.addEventListener('change', handleStartupToggle);
  }
  
  // Set and handle confirm delete toggle
  const confirmDeleteToggle = document.getElementById('confirm-delete-toggle');
  if (confirmDeleteToggle) {
    confirmDeleteToggle.checked = appConfig.confirmDelete !== false;
    confirmDeleteToggle.addEventListener('change', (e) => {
      appConfig.confirmDelete = e.target.checked;
      saveConfig();
    });
  }
  
  // Set and handle check updates toggle
  const checkUpdatesToggle = document.getElementById('check-updates-toggle');
  if (checkUpdatesToggle) {
    checkUpdatesToggle.checked = appConfig.checkForUpdates !== false;
    checkUpdatesToggle.addEventListener('change', (e) => {
      appConfig.checkForUpdates = e.target.checked;
      saveConfig();
      if (e.target.checked) {
        checkForUpdates(); // Check immediately when enabled
      }
    });
  }
  
  // Initialize customization settings - delay to ensure DOM is ready
  setTimeout(async () => {
    console.log('=== STARTING CUSTOMIZATION INIT ===');
    try {
      await initializeCustomizationSettings();
      console.log('=== CUSTOMIZATION INIT COMPLETED ===');
    } catch (error) {
      console.error('=== ERROR IN CUSTOMIZATION INIT ===', error);
    }
  }, 100);
}

function closeSettingsModal() {
  const modal = document.querySelector('.settings-modal');
  if (modal) {
    modal.remove();
  }
}

// Startup management functions
async function loadStartupToggleState() {
  try {
    const isEnabled = await ipcRenderer.invoke('get-startup-status');
    const toggle = document.getElementById('startup-toggle');
    if (toggle) {
      toggle.checked = !!isEnabled;
    }
  } catch (error) {
    console.error('Error loading startup state:', error);
  }
}

async function handleStartupToggle(event) {
  try {
    const enabled = event.target.checked;
    const success = await ipcRenderer.invoke('set-startup-status', enabled);
    
    if (!success) {
      // Revert toggle if failed
      event.target.checked = !enabled;
      const { dialog, getCurrentWindow } = require('@electron/remote');
      dialog.showMessageBox(getCurrentWindow(), {
        type: 'error',
        message: 'Failed to update startup setting',
        detail: 'Unable to modify Windows startup settings. Please check permissions.'
      });
    }
  } catch (error) {
    console.error('Error setting startup status:', error);
    // Revert toggle if failed
    event.target.checked = !event.target.checked;
  }
}

function copyToClipboard(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  let text = '';
  
  if (note.title) {
    text += `${note.title}\n${'='.repeat(note.title.length)}\n\n`;
  }
  
  if (note.tags && note.tags.length > 0) {
    text += `Tags: ${note.tags.join(', ')}\n\n`;
  }
  
  switch (note.type) {
    case 'text':
      text += note.content || '';
      break;
    case 'code':
      text += `Code (${note.codeLanguage}):\n\n${note.codeContent || ''}`;
      break;
    case 'todo':
      text += 'Tasks:\n';
      if (note.todoItems) {
        note.todoItems.forEach(item => {
          text += `${item.completed ? '✓' : '□'} ${item.text}\n`;
        });
      }
      break;
    default:
      text += note.content || '';
  }
  
  navigator.clipboard.writeText(text).then(() => {
    // Show feedback
    const btn = document.querySelector('.export-modal button');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        closeShareModal();
      }, 1000);
    }
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
    alert('Failed to copy to clipboard');
  });
}

function exportAsPNG(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Handle different note types for PNG export
  switch (note.type) {
    case 'paint':
      exportPaintAsPNG(note);
      break;
    case 'image':
      exportImageAsPNG(note);
      break;
    case 'table':
      exportTableAsPNG(note);
      break;
    default:
      alert('PNG export is not available for this note type.');
  }
}

function exportPaintAsPNG(note) {
  if (!note.paintData) {
    alert('No drawing data found to export.');
    return;
  }
  
  try {
    // Create download link from paint data
    const link = document.createElement('a');
    link.download = `${(note.title || 'drawing').replace(/[^a-zA-Z0-9]/g, '_')}_drawing.png`;
    link.href = note.paintData;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeShareModal();
  } catch (error) {
    console.error('Error exporting paint as PNG:', error);
    alert('Failed to export drawing as PNG.');
  }
}

function exportImageAsPNG(note) {
  if (!note.imagePath) {
    alert('No image data found to export.');
    return;
  }
  
  try {
    // Create download link from image data
    const link = document.createElement('a');
    link.download = `${(note.title || 'image').replace(/[^a-zA-Z0-9]/g, '_')}_image.png`;
    link.href = note.imagePath;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeShareModal();
  } catch (error) {
    console.error('Error exporting image as PNG:', error);
    alert('Failed to export image as PNG.');
  }
}

function exportTableAsPNG(note) {
  const noteElement = document.getElementById(note.id);
  if (!noteElement) {
    alert('Note element not found.');
    return;
  }
  
  // Create a canvas to render the table
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Set canvas size
  const rect = noteElement.getBoundingClientRect();
  canvas.width = rect.width * 2; // Higher resolution
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  
  // Fill white background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, rect.width, rect.height);
  
  // Draw note content (simplified version)
  ctx.fillStyle = '#333';
  ctx.font = '14px Arial';
  
  let y = 30;
  if (note.title) {
    ctx.font = 'bold 16px Arial';
    ctx.fillText(note.title, 10, y);
    y += 30;
  }
  
  ctx.font = '14px Arial';
  if (note.tableData && note.tableData.length > 0) {
    note.tableData.forEach((row, i) => {
      const rowText = row.join(' | ');
      ctx.fillText(`${i + 1}. ${rowText}`, 10, y);
      y += 20;
    });
  }
  
  // Download the canvas as PNG
  try {
    const link = document.createElement('a');
    link.download = `${(note.title || 'table').replace(/[^a-zA-Z0-9]/g, '_')}_table.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeShareModal();
  } catch (error) {
    console.error('Error exporting table as PNG:', error);
    alert('Failed to export table as PNG.');
  }
}

// Sharing functionality
function createShareableFile(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Create a standalone HTML file with the note
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${note.title || 'PhasePad Note'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f8f9fa;
        }
        .note-container {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .note-title {
            font-size: 28px;
            font-weight: 600;
            margin: 0 0 20px 0;
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        .note-meta {
            color: #7f8c8d;
            font-size: 14px;
            margin-bottom: 20px;
        }
        .note-tags {
            margin-bottom: 20px;
        }
        .tag {
            background: #3498db;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-right: 8px;
        }
        .note-content {
            white-space: pre-wrap;
            line-height: 1.7;
            color: #2c3e50;
        }
        .code-content {
            background: #f1f2f6;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #3498db;
            font-family: 'Courier New', monospace;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #95a5a6;
            font-size: 12px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="note-container">
        ${note.title ? `<h1 class="note-title">${note.title}</h1>` : ''}
        <div class="note-meta">
            Created: ${note.createdAt ? new Date(note.createdAt).toLocaleString() : 'Unknown'}
            ${note.tags && note.tags.length > 0 ? ` • ${note.tags.length} tag${note.tags.length > 1 ? 's' : ''}` : ''}
        </div>
        ${note.tags && note.tags.length > 0 ? `
            <div class="note-tags">
                ${note.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
        ` : ''}
        <div class="note-content ${note.type === 'code' ? 'code-content' : ''}">
            ${getFormattedContent(note)}
        </div>
        <div class="footer">
            Shared from PhasePad • <a href="#" onclick="alert('PhasePad is a desktop notes app')">Get PhasePad</a>
        </div>
    </div>
</body>
</html>`;
  
  // Create and download the file
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(note.title || 'note').replace(/[^a-zA-Z0-9]/g, '_')}_shareable.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  alert('Shareable HTML file created! You can send this file to anyone and they can open it in any web browser.');
  closeShareModal();
}

function generateShareText(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Generate shareable text format
  let shareText = '';
  
  if (note.title) {
    shareText += `${note.title}\n${'='.repeat(note.title.length)}\n\n`;
  }
  
  shareText += getPlainTextContent(note);
  
  if (note.tags && note.tags.length > 0) {
    shareText += `\n\nTags: ${note.tags.join(', ')}`;
  }
  
  shareText += `\n\n---\nCreated: ${note.createdAt ? new Date(note.createdAt).toLocaleString() : 'Unknown'}`;
  shareText += `\nShared from PhasePad`;
  
  // Copy to clipboard
  navigator.clipboard.writeText(shareText).then(() => {
    alert('Share text copied to clipboard! You can now paste this in messaging apps, social media, or anywhere you want to share your note.');
    closeShareModal();
  }).catch(err => {
    console.error('Failed to copy share text:', err);
    // Fallback: create a text file
    const blob = new Blob([shareText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(note.title || 'note').replace(/[^a-zA-Z0-9]/g, '_')}_share.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('Share text saved as file! You can copy the contents to share.');
    closeShareModal();
  });
}

function getFormattedContent(note) {
  switch (note.type) {
    case 'text':
      return (note.content || '').replace(/\n/g, '<br>');
    case 'code':
      return `<strong>Language:</strong> ${note.codeLanguage || 'Plain text'}<br><br>${(note.codeContent || '').replace(/\n/g, '<br>')}`;
    case 'todo':
      if (note.todoItems) {
        return note.todoItems.map(item => 
          `${item.completed ? '[X]' : '[ ]'} ${item.text}`
        ).join('<br>');
      }
      return 'No tasks';
    case 'web':
      return `<strong>URL:</strong> <a href="${note.url}" target="_blank">${note.url}</a><br><br>${(note.content || '').replace(/\n/g, '<br>')}`;
    case 'location':
      let locContent = '';
      if (note.locationName) locContent += `<strong>Location:</strong> ${note.locationName}<br>`;
      if (note.locationAddress) locContent += `<strong>Address:</strong> ${note.locationAddress}<br>`;
      if (note.content) locContent += `<br>${note.content.replace(/\n/g, '<br>')}`;
      return locContent;
    case 'reminder':
      let remContent = (note.content || '').replace(/\n/g, '<br>');
      if (note.reminderDate) {
        remContent += `<br><br><strong>Reminder:</strong> ${new Date(note.reminderDate).toLocaleString()}`;
      }
      return remContent;
    default:
      return (note.content || '').replace(/\n/g, '<br>');
  }
}

function getPlainTextContent(note) {
  switch (note.type) {
    case 'text':
      return note.content || '';
    case 'code':
      return `Code (${note.codeLanguage || 'Plain text'}):\n\n${note.codeContent || ''}`;
    case 'todo':
      if (note.todoItems) {
        return note.todoItems.map(item => 
          `${item.completed ? '[x]' : '[ ]'} ${item.text}`
        ).join('\n');
      }
      return 'No tasks';
    case 'web':
      return `Website: ${note.url || ''}\n\n${note.content || ''}`;
    case 'location':
      let locContent = '';
      if (note.locationName) locContent += `Location: ${note.locationName}\n`;
      if (note.locationAddress) locContent += `Address: ${note.locationAddress}\n`;
      if (note.content) locContent += `\n${note.content}`;
      return locContent;
    case 'reminder':
      let remContent = note.content || '';
      if (note.reminderDate) {
        remContent += `\n\nReminder: ${new Date(note.reminderDate).toLocaleString()}`;
      }
      return remContent;
    default:
      return note.content || '';
  }
}

// Import functionality
function showImportOptions() {
  // Create import modal
  const existingModal = document.querySelector('.import-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.className = 'import-modal';
  modal.innerHTML = `
    <div class="import-modal-content">
      <h3>Import Notes</h3>
      <p>Import notes from backup files</p>
      <div class="import-options">
        <button class="import-btn" onclick="importFromJSON()">
          Import JSON Notes
        </button>
        <button class="import-btn" onclick="exportAllAsJSON()">
          💾 Export All Notes (Backup)
        </button>
        <button class="import-btn" onclick="importFromMarkdown()">
          Import Markdown Files
        </button>
      </div>
      <div class="import-info">
        <small>Importing will add notes to your existing collection. Duplicate IDs will be skipped.</small>
      </div>
      <button class="import-close" onclick="closeImportModal()">Close</button>
    </div>
    <div class="import-modal-backdrop" onclick="closeImportModal()"></div>
  `;
  
  document.body.appendChild(modal);
}

function closeImportModal() {
  const modal = document.querySelector('.import-modal');
  if (modal) {
    modal.remove();
  }
}

function importFromJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.multiple = true;
  
  input.onchange = (e) => {
    const files = Array.from(e.target.files);
    let importedCount = 0;
    let skippedCount = 0;
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const noteData = JSON.parse(e.target.result);
          
          // Check if it's a backup file or single/multiple notes
          let notesToImport = [];
          if (noteData.notes && Array.isArray(noteData.notes)) {
            // It's a full backup file
            notesToImport = noteData.notes;
            if (noteData.archivedNotes && noteData.archivedNotes.length > 0) {
              // Also import archived notes
              archivedNotes.push(...noteData.archivedNotes.filter(n => !archivedNotes.find(existing => existing.id === n.id)));
            }
          } else if (Array.isArray(noteData)) {
            // It's an array of notes
            notesToImport = noteData;
          } else {
            // It's a single note
            notesToImport = [noteData];
          }
          
          notesToImport.forEach(note => {
            // Check if note already exists
            const existingNote = notes.find(n => n.id === note.id);
            if (existingNote) {
              skippedCount++;
              return;
            }
            
            // Validate and add note
            if (note.id && note.type) {
              // Generate new ID if needed to avoid conflicts
              note.id = note.id || generateId();
              note.x = note.x || Math.random() * 400;
              note.y = note.y || Math.random() * 400;
              note.width = note.width || 200;
              note.height = note.height || 150;
              note.color = note.color || noteColors[0];
              note.createdAt = note.createdAt || new Date().toISOString();
              
              notes.unshift(note);
              importedCount++;
            }
          });
          
          // Update display and save
          saveNotes();
          
          // Render newly imported notes
          notesToImport.forEach(note => {
            renderNote(note);
          });
          
          // Show result
          alert(`Import complete!\nImported: ${importedCount} notes\nSkipped: ${skippedCount} duplicates`);
          closeImportModal();
          
        } catch (error) {
          console.error('Error importing JSON:', error);
          alert(`Error importing file: ${error.message}\n\nPlease check that it's a valid JSON backup file exported from PhasePad.`);
        }
      };
      reader.readAsText(file);
    });
  };
  
  input.click();
}

function exportAllAsJSON() {
  const exportData = {
    notes: notes,
    archivedNotes: archivedNotes,
    exportedAt: new Date().toISOString(),
    version: '1.0'
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `phasepad_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // Show feedback
  alert('Backup created! This file contains all your notes and can be imported later.');
  closeImportModal();
}

function importFromMarkdown() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt';
  input.multiple = true;
  
  input.onchange = (e) => {
    const files = Array.from(e.target.files);
    let importedCount = 0;
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        const fileName = file.name.replace(/\.(md|markdown|txt)$/, '');
        
        // Create a new text note from the markdown content
        const newNote = {
          id: generateId(),
          type: 'text',
          title: fileName,
          content: content,
          x: Math.random() * 400,
          y: Math.random() * 400,
          width: 250,
          height: 200,
          color: noteColors[0],
          tags: [],
          createdAt: new Date().toISOString()
        };
        
        notes.unshift(newNote);
        importedCount++;
        
        // Update display and save
        saveNotes();
        
        // Render newly imported note
        renderNote(newNote);
      };
      reader.readAsText(file);
    });
    
    // Show result after a short delay to ensure all files are processed
    setTimeout(() => {
      alert(`Imported ${importedCount} markdown files as text notes.`);
      closeImportModal();
    }, 500);
  };
  
  input.click();
}

// Folder item drag functionality
let draggedFolderItem = null;
let sourceFolder = null;

function startFolderItemDrag(event, itemId, folderId) {
  // Prevent the click event from firing
  event.stopPropagation();
  draggedFolderItem = itemId;
  sourceFolder = folderId;
}

function handleFolderItemDragStart(event, itemId, folderId) {
  event.stopPropagation();
  draggedFolderItem = itemId;
  sourceFolder = folderId;
  event.dataTransfer.setData("text/plain", itemId);
  event.dataTransfer.effectAllowed = "move";
  event.target.style.opacity = "0.5";
}

function handleFolderItemDragEnd(event) {
  event.target.style.opacity = "1";
  
  // Check if dragged outside any folder (remove from folder)
  setTimeout(() => {
    const rect = event.target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Check if dropped outside all folder drop zones
    const elementBelow = document.elementFromPoint(centerX, centerY);
    const droppedOnFolder = elementBelow && elementBelow.closest('.folder-drop-zone');
    
    if (!droppedOnFolder && draggedFolderItem && sourceFolder) {
      // Remove from source folder and show on main canvas
      removeNoteFromFolder(null, sourceFolder, draggedFolderItem);
    }
    
    draggedFolderItem = null;
    sourceFolder = null;
  }, 100);
}

// Search functionality
let currentSearchQuery = '';
let searchFilters = {
  archived: false,
  content: true,
  titles: true,
  tags: true
};

function setupSearchFunctionality() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const searchOptions = document.getElementById('search-options');
  const searchDropdown = document.getElementById('search-dropdown');
  const searchResults = document.getElementById('search-results');
  
  if (!searchInput) {
    console.error('Search input not found');
    return;
  }
  
  // Search input handling
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    currentSearchQuery = query;
    
    if (query.trim()) {
      searchClear.style.display = 'flex';
      performSearch(query);
    } else {
      searchClear.style.display = 'none';
      hideSearchResults();
      clearNoteHighlights();
    }
  });
  
  // Clear search
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    currentSearchQuery = '';
    hideSearchResults();
    clearNoteHighlights();
    searchInput.focus();
  });
  
  // Search options toggle
  searchOptions.addEventListener('click', (e) => {
    e.stopPropagation();
    searchDropdown.classList.toggle('active');
  });
  
  // Search filter changes
  document.getElementById('search-archived').addEventListener('change', (e) => {
    searchFilters.archived = e.target.checked;
    if (currentSearchQuery.trim()) {
      performSearch(currentSearchQuery);
    }
  });
  
  document.getElementById('search-content').addEventListener('change', (e) => {
    searchFilters.content = e.target.checked;
    if (currentSearchQuery.trim()) {
      performSearch(currentSearchQuery);
    }
  });
  
  document.getElementById('search-titles').addEventListener('change', (e) => {
    searchFilters.titles = e.target.checked;
    if (currentSearchQuery.trim()) {
      performSearch(currentSearchQuery);
    }
  });
  
  document.getElementById('search-tags').addEventListener('change', (e) => {
    searchFilters.tags = e.target.checked;
    if (currentSearchQuery.trim()) {
      performSearch(currentSearchQuery);
    }
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchDropdown.classList.remove('active');
      if (!currentSearchQuery.trim()) {
        hideSearchResults();
      }
    }
  });
}

function performSearch(query) {
  const results = [];
  const queryLower = query.toLowerCase();
  
  // Search active notes
  notes.forEach(note => {
    const match = searchNote(note, queryLower, false);
    if (match) {
      results.push(match);
    }
  });
  
  // Search archived notes if enabled
  if (searchFilters.archived) {
    archivedNotes.forEach(note => {
      const match = searchNote(note, queryLower, true);
      if (match) {
        results.push(match);
      }
    });
  }
  
  // Search saved documents
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    
    if (fs.existsSync(savedDocsPath)) {
      const savedDocsData = fs.readFileSync(savedDocsPath, 'utf-8');
      const savedDocs = JSON.parse(savedDocsData);
      
      savedDocs.forEach(doc => {
        // Convert document to note-like structure for searching
        const docAsNote = {
          id: `doc-${doc.id}`,
          type: 'document',
          title: doc.title || 'Untitled Document',
          content: doc.content || '',
          tags: doc.tags || [],
          isDocument: true,
          documentPath: doc.path
        };
        
        const match = searchNote(docAsNote, queryLower, false);
        if (match) {
          match.isDocument = true;
          results.push(match);
        }
      });
    }
  } catch (error) {
    console.error('Error searching saved documents:', error);
  }
  
  displaySearchResults(results, query);
  highlightNotesInView(results.filter(r => !r.archived && !r.isDocument));
}

function searchNote(note, queryLower, isArchived) {
  let titleMatch = false;
  let contentMatch = false;
  let tagsMatch = false;
  let matchedContent = '';
  
  // Search title
  if (searchFilters.titles && note.title && note.title.toLowerCase().includes(queryLower)) {
    titleMatch = true;
  }
  
  // Search tags
  if (searchFilters.tags && note.tags && note.tags.length > 0) {
    const tagString = note.tags.join(' ').toLowerCase();
    if (tagString.includes(queryLower)) {
      tagsMatch = true;
    }
  }
  
  // Search content based on note type
  if (searchFilters.content) {
    let searchableContent = '';
    
    switch (note.type) {
      case 'text':
        searchableContent = note.content || '';
        break;
      case 'web':
        searchableContent = `${note.webUrl || ''} ${note.webTitle || ''} ${note.webDescription || ''}`;
        break;
      case 'location':
        searchableContent = `${note.locationName || ''} ${note.locationAddress || ''} ${note.locationNotes || ''}`;
        break;
      case 'reminder':
        searchableContent = note.reminderMessage || '';
        break;
      case 'todo':
        searchableContent = note.todoItems ? note.todoItems.map(item => item.text).join(' ') : '';
        break;
      case 'table':
        searchableContent = note.tableData ? note.tableData.flat().join(' ') : '';
        break;
      case 'file':
        searchableContent = note.filePath || '';
        break;
      case 'code':
        searchableContent = note.codeContent || '';
        break;
      case 'folder':
        // Search folder item titles
        if (note.folderItems && note.folderItems.length > 0) {
          const folderItemTitles = note.folderItems.map(itemId => {
            const item = notes.find(n => n.id === itemId) || archivedNotes.find(n => n.id === itemId);
            return item ? (item.title || '') : '';
          }).filter(title => title.length > 0);
          searchableContent = folderItemTitles.join(' ');
        }
        break;
      case 'document':
        searchableContent = note.content || '';
        break;
    }
    
    if (searchableContent.toLowerCase().includes(queryLower)) {
      contentMatch = true;
      // Extract context around the match
      const index = searchableContent.toLowerCase().indexOf(queryLower);
      const start = Math.max(0, index - 30);
      const end = Math.min(searchableContent.length, index + queryLower.length + 30);
      matchedContent = searchableContent.substring(start, end);
    }
  }
  
  if (titleMatch || contentMatch || tagsMatch) {
    return {
      note,
      titleMatch,
      contentMatch,
      tagsMatch,
      matchedContent,
      archived: isArchived
    };
  }
  
  return null;
}

function displaySearchResults(results, query) {
  const searchResults = document.getElementById('search-results');
  
  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-result"><div class="search-result-content">No results found</div></div>';
  } else {
    searchResults.innerHTML = results.map(result => {
      const { note, titleMatch, contentMatch, tagsMatch, matchedContent, archived, isDocument } = result;
      const noteTypeInfo = getNoteTypeInfo(note.type);
      
      const clickHandler = isDocument ? `openSavedDocumentFromSearch('${note.id}', '${note.documentPath || ''}')` : `focusSearchResult('${note.id}', ${archived})`;
      
      return `
        <div class="search-result" onclick="${clickHandler}">
          <div class="search-result-title">
            <span>${noteTypeInfo.icon}</span>
            <span>${highlightText(note.title || 'Untitled', query)}</span>
            <span class="search-result-type">${noteTypeInfo.name}</span>
            ${archived ? '<span class="search-result-archived">Archived</span>' : ''}
            ${isDocument ? '<span class="search-result-document">Saved Document</span>' : ''}
          </div>
          ${tagsMatch && note.tags && note.tags.length > 0 ? `<div class="search-result-tags">${note.tags.map(tag => `<span class="search-result-tag">${highlightText(tag, query)}</span>`).join('')}</div>` : ''}
          ${contentMatch ? `<div class="search-result-content">${highlightText(matchedContent, query)}</div>` : ''}
        </div>
      `;
    }).join('');
  }
  
  searchResults.classList.add('active');
}

function highlightText(text, query) {
  if (!text) return '';
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<span class="search-highlight">$1</span>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNoteTypeInfo(type) {
  const types = {
    text: { icon: 'T', name: 'Text' },
    file: { icon: 'F', name: 'File' },
    image: { icon: 'I', name: 'Image' },
    paint: { icon: 'P', name: 'Paint' },
    todo: { icon: 'C', name: 'Todo' },
    reminder: { icon: 'R', name: 'Reminder' },
    web: { icon: 'W', name: 'Web' },
    table: { icon: 'T', name: 'Table' },
    location: { icon: 'L', name: 'Location' },
    calculator: { icon: '=', name: 'Calculator' },
    timer: { icon: 'T', name: 'Timer' },
    folder: { icon: 'D', name: 'Folder' },
    code: { icon: '<>', name: 'Code' },
    document: { icon: 'D', name: 'Document' }
  };
  return types[type] || { icon: 'N', name: 'Note' };
}

function openSavedDocumentFromSearch(docId, documentPath) {
  hideSearchResults();
  
  // Clear search
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  currentSearchQuery = '';
  
  // Extract the actual document ID (remove 'doc-' prefix)
  const actualDocId = docId.replace('doc-', '');
  
  // Open the saved document
  openSavedDocument(actualDocId, documentPath);
}

function focusSearchResult(noteId, isArchived) {
  if (isArchived) {
    // Restore archived note first
    restoreNote(noteId);
    hideSearchResults();
    // Focus on the restored note after a brief delay
    setTimeout(() => {
      focusOnNote(noteId);
    }, 300);
  } else {
    focusOnNote(noteId);
    hideSearchResults();
  }
  
  // Clear search
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  currentSearchQuery = '';
  clearNoteHighlights();
}

function hideSearchResults() {
  document.getElementById('search-results').classList.remove('active');
}

function highlightNotesInView(results) {
  // Add visual highlight to matching notes in the overlay
  clearNoteHighlights();
  
  results.forEach(result => {
    const noteElement = document.getElementById(result.note.id);
    if (noteElement) {
      noteElement.style.outline = '2px solid #4a90e2';
      noteElement.style.boxShadow = '0 0 10px rgba(74, 144, 226, 0.5)';
    }
  });
}

function clearNoteHighlights() {
  notes.forEach(note => {
    const noteElement = document.getElementById(note.id);
    if (noteElement) {
      noteElement.style.outline = '';
      noteElement.style.boxShadow = '';
    }
  });
}

// Global functions for onclick handlers
window.deleteNote = deleteNote;
window.openFile = openFile;
window.selectFile = selectFile;
window.selectImage = selectImage;
window.showImageOptions = showImageOptions;
window.showScreenshotOptions = showScreenshotOptions;
window.captureScreenshot = captureScreenshot;
window.takeAreaScreenshot = takeAreaScreenshot;
window.clearCanvas = clearCanvas;
window.addTodo = addTodo;
window.deleteTodo = deleteTodo;
window.toggleTodo = toggleTodo;
window.updateTodoText = updateTodoText;
window.archiveNote = archiveNote;
window.restoreNote = restoreNote;
window.hideArchivePanel = hideArchivePanel;
window.updateReminderDateTime = updateReminderDateTime;
window.updateReminderMessage = updateReminderMessage;
window.resetReminder = resetReminder;
window.testReminder = testReminder;
window.updateWebUrl = updateWebUrl;
window.updateWebTitle = updateWebTitle;
window.updateWebDescription = updateWebDescription;
window.openWebUrl = openWebUrl;
window.copyWebUrl = copyWebUrl;
window.toggleWebPreview = toggleWebPreview;
window.updateTableCell = updateTableCell;
window.addTableRow = addTableRow;
window.addTableColumn = addTableColumn;
window.removeTableRow = removeTableRow;
window.removeTableColumn = removeTableColumn;
window.updateLocationName = updateLocationName;
window.updateLocationAddress = updateLocationAddress;
window.updateLocationNotes = updateLocationNotes;
window.openLocationMaps = openLocationMaps;
window.copyLocationAddress = copyLocationAddress;
window.calculatorInput = calculatorInput;
window.calculatorEquals = calculatorEquals;
window.calculatorClear = calculatorClear;
window.calculatorBackspace = calculatorBackspace;
window.setTimerPreset = setTimerPreset;
window.setCustomTimer = setCustomTimer;
window.toggleTimer = toggleTimer;
window.resetTimer = resetTimer;
window.detachTimer = detachTimer;

// Version comparison utility
function compareVersions(version1, version2) {
  // Remove 'v' prefix if present and normalize
  const v1 = version1.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  const v2 = version2.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  
  // Pad arrays to same length
  const maxLength = Math.max(v1.length, v2.length);
  while (v1.length < maxLength) v1.push(0);
  while (v2.length < maxLength) v2.push(0);
  
  // Compare each part
  for (let i = 0; i < maxLength; i++) {
    if (v1[i] < v2[i]) return -1;
    if (v1[i] > v2[i]) return 1;
  }
  return 0;
}

function isNewerVersion(currentVersion, latestVersion) {
  return compareVersions(currentVersion, latestVersion) < 0;
}

// Update checking functionality
async function checkForUpdates() {
  try {
    // First try using electron-updater through IPC
    const result = await ipcRenderer.invoke('check-for-updates');
    
    // Also check GitHub API for release notes
    const response = await fetch('https://api.github.com/repos/OwenModsTW/PhasePad/releases/latest');
    if (response.ok) {
      const latestRelease = await response.json();
      const currentVersion = 'v1.0.2'; // Update this with each release
      
      // Only show notification if the latest version is actually newer
      if (latestRelease.tag_name && isNewerVersion(currentVersion, latestRelease.tag_name)) {
        console.log(`Update available: ${currentVersion} -> ${latestRelease.tag_name}`);
        showUpdateNotification(latestRelease);
      } else {
        console.log(`No update needed. Current: ${currentVersion}, Latest: ${latestRelease.tag_name || 'unknown'}`);
      }
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  }
}

function showUpdateNotification(release) {
  // Remove any existing update notification
  const existingNotification = document.querySelector('.update-notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  // Create update notification
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.innerHTML = `
    <button class="update-notification-close" onclick="this.parentElement.remove()">×</button>
    <h3>🎉 Update Available!</h3>
    <p><strong>${release.tag_name}</strong> - ${release.name || 'New version available'}</p>
    <div class="update-actions">
      <button class="update-btn-primary" onclick="require('electron').shell.openExternal('${release.html_url}')">Download Update</button>
      <button class="update-btn-secondary" onclick="this.parentElement.parentElement.remove()">Remind Me Later</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Auto-hide after 15 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 15000);
}

window.checkForUpdates = checkForUpdates;
window.focusSearchResult = focusSearchResult;
window.openSavedDocumentFromSearch = openSavedDocumentFromSearch;
window.showUpdateNotification = showUpdateNotification; // For testing
window.compareVersions = compareVersions; // For testing
window.isNewerVersion = isNewerVersion; // For testing


// Custom delete confirmation modal
function showDeleteConfirmation(note) {
  return new Promise((resolve) => {
    // Remove any existing confirmation modal
    const existingModal = document.querySelector('.delete-confirmation-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'delete-confirmation-modal';
    modal.innerHTML = `
      <div class="delete-confirmation-backdrop" onclick="closeDeleteConfirmation(false)"></div>
      <div class="delete-confirmation-content">
        <div class="delete-confirmation-header">
          <h3>Delete Note?</h3>
        </div>
        <div class="delete-confirmation-body">
          <p>Are you sure you want to delete this <strong>${escapeHtml(note.type)}</strong> note?</p>
          ${note.title ? `<p class="delete-confirmation-title">"${escapeHtml(note.title)}"</p>` : ''}
          <p class="delete-confirmation-warning">This action cannot be undone.</p>
        </div>
        <div class="delete-confirmation-actions">
          <button class="delete-confirmation-btn cancel-btn" onclick="closeDeleteConfirmation(false)">Cancel</button>
          <button class="delete-confirmation-btn delete-btn" onclick="closeDeleteConfirmation(true)">Delete</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Store the resolve function globally so buttons can access it
    window._deleteConfirmationResolve = resolve;
    
    // Add keyboard event listener
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDeleteConfirmation(false);
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        closeDeleteConfirmation(true);
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    
    document.addEventListener('keydown', handleKeydown);
    
    // Focus the cancel button by default (safer)
    setTimeout(() => {
      const cancelBtn = modal.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.focus();
      }
    }, 100);
  });
}

function closeDeleteConfirmation(confirmed) {
  const modal = document.querySelector('.delete-confirmation-modal');
  if (modal) {
    modal.remove();
  }
  
  if (window._deleteConfirmationResolve) {
    window._deleteConfirmationResolve(confirmed);
    delete window._deleteConfirmationResolve;
  }
}

// Customization Functions
async function initializeCustomizationSettings() {
  console.log('=== INITIALIZING CUSTOMIZATION SETTINGS ===');
  // Load saved customization preferences
  loadCustomizationPreferences();
  
  // Initialize theme selector
  const themeSelector = document.getElementById('theme-selector');
  if (themeSelector) {
    themeSelector.value = appConfig.theme || 'default';
    themeSelector.addEventListener('change', (e) => {
      const selectedTheme = e.target.value;
      applyTheme(selectedTheme);
      appConfig.theme = selectedTheme;
      saveConfig();
      
      // If switching to default, force update the overlay color
      if (selectedTheme === 'default') {
        const savedColor = localStorage.getItem('overlay-color') || '#4a90e2';
        const opacitySlider = document.getElementById('opacity-slider');
        const opacity = opacitySlider ? opacitySlider.value / 100 : 0.7;
        
        const overlay = document.getElementById('overlay-container');
        const rgb = hexToRgb(savedColor);
        if (overlay && rgb) {
          overlay.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
        }
      }
    });
  }
  
  // Initialize font selector - populate with system fonts
  try {
    await initializeFontSelector();
  } catch (error) {
    console.error('Error initializing font selector:', error);
  }
  
}

function loadCustomizationPreferences() {
  // Apply saved theme (always call applyTheme to ensure proper initialization)
  const savedTheme = appConfig.theme || 'default';
  applyTheme(savedTheme);
  
  // Apply saved font
  if (appConfig.fontFamily) {
    applyFont(appConfig.fontFamily);
  }
}

function applyTheme(themeName) {
  const body = document.body;
  const modal = document.querySelector('.settings-modal-content');
  const overlay = document.getElementById('overlay-container');
  
  // Remove existing theme classes
  body.className = body.className.replace(/theme-\w+/g, '');
  
  // Always apply theme class for consistency
  if (themeName && themeName !== 'default') {
    body.classList.add(`theme-${themeName}`);
  } else {
    // Ensure default theme is explicitly handled - remove all theme classes
    body.classList.remove('theme-dark', 'theme-light', 'theme-purple', 'theme-green', 'theme-red');
    
    // Force reset to original default styles
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.style.removeProperty('background');
      toolbar.style.removeProperty('border-color');
      
      // Reset all toolbar elements to default
      const toolbarElements = toolbar.querySelectorAll('button, .workspace-btn, .tool-btn');
      toolbarElements.forEach(el => {
        el.style.removeProperty('color');
        el.style.removeProperty('background');
        el.style.removeProperty('border-color');
      });
      
      // Reset search bar
      const searchBar = document.getElementById('search-bar');
      const searchInput = document.getElementById('search-input');
      if (searchBar) {
        searchBar.style.removeProperty('background');
        searchBar.style.removeProperty('border-color');
      }
      if (searchInput) {
        searchInput.style.removeProperty('color');
      }
    }
  }
  
  // Apply theme colors to overlay background
  if (overlay) {
    const opacitySlider = document.getElementById('opacity-slider');
    const opacity = opacitySlider ? opacitySlider.value / 100 : 0.7;
    
    switch(themeName) {
      case 'dark':
        overlay.style.backgroundColor = `rgba(30, 30, 30, ${opacity})`;
        break;
      case 'light':
        overlay.style.backgroundColor = `rgba(240, 240, 240, ${opacity})`;
        break;
      case 'purple':
        overlay.style.backgroundColor = `rgba(64, 42, 122, ${opacity})`;
        break;
      case 'green':
        overlay.style.backgroundColor = `rgba(45, 89, 64, ${opacity})`;
        break;
      case 'red':
        overlay.style.backgroundColor = `rgba(102, 26, 26, ${opacity})`;
        break;
      default:
        // Always use default blue for default theme - ignore saved color during theme application
        overlay.style.setProperty('background-color', `rgba(74, 144, 226, ${opacity})`, 'important');
        
        // Reset the saved color to default blue when switching to default theme
        localStorage.setItem('overlay-color', '#4a90e2');
        
        // Update the color picker to show default blue
        const colorPicker = document.getElementById('overlay-color-picker');
        if (colorPicker) {
          colorPicker.style.backgroundColor = '#4a90e2';
        }
    }
  }
  
  // Apply theme colors to settings modal if open
  if (modal) {
    switch(themeName) {
      case 'dark':
        modal.style.background = '#2d2d30';
        modal.style.color = '#ffffff';
        break;
      case 'light':
        modal.style.background = '#ffffff';
        modal.style.color = '#1e1e1e';
        break;
      case 'purple':
        modal.style.background = '#402a7a';
        modal.style.color = '#ffffff';
        break;
      case 'green':
        modal.style.background = '#2d5940';
        modal.style.color = '#ffffff';
        break;
      case 'red':
        modal.style.background = '#661a1a';
        modal.style.color = '#ffffff';
        break;
      default:
        modal.style.background = 'white';
        modal.style.color = '#333';
    }
  }
}

async function initializeFontSelector() {
  console.log('=== INITIALIZING FONT SELECTOR ===');
  const fontSelector = document.getElementById('font-selector');
  if (!fontSelector) {
    console.error('Font selector element not found!');
    return;
  }
  
  console.log('Font selector found, getting system fonts...');
  // Get available system fonts
  const fonts = await getSystemFonts();
  console.log('Received fonts:', fonts);
  
  // Clear existing options except system default
  fontSelector.innerHTML = '<option value="system">System Default</option>';
  
  // Add font options
  fonts.forEach(font => {
    const option = document.createElement('option');
    option.value = font;
    option.textContent = font;
    fontSelector.appendChild(option);
  });
  
  console.log(`Added ${fonts.length} fonts to selector`);
  
  // Set saved font
  if (appConfig.fontFamily) {
    fontSelector.value = appConfig.fontFamily;
  }
  
  // Add change listener
  fontSelector.addEventListener('change', (e) => {
    applyFont(e.target.value);
    appConfig.fontFamily = e.target.value;
    saveConfig();
  });
}

async function getSystemFonts() {
  // Try to get system fonts via IPC
  console.log('=== CALLING GET-SYSTEM-FONTS IPC ===');
  try {
    const fonts = await ipcRenderer.invoke('get-system-fonts');
    console.log('IPC returned fonts:', fonts);
    return fonts || getDefaultFonts();
  } catch (error) {
    console.error('Error getting system fonts:', error);
    return getDefaultFonts();
  }
}

function getDefaultFonts() {
  // Return common web-safe fonts as fallback
  return [
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Georgia',
    'Courier New',
    'Verdana',
    'Comic Sans MS',
    'Impact',
    'Lucida Console',
    'Tahoma',
    'Trebuchet MS',
    'Palatino',
    'Garamond',
    'Bookman',
    'Avant Garde'
  ];
}

function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Parse the hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return { r, g, b };
}

function applyFont(fontName) {
  if (fontName === 'system') {
    document.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  } else {
    document.body.style.fontFamily = `"${fontName}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  }
  
  // Apply to all notes
  document.querySelectorAll('.sticky-note').forEach(note => {
    note.style.fontFamily = document.body.style.fontFamily;
  });
}


window.closeDeleteConfirmation = closeDeleteConfirmation;

// Document functionality
function updateDocumentTitle(noteId, title) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note.documentTitle = title;
  note.title = title || 'Untitled Document'; // Also update the note title
  note.documentSaved = false; // Mark as unsaved
  updateDocumentTitle_UI(noteId);
  saveNotes();
  generateAutoTitle(noteId);
}

function updateDocumentTags(noteId, tagsString) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Parse tags from comma-separated string
  const tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  note.tags = tags;
  note.documentSaved = false; // Mark as unsaved
  saveNotes();
}

function updateDocumentContent(noteId) {
  const note = notes.find(n => n.id === noteId);
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!note || !editor) return;
  
  note.documentContent = editor.innerHTML;
  note.content = editor.textContent || editor.innerText || ''; // For search functionality
  note.documentSaved = false; // Mark as unsaved
  updateDocumentTitle_UI(noteId);
  saveNotes();
  
  console.log('Document content updated:', note.content.substring(0, 50)); // Debug
}

function updateDocumentTitle_UI(noteId) {
  const note = notes.find(n => n.id === noteId);
  const titleInput = document.querySelector(`#${noteId} .document-title-input`);
  if (note && titleInput) {
    const title = note.documentTitle || 'Untitled Document';
    const displayTitle = note.documentSaved ? title : title + ' *';
    if (titleInput.value !== displayTitle) {
      titleInput.value = displayTitle;
    }
  }
}

function applyDocumentFormat(noteId, command) {
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!editor) return;
  
  editor.focus();
  document.execCommand(command);
  updateDocumentContent(noteId);
  updateFormatButtonStates(noteId);
}

function applyDocumentFontFamily(noteId, fontFamily) {
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!editor) return;
  
  editor.focus();
  document.execCommand('fontName', false, fontFamily);
  updateDocumentContent(noteId);
}

function applyDocumentFontSize(noteId, fontSize) {
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!editor) return;
  
  editor.focus();
  
  // Use a more reliable method for font size
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = fontSize + 'pt';
    
    try {
      if (range.collapsed) {
        // If cursor position, set up for next typing
        range.insertNode(span);
        range.selectNodeContents(span);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // If text selected, wrap it
        range.surroundContents(span);
      }
    } catch (e) {
      // Fallback method
      document.execCommand('fontSize', false, '3');
      const fontElements = editor.querySelectorAll('font[size="3"]');
      fontElements.forEach(el => {
        el.style.fontSize = fontSize + 'pt';
        el.removeAttribute('size');
      });
    }
  }
  
  updateDocumentContent(noteId);
}

function toggleColorPicker(noteId, type) {
  const dropdown = document.getElementById(`${type}-color-${noteId}`);
  if (!dropdown) return;
  
  // Close all other color pickers
  document.querySelectorAll('.color-picker-dropdown').forEach(picker => {
    if (picker.id !== `${type}-color-${noteId}`) {
      picker.classList.remove('active');
    }
  });
  
  dropdown.classList.toggle('active');
  
  // Add click handlers to color options if not already added
  if (!dropdown.hasAttribute('data-handlers-added')) {
    dropdown.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', () => {
        const color = option.dataset.color;
        applyDocumentColor(noteId, type, color);
        dropdown.classList.remove('active');
      });
    });
    dropdown.setAttribute('data-handlers-added', 'true');
  }
}

function applyDocumentColor(noteId, type, color) {
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!editor) return;
  
  editor.focus();
  
  if (type === 'text') {
    document.execCommand('foreColor', false, color);
    // Update color indicator
    const indicator = document.querySelector(`#${noteId} .color-btn .color-indicator`);
    if (indicator) {
      indicator.style.background = color;
    }
  } else if (type === 'highlight') {
    if (color === 'transparent') {
      document.execCommand('removeFormat');
    } else {
      document.execCommand('hiliteColor', false, color);
    }
    // Update highlight indicator  
    const indicator = document.querySelector(`#${noteId} .color-btn:nth-of-type(2) .color-indicator`);
    if (indicator) {
      indicator.style.background = color;
    }
  }
  
  updateDocumentContent(noteId);
}

function updateFormatButtonStates(noteId) {
  // Update button states based on current selection
  const editor = document.getElementById(`document-editor-${noteId}`);
  if (!editor) return;
  
  // Check if editor has focus
  if (document.activeElement !== editor) {
    return;
  }
  
  // Find format buttons within this specific note
  const noteElement = document.getElementById(noteId);
  if (!noteElement) return;
  
  const formatControls = noteElement.querySelector('.document-format-controls');
  if (!formatControls) return;
  
  // Update specific format buttons
  const boldBtn = formatControls.querySelector('button[onclick*="bold"]');
  const italicBtn = formatControls.querySelector('button[onclick*="italic"]');
  const underlineBtn = formatControls.querySelector('button[onclick*="underline"]');
  const strikeBtn = formatControls.querySelector('button[onclick*="strikeThrough"]');
  
  if (boldBtn) {
    boldBtn.classList.toggle('active', document.queryCommandState('bold'));
  }
  if (italicBtn) {
    italicBtn.classList.toggle('active', document.queryCommandState('italic'));
  }
  if (underlineBtn) {
    underlineBtn.classList.toggle('active', document.queryCommandState('underline'));
  }
  if (strikeBtn) {
    strikeBtn.classList.toggle('active', document.queryCommandState('strikeThrough'));
  }
  
  console.log('Updated format button states for', noteId); // Debug
}

async function saveDocument(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  console.log('Saving document:', noteId, 'Path:', note.documentPath); // Debug
  
  try {
    // If document doesn't have a path, show save dialog
    if (!note.documentPath) {
      console.log('No document path, showing save dialog'); // Debug
      const documentsDir = path.join(appConfig.dataPath, 'documents');
      let fileName = (note.documentTitle || 'document').replace(/[<>:"/\\|?*]/g, '_'); // Replace invalid characters
      let defaultPath = path.join(documentsDir, fileName + '.ppdoc');
      
      // Check for filename conflicts and add number if needed
      let counter = 1;
      while (fs.existsSync(defaultPath)) {
        defaultPath = path.join(documentsDir, `${fileName} (${counter}).ppdoc`);
        counter++;
      }
      
      const result = await ipcRenderer.invoke('save-file-dialog', {
        defaultPath: defaultPath,
        filters: [
          { name: 'PhasePad Documents', extensions: ['ppdoc'] },
          { name: 'HTML Files', extensions: ['html'] }
        ]
      });
      
      if (result.canceled) return;
      note.documentPath = result.filePath;
    }
    
    // Create document data
    const documentData = {
      id: note.originalDocumentId || note.id, // Use original document ID if available
      title: note.documentTitle,
      content: note.documentContent,
      tags: note.tags || [],
      createdAt: note.createdAt || new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      type: 'document',
      filePath: note.documentPath // Store the file path so we can delete it later
    };
    
    console.log('Saving document with tags:', note.tags);
    console.log('Document data:', documentData);
    
    const extension = path.extname(note.documentPath).toLowerCase();
    let saveData;
    
    if (extension === '.ppdoc') {
      saveData = JSON.stringify(documentData, null, 2);
    } else if (extension === '.html') {
      saveData = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${note.documentTitle || 'Document'}</title>
  <style>
    body { 
      font-family: "Times New Roman", serif; 
      font-size: 12pt; 
      line-height: 1.6; 
      max-width: 8.5in; 
      margin: 1in auto; 
      color: #333;
    }
    p { margin-bottom: 12px; }
  </style>
</head>
<body>
  ${note.documentContent}
</body>
</html>`;
    }
    
    fs.writeFileSync(note.documentPath, saveData);
    
    // Update document state
    note.documentSaved = true;
    updateDocumentTitle_UI(noteId);
    
    // Add to saved documents list
    addToSavedDocuments(documentData);
    
    console.log('Document saved successfully');
    
  } catch (error) {
    console.error('Save failed:', error);
    alert('Save failed: ' + error.message);
  }
}

function addToSavedDocuments(documentData) {
  // Load existing saved documents
  let savedDocs = [];
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    if (fs.existsSync(savedDocsPath)) {
      savedDocs = JSON.parse(fs.readFileSync(savedDocsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading saved documents:', error);
  }
  
  // Update or add document
  const existingIndex = savedDocs.findIndex(doc => doc.id === documentData.id);
  if (existingIndex >= 0) {
    savedDocs[existingIndex] = documentData;
  } else {
    savedDocs.push(documentData);
  }
  
  // Save updated list
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    const dataDir = appConfig.dataPath;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(savedDocsPath, JSON.stringify(savedDocs, null, 2));
  } catch (error) {
    console.error('Error saving documents list:', error);
  }
}

function convertHtmlToMarkdown(htmlContent, title) {
  // Simple HTML to Markdown conversion
  let markdown = '';
  
  if (title) {
    markdown += `# ${title}\n\n`;
  }
  
  // Create a temporary element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Convert common HTML elements to Markdown
  let text = tempDiv.innerHTML;
  
  // Replace headers
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  
  // Replace formatting
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  text = text.replace(/<u[^>]*>(.*?)<\/u>/gi, '_$1_');
  
  // Replace paragraphs
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Replace line breaks
  text = text.replace(/<br[^>]*>/gi, '\n');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Clean up multiple newlines
  text = text.replace(/\n{3,}/g, '\n\n');
  
  markdown += text.trim();
  
  return markdown;
}

function convertHtmlToRtf(htmlContent, title) {
  // Simple HTML to RTF conversion
  let rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}';
  
  if (title) {
    rtf += `\\f0\\fs28\\b ${title.replace(/[\\{}]/g, '\\$&')}\\b0\\fs24\\par\\par`;
  }
  
  // Create a temporary element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Convert to plain text and add basic RTF formatting
  const plainText = tempDiv.textContent || tempDiv.innerText || '';
  const escapedText = plainText.replace(/[\\{}]/g, '\\$&');
  
  // Replace line breaks with RTF line breaks
  const rtfText = escapedText.replace(/\n/g, '\\par ');
  
  rtf += '\\f0\\fs24 ' + rtfText + '}';
  
  return rtf;
}

function convertHtmlToWordRtf(htmlContent, title) {
  // Enhanced RTF format specifically for Word compatibility
  let rtf = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033{\\fonttbl{\\f0\\froman\\fprq2\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fprq2\\fcharset0 Calibri;}}';
  rtf += '{\\colortbl ;\\red0\\green0\\blue0;\\red47\\green84\\blue150;}';
  rtf += '\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\f0\\fs24';
  
  if (title) {
    const cleanTitle = title.replace(/[\\{}]/g, '\\\\$&');
    rtf += `\\f1\\fs32\\cf2\\b ${cleanTitle}\\b0\\fs24\\cf1\\par\\par`;
  }
  
  // Create a temporary element to parse HTML properly
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent || '';
  
  // Process the HTML content more carefully
  function processNode(node) {
    let result = '';
    
    if (node.nodeType === Node.TEXT_NODE) {
      // Escape RTF special characters in text content
      const text = node.textContent || '';
      return text.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      let startTag = '';
      let endTag = '';
      
      // Handle different HTML elements
      switch (tagName) {
        case 'p':
          startTag = '\\par ';
          endTag = '';
          break;
        case 'br':
          return '\\line ';
        case 'strong':
        case 'b':
          startTag = '\\b ';
          endTag = '\\b0 ';
          break;
        case 'em':
        case 'i':
          startTag = '\\i ';
          endTag = '\\i0 ';
          break;
        case 'u':
          startTag = '\\ul ';
          endTag = '\\ulnone ';
          break;
        case 'h1':
          startTag = '\\par\\f1\\fs32\\cf2\\b ';
          endTag = '\\b0\\fs24\\cf1\\f0\\par ';
          break;
        case 'h2':
          startTag = '\\par\\f1\\fs28\\b ';
          endTag = '\\b0\\fs24\\f0\\par ';
          break;
        case 'h3':
          startTag = '\\par\\f1\\fs26\\b ';
          endTag = '\\b0\\fs24\\f0\\par ';
          break;
        default:
          startTag = '';
          endTag = '';
      }
      
      result += startTag;
      
      // Process child nodes
      for (let child of node.childNodes) {
        result += processNode(child);
      }
      
      result += endTag;
    }
    
    return result;
  }
  
  // Process all child nodes
  for (let child of tempDiv.childNodes) {
    rtf += processNode(child);
  }
  
  rtf += '}';
  
  return rtf;
}

async function exportMarkdownDocument(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  try {
    // Get downloads folder path
    const os = require('os');
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const defaultFileName = (note.documentTitle || 'markdown-document').replace(/[<>:"/\\|?*]/g, '_');
    
    const result = await ipcRenderer.invoke('save-file-dialog', {
      defaultPath: path.join(downloadsPath, defaultFileName + '.md'),
      filters: [
        { name: 'Markdown Files', extensions: ['md'] },
        { name: 'Text Files', extensions: ['txt'] }
      ]
    });
    
    if (result.canceled) return;
    
    // Convert HTML content to markdown
    let content = note.documentContent || '';
    
    // Simple HTML to Markdown conversion
    content = content
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<ul[^>]*>(.*?)<\/ul>/gi, '$1')
      .replace(/<ol[^>]*>(.*?)<\/ol>/gi, '$1')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<[^>]+>/g, '') // Remove any remaining HTML tags
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean up multiple newlines
      .trim();
    
    // Write the markdown file
    await ipcRenderer.invoke('write-file', result.filePath, content);
    
    alert(`Markdown file exported successfully to:\n${result.filePath}`);
    
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export markdown file: ' + error.message);
  }
}

async function exportDocument(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Check if this is a markdown document
  if (note.documentType === 'markdown') {
    exportMarkdownDocument(noteId);
    return;
  }
  
  try {
    // Get downloads folder path
    const os = require('os');
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    const defaultFileName = (note.documentTitle || 'document').replace(/[<>:"/\\|?*]/g, '_');
    
    const result = await ipcRenderer.invoke('save-file-dialog', {
      defaultPath: path.join(downloadsPath, defaultFileName),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'HTML Files', extensions: ['html'] },
        { name: 'Microsoft Word Documents', extensions: ['doc'] },
        { name: 'Rich Text Format', extensions: ['rtf'] },
        { name: 'OpenDocument Text', extensions: ['odt'] },
        { name: 'Text Files', extensions: ['txt'] }
      ]
    });
    
    if (result.canceled) return;
    
    // Determine format from file extension
    const extension = path.extname(result.filePath).toLowerCase().substring(1);
    const format = extension;
    
    if (format === 'pdf') {
      // Create a temporary HTML file with the document content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${note.documentTitle || 'Document'}</title>
          <style>
            body { 
              font-family: "Times New Roman", serif; 
              font-size: 12pt; 
              line-height: 1.6; 
              margin: 1in; 
              color: #333;
            }
            p { margin-bottom: 12px; }
            p:last-child { margin-bottom: 0; }
            h1, h2, h3, h4, h5, h6 { margin-bottom: 12px; margin-top: 24px; }
            h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
          </style>
        </head>
        <body>
          ${note.documentContent}
        </body>
        </html>
      `;
      
      // Save temporary HTML file and convert to PDF
      const tempHtmlPath = result.filePath.replace('.pdf', '_temp.html');
      fs.writeFileSync(tempHtmlPath, htmlContent);
      
      // Use Electron's PDF generation
      ipcRenderer.send('convert-html-to-pdf', {
        htmlPath: tempHtmlPath,
        pdfPath: result.filePath
      });
      
    } else if (format === 'html') {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${note.documentTitle || 'Document'}</title>
          <style>
            body { 
              font-family: "Times New Roman", serif; 
              font-size: 12pt; 
              line-height: 1.6; 
              max-width: 8.5in; 
              margin: 1in auto; 
              color: #333;
            }
            p { margin-bottom: 12px; }
          </style>
        </head>
        <body>
          <h1>${note.documentTitle || 'Untitled Document'}</h1>
          ${note.documentContent}
        </body>
        </html>
      `;
      
      fs.writeFileSync(result.filePath, htmlContent);
    } else if (format === 'txt') {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = note.documentContent;
      const plainText = tempDiv.textContent || tempDiv.innerText || '';
      fs.writeFileSync(result.filePath, plainText);
      
    } else if (format === 'md') {
      // Convert HTML to Markdown
      const markdownContent = convertHtmlToMarkdown(note.documentContent, note.documentTitle);
      fs.writeFileSync(result.filePath, markdownContent);
      
    } else if (format === 'rtf') {
      // Convert HTML to RTF
      const rtfContent = convertHtmlToRtf(note.documentContent, note.documentTitle);
      fs.writeFileSync(result.filePath, rtfContent);
      
    } else if (format === 'doc') {
      // Create enhanced RTF format for Word compatibility
      const docContent = convertHtmlToWordRtf(note.documentContent, note.documentTitle);
      fs.writeFileSync(result.filePath, docContent);
      
    } else if (format === 'odt') {
      // For ODT format, create LibreOffice-compatible HTML
      const odtHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${note.documentTitle || 'Document'}</title>
          <style>
            body { 
              font-family: "Liberation Serif", "Times New Roman", serif; 
              font-size: 12pt; 
              line-height: 1.6; 
              margin: 1in; 
              color: #000;
            }
            p { margin-bottom: 12px; }
            p:last-child { margin-bottom: 0; }
            h1, h2, h3, h4, h5, h6 { margin-bottom: 12px; margin-top: 24px; }
            h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
          </style>
        </head>
        <body>
          <h1>${note.documentTitle || 'Untitled Document'}</h1>
          ${note.documentContent}
        </body>
        </html>
      `;
      
      fs.writeFileSync(result.filePath, odtHtml);
    }
    
    // Show success message
    console.log(`Document exported as ${format.toUpperCase()} successfully`);
    
  } catch (error) {
    console.error('Export failed:', error);
    alert('Export failed: ' + error.message);
  }
}

// Document save prompt
function showDocumentSavePrompt(note) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'save-prompt-modal';
    modal.innerHTML = `
      <div class="save-prompt-overlay"></div>
      <div class="save-prompt-content">
        <h3>Save Document?</h3>
        <p>The document "${note.documentTitle || 'Untitled Document'}" has unsaved changes.</p>
        <p>Do you want to save your changes before closing?</p>
        <div class="save-prompt-buttons">
          <button class="save-prompt-btn save-btn" onclick="resolveSavePrompt('save')">💾 Save</button>
          <button class="save-prompt-btn dont-save-btn" onclick="resolveSavePrompt('dont-save')">Don't Save</button>
          <button class="save-prompt-btn cancel-btn" onclick="resolveSavePrompt('cancel')">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Store resolve function globally so buttons can access it
    window.currentSavePromptResolve = resolve;
  });
}

function resolveSavePrompt(choice) {
  const modal = document.querySelector('.save-prompt-modal');
  if (modal) {
    modal.remove();
  }
  
  if (window.currentSavePromptResolve) {
    window.currentSavePromptResolve(choice);
    delete window.currentSavePromptResolve;
  }
}

// Saved documents panel
let isSavedDocsPanelVisible = false;

function toggleSavedDocumentsPanel() {
  if (isSavedDocsPanelVisible) {
    hideSavedDocumentsPanel();
  } else {
    showSavedDocumentsPanel();
  }
}

function showSavedDocumentsPanel() {
  hideSavedDocumentsPanel(); // Remove existing panel
  
  // Load saved documents
  let savedDocs = [];
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    if (fs.existsSync(savedDocsPath)) {
      savedDocs = JSON.parse(fs.readFileSync(savedDocsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading saved documents:', error);
  }
  
  const panel = document.createElement('div');
  panel.className = 'archive-panel';
  panel.id = 'saved-docs-panel';
  
  panel.innerHTML = `
    <div class="archive-header">
      <h3 style="margin: 0; font-size: 16px;">Saved Documents</h3>
      <span style="cursor: pointer; font-size: 18px;" onclick="hideSavedDocumentsPanel()">×</span>
    </div>
    <div id="saved-docs-list">
      ${savedDocs.length === 0 ? 
        '<p style="text-align: center; opacity: 0.7; font-size: 14px;">No saved documents</p>' :
        savedDocs.map(doc => {
          const preview = doc.content ? doc.content.replace(/<[^>]*>/g, '').substring(0, 30) : 'Empty document';
          const escapedPreview = escapeHtml(preview) + (preview.length > 30 ? '...' : '');
          return `
            <div class="archive-item">
              <div class="archive-item-info" onclick="openSavedDocument('${doc.id}')">
                <div class="archive-item-title">${escapeHtml(doc.title || 'Untitled Document')}</div>
                <div class="archive-item-preview">${escapedPreview}</div>
              </div>
              <div class="archive-item-restore" title="Delete document" onclick="deleteSavedDocument('${doc.id}')">X</div>
            </div>
          `;
        }).join('')
      }
    </div>
  `;
  
  document.body.appendChild(panel);
  isSavedDocsPanelVisible = true;
}

function hideSavedDocumentsPanel() {
  const panel = document.getElementById('saved-docs-panel');
  if (panel) {
    panel.remove();
  }
  isSavedDocsPanelVisible = false;
}

function openSavedDocument(docId) {
  // Load the document data
  let savedDocs = [];
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    if (fs.existsSync(savedDocsPath)) {
      savedDocs = JSON.parse(fs.readFileSync(savedDocsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading saved documents:', error);
    return;
  }
  
  const doc = savedDocs.find(d => d.id === docId);
  if (!doc) {
    alert('Document not found.');
    return;
  }
  
  console.log('Loading document:', doc);
  console.log('Document tags:', doc.tags);
  
  // Create a new document note with the saved data
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  
  const note = {
    id: `note-${Date.now()}`, // Generate unique note ID for workspace
    type: 'document',
    title: doc.title,
    content: doc.content ? doc.content.replace(/<[^>]*>/g, '') : '', // Strip HTML for search
    documentContent: doc.content,
    documentTitle: doc.title,
    documentType: doc.documentType || 'word', // Set document type
    tags: doc.tags || [],
    documentSaved: true, // It's saved
    documentPath: doc.filePath, // Keep the original file path for auto-save
    originalDocumentId: doc.id, // Keep track of original document ID for updates
    createdAt: doc.createdAt,
    filePath: '',
    imagePath: '',
    paintData: '',
    todoItems: [],
    reminderDateTime: '',
    reminderMessage: '',
    reminderTriggered: false,
    webUrl: '',
    webTitle: '',
    webDescription: '',
    tableData: [],
    locationAddress: '',
    locationName: '',
    locationNotes: '',
    calculatorDisplay: '0',
    calculatorHistory: [],
    timerDuration: 25 * 60,
    timerRemaining: 25 * 60,
    timerRunning: false,
    timerType: 'pomodoro',
    codeContent: '',
    codeLanguage: 'javascript',
    ocrImagePath: '',
    ocrExtractedText: '',
    folderItems: [],
    parentFolder: null,
    x: centerX - 400,
    y: centerY - 300,
    width: 800,
    height: 600,
    color: '#ffd700'
  };
  
  notes.push(note);
  renderNote(note);
  saveNotes();
  
  // Update the tags input field after rendering
  setTimeout(() => {
    const tagsInput = document.querySelector(`#${note.id} .document-tags-input`);
    if (tagsInput && note.tags && note.tags.length > 0) {
      tagsInput.value = note.tags.join(', ');
      console.log('Updated tags input with:', note.tags.join(', '));
    }
  }, 100);
  
  // Hide the panel
  hideSavedDocumentsPanel();
}

function deleteSavedDocument(docId) {
  if (!confirm('Are you sure you want to delete this saved document? This action cannot be undone.')) {
    return;
  }
  
  // Load saved documents
  let savedDocs = [];
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    if (fs.existsSync(savedDocsPath)) {
      savedDocs = JSON.parse(fs.readFileSync(savedDocsPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading saved documents:', error);
    return;
  }
  
  // Find the document to get its file path
  const docToDelete = savedDocs.find(doc => doc.id === docId);
  
  // Delete the actual file if it exists
  if (docToDelete && docToDelete.filePath) {
    try {
      if (fs.existsSync(docToDelete.filePath)) {
        fs.unlinkSync(docToDelete.filePath);
        console.log('Deleted document file:', docToDelete.filePath);
      }
    } catch (error) {
      console.error('Error deleting document file:', error);
    }
  } else {
    // Try to find the file in documents folder by name
    try {
      const documentsDir = path.join(appConfig.dataPath, 'documents');
      const fileName = (docToDelete ? docToDelete.title || 'document' : 'document') + '.ppdoc';
      const filePath = path.join(documentsDir, fileName);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted document file by name:', filePath);
      }
    } catch (error) {
      console.error('Error deleting document file by name:', error);
    }
  }
  
  // Remove the document from the list
  savedDocs = savedDocs.filter(doc => doc.id !== docId);
  
  // Save updated list
  try {
    const savedDocsPath = path.join(appConfig.dataPath, 'saved-documents.json');
    fs.writeFileSync(savedDocsPath, JSON.stringify(savedDocs, null, 2));
  } catch (error) {
    console.error('Error saving documents list:', error);
  }
  
  // Refresh the panel
  showSavedDocumentsPanel();
}

// Document close function (different from delete)
async function closeDocument(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  // Check if document is unsaved
  if (!note.documentSaved) {
    const saveChoice = await showDocumentSavePrompt(note);
    if (saveChoice === 'cancel') {
      return; // User cancelled
    } else if (saveChoice === 'save') {
      await saveDocument(noteId);
    }
  }
  
  // Remove the note from the notes array and UI without confirmation
  const noteIndex = notes.findIndex(n => n.id === noteId);
  if (noteIndex !== -1) {
    notes.splice(noteIndex, 1);
  }
  
  // Remove note element from DOM
  const noteElement = document.getElementById(noteId);
  if (noteElement) {
    noteElement.remove();
  }
  
  // Save notes (this saves to the workspace, but document is saved separately)
  saveNotes();
}

function setupDocumentNote(note) {
  console.log('Setting up document note:', note.id); // Debug
  
  // Use setTimeout to ensure DOM is fully rendered
  setTimeout(() => {
    const editor = document.getElementById(`document-editor-${note.id}`);
    if (!editor) {
      console.error('Document editor not found:', `document-editor-${note.id}`);
      return;
    }
    
    console.log('Document editor found, setting up...'); // Debug
    
    // Remove any existing event listeners by cloning the element
    const newEditor = editor.cloneNode(true);
    
    // Explicitly preserve important attributes on the new editor
    newEditor.contentEditable = 'true';
    newEditor.spellcheck = true;
    newEditor.style.cursor = 'text';
    newEditor.style.userSelect = 'text';
    newEditor.setAttribute('contenteditable', 'true');
    newEditor.setAttribute('spellcheck', 'true');
    
    editor.parentNode.replaceChild(newEditor, editor);
    
    // Debug: Check if editor is properly configured
    console.log('Editor contentEditable:', newEditor.contentEditable);
    console.log('Editor isContentEditable:', newEditor.isContentEditable);
    
    // Add click handler to focus the editor
    newEditor.addEventListener('click', (e) => {
      e.stopPropagation();
      newEditor.focus();
      console.log('Document editor focused'); // Debug
    });
    
    // Add keydown handler for better text editing
    newEditor.addEventListener('keydown', (e) => {
      console.log('Key pressed in editor:', e.key); // Debug
      
      // Don't prevent default for most keys - let them type naturally
      if (e.key === 'Enter' && !e.shiftKey) {
        // Let the browser handle Enter naturally for now
        setTimeout(() => updateDocumentContent(note.id), 10);
      }
    });
    
    // Add input handler
    newEditor.addEventListener('input', (e) => {
      console.log('Input event fired in editor'); // Debug
      updateDocumentContent(note.id);
    });
    
    // Add paste handler
    newEditor.addEventListener('paste', (e) => {
      console.log('Paste event fired in editor'); // Debug
      setTimeout(() => updateDocumentContent(note.id), 10);
    });
    
    // Add selection change handler for format button states
    newEditor.addEventListener('mouseup', () => {
      setTimeout(() => updateFormatButtonStates(note.id), 10);
    });
    
    newEditor.addEventListener('keyup', () => {
      setTimeout(() => updateFormatButtonStates(note.id), 10);
    });
    
    newEditor.addEventListener('focus', () => {
      setTimeout(() => updateFormatButtonStates(note.id), 10);
    });
    
    // Set up document tags input event listener
    const tagsInput = document.querySelector(`#${note.id} .document-tags-input`);
    if (tagsInput) {
      tagsInput.addEventListener('blur', (e) => {
        updateDocumentTags(note.id, e.target.value);
      });
      tagsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.target.blur(); // Trigger the blur event to save tags
        }
      });
    }
    
    // Ensure proper content structure
    if (newEditor.innerHTML === '' || newEditor.innerHTML === '<p><br></p>') {
      newEditor.innerHTML = '<p><br></p>';
    }
    
    // Focus the editor after a short delay to ensure it's ready
    setTimeout(() => {
      newEditor.focus();
      console.log('Editor focused after delay'); // Debug
      
      // Place cursor at the end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(newEditor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 200);
    
  }, 50); // Give DOM time to render
}

// Markdown Document Functions
function setupMarkdownDocument(note) {
  setTimeout(() => {
    const editor = document.getElementById(`markdown-editor-${note.id}`);
    if (editor) {
      // Initialize preview
      updateMarkdownPreview(note.id);
      
      // Set up auto-save
      editor.addEventListener('input', debounce(() => {
        const n = notes.find(nt => nt.id === note.id);
        if (n) {
          n.documentContent = editor.value;
          n.documentSaved = false;
          saveNotes();
        }
      }, 1000));
    }
  }, 100);
}

function updateMarkdownPreview(noteId) {
  const editor = document.getElementById(`markdown-editor-${noteId}`);
  const preview = document.querySelector(`#markdown-preview-${noteId} .markdown-preview-content`);
  
  if (editor && preview) {
    // Simple markdown to HTML conversion
    let html = editor.value;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Code
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    preview.innerHTML = html;
  }
}

function insertMarkdown(noteId, type) {
  const editor = document.getElementById(`markdown-editor-${noteId}`);
  if (!editor) return;
  
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selectedText = text.substring(start, end);
  
  let insertion = '';
  switch(type) {
    case 'bold':
      insertion = `**${selectedText || 'bold text'}**`;
      break;
    case 'italic':
      insertion = `*${selectedText || 'italic text'}*`;
      break;
    case 'code':
      insertion = `\`${selectedText || 'code'}\``;
      break;
    case 'link':
      insertion = `[${selectedText || 'link text'}](url)`;
      break;
    case 'list':
      insertion = `\n- ${selectedText || 'list item'}`;
      break;
    case 'heading':
      insertion = `\n# ${selectedText || 'Heading'}`;
      break;
  }
  
  editor.value = text.substring(0, start) + insertion + text.substring(end);
  editor.selectionStart = start;
  editor.selectionEnd = start + insertion.length;
  editor.focus();
  
  updateMarkdownPreview(noteId);
}

// Spreadsheet Document Functions
function setupSpreadsheetDocument(note) {
  setTimeout(() => {
    const container = document.getElementById(`spreadsheet-${note.id}`);
    if (container) {
      // Initialize spreadsheet with saved data or default grid
      initializeSpreadsheet(note.id, note.spreadsheetData || {});
    }
  }, 100);
}

function initializeSpreadsheet(noteId, data) {
  const container = document.getElementById(`spreadsheet-${noteId}`);
  if (!container) return;
  
  const cols = data.cols || 5;
  const rows = data.rows || 10;
  const cells = data.cells || {};
  const formatting = data.formatting || {};
  
  let html = '<table class="spreadsheet-table"><thead><tr><th></th>';
  
  // Column headers
  for (let c = 0; c < cols; c++) {
    html += `<th>${String.fromCharCode(65 + c)}</th>`;
  }
  html += '</tr></thead><tbody>';
  
  // Rows
  for (let r = 0; r < rows; r++) {
    html += `<tr><td class="row-header">${r + 1}</td>`;
    for (let c = 0; c < cols; c++) {
      const cellKey = `${r}_${c}`;
      const value = cells[cellKey] || '';
      const cellFormatting = formatting[cellKey] || {};
      
      // Build style string
      let styleString = '';
      if (cellFormatting.backgroundColor) styleString += `background-color: ${cellFormatting.backgroundColor};`;
      if (cellFormatting.color) styleString += `color: ${cellFormatting.color};`;
      if (cellFormatting.fontWeight) styleString += `font-weight: ${cellFormatting.fontWeight};`;
      if (cellFormatting.fontStyle) styleString += `font-style: ${cellFormatting.fontStyle};`;
      
      html += `
        <td>
          <input type="text" 
                 class="spreadsheet-cell" 
                 data-row="${r}" 
                 data-col="${c}"
                 style="${styleString}"
                 oninput="updateSpreadsheetCell('${noteId}', ${r}, ${c}, this.value)"
                 onchange="updateSpreadsheetCell('${noteId}', ${r}, ${c}, this.value)"
                 onclick="handleSpreadsheetCellClick(event, '${noteId}', ${r}, ${c})"
                 value="${escapeHtml(value)}">
        </td>
      `;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  
  container.innerHTML = html;
}

function updateSpreadsheetCell(noteId, row, col, value) {
  try {
    const note = notes.find(n => n.id === noteId);
    if (!note) {
      console.error('Note not found:', noteId);
      return;
    }
    
    if (!note.spreadsheetData) {
      note.spreadsheetData = { cols: 5, rows: 10, cells: {} };
    }
    
    note.spreadsheetData.cells[`${row}_${col}`] = value;
    note.documentSaved = false;
    saveNotes();
  } catch (error) {
    console.error('Error updating spreadsheet cell:', error);
  }
}

function addSpreadsheetRow(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  if (!note.spreadsheetData) {
    note.spreadsheetData = { cols: 5, rows: 10, cells: {} };
  }
  
  note.spreadsheetData.rows++;
  initializeSpreadsheet(noteId, note.spreadsheetData);
  saveNotes();
}

function addSpreadsheetColumn(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  if (!note.spreadsheetData) {
    note.spreadsheetData = { cols: 5, rows: 10, cells: {} };
  }
  
  note.spreadsheetData.cols++;
  initializeSpreadsheet(noteId, note.spreadsheetData);
  saveNotes();
}

function deleteSpreadsheetRow(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.spreadsheetData || note.spreadsheetData.rows <= 1) return;
  
  note.spreadsheetData.rows--;
  
  // Remove cells from the last row
  const lastRow = note.spreadsheetData.rows + 1;
  for (let col = 1; col <= note.spreadsheetData.cols; col++) {
    delete note.spreadsheetData.cells[`${lastRow}_${col}`];
  }
  
  initializeSpreadsheet(noteId, note.spreadsheetData);
  saveNotes();
}

function deleteSpreadsheetColumn(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.spreadsheetData || note.spreadsheetData.cols <= 1) return;
  
  const lastCol = note.spreadsheetData.cols;
  note.spreadsheetData.cols--;
  
  // Remove cells from the last column
  for (let row = 1; row <= note.spreadsheetData.rows; row++) {
    delete note.spreadsheetData.cells[`${row}_${lastCol}`];
  }
  
  initializeSpreadsheet(noteId, note.spreadsheetData);
  saveNotes();
}

function insertFormula(noteId, formulaType) {
  const rangePrompt = prompt(`Enter range for ${formulaType} (e.g., A1:A5):`);
  if (!rangePrompt) return;
  
  const formula = `=${formulaType}(${rangePrompt})`;
  
  // Find the last selected cell or ask user to select one
  const selectedCellKeys = getSelectedCells(noteId);
  
  if (selectedCellKeys.length > 0) {
    // Use the first selected cell
    const cellKey = selectedCellKeys[0];
    const parts = cellKey.split('_');
    const row = parseInt(parts[1]);
    const col = parseInt(parts[2]);
    
    const cell = document.querySelector(`#spreadsheet-${noteId} input[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
      cell.value = formula;
      updateSpreadsheetCell(noteId, row, col, formula);
      alert(`Formula ${formula} added to cell ${String.fromCharCode(65 + col)}${row + 1}`);
    }
  } else {
    // Try to find focused cell as fallback
    const focusedCell = document.querySelector(`#spreadsheet-${noteId} input:focus`);
    if (focusedCell) {
      focusedCell.value = formula;
      const row = focusedCell.getAttribute('data-row');
      const col = focusedCell.getAttribute('data-col');
      if (row && col) {
        updateSpreadsheetCell(noteId, parseInt(row), parseInt(col), formula);
        alert(`Formula ${formula} added to cell ${String.fromCharCode(65 + parseInt(col))}${parseInt(row) + 1}`);
      }
    } else {
      alert(`Formula created: ${formula}\n\nPlease:\n1. Click on a cell first\n2. Then use the formula button\n\nOr copy this formula and paste it into any cell.`);
    }
  }
}

function formatSpreadsheetCells(noteId, formatType) {
  const selectedCellKeys = getSelectedCells(noteId);
  if (selectedCellKeys.length === 0) {
    alert('Please select cells first');
    return;
  }
  
  selectedCellKeys.forEach(cellKey => {
    const parts = cellKey.split('_');
    const row = parseInt(parts[1]);
    const col = parseInt(parts[2]);
    
    const cell = document.querySelector(`#spreadsheet-${noteId} input[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    
    const value = cell.value;
    if (value && !isNaN(parseFloat(value))) {
      const num = parseFloat(value);
      let formattedValue = value;
      
      switch (formatType) {
        case 'currency':
          formattedValue = '$' + num.toFixed(2);
          break;
        case 'percent':
          formattedValue = (num * 100).toFixed(2) + '%';
          break;
        case 'date':
          if (value.includes('/') || value.includes('-')) {
            const date = new Date(value);
            if (!isNaN(date)) {
              formattedValue = date.toLocaleDateString();
            }
          }
          break;
      }
      
      cell.value = formattedValue;
      updateSpreadsheetCell(noteId, row, col, formattedValue);
    }
  });
}

function calculateSpreadsheet(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.spreadsheetData) return;
  
  const cells = note.spreadsheetData.cells;
  let calculationsPerformed = 0;
  
  // Process all cells looking for formulas
  Object.keys(cells).forEach(cellKey => {
    const value = cells[cellKey];
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        const result = evaluateFormula(value, cells, note.spreadsheetData);
        if (result !== value) {
          cells[cellKey] = result;
          calculationsPerformed++;
        }
      } catch (error) {
        console.error('Formula error:', error);
        cells[cellKey] = '#ERROR';
      }
    }
  });
  
  if (calculationsPerformed > 0) {
    initializeSpreadsheet(noteId, note.spreadsheetData);
    saveNotes();
    alert(`${calculationsPerformed} formulas calculated!`);
  } else {
    alert('No formulas found to calculate');
  }
}

function evaluateFormula(formula, cells, sheetData) {
  // Remove = sign
  const expression = formula.substring(1);
  
  // Handle basic functions
  if (expression.startsWith('SUM(')) {
    const range = expression.match(/SUM\(([^)]+)\)/)[1];
    return calculateSum(range, cells, sheetData);
  } else if (expression.startsWith('AVERAGE(')) {
    const range = expression.match(/AVERAGE\(([^)]+)\)/)[1];
    return calculateAverage(range, cells, sheetData);
  } else if (expression.startsWith('COUNT(')) {
    const range = expression.match(/COUNT\(([^)]+)\)/)[1];
    return calculateCount(range, cells, sheetData);
  } else if (expression.startsWith('MAX(')) {
    const range = expression.match(/MAX\(([^)]+)\)/)[1];
    return calculateMax(range, cells, sheetData);
  } else if (expression.startsWith('MIN(')) {
    const range = expression.match(/MIN\(([^)]+)\)/)[1];
    return calculateMin(range, cells, sheetData);
  }
  
  return formula; // Return original if can't calculate
}

function parseRange(range, cells, sheetData) {
  const values = [];
  
  if (range.includes(':')) {
    // Range like A1:A5
    const [start, end] = range.split(':');
    const startPos = cellRefToRowCol(start);
    const endPos = cellRefToRowCol(end);
    
    for (let row = startPos.row; row <= endPos.row; row++) {
      for (let col = startPos.col; col <= endPos.col; col++) {
        const cellValue = cells[`${row}_${col}`];
        const numValue = parseFloat(cellValue);
        if (!isNaN(numValue)) {
          values.push(numValue);
        }
      }
    }
  } else {
    // Single cell like A1
    const pos = cellRefToRowCol(range);
    const cellValue = cells[`${pos.row}_${pos.col}`];
    const numValue = parseFloat(cellValue);
    if (!isNaN(numValue)) {
      values.push(numValue);
    }
  }
  
  return values;
}

function cellRefToRowCol(cellRef) {
  // Convert A1 to {row: 1, col: 1}
  const col = cellRef.charCodeAt(0) - 64; // A=1, B=2, etc.
  const row = parseInt(cellRef.substring(1));
  return { row, col };
}

function calculateSum(range, cells, sheetData) {
  const values = parseRange(range, cells, sheetData);
  return values.reduce((sum, val) => sum + val, 0);
}

function calculateAverage(range, cells, sheetData) {
  const values = parseRange(range, cells, sheetData);
  return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
}

function calculateCount(range, cells, sheetData) {
  const values = parseRange(range, cells, sheetData);
  return values.length;
}

function calculateMax(range, cells, sheetData) {
  const values = parseRange(range, cells, sheetData);
  return values.length > 0 ? Math.max(...values) : 0;
}

function calculateMin(range, cells, sheetData) {
  const values = parseRange(range, cells, sheetData);
  return values.length > 0 ? Math.min(...values) : 0;
}

// Spreadsheet cell selection management
let selectedCells = new Set();
let lastSelectedCell = null;

function handleSpreadsheetCellClick(event, noteId, row, col) {
  const cellKey = `${noteId}_${row}_${col}`;
  const cell = event.target;
  
  if (event.shiftKey && lastSelectedCell) {
    // Shift+click: Select range from last selected to current
    const lastParts = lastSelectedCell.split('_');
    const lastNoteId = lastParts[0];
    const lastRow = parseInt(lastParts[1]);
    const lastCol = parseInt(lastParts[2]);
    
    if (lastNoteId === noteId) {
      // Clear previous selection
      clearCellSelection(noteId);
      
      // Select range
      const minRow = Math.min(lastRow, row);
      const maxRow = Math.max(lastRow, row);
      const minCol = Math.min(lastCol, col);
      const maxCol = Math.max(lastCol, col);
      
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const rangeCellKey = `${noteId}_${r}_${c}`;
          selectedCells.add(rangeCellKey);
          const rangeCell = document.querySelector(`#spreadsheet-${noteId} input[data-row="${r}"][data-col="${c}"]`);
          if (rangeCell) {
            rangeCell.classList.add('selected');
          }
        }
      }
    }
  } else if (event.ctrlKey || event.metaKey) {
    // Ctrl+click: Toggle individual cell
    if (selectedCells.has(cellKey)) {
      selectedCells.delete(cellKey);
      cell.classList.remove('selected');
    } else {
      selectedCells.add(cellKey);
      cell.classList.add('selected');
    }
    lastSelectedCell = cellKey;
  } else {
    // Normal click: Select single cell
    clearCellSelection(noteId);
    selectedCells.add(cellKey);
    cell.classList.add('selected');
    lastSelectedCell = cellKey;
  }
}

function clearCellSelection(noteId) {
  // Remove visual selection
  const cells = document.querySelectorAll(`#spreadsheet-${noteId} .spreadsheet-cell`);
  cells.forEach(cell => cell.classList.remove('selected'));
  
  // Clear selection set for this spreadsheet only
  const toRemove = Array.from(selectedCells).filter(key => key.startsWith(noteId + '_'));
  toRemove.forEach(key => selectedCells.delete(key));
}

function getSelectedCells(noteId) {
  return Array.from(selectedCells).filter(key => key.startsWith(noteId + '_'));
}

function showSpreadsheetColorPicker(noteId, colorType) {
  const selectedCellKeys = getSelectedCells(noteId);
  if (selectedCellKeys.length === 0) {
    alert('Please select cells first');
    return;
  }
  
  // Create a color picker modal
  const colors = [
    '#ffffff', '#f0f0f0', '#d0d0d0', '#808080', '#404040', '#000000',
    '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80',
    '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080',
    '#ffcccc', '#ffd9cc', '#ffeecc', '#e6ffcc', '#ccffcc', '#ccffe6',
    '#ccffff', '#cce6ff', '#ccccff', '#e6ccff', '#ffccff', '#ffcce6'
  ];
  
  const colorPicker = document.createElement('div');
  colorPicker.className = 'spreadsheet-color-picker-modal';
  colorPicker.innerHTML = `
    <div class="color-picker-backdrop" onclick="this.parentElement.remove()"></div>
    <div class="color-picker-content">
      <h4>${colorType === 'background' ? 'Cell Background Color' : 'Text Color'}</h4>
      <div class="color-picker-grid">
        ${colors.map(color => `
          <div class="color-picker-option" 
               style="background-color: ${color};" 
               onclick="applySpreadsheetColor('${noteId}', '${colorType}', '${color}'); this.parentElement.parentElement.parentElement.remove();"
               title="${color}"></div>
        `).join('')}
      </div>
      <button onclick="this.parentElement.parentElement.remove()">Cancel</button>
    </div>
  `;
  
  document.body.appendChild(colorPicker);
}

function applySpreadsheetColor(noteId, colorType, color) {
  const selectedCellKeys = getSelectedCells(noteId);
  
  selectedCellKeys.forEach(cellKey => {
    const parts = cellKey.split('_');
    const row = parseInt(parts[1]);
    const col = parseInt(parts[2]);
    
    const cell = document.querySelector(`#spreadsheet-${noteId} input[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
      if (colorType === 'background') {
        cell.style.backgroundColor = color;
      } else if (colorType === 'text') {
        cell.style.color = color;
      }
      
      // Store the formatting in spreadsheet data
      const note = notes.find(n => n.id === noteId);
      if (note && note.spreadsheetData) {
        if (!note.spreadsheetData.formatting) {
          note.spreadsheetData.formatting = {};
        }
        const cellKey = `${row}_${col}`;
        if (!note.spreadsheetData.formatting[cellKey]) {
          note.spreadsheetData.formatting[cellKey] = {};
        }
        
        if (colorType === 'background') {
          note.spreadsheetData.formatting[cellKey].backgroundColor = color;
        } else if (colorType === 'text') {
          note.spreadsheetData.formatting[cellKey].color = color;
        }
        
        saveNotes();
      }
    }
  });
}

function formatSpreadsheetText(noteId, formatType) {
  const selectedCellKeys = getSelectedCells(noteId);
  if (selectedCellKeys.length === 0) {
    alert('Please select cells first');
    return;
  }
  
  selectedCellKeys.forEach(cellKey => {
    const parts = cellKey.split('_');
    const row = parseInt(parts[1]);
    const col = parseInt(parts[2]);
    
    const cell = document.querySelector(`#spreadsheet-${noteId} input[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
      const note = notes.find(n => n.id === noteId);
      if (note && note.spreadsheetData) {
        if (!note.spreadsheetData.formatting) {
          note.spreadsheetData.formatting = {};
        }
        const cellKey = `${row}_${col}`;
        if (!note.spreadsheetData.formatting[cellKey]) {
          note.spreadsheetData.formatting[cellKey] = {};
        }
        
        if (formatType === 'bold') {
          const isBold = cell.style.fontWeight === 'bold';
          cell.style.fontWeight = isBold ? 'normal' : 'bold';
          note.spreadsheetData.formatting[cellKey].fontWeight = isBold ? 'normal' : 'bold';
        } else if (formatType === 'italic') {
          const isItalic = cell.style.fontStyle === 'italic';
          cell.style.fontStyle = isItalic ? 'normal' : 'italic';
          note.spreadsheetData.formatting[cellKey].fontStyle = isItalic ? 'normal' : 'italic';
        }
        
        saveNotes();
      }
    }
  });
}

function insertMeetingSection(noteId) {
  console.log('insertMeetingSection called with noteId:', noteId);
  
  const sectionName = prompt('Enter section name:');
  if (!sectionName) {
    console.log('No section name provided, cancelling');
    return;
  }
  
  console.log('Section name:', sectionName);
  
  const editor = document.getElementById(`document-editor-${noteId}`);
  console.log('Editor found:', !!editor);
  
  if (!editor) {
    console.error('Meeting editor not found:', noteId);
    alert('Editor not found! Note ID: ' + noteId);
    return;
  }
  
  // Create new section HTML - simplified approach
  const sectionHTML = `<h2>${sectionName}</h2><p>Content goes here...</p><p><br></p>`;
  console.log('Section HTML:', sectionHTML);
  
  try {
    // Simple approach - just append at the end
    editor.insertAdjacentHTML('beforeend', sectionHTML);
    console.log('Section inserted successfully');
    
    // Update document content
    updateDocumentContent(noteId);
    console.log('Document content updated');
    
    // Scroll to the new section
    editor.scrollTop = editor.scrollHeight;
    console.log('Scrolled to bottom');
    
    alert('Section added successfully!');
    
  } catch (error) {
    console.error('Error inserting section:', error);
    alert('Error adding section: ' + error.message);
  }
}

function exportSpreadsheetCSV(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.spreadsheetData) return;
  
  let csv = '';
  const data = note.spreadsheetData;
  
  for (let r = 0; r < data.rows; r++) {
    const rowData = [];
    for (let c = 0; c < data.cols; c++) {
      const value = data.cells[`${r}_${c}`] || '';
      rowData.push(`"${value.replace(/"/g, '""')}"`);
    }
    csv += rowData.join(',') + '\n';
  }
  
  // Download CSV
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${note.documentTitle || 'spreadsheet'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Meeting Notes Functions
function setupMeetingDocument(note) {
  setTimeout(() => {
    const container = document.querySelector(`#${note.id} .meeting-content`);
    if (container) {
      initializeMeetingTemplate(note.id, note);
    }
  }, 100);
}

function initializeMeetingTemplate(noteId, note) {
  const container = document.querySelector(`#${noteId} .meeting-content`);
  if (!container) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  container.innerHTML = `
    <div class="meeting-header">
      <div class="meeting-field">
        <label>Date:</label>
        <input type="date" value="${note.meetingDate || today}" 
               onchange="updateMeetingField('${noteId}', 'meetingDate', this.value)">
        <label>Time:</label>
        <input type="time" value="${note.meetingTime || ''}" 
               onchange="updateMeetingField('${noteId}', 'meetingTime', this.value)">
      </div>
      <div class="meeting-field">
        <label>Location/Link:</label>
        <input type="text" placeholder="Conference room or meeting link" 
               value="${note.meetingLocation || ''}"
               onchange="updateMeetingField('${noteId}', 'meetingLocation', this.value)">
      </div>
    </div>
    
    <div class="meeting-section">
      <h3>Attendees</h3>
      <textarea class="meeting-textarea" 
                placeholder="List attendees (one per line)"
                onblur="updateMeetingField('${noteId}', 'attendees', this.value)">${note.attendees || ''}</textarea>
    </div>
    
    <div class="meeting-section">
      <h3>Agenda</h3>
      <textarea class="meeting-textarea" 
                placeholder="Meeting agenda items"
                onblur="updateMeetingField('${noteId}', 'agenda', this.value)">${note.agenda || ''}</textarea>
    </div>
    
    <div class="meeting-section">
      <h3>Discussion Notes</h3>
      <div contenteditable="true" 
           class="meeting-notes-editor"
           id="meeting-notes-${noteId}"
           onblur="updateMeetingField('${noteId}', 'notes', this.innerHTML)">${note.notes || ''}</div>
    </div>
    
    <div class="meeting-section">
      <h3>Action Items</h3>
      <div class="action-items-container" id="action-items-${noteId}">
        ${renderActionItems(noteId, note.actionItems || [])}
      </div>
    </div>
    
    <div class="meeting-section">
      <h3>🔑 Key Decisions</h3>
      <textarea class="meeting-textarea" 
                placeholder="Document key decisions made"
                onblur="updateMeetingField('${noteId}', 'decisions', this.value)">${note.decisions || ''}</textarea>
    </div>
  `;
}

function renderActionItems(noteId, items) {
  let html = items.map((item, i) => `
    <div class="action-item">
      <input type="checkbox" ${item.completed ? 'checked' : ''} 
             onchange="toggleActionItem('${noteId}', ${i})">
      <input type="text" value="${item.task || ''}" 
             placeholder="Action item"
             onchange="updateActionItem('${noteId}', ${i}, 'task', this.value)">
      <input type="text" value="${item.assignee || ''}" 
             placeholder="Assignee"
             onchange="updateActionItem('${noteId}', ${i}, 'assignee', this.value)">
      <input type="date" value="${item.dueDate || ''}" 
             onchange="updateActionItem('${noteId}', ${i}, 'dueDate', this.value)">
      <button onclick="removeActionItem('${noteId}', ${i})">×</button>
    </div>
  `).join('');
  
  html += `<button class="add-action-btn" onclick="addActionItem('${noteId}')">+ Add Action Item</button>`;
  
  return html;
}

function updateMeetingField(noteId, field, value) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  note[field] = value;
  note.documentSaved = false;
  saveNotes();
}

function addActionItem(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  if (!note.actionItems) note.actionItems = [];
  note.actionItems.push({ task: '', assignee: '', dueDate: '', completed: false });
  
  const container = document.getElementById(`action-items-${noteId}`);
  if (container) {
    container.innerHTML = renderActionItems(noteId, note.actionItems);
  }
  
  saveNotes();
}

function updateActionItem(noteId, index, field, value) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.actionItems || !note.actionItems[index]) return;
  
  note.actionItems[index][field] = value;
  note.documentSaved = false;
  saveNotes();
}

function toggleActionItem(noteId, index) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.actionItems || !note.actionItems[index]) return;
  
  note.actionItems[index].completed = !note.actionItems[index].completed;
  note.documentSaved = false;
  saveNotes();
}

function removeActionItem(noteId, index) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.actionItems) return;
  
  note.actionItems.splice(index, 1);
  
  const container = document.getElementById(`action-items-${noteId}`);
  if (container) {
    container.innerHTML = renderActionItems(noteId, note.actionItems);
  }
  
  note.documentSaved = false;
  saveNotes();
}

// Helper function for debouncing
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

window.setupDocumentNote = setupDocumentNote;
window.setupMarkdownDocument = setupMarkdownDocument;
window.setupSpreadsheetDocument = setupSpreadsheetDocument;
window.setupMeetingDocument = setupMeetingDocument;
window.updateDocumentTitle = updateDocumentTitle;
window.updateDocumentTags = updateDocumentTags;
window.updateMarkdownPreview = updateMarkdownPreview;
window.insertMarkdown = insertMarkdown;
window.updateSpreadsheetCell = updateSpreadsheetCell;
window.addSpreadsheetRow = addSpreadsheetRow;
window.addSpreadsheetColumn = addSpreadsheetColumn;
window.deleteSpreadsheetRow = deleteSpreadsheetRow;
window.deleteSpreadsheetColumn = deleteSpreadsheetColumn;
window.insertFormula = insertFormula;
window.formatSpreadsheetCells = formatSpreadsheetCells;
window.showSpreadsheetColorPicker = showSpreadsheetColorPicker;
window.applySpreadsheetColor = applySpreadsheetColor;
window.formatSpreadsheetText = formatSpreadsheetText;
window.handleSpreadsheetCellClick = handleSpreadsheetCellClick;
window.clearCellSelection = clearCellSelection;
window.exportSpreadsheetCSV = exportSpreadsheetCSV;
window.calculateSpreadsheet = calculateSpreadsheet;
window.updateMeetingField = updateMeetingField;
window.insertMeetingSection = insertMeetingSection;
window.addActionItem = addActionItem;
window.updateActionItem = updateActionItem;
window.toggleActionItem = toggleActionItem;
window.removeActionItem = removeActionItem;
window.updateDocumentContent = updateDocumentContent;
window.applyDocumentFormat = applyDocumentFormat;
window.applyDocumentFontFamily = applyDocumentFontFamily;
window.applyDocumentFontSize = applyDocumentFontSize;
window.toggleColorPicker = toggleColorPicker;
window.saveDocument = saveDocument;
window.exportDocument = exportDocument;
window.exportMarkdownDocument = exportMarkdownDocument;
window.resolveSavePrompt = resolveSavePrompt;
window.closeDocument = closeDocument;
window.hideSavedDocumentsPanel = hideSavedDocumentsPanel;
window.openSavedDocument = openSavedDocument;
window.deleteSavedDocument = deleteSavedDocument;