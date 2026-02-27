const { app, BrowserWindow, ipcMain, protocol, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

let mainWindow;
let pythonProcess = null;

// In packaged mode, user data (config, cache, gazetki) goes to userData dir
// In dev mode, everything stays in __dirname
function getDataDir() {
  return app.isPackaged ? app.getPath('userData') : __dirname;
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

function loadConfig() {
  try {
    const cfgPath = getConfigPath();
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch {}
  return { discordWebhookUrl: '', discordEnabled: false };
}

function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// Detect Python command
function getPythonCmd() {
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return cmd;
    } catch {}
  }
  return null;
}

// Register custom protocol for serving local images
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-image',
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true,
      standard: true,
      secure: true,
    },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Allow opening DevTools with Ctrl+Shift+I (also in packaged builds for debugging)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(() => {
  // Handle local-image:// protocol with optional thumbnail resizing
  // Usage: local-image:///path/to/image?thumb=300 for 300px wide thumbnail
  protocol.handle('local-image', (request) => {
    let url = request.url.replace('local-image://', '');
    let thumbWidth = 0;
    const qIdx = url.indexOf('?thumb=');
    if (qIdx !== -1) {
      thumbWidth = parseInt(url.substring(qIdx + 7), 10) || 0;
      url = url.substring(0, qIdx);
    }
    let filePath = decodeURIComponent(url);
    if (!filePath.startsWith('/') && process.platform !== 'win32') {
      filePath = '/' + filePath;
    }

    if (thumbWidth > 0) {
      try {
        const img = nativeImage.createFromPath(filePath);
        const size = img.getSize();
        if (size.width > thumbWidth) {
          const ratio = thumbWidth / size.width;
          const resized = img.resize({
            width: thumbWidth,
            height: Math.round(size.height * ratio),
            quality: 'good',
          });
          const jpegBuffer = resized.toJPEG(70);
          return new Response(jpegBuffer, {
            headers: { 'Content-Type': 'image/jpeg' },
          });
        }
      } catch (e) {
        // Fallback to full image on error
      }
    }

    return net.fetch('file://' + encodeURI(filePath));
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  app.quit();
});

// === IPC Handlers ===

ipcMain.handle('start-search', async (_event, { keyword, discordEnabled }) => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }

  const dataDir = getDataDir();
  let spawnCmd, spawnArgs;

  if (app.isPackaged) {
    // Packaged mode — use PyInstaller binary from extraResources
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binaryPath = path.join(process.resourcesPath, 'python_dist', 'biedrona' + ext);

    if (!fs.existsSync(binaryPath)) {
      mainWindow.webContents.send('search-event', {
        type: 'error',
        message: 'Nie znaleziono silnika wyszukiwania (biedrona binary).',
      });
      mainWindow.webContents.send('search-event', { type: 'done', found_count: 0 });
      return;
    }

    spawnCmd = binaryPath;
    spawnArgs = ['--gui', '--keyword', keyword];
  } else {
    // Dev mode — use system Python
    const pythonCmd = getPythonCmd();
    if (!pythonCmd) {
      mainWindow.webContents.send('search-event', {
        type: 'error',
        message: 'Python nie został znaleziony. Zainstaluj Python 3.',
      });
      mainWindow.webContents.send('search-event', { type: 'done', found_count: 0 });
      return;
    }

    const scriptPath = path.join(__dirname, 'biedrona.py');
    spawnCmd = pythonCmd;
    spawnArgs = ['-u', scriptPath, '--gui', '--keyword', keyword];
  }

  const config = loadConfig();
  const envVars = { ...process.env, PYTHONUNBUFFERED: '1' };

  // Tell the Python process where to store data (gazetki, cache)
  envVars.BIEDRONA_DATA_DIR = dataDir;

  // Point to bundled Tesseract if available
  if (app.isPackaged) {
    const tessDir = path.join(process.resourcesPath, 'tesseract_dist');
    if (fs.existsSync(tessDir)) {
      const tessExt = process.platform === 'win32' ? '.exe' : '';
      envVars.TESSERACT_CMD = path.join(tessDir, 'tesseract' + tessExt);
      // TESSDATA_PREFIX must point to the parent of tessdata/ — Tesseract appends /tessdata/ itself
      envVars.TESSDATA_PREFIX = tessDir;
    }
  }

  if (discordEnabled && config.discordWebhookUrl) {
    spawnArgs.push('--discord');
    envVars.DISCORD_WEBHOOK_URL = config.discordWebhookUrl;
  }

  pythonProcess = spawn(spawnCmd, spawnArgs, {
    cwd: dataDir,
    env: envVars,
  });

  let buffer = '';

  pythonProcess.stdout.on('data', (data) => {
    buffer += data.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (line.startsWith('JSON:')) {
        try {
          const evt = JSON.parse(line.slice(5));
          mainWindow.webContents.send('search-event', evt);
        } catch (e) {
          // ignore malformed JSON
        }
      }
    }
  });

  let stderrBuffer = '';

  pythonProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.error('[Python]', text);
    stderrBuffer += text;
  });

  pythonProcess.on('close', (code) => {
    // Flush remaining buffer
    if (buffer.startsWith('JSON:')) {
      try {
        const evt = JSON.parse(buffer.slice(5));
        mainWindow.webContents.send('search-event', evt);
      } catch {}
    }
    // If process crashed or ended unexpectedly, send error with stderr details
    if (code !== 0 && code !== null) {
      const details = stderrBuffer.trim().slice(-800);
      mainWindow.webContents.send('search-event', {
        type: 'error',
        message: `Silnik wyszukiwania zakończył się z kodem ${code}.${details ? '\n' + details : ''}`,
      });
    }
    pythonProcess = null;
    mainWindow.webContents.send('search-event', { type: 'process-ended', code, stderr: stderrBuffer.trim().slice(-1000) });
  });
});

ipcMain.handle('stop-search', async () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});

ipcMain.handle('load-config', async () => loadConfig());

ipcMain.handle('save-config', async (_event, config) => {
  saveConfig(config);
  return true;
});

ipcMain.handle('minimize-window', () => mainWindow.minimize());

ipcMain.handle('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('close-window', () => mainWindow.close());
