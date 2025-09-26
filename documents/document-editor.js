const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let currentDocument = {
  id: null,
  type: 'word',
  title: 'Untitled Document',
  content: '',
  filePath: null,
  modified: false
};

let pages = 1;

// Initialize document editor
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateWordCount();
  updateTitle();
});

// Receive document type from main process
ipcRenderer.on('document-type', (event, data) => {
  currentDocument.id = data.id;
  currentDocument.type = data.type;
  updateTitle();
});

function setupEventListeners() {
  const editor = document.getElementById('editor');
  const toolbar = document.getElementById('toolbar');
  
  // Editor events
  editor.addEventListener('input', handleEditorInput);
  editor.addEventListener('keydown', handleKeyDown);
  editor.addEventListener('paste', handlePaste);
  
  // File operations
  document.getElementById('new-btn').addEventListener('click', newDocument);
  document.getElementById('open-btn').addEventListener('click', openDocument);
  document.getElementById('save-btn').addEventListener('click', saveDocument);
  document.getElementById('export-btn').addEventListener('click', toggleExportDropdown);
  
  // Export options
  document.querySelectorAll('.export-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const format = e.target.dataset.format;
      exportDocument(format);
      toggleExportDropdown();
    });
  });
  
  // Format controls
  document.getElementById('font-family').addEventListener('change', updateFontFamily);
  document.getElementById('font-size').addEventListener('change', updateFontSize);
  
  document.getElementById('bold-btn').addEventListener('click', () => toggleFormat('bold'));
  document.getElementById('italic-btn').addEventListener('click', () => toggleFormat('italic'));
  document.getElementById('underline-btn').addEventListener('click', () => toggleFormat('underline'));
  
  document.getElementById('align-left-btn').addEventListener('click', () => setAlignment('left'));
  document.getElementById('align-center-btn').addEventListener('click', () => setAlignment('center'));
  document.getElementById('align-right-btn').addEventListener('click', () => setAlignment('right'));
  document.getElementById('align-justify-btn').addEventListener('click', () => setAlignment('justify'));
  
  document.getElementById('bulleted-list-btn').addEventListener('click', () => toggleList('ul'));
  document.getElementById('numbered-list-btn').addEventListener('click', () => toggleList('ol'));
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#export-btn') && !e.target.closest('.export-dropdown')) {
      document.getElementById('export-dropdown').classList.remove('active');
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey) {
      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          newDocument();
          break;
        case 'o':
          e.preventDefault();
          openDocument();
          break;
        case 's':
          e.preventDefault();
          saveDocument();
          break;
        case 'b':
          e.preventDefault();
          toggleFormat('bold');
          break;
        case 'i':
          e.preventDefault();
          toggleFormat('italic');
          break;
        case 'u':
          e.preventDefault();
          toggleFormat('underline');
          break;
      }
    }
  });
}

function handleEditorInput() {
  currentDocument.modified = true;
  currentDocument.content = document.getElementById('editor').innerHTML;
  updateWordCount();
  updateTitle();
  checkPageBreaks();
}

function handleKeyDown(e) {
  // Handle Enter key for proper paragraph creation
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.execCommand('insertParagraph');
  }
}

function handlePaste(e) {
  e.preventDefault();
  
  // Get plain text from clipboard
  const text = e.clipboardData.getData('text/plain');
  
  // Insert as formatted text
  document.execCommand('insertText', false, text);
}

function toggleFormat(command) {
  document.execCommand(command);
  updateFormatButtons();
}

function setAlignment(align) {
  document.execCommand('justify' + align.charAt(0).toUpperCase() + align.slice(1));
  updateFormatButtons();
}

function toggleList(listType) {
  const command = listType === 'ul' ? 'insertUnorderedList' : 'insertOrderedList';
  document.execCommand(command);
  updateFormatButtons();
}

function updateFontFamily() {
  const fontFamily = document.getElementById('font-family').value;
  document.execCommand('fontName', false, fontFamily);
}

