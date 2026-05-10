
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
            const filename = `${chatId}.jpg`;
            const filepath = `${__dirname}/photos/${filename}`;
            await downloadFile(imageUrl, filepath);
            parentPort.postMessage({ success: true, type: 'avatar', chatId, localPath: `file://${filepath}` });
          } else if (type === 'media') {
            let ext = '.jpg';
            if (mediaType === 'sticker') ext = '.webp';
            if (mediaType === 'video') ext = '.mp4';
            const filename = `${assetId}${ext}`;
            const filepath = `${__dirname}/photos/${filename}`;
            await downloadFile(imageUrl, filepath);
            parentPort.postMessage({ success: true, type: 'media', assetId, localPath: `file://${filepath}` });
          } else if (type === 'check') {
            const possiblePaths = [
              `${__dirname}/photos/${identifier}.jpg`,
              `${__dirname}/photos/${identifier}.webp`,
              `${__dirname}/photos/${identifier}.mp4`
            ];
            let found = null;
            for (const filepath of possiblePaths) {
              if (fs.existsSync(filepath)) {
                found = `file://${filepath}`;
                break;
              }
            }
            parentPort.postMessage({ success: true, type: 'check', identifier, localPath: found });
          }
        } catch (error) {
          parentPort.postMessage({ success: false, type, chatId, assetId, error: error.message });
        }
      });
    