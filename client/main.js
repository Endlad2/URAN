const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

app.commandLine.appendSwitch('disable-features', 'WindowsTransparency');
app.commandLine.appendSwitch('disable-gpu', false);

const photosDir = path.join(__dirname, 'photos');
if (!fs.existsSync(photosDir)) {
  fs.mkdirSync(photosDir, { recursive: true });
}

let avatarWorker = null;

function getAvatarWorker() {
  if (avatarWorker) return avatarWorker;
  
  const workerPath = path.join(__dirname, 'avatar-worker.js');
  if (!fs.existsSync(workerPath)) {
    const workerCode = `
      const { parentPort } = require('worker_threads');
      const https = require('https');
      const http = require('http');
      const fs = require('fs');
      
      function downloadFile(url, filepath) {
        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const options = {
            hostname: 'localhost',
            port: urlObj.port || 9870,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            family: 4
          };
          
          const client = url.startsWith('https') ? https : http;
          const req = client.request(options, (response) => {
            if (response.statusCode === 200) {
              const file = fs.createWriteStream(filepath);
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve(true);
              });
            } else {
              reject(new Error('Failed to download'));
            }
          });
          req.on('error', reject);
          req.end();
        });
      }
      
      parentPort.on('message', async (data) => {
        const { type, chatId, imageUrl, assetId, mediaType, identifier } = data;
        
        try {
          if (type === 'avatar') {
            const filename = \`\${chatId}.jpg\`;
            const filepath = \`\${__dirname}/photos/\${filename}\`;
            await downloadFile(imageUrl, filepath);
            parentPort.postMessage({ success: true, type: 'avatar', chatId, localPath: \`file://\${filepath}\` });
          } else if (type === 'media') {
            let ext = '.jpg';
            if (mediaType === 'sticker') ext = '.webp';
            if (mediaType === 'video') ext = '.mp4';
            const filename = \`\${assetId}\${ext}\`;
            const filepath = \`\${__dirname}/photos/\${filename}\`;
            await downloadFile(imageUrl, filepath);
            parentPort.postMessage({ success: true, type: 'media', assetId, localPath: \`file://\${filepath}\` });
          } else if (type === 'check') {
            const possiblePaths = [
              \`\${__dirname}/photos/\${identifier}.jpg\`,
              \`\${__dirname}/photos/\${identifier}.webp\`,
              \`\${__dirname}/photos/\${identifier}.mp4\`
            ];
            let found = null;
            for (const filepath of possiblePaths) {
              if (fs.existsSync(filepath)) {
                found = \`file://\${filepath}\`;
                break;
              }
            }
            parentPort.postMessage({ success: true, type: 'check', identifier, localPath: found });
          }
        } catch (error) {
          parentPort.postMessage({ success: false, type, chatId, assetId, error: error.message });
        }
      });
    `;
    fs.writeFileSync(workerPath, workerCode);
  }
  
  avatarWorker = new Worker(workerPath);
  return avatarWorker;
}

ipcMain.handle('save-avatar', async (event, chatId, imageUrl) => {
  return new Promise((resolve) => {
    const worker = getAvatarWorker();
    const fixedUrl = imageUrl.replace('::1', 'localhost').replace('[::1]', 'localhost');
    
    const handler = (message) => {
      if (message.type === 'avatar' && message.chatId === chatId) {
        worker.off('message', handler);
        resolve(message.localPath || null);
      }
    };
    
    worker.on('message', handler);
    worker.postMessage({ type: 'avatar', chatId, imageUrl: fixedUrl });
    
    setTimeout(() => {
      worker.off('message', handler);
      resolve(null);
    }, 30000);
  });
});

ipcMain.handle('save-media', async (event, assetId, imageUrl, mediaType) => {
  return new Promise((resolve) => {
    const worker = getAvatarWorker();
    const fixedUrl = imageUrl.replace('::1', 'localhost').replace('[::1]', 'localhost');
    
    const handler = (message) => {
      if (message.type === 'media' && message.assetId === assetId) {
        worker.off('message', handler);
        resolve(message.localPath || null);
      }
    };
    
    worker.on('message', handler);
    worker.postMessage({ type: 'media', assetId, imageUrl: fixedUrl, mediaType });
    
    setTimeout(() => {
      worker.off('message', handler);
      resolve(null);
    }, 30000);
  });
});

ipcMain.handle('get-local-photo', async (event, identifier) => {
  return new Promise((resolve) => {
    const worker = getAvatarWorker();
    
    const handler = (message) => {
      if (message.type === 'check' && message.identifier === identifier) {
        worker.off('message', handler);
        resolve(message.localPath || null);
      }
    };
    
    worker.on('message', handler);
    worker.postMessage({ type: 'check', identifier });
    
    setTimeout(() => {
      worker.off('message', handler);
      resolve(null);
    }, 5000);
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#ffffff',
    transparent: false,
    show: false
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    win.show();
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' https: http: 'unsafe-inline' 'unsafe-eval' file:; " +
          "img-src 'self' https: http: data: blob: file:; " +
          "media-src 'self' https: http: blob: file:; " +
          "connect-src 'self' https: http: ws: wss:;"
        ]
      }
    });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});