function updateFontSize() {
  const fontSize = document.getElementById('font-size').value;
  document.execCommand('fontSize', false, 3); // Use size 3 as base
  
  // Apply actual size with CSS
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = fontSize + 'pt';
    
    try {
      range.surroundContents(span);
    } catch (e) {
      // If range can't be surrounded, insert at cursor
      range.deleteContents();
      range.insertNode(span);
    }
  }
}

function updateFormatButtons() {
  // Update button states based on current selection
  document.getElementById('bold-btn').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('italic-btn').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('underline-btn').classList.toggle('active', document.queryCommandState('underline'));
}

function newDocument() {
  if (currentDocument.modified) {
    const save = confirm('Save changes to current document?');
    if (save) {
      saveDocument();
    }
  }
  
  currentDocument = {
    id: `doc-${Date.now()}`,
    type: 'word',
    title: 'Untitled Document',
    content: '',
    filePath: null,
    modified: false
  };
  
  document.getElementById('editor').innerHTML = '<p><br></p>';
  updateTitle();
  updateWordCount();
}

async function openDocument() {
  const result = await ipcRenderer.invoke('open-file-dialog', {
    filters: [
      { name: 'PhasePad Documents', extensions: ['ppdoc'] },
      { name: 'HTML Files', extensions: ['html', 'htm'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase();
    
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      
      if (extension === '.ppdoc') {
        // Parse PhasePad document format (JSON)
        const docData = JSON.parse(content);
        currentDocument = { ...docData, filePath, modified: false };
        document.getElementById('editor').innerHTML = docData.content;
      } else if (extension === '.html' || extension === '.htm') {
        // Load HTML content
        document.getElementById('editor').innerHTML = content;
        currentDocument.content = content;
        currentDocument.filePath = filePath;
        currentDocument.title = path.basename(filePath, extension);
        currentDocument.modified = false;
      } else {
        // Load as plain text
        document.getElementById('editor').innerHTML = content.replace(/\n/g, '<br>');
        currentDocument.content = document.getElementById('editor').innerHTML;
        currentDocument.filePath = filePath;
        currentDocument.title = path.basename(filePath, extension);
        currentDocument.modified = false;
      }
      
      updateTitle();
      updateWordCount();
    } catch (error) {
      alert('Error opening file: ' + error.message);
    }
  }
}

async function saveDocument() {
  if (!currentDocument.filePath) {
    // Save as new file
    const result = await ipcRenderer.invoke('save-file-dialog', {
      defaultPath: currentDocument.title + '.ppdoc',
      filters: [
        { name: 'PhasePad Documents', extensions: ['ppdoc'] },
        { name: 'HTML Files', extensions: ['html'] },
        { name: 'Text Files', extensions: ['txt'] }
      ]
    });
    
    if (result.canceled) return;
    currentDocument.filePath = result.filePath;
  }
  
  try {
    const extension = path.extname(currentDocument.filePath).toLowerCase();
    let saveData;
    
    if (extension === '.ppdoc') {
      // Save as PhasePad document (JSON format)
      saveData = JSON.stringify({
        id: currentDocument.id,
        type: currentDocument.type,
        title: currentDocument.title,
        content: currentDocument.content,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
      }, null, 2);
    } else if (extension === '.html') {
      // Save as HTML
      saveData = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${currentDocument.title}</title>
  <style>
    body { font-family: "Times New Roman", serif; font-size: 11pt; line-height: 1.5; margin: 1in; }
    p { margin-bottom: 12px; }
  </style>
</head>
<body>
  ${currentDocument.content}
</body>
</html>`;
    } else {
      // Save as plain text
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = currentDocument.content;
      saveData = tempDiv.textContent || tempDiv.innerText || '';
    }
    
    fs.writeFileSync(currentDocument.filePath, saveData);
    currentDocument.modified = false;
    currentDocument.title = path.basename(currentDocument.filePath, path.extname(currentDocument.filePath));
    updateTitle();
    
    // Show save confirmation
    const statusBar = document.getElementById('status-bar');
    const originalContent = statusBar.innerHTML;
    statusBar.innerHTML = '<div class="status-section"><span style="color: #48bb78;">Document saved successfully</span></div>';
    setTimeout(() => {
      statusBar.innerHTML = originalContent;
    }, 2000);
    
  } catch (error) {
    alert('Error saving file: ' + error.message);
  }
}

function toggleExportDropdown() {
  document.getElementById('export-dropdown').classList.toggle('active');
}

async function exportDocument(format) {
  const result = await ipcRenderer.invoke('save-file-dialog', {
    defaultPath: currentDocument.title + '.' + format,
    filters: getExportFilters(format)
  });
  
  if (result.canceled) return;
  
  try {
    let exportData;
    
    switch (format) {
      case 'pdf':
        exportAsPDF(result.filePath);
        return;
        
      case 'docx':
        alert('Word document export coming soon!');
        return;
        
      case 'html':
        exportData = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${currentDocument.title}</title>
  <style>
    body { font-family: "Times New Roman", serif; font-size: 11pt; line-height: 1.5; margin: 1in; }
    p { margin-bottom: 12px; }
  </style>
</head>
<body>
  ${currentDocument.content}
</body>
</html>`;
        break;
        
      case 'txt':
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentDocument.content;
        exportData = tempDiv.textContent || tempDiv.innerText || '';
        break;
    }
    
    fs.writeFileSync(result.filePath, exportData);
    
    // Show export confirmation
    const statusBar = document.getElementById('status-bar');
    const originalContent = statusBar.innerHTML;
    statusBar.innerHTML = `<div class="status-section"><span style="color: #48bb78;">Exported as ${format.toUpperCase()} successfully</span></div>`;
    setTimeout(() => {
      statusBar.innerHTML = originalContent;
    }, 2000);
    
  } catch (error) {
    alert('Error exporting file: ' + error.message);
  }
}

function exportAsPDF(filePath) {
  // Use Electron's built-in PDF generation
  const printOptions = {
    marginsType: 1, // Default margins
    pageSize: 'A4',
    printBackground: true,
    printSelectionOnly: false,
    landscape: false
  };
  
  ipcRenderer.send('print-to-pdf', { filePath, options: printOptions });
}

function getExportFilters(format) {
  const filters = {
    pdf: [{ name: 'PDF Files', extensions: ['pdf'] }],
    docx: [{ name: 'Word Documents', extensions: ['docx'] }],
    html: [{ name: 'HTML Files', extensions: ['html'] }],
    txt: [{ name: 'Text Files', extensions: ['txt'] }]
  };
  
  return filters[format] || [{ name: 'All Files', extensions: ['*'] }];
}

function updateWordCount() {
  const editor = document.getElementById('editor');
  const text = editor.textContent || editor.innerText || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  
  document.getElementById('word-count').textContent = `Words: ${words}`;
  document.getElementById('char-count').textContent = `Characters: ${chars}`;
}

function updateTitle() {
  const titleDisplay = document.getElementById('document-title-display');
  const title = currentDocument.modified ? currentDocument.title + ' *' : currentDocument.title;
  titleDisplay.textContent = title;
  document.title = `${title} - PhasePad Document Editor`;
}

function checkPageBreaks() {
  // Simple page break logic - could be enhanced
  const editor = document.getElementById('editor');
  const pageHeight = 11.7 * 96; // A4 height in pixels (96 DPI)
  const contentHeight = editor.scrollHeight;
  
  const newPageCount = Math.max(1, Math.ceil(contentHeight / pageHeight));
  
  if (newPageCount !== pages) {
    pages = newPageCount;
    document.getElementById('page-count').textContent = `Page 1 of ${pages}`;
  }
}

// Handle PDF export response from main process
ipcRenderer.on('pdf-export-complete', (event, success, error) => {
  const statusBar = document.getElementById('status-bar');
  const originalContent = statusBar.innerHTML;
  
  if (success) {
    statusBar.innerHTML = '<div class="status-section"><span style="color: #48bb78;">Exported as PDF successfully</span></div>';
  } else {
    statusBar.innerHTML = `<div class="status-section"><span style="color: #e53e3e;">PDF export failed: ${error}</span></div>`;
  }
  
  setTimeout(() => {
    statusBar.innerHTML = originalContent;
  }, 3000);
});

// Auto-save functionality
setInterval(() => {
  if (currentDocument.modified && currentDocument.filePath) {
    saveDocument();
  }
}, 30000); // Auto-save every 30 seconds