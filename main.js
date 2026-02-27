const { app, BrowserWindow, ipcMain, protocol, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

let mainWindow;
let pythonProcess = null;

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return { discordWebhookUrl: '', discordEnabled: false };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
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
    width: 1280,
    height: 860,
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
  const args = ['-u', scriptPath, '--gui', '--keyword', keyword];

  const config = loadConfig();
  const envVars = { ...process.env, PYTHONUNBUFFERED: '1' };

  if (discordEnabled && config.discordWebhookUrl) {
    args.push('--discord');
    envVars.DISCORD_WEBHOOK_URL = config.discordWebhookUrl;
  }

  pythonProcess = spawn(pythonCmd, args, {
    cwd: __dirname,
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

  pythonProcess.stderr.on('data', (data) => {
    // Log Python errors to dev console
    console.error('[Python]', data.toString());
  });

  pythonProcess.on('close', (code) => {
    // Flush remaining buffer
    if (buffer.startsWith('JSON:')) {
      try {
        const evt = JSON.parse(buffer.slice(5));
        mainWindow.webContents.send('search-event', evt);
      } catch {}
    }
    pythonProcess = null;
    mainWindow.webContents.send('search-event', { type: 'process-ended', code });
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
