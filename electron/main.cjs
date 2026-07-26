const { app, BrowserWindow, shell } = require('electron')
const path = require('path')

/** @type {BrowserWindow | null} */
let mainWindow = null

function iconPath() {
  return path.join(__dirname, '..', 'build', 'icon.ico')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Paletter',
    backgroundColor: '#0a0a0a',
    icon: iconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  // Local fonts + tiny asar → first paint is fast; show as soon as it's ready.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Closing the window must end the whole app (no tray / background linger).
  mainWindow.on('close', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when the last window closes on every platform (including macOS).
app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  // Ensure no orphaned windows keep the process alive.
  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy()
  }
})
