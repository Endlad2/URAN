let currentUser = null;
let currentChat = null;
let peer = null;
let connections = new Map();
let chats = new Map();
let encryptionKey = null;
let offlineCheckInterval = null;
let tgClient = null;
let tgConnected = false;
let tgCredentials = null;

const peerConfig = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { 
                urls: 'turn:numb.viagenie.ca',
                credential: 'muazkh',
                username: 'muazkh@webrtc-experiment.com'
            }
        ]
    },
    debug: 3
};

function getPeerId(username) {
    return `${username}-uranchat`;
}

function getInitials(username) {
    return username.charAt(0).toUpperCase();
}

async function loadTelegramCredentials() {
    try {
        const response = await fetch('https://www.uran-chat.space/app_cred.php');
        const data = await response.json();
        tgCredentials = data;
        console.log('Telegram credentials загружены');
        return tgCredentials;
    } catch (error) {
        console.error('Ошибка загрузки Telegram credentials:', error);
        return null;
    }
}

async function initTelegramClient() {
    if (!tgCredentials) {
        await loadTelegramCredentials();
    }
    
    if (!tgCredentials || typeof TelegramClient === 'undefined') {
        console.log('TelegramClient не загружен или нет credentials');
        return false;
    }
    
    try {
        const savedSession = localStorage.getItem('telegram_session_data');
        
        tgClient = new TelegramClient(
            new Api.TelegramClient('uran-chat', tgCredentials.telegram.api_id, tgCredentials.telegram.api_hash),
            {
                deviceModel: tgCredentials.device_model,
                systemVersion: tgCredentials.system_version,
                appVersion: tgCredentials.version,
                session: savedSession ? JSON.parse(savedSession) : undefined
            }
        );
        
        await tgClient.start({
            qrCode: (qr) => {
                console.log('QR Code для Telegram получен');
                showTelegramQR(qr);
            },
            onError: (err) => {
                console.error('Telegram ошибка:', err);
                tgConnected = false;
                updateTelegramButtonStatus(false);
            }
        });
        
        tgConnected = true;
        
        const sessionData = await tgClient.exportSession();
        localStorage.setItem('telegram_session_data', JSON.stringify(sessionData));
        
        updateTelegramButtonStatus(true);
        await loadTelegramChats();
        
        return true;
    } catch (error) {
        console.error('Ошибка инициализации Telegram:', error);
        updateTelegramButtonStatus(false);
        return false;
    }
}

function updateTelegramButtonStatus(connected) {
    const tgBtn = document.querySelector('.tg-connect-btn');
    if (!tgBtn) return;
    
    if (connected) {
        tgBtn.style.background = '#4caf50';
        tgBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Telegram</span>
        `;
        tgBtn.disabled = false;
    } else {
        tgBtn.style.background = '#29a9e9';
        tgBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 4.5L2.5 12.5L9.5 14.5L13.5 21.5L21.5 4.5Z"/>
                <path d="M9.5 14.5L13.5 21.5L21.5 4.5L9.5 14.5Z"/>
            </svg>
            <span>Telegram</span>
        `;
        tgBtn.disabled = false;
    }
}

async function loadTelegramChats() {
    if (!tgClient || !tgConnected) return;
    
    try {
        const me = await tgClient.getMe();
        console.log('Telegram пользователь:', me);
        
        const dialogs = await tgClient.getDialogs({ limit: 100 });
        
        for (const dialog of dialogs) {
            const chatId = `tg_${dialog.id}`;
            
            let avatarUrl = null;
            if (dialog.entity?.photo) {
                try {
                    const photo = await tgClient.downloadProfilePhoto(dialog.entity);
                    if (photo) {
                        avatarUrl = URL.createObjectURL(photo);
                    }
                } catch (e) {
                    console.error('Ошибка загрузки фото:', e);
                }
            }
            
            const chatData = {
                messages: [],
                avatar: avatarUrl,
                lastMessage: dialog.message?.text || '',
                source: 'telegram',
                tgData: {
                    id: dialog.id,
                    type: dialog.isUser ? 'user' : (dialog.isGroup ? 'group' : 'channel'),
                    title: dialog.title,
                    username: dialog.username,
                    unreadCount: dialog.unreadCount,
                    status: dialog.entity?.status?._ === 'userStatusOnline' ? 'online' : 'offline'
                }
            };
            
            if (!chats.has(chatId)) {
                chats.set(chatId, chatData);
            }
        }
        
        await saveToLocalStorage();
        await refreshChatsList();
        
    } catch (error) {
        console.error('Ошибка загрузки чатов Telegram:', error);
    }
}

async function getTelegramMessages(chatId, limit = 50) {
    if (!tgClient || !tgConnected) return [];
    
    try {
        const tgChatId = parseInt(chatId.replace('tg_', ''));
        const messages = await tgClient.getMessages(tgChatId, { limit: limit });
        
        const formattedMessages = [];
        for (const msg of messages) {
            let senderId = chatId;
            if (msg.fromId?.userId) {
                senderId = `tg_${msg.fromId.userId}`;
            }
            
            formattedMessages.push({
                id: msg.id,
                text: msg.message || '[Медиа]',
                time: new Date(msg.date * 1000).toISOString(),
                sender: senderId,
                receiver: chatId,
                isRead: true,
                isDelivered: true
            });
        }
        
        return formattedMessages;
    } catch (error) {
        console.error('Ошибка получения сообщений Telegram:', error);
        return [];
    }
}

async function sendTelegramMessage(chatId, text) {
    if (!tgClient || !tgConnected) return false;
    
    try {
        const tgChatId = parseInt(chatId.replace('tg_', ''));
        const result = await tgClient.sendMessage(tgChatId, { message: text });
        
        if (result) {
            const message = {
                id: result.id,
                text: result.message,
                time: new Date(result.date * 1000).toISOString(),
                sender: currentUser.username,
                receiver: chatId,
                isRead: true,
                isDelivered: true
            };
            await saveMessage(chatId, message);
            displayMessage(message);
            return true;
        }
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error);
    }
    return false;
}

function showTelegramQR(qrData) {
    let qrModal = document.querySelector('.tg-qr-modal');
    if (!qrModal) {
        qrModal = document.createElement('div');
        qrModal.className = 'tg-qr-modal';
        qrModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        `;
        document.body.appendChild(qrModal);
    }
    
    qrModal.innerHTML = `
        <div style="background: white; border-radius: 20px; padding: 30px; text-align: center; max-width: 400px;">
            <h3 style="margin-bottom: 20px; color: #333;">Подключение Telegram</h3>
            <div id="tg-qr-container" style="margin: 20px 0; display: flex; justify-content: center;"></div>
            <p style="margin-bottom: 20px; color: #666;">Отсканируйте QR-код в приложении Telegram<br>(Настройки -> Устройства -> Сканировать QR)</p>
            <button id="close-tg-qr" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 10px; cursor: pointer;">Закрыть</button>
        </div>
    `;
    
    if (typeof QRCode !== 'undefined') {
        new QRCode(document.getElementById('tg-qr-container'), {
            text: qrData,
            width: 200,
            height: 200
        });
    } else {
        const img = document.createElement('img');
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;
        document.getElementById('tg-qr-container').appendChild(img);
    }
    
    document.getElementById('close-tg-qr').onclick = () => {
        qrModal.remove();
    };
}

async function saveOfflineMessageToFTP(receiver, sender, message) {
    try {
        const response = await fetch('https://www.uran-chat.space/offline_messages.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=save&receiver=${encodeURIComponent(receiver)}&sender=${encodeURIComponent(sender)}&message=${encodeURIComponent(JSON.stringify(message))}`
        });
        const result = await response.json();
        return result.success;
    } catch (error) {
        console.error('Ошибка сохранения офлайн сообщения:', error);
        return false;
    }
}

async function getOfflineMessagesFromFTP(receiver, sender = null) {
    try {
        const response = await fetch('https://www.uran-chat.space/offline_messages.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=get&receiver=${encodeURIComponent(receiver)}&sender=${encodeURIComponent(sender || '')}`
        });
        const result = await response.json();
        return result.success ? result.messages : [];
    } catch (error) {
        console.error('Ошибка получения офлайн сообщений:', error);
        return [];
    }
}

async function deleteOfflineMessagesFromFTP(receiver, sender) {
    try {
        const response = await fetch('https://www.uran-chat.space/offline_messages.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=delete&receiver=${encodeURIComponent(receiver)}&sender=${encodeURIComponent(sender)}`
        });
        const result = await response.json();
        return result.success;
    } catch (error) {
        console.error('Ошибка удаления офлайн сообщений:', error);
        return false;
    }
}

async function checkOfflineMessages() {
    if (!currentUser) return;

    console.log('Проверка офлайн сообщений...');
    const offlineMessages = await getOfflineMessagesFromFTP(currentUser.username);

    if (offlineMessages && offlineMessages.length > 0) {
        console.log(`Найдено ${offlineMessages.length} офлайн сообщений`);

        const messagesBySender = new Map();
        for (const msg of offlineMessages) {
            if (!messagesBySender.has(msg.sender)) {
                messagesBySender.set(msg.sender, []);
            }
            messagesBySender.get(msg.sender).push(msg);
        }

        for (const [sender, messages] of messagesBySender) {
            for (const msg of messages) {
                await saveMessage(sender, {
                    id: msg.id,
                    text: msg.text,
                    time: msg.time,
                    sender: msg.sender,
                    receiver: currentUser.username,
                    isRead: msg.sender === currentChat ? true : false,
                    isDelivered: true
                });
            }

            await deleteOfflineMessagesFromFTP(currentUser.username, sender);

            if (!chats.has(sender)) {
                const userInfo = await fetchUserInfo(sender);
                chats.set(sender, {
                    messages: [],
                    avatar: null,
                    lastMessage: ''
                });
            }
        }

        await saveToLocalStorage();
        await refreshChatsList();

        if (currentChat) {
            displayChatMessages(currentChat);
        }

        playNotification();
    }
}

async function loadUserAvatar(username, photoUrl) {
    if (!photoUrl) {
        return null;
    }

    try {
        const match = photoUrl.match(/user=([a-f0-9]+)/);
        if (match) {
            const userHash = match[1];
            const zipUrl = `https://www.uran-chat.space/user_photo.php?user=${userHash}`;

            console.log(`Загрузка фото для ${username}:`, zipUrl);

            const response = await fetch(zipUrl);

            if (!response.ok) {
                console.error(`Ошибка HTTP ${response.status} для ${username}`);
                return null;
            }

            const blob = await response.blob();

            if (blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed') {
                if (typeof JSZip !== 'undefined') {
                    const zip = await JSZip.loadAsync(blob);
                    const files = Object.keys(zip.files);

                    for (const fileName of files) {
                        if (!zip.files[fileName].dir) {
                            const fileBlob = await zip.files[fileName].async('blob');
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result);
                                reader.onerror = () => resolve(null);
                                reader.readAsDataURL(fileBlob);
                            });
                        }
                    }
                }
            } else {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
    }

    return null;
}

async function loadUserEncryptionKey(username) {
    const keyKey = `encryption_key_${username}`;
    const storedKey = localStorage.getItem(keyKey);
    
    if (storedKey) {
        try {
            const keyData = JSON.parse(storedKey);
            encryptionKey = await crypto.subtle.importKey(
                'jwk',
                keyData,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
            console.log(`Ключ шифрования загружен для ${username}`);
        } catch (e) {
            console.error('Ошибка импорта ключа', e);
            encryptionKey = null;
        }
    }
    
    if (!encryptionKey) {
        encryptionKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        const exportedKey = await crypto.subtle.exportKey('jwk', encryptionKey);
        localStorage.setItem(keyKey, JSON.stringify(exportedKey));
        console.log(`Сгенерирован новый ключ шифрования для ${username}`);
    }
    
    return encryptionKey;
}

async function loadCurrentUser() {
    try {
        const response = await fetch('https://www.uran-chat.space/get_session.php');
        const data = await response.json();

        if (data.success && data.user_id && data.username) {
            currentUser = {
                id: data.user_id,
                username: data.username,
                photo: data.photo || null
            };

            console.log('Загружен пользователь:', currentUser);
            
            await loadUserEncryptionKey(currentUser.username);

            const avatarImg = document.getElementById('currentUserAvatar');
            if (avatarImg && currentUser.photo) {
                const avatarDataUrl = await loadUserAvatar(currentUser.username, currentUser.photo);
                if (avatarDataUrl) {
                    avatarImg.src = avatarDataUrl;
                    avatarImg.style.display = 'block';
                    console.log('Аватар текущего пользователя загружен');
                }
            }
        } else {
            console.error('Нет активной сессии, перенаправление на login.php');
            window.location.href = '/login.php';
            return;
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        window.location.href = '/login.php';
        return;
    }

    const usernameSpan = document.getElementById('currentUsername');
    if (usernameSpan) {
        usernameSpan.textContent = currentUser.username;
    }
}

function initPeer() {
    return new Promise((resolve, reject) => {
        if (!currentUser) {
            reject(new Error('User not loaded'));
            return;
        }

        const peerId = getPeerId(currentUser.username);
        console.log('Создаем Peer с ID:', peerId);

        peer = new Peer(peerId, peerConfig);

        const timeout = setTimeout(() => {
            reject(new Error('PeerJS connection timeout'));
        }, 10000);

        peer.on('open', async (id) => {
            clearTimeout(timeout);
            console.log('PeerJS подключен, ID:', id);
            updateConnectionStatus(true);
            resolve();
        });

        peer.on('connection', (conn) => {
            console.log('Входящее соединение от:', conn.peer);
            setupConnection(conn);
        });

        peer.on('error', (err) => {
            console.error('PeerJS ошибка:', err);
            updateConnectionStatus(false);

            if (err.type === 'unavailable-id') {
                console.warn('ID занят, переподключаемся...');
                peer.destroy();
                setTimeout(() => {
                    peer = new Peer(peerId, peerConfig);
                }, 1000);
            } else if (err.type === 'disconnected') {
                setTimeout(() => peer?.reconnect(), 3000);
            }
        });

        peer.on('disconnected', () => {
            console.warn('PeerJS отключен, переподключаемся...');
            updateConnectionStatus(false);
            setTimeout(() => peer?.reconnect(), 3000);
        });
    });
}

function setupConnection(conn) {
    connections.set(conn.peer, conn);

    conn.on('open', () => {
        console.log('Соединение открыто с:', conn.peer);
        if (currentUser) {
            conn.send({
                type: 'get_user_info',
                from: currentUser.username
            });
        }
    });

    conn.on('data', async (data) => {
        await handleIncomingMessage(conn.peer, data);
    });

    conn.on('close', () => {
        console.log('Соединение закрыто с:', conn.peer);
        connections.delete(conn.peer);
        updateUserStatus(conn.peer, false);
    });

    conn.on('error', (err) => {
        console.error('Ошибка соединения:', err);
    });
}

async function handleIncomingMessage(peerId, data) {
    switch(data.type) {
        case 'message':
            await receiveMessage(peerId, data);
            break;
        case 'get_user_info':
            await sendUserInfo(peerId);
            break;
        case 'user_info':
            await saveUserInfo(peerId, data);
            break;
        case 'typing':
            if (data.isTyping) {
                updateTypingStatus(peerId, data.isTyping);
            }
            break;
    }
}

async function receiveMessage(peerId, data) {
    if (!currentUser || !data.from || !data.text) return;

    const senderUsername = data.from;
    const message = {
        id: data.messageId || Date.now(),
        text: data.text,
        time: data.time || new Date().toISOString(),
        sender: senderUsername,
        receiver: currentUser.username,
        isRead: currentChat === senderUsername ? true : false,
        isDelivered: true
    };

    await saveMessage(senderUsername, message);

    if (currentChat === senderUsername) {
        displayMessage(message);
    }

    await refreshChatsList();
    playNotification();
}

async function sendUserInfo(peerId) {
    const conn = connections.get(peerId);
    if (conn && conn.open && currentUser) {
        conn.send({
            type: 'user_info',
            username: currentUser.username,
            photo: currentUser.photo
        });
    }
}

async function saveUserInfo(peerId, data) {
    if (!data.username) return;

    const username = data.username;

    if (!chats.has(username)) {
        chats.set(username, {
            messages: [],
            avatar: null,
            lastMessage: ''
        });
        await saveToLocalStorage();
        await refreshChatsList();
    }
}

async function sendMessage(text) {
    if (!currentChat || !text.trim() || !currentUser) return;
    
    if (currentChat.startsWith('tg_')) {
        const success = await sendTelegramMessage(currentChat, text);
        if (success) {
            showMessageDelivered(currentChat);
        } else {
            showMessageQueued(currentChat, text);
            await saveOfflineMessageToFTP(currentChat, currentUser.username, {
                id: Date.now(),
                text: text.trim(),
                time: new Date().toISOString(),
                sender: currentUser.username,
                receiver: currentChat
            });
        }
        
        const messageInput = document.getElementById('messageInput');
        if (messageInput) messageInput.value = '';
        await refreshChatsList();
        return;
    }
    
    const message = {
        id: Date.now(),
        text: text.trim(),
        time: new Date().toISOString(),
        sender: currentUser.username,
        receiver: currentChat,
        isRead: true,
        isDelivered: false
    };

    await saveMessage(currentChat, message);
    displayMessage(message);

    const peerId = getPeerId(currentChat);
    const conn = connections.get(peerId);

    let messageDelivered = false;

    if (conn && conn.open) {
        try {
            conn.send({
                type: 'message',
                from: currentUser.username,
                text: text.trim(),
                time: message.time,
                messageId: message.id
            });
            message.isDelivered = true;
            await saveMessage(currentChat, message);
            messageDelivered = true;
            showMessageDelivered(currentChat);
        } catch (error) {
            console.error('Ошибка отправки через PeerJS:', error);
        }
    }

    if (!messageDelivered) {
        console.log(`Peer ${currentChat} недоступен, сохраняем на FTP`);
        await saveOfflineMessageToFTP(currentChat, currentUser.username, message);
        showMessageQueued(currentChat, text);
    }

    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.value = '';
    }
    await refreshChatsList();
}

function showMessageDelivered(username) {
    const statusDiv = document.getElementById('chatHeaderStatus');
    if (currentChat === username && statusDiv) {
        statusDiv.textContent = 'Сообщение доставлено!';
        statusDiv.style.color = '#4caf50';
        setTimeout(() => {
            if (currentChat === username) {
                const peerId = getPeerId(username);
                const conn = connections.get(peerId);
                if (conn && conn.open) {
                    statusDiv.textContent = 'Онлайн';
                    statusDiv.style.color = '#4caf50';
                } else {
                    statusDiv.textContent = 'Оффлайн';
                    statusDiv.style.color = '#f44336';
                }
            }
        }, 2000);
    }
}

function showMessageQueued(username, text) {
    const statusDiv = document.getElementById('chatHeaderStatus');
    if (currentChat === username && statusDiv) {
        statusDiv.textContent = 'Пользователь не в сети, сообщение сохранено';
        statusDiv.style.color = '#ff9800';
        setTimeout(() => {
            if (currentChat === username) {
                const peerId = getPeerId(username);
                const conn = connections.get(peerId);
                if (conn && conn.open) {
                    statusDiv.textContent = 'Онлайн';
                    statusDiv.style.color = '#4caf50';
                } else {
                    statusDiv.textContent = 'Оффлайн';
                    statusDiv.style.color = '#f44336';
                }
            }
        }, 3000);
    }
}

async function saveMessage(chatWith, message) {
    if (!chats.has(chatWith)) {
        chats.set(chatWith, {
            messages: [],
            avatar: null,
            lastMessage: ''
        });
    }

    const chat = chats.get(chatWith);
    const existingIndex = chat.messages.findIndex(m => m.id === message.id);

    if (existingIndex !== -1) {
        chat.messages[existingIndex] = message;
    } else {
        chat.messages.push(message);
    }

    chat.lastMessage = message.text.substring(0, 50);
    chat.messages.sort((a, b) => new Date(a.time) - new Date(b.time));

    await saveToLocalStorage();
    updateLastMessage(chatWith, message.text);
}

async function encryptData(data, key) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(JSON.stringify(data));

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        dataBuffer
    );

    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
    };
}

async function decryptData(encryptedData, key) {
    const iv = new Uint8Array(encryptedData.iv);
    const data = new Uint8Array(encryptedData.data);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
}

async function saveToLocalStorage() {
    if (!currentUser) return;
    
    try {
        const key = await loadUserEncryptionKey(currentUser.username);
        const dataToSave = Array.from(chats.entries()).map(([chatId, chatData]) => [
            chatId,
            {
                messages: chatData.messages,
                avatar: chatData.avatar,
                lastMessage: chatData.lastMessage,
                source: chatData.source,
                tgData: chatData.tgData
            }
        ]);
        const encrypted = await encryptData(dataToSave, key);
        const storageKey = `chats_data_${currentUser.username}`;
        localStorage.setItem(storageKey, JSON.stringify(encrypted));
        console.log('Данные сохранены в localStorage');
    } catch (error) {
        console.error('Ошибка сохранения в localStorage:', error);
    }
}

async function loadChats() {
    if (!currentUser) return;
    
    const storageKey = `chats_data_${currentUser.username}`;
    const encryptedData = localStorage.getItem(storageKey);
    
    if (encryptedData) {
        try {
            const key = await loadUserEncryptionKey(currentUser.username);
            const decrypted = await decryptData(JSON.parse(encryptedData), key);
            chats = new Map(decrypted);
            console.log(`Загружено ${chats.size} чатов из localStorage для ${currentUser.username}`);
        } catch (error) {
            console.error('Ошибка расшифровки:', error);
            chats = new Map();
        }
    } else {
        chats = new Map();
        console.log(`Нет сохраненных чатов для ${currentUser.username}`);
    }
}

async function syncChatsFromServer() {
    if (!currentUser) return;

    try {
        const response = await fetch('https://www.uran-chat.space/chat_storage.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=get_chats&username=${encodeURIComponent(currentUser.username)}`
        });

        const result = await response.json();

        if (result.success && result.chats) {
            for (const chatUsername of result.chats) {
                if (!chats.has(chatUsername)) {
                    const userInfo = await fetchUserInfo(chatUsername);
                    chats.set(chatUsername, {
                        messages: [],
                        avatar: null,
                        lastMessage: '',
                        source: result.my_chats?.includes(chatUsername) ? 'me' : 'another'
                    });
                }
            }

            await saveToLocalStorage();
            await refreshChatsList();
        }
    } catch (error) {
        console.error('Ошибка синхронизации чатов:', error);
    }
}

async function fetchUserInfo(username) {
    try {
        const response = await fetch(`https://www.uran-chat.space/get_user_info.php?username=${encodeURIComponent(username)}`);
        const data = await response.json();
        return data.success ? data : { success: false, username, photo: null };
    } catch (error) {
        console.error('Ошибка получения информации о пользователе:', error);
        return { success: false, username, photo: null };
    }
}

async function loadChatAvatar(chatId, photoUrl, avatarImg, initialsSpan) {
    if (!photoUrl || !avatarImg) return false;

    console.log(`Загрузка аватара для чата: ${chatId}`);
    const avatarDataUrl = await loadUserAvatar(chatId, photoUrl);
    if (avatarDataUrl) {
        avatarImg.src = avatarDataUrl;
        avatarImg.style.display = 'block';
        if (initialsSpan) {
            initialsSpan.style.display = 'none';
        }
        console.log(`Аватар загружен для ${chatId}`);
        return true;
    }
    return false;
}

async function addNewChat(chatWith) {
    if (!currentUser) return false;

    if (chatWith === currentUser.username) {
        alert('Нельзя создать чат с самим собой');
        return false;
    }

    const response = await fetch('https://www.uran-chat.space/chat_storage.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `action=add_chat&username=${encodeURIComponent(currentUser.username)}&chat_with=${encodeURIComponent(chatWith)}`
    });

    const result = await response.json();

    if (result.success) {
        if (!chats.has(chatWith)) {
            const userInfo = await fetchUserInfo(chatWith);
            chats.set(chatWith, {
                messages: [],
                avatar: null,
                lastMessage: '',
                source: 'me'
            });
            await saveToLocalStorage();
        }

        await refreshChatsList();
        await connectToUser(chatWith);
        return true;
    } else {
        alert('Ошибка: ' + (result.error || 'Не удалось создать чат'));
        return false;
    }
}

async function connectToUser(username) {
    if (!peer) return null;

    const peerId = getPeerId(username);

    if (connections.has(peerId)) {
        const conn = connections.get(peerId);
        if (conn && conn.open) {
            return conn;
        }
    }

    console.log('Подключаемся к Peer ID:', peerId);
    const conn = peer.connect(peerId, {
        reliable: true,
        serialization: 'json'
    });

    setupConnection(conn);
    return conn;
}

function updateUI() {
    if (currentUser) {
        const usernameSpan = document.getElementById('currentUsername');
        if (usernameSpan) {
            usernameSpan.textContent = currentUser.username;
        }
    }

    refreshChatsList();
}

async function refreshChatsList() {
    const chatsList = document.getElementById('chatsList');
    if (!chatsList) return;

    chatsList.innerHTML = '';

    const sortedChats = Array.from(chats.entries()).sort((a, b) => {
        const lastMsgA = a[1].messages[a[1].messages.length - 1];
        const lastMsgB = b[1].messages[b[1].messages.length - 1];
        if (!lastMsgA && !lastMsgB) return 0;
        if (!lastMsgA) return 1;
        if (!lastMsgB) return -1;
        return new Date(lastMsgB.time) - new Date(lastMsgA.time);
    });

    for (const [chatId, chatData] of sortedChats) {
        let userInfo = null;
        let displayName = chatId;
        
        if (chatData.source === 'telegram' && chatData.tgData) {
            displayName = chatData.tgData.title || chatData.tgData.username || chatId;
            userInfo = { username: displayName, photo: chatData.avatar };
        } else {
            userInfo = await fetchUserInfo(chatId);
            displayName = userInfo.username || chatId;
        }
        
        const chatItem = createChatItem(chatId, chatData, userInfo, displayName);
        chatsList.appendChild(chatItem);
    }

    if (chats.size === 0) {
        chatsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">Нет чатов. Нажмите + чтобы добавить</div>';
    }
}

function createChatItem(chatId, chatData, userInfo, displayName) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (currentChat === chatId) div.classList.add('active');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'chat-avatar';
    avatarDiv.style.position = 'relative';
    avatarDiv.style.width = '50px';
    avatarDiv.style.height = '50px';
    avatarDiv.style.borderRadius = '50%';
    avatarDiv.style.overflow = 'hidden';
    avatarDiv.style.display = 'flex';
    avatarDiv.style.alignItems = 'center';
    avatarDiv.style.justifyContent = 'center';
    
    if (chatData.source === 'telegram') {
        avatarDiv.style.background = '#29a9e9';
    } else {
        avatarDiv.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
    avatarDiv.style.color = 'white';
    
    const avatarImg = document.createElement('img');
    avatarImg.className = 'chat-avatar-img';
    avatarImg.style.width = '100%';
    avatarImg.style.height = '100%';
    avatarImg.style.objectFit = 'cover';
    avatarImg.style.display = 'none';
    avatarDiv.appendChild(avatarImg);
    
    const initialsSpan = document.createElement('span');
    initialsSpan.className = 'chat-avatar-initials';
    initialsSpan.textContent = getInitials(displayName);
    initialsSpan.style.fontSize = '20px';
    initialsSpan.style.fontWeight = 'bold';
    avatarDiv.appendChild(initialsSpan);
    
    const messengerIcon = document.createElement('img');
    messengerIcon.style.position = 'absolute';
    messengerIcon.style.bottom = '-2px';
    messengerIcon.style.right = '-2px';
    messengerIcon.style.width = '18px';
    messengerIcon.style.height = '18px';
    messengerIcon.style.borderRadius = '50%';
    messengerIcon.style.backgroundColor = 'white';
    messengerIcon.style.padding = '2px';
    messengerIcon.style.zIndex = '1';
    
    if (chatData.source === 'telegram') {
        messengerIcon.src = 'https://www.uran-chat.space/tg.ico';
    } else {
        messengerIcon.src = 'https://www.uran-chat.space/favicon.ico';
    }
    avatarDiv.appendChild(messengerIcon);
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'chat-name';
    nameDiv.textContent = displayName;
    
    if (chatData.source === 'telegram' && chatData.tgData && chatData.tgData.username) {
        const usernameSpan = document.createElement('span');
        usernameSpan.style.fontSize = '11px';
        usernameSpan.style.color = '#888';
        usernameSpan.style.marginLeft = '5px';
        usernameSpan.textContent = `@${chatData.tgData.username}`;
        nameDiv.appendChild(usernameSpan);
    }
    
    const lastMsgDiv = document.createElement('div');
    lastMsgDiv.className = 'last-message';
    let lastMsg = chatData.lastMessage || 'Нет сообщений';
    lastMsgDiv.textContent = lastMsg.length > 50 ? lastMsg.substring(0, 47) + '...' : lastMsg;
    
    const unreadCount = chatData.messages.filter(m => m.sender === chatId && !m.isRead).length;
    if (unreadCount > 0) {
        const unreadBadge = document.createElement('span');
        unreadBadge.style.cssText = 'background: #667eea; color: white; border-radius: 10px; padding: 2px 6px; font-size: 10px; margin-left: 5px;';
        unreadBadge.textContent = unreadCount;
        nameDiv.appendChild(unreadBadge);
    }
    
    if (chatData.source === 'telegram' && chatData.tgData && chatData.tgData.status === 'online') {
        const onlineDot = document.createElement('span');
        onlineDot.style.cssText = 'display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4caf50; margin-left: 8px;';
        nameDiv.appendChild(onlineDot);
    }
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(lastMsgDiv);
    
    div.appendChild(avatarDiv);
    div.appendChild(infoDiv);
    
    div.onclick = () => openChat(chatId);
    
    if (userInfo && userInfo.photo) {
        loadChatAvatar(displayName, userInfo.photo, avatarImg, initialsSpan);
    } else if (chatData.avatar) {
        loadChatAvatar(displayName, chatData.avatar, avatarImg, initialsSpan);
    }
    
    return div;
}

async function openChat(chatId) {
    currentChat = chatId;
    
    const headerName = document.getElementById('chatHeaderName');
    const headerAvatar = document.getElementById('chatHeaderAvatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    let displayName = chatId;
    const chat = chats.get(chatId);
    
    if (chat && chat.source === 'telegram' && chat.tgData) {
        displayName = chat.tgData.title || chat.tgData.username || chatId;
        if (headerName) headerName.textContent = displayName;
        
        const statusDiv = document.getElementById('chatHeaderStatus');
        if (statusDiv && chat.tgData) {
            if (chat.tgData.status === 'online') {
                statusDiv.textContent = 'Онлайн (Telegram)';
                statusDiv.style.color = '#4caf50';
            } else {
                statusDiv.textContent = 'Telegram';
                statusDiv.style.color = '#888';
            }
        }
    } else {
        if (headerName) headerName.textContent = chatId;
    }
    
    if (headerAvatar) {
        headerAvatar.innerHTML = '';
        headerAvatar.textContent = getInitials(displayName);
        headerAvatar.style.display = 'flex';
        headerAvatar.style.alignItems = 'center';
        headerAvatar.style.justifyContent = 'center';
        headerAvatar.style.fontSize = '20px';
        headerAvatar.style.fontWeight = 'bold';
        
        if (chat && chat.source === 'telegram') {
            headerAvatar.style.background = '#29a9e9';
        } else {
            headerAvatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
        headerAvatar.style.color = 'white';
        headerAvatar.style.width = '45px';
        headerAvatar.style.height = '45px';
        headerAvatar.style.borderRadius = '50%';
        
        if (chat && chat.avatar) {
            const img = document.createElement('img');
            img.src = chat.avatar;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.borderRadius = '50%';
            img.style.objectFit = 'cover';
            headerAvatar.innerHTML = '';
            headerAvatar.appendChild(img);
        } else {
            fetchUserInfo(chatId).then(userInfo => {
                if (userInfo && userInfo.photo) {
                    loadUserAvatar(displayName, userInfo.photo).then(avatarDataUrl => {
                        if (avatarDataUrl) {
                            headerAvatar.innerHTML = '';
                            const img = document.createElement('img');
                            img.src = avatarDataUrl;
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.borderRadius = '50%';
                            img.style.objectFit = 'cover';
                            headerAvatar.appendChild(img);
                        }
                    });
                }
            });
        }
    }
    
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    
    await displayChatMessages(chatId);
    
    if (chat && chat.source === 'telegram' && tgConnected) {
        const tgMessages = await getTelegramMessages(chatId);
        if (tgMessages.length > 0) {
            for (const msg of tgMessages) {
                const exists = chat.messages.some(m => m.id === msg.id);
                if (!exists) {
                    await saveMessage(chatId, msg);
                }
            }
            await displayChatMessages(chatId);
        }
    }
    
    const peerId = getPeerId(chatId);
    const conn = connections.get(peerId);
    updateConnectionStatus(conn && conn.open);
    
    if (chat) {
        const unreadMessages = chat.messages.filter(m => m.sender === chatId && !m.isRead);
        for (const msg of unreadMessages) {
            msg.isRead = true;
        }
        saveToLocalStorage();
    }
    
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        const nameDiv = item.querySelector('.chat-name');
        if (nameDiv && nameDiv.textContent === displayName) {
            item.classList.add('active');
        }
    });
}

async function displayChatMessages(chatId) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    const chat = chats.get(chatId);
    if (chat && chat.messages) {
        for (const msg of chat.messages) {
            let displayText = msg.text;
            let senderName = msg.sender;
            
            if (chat.source === 'telegram' && msg.sender.startsWith('tg_')) {
                const senderChat = chats.get(msg.sender);
                if (senderChat && senderChat.tgData) {
                    senderName = senderChat.tgData.title || senderChat.tgData.username || msg.sender;
                }
            }
            
            displayMessage({ ...msg, text: displayText, sender: msg.sender });
        }
    }
    
    container.scrollTop = container.scrollHeight;
}

function displayMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container || !currentUser) return;
    
    const messageDiv = document.createElement('div');
    const isSent = message.sender === currentUser.username || message.sender === currentUser.username;
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = message.text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    const time = new Date(message.time);
    timeDiv.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (isSent) {
        const statusSpan = document.createElement('span');
        statusSpan.style.marginLeft = '8px';
        statusSpan.style.fontSize = '10px';
        if (message.isRead) {
            statusSpan.textContent = '✓✓ прочитано';
        } else if (message.isDelivered) {
            statusSpan.textContent = '✓✓ доставлено';
        } else {
            statusSpan.textContent = '✓ отправлено';
        }
        timeDiv.appendChild(statusSpan);
    }
    
    messageDiv.appendChild(textDiv);
    messageDiv.appendChild(timeDiv);
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function updateLastMessage(chatId, text) {
    const items = document.querySelectorAll('.chat-item');
    for (const item of items) {
        const nameDiv = item.querySelector('.chat-name');
        if (nameDiv && nameDiv.textContent === chatId) {
            const lastMsgDiv = item.querySelector('.last-message');
            if (lastMsgDiv) {
                lastMsgDiv.textContent = text.substring(0, 50);
            }
            break;
        }
    }
}

function updateConnectionStatus(isConnected) {
    const statusDiv = document.getElementById('chatHeaderStatus');
    if (statusDiv) {
        if (isConnected) {
            statusDiv.textContent = 'Онлайн';
            statusDiv.style.color = '#4caf50';
        } else {
            statusDiv.textContent = 'Оффлайн';
            statusDiv.style.color = '#f44336';
        }
    }
}

function updateUserStatus(peerId, isOnline) {
    for (const [username] of chats) {
        if (getPeerId(username) === peerId && currentChat === username) {
            updateConnectionStatus(isOnline);
            break;
        }
    }
}

function updateTypingStatus(peerId, isTyping) {
    for (const [username] of chats) {
        if (getPeerId(username) === peerId && currentChat === username && isTyping) {
            const statusDiv = document.getElementById('chatHeaderStatus');
            if (statusDiv) {
                statusDiv.textContent = 'Печатает...';
                statusDiv.style.color = '#ff9800';
                setTimeout(() => {
                    if (currentChat === username) {
                        const conn = connections.get(peerId);
                        if (conn && conn.open) {
                            statusDiv.textContent = 'Онлайн';
                            statusDiv.style.color = '#4caf50';
                        } else {
                            statusDiv.textContent = 'Оффлайн';
                            statusDiv.style.color = '#f44336';
                        }
                    }
                }, 2000);
            }
            break;
        }
    }
}

function playNotification() {
    if (document.hidden) {
        try {
            const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCBzb3VuZA==');
            audio.play().catch(e => console.log('Notification sound blocked'));
        } catch(e) {}
    }
}

function showNewChatModal() {
    const modal = document.getElementById('newChatModal');
    const input = document.getElementById('newChatUsername');
    if (modal) modal.classList.add('active');
    if (input) input.value = '';
}

function closeModal() {
    const modal = document.getElementById('newChatModal');
    if (modal) modal.classList.remove('active');
}

async function createNewChat() {
    const input = document.getElementById('newChatUsername');
    const username = input.value.trim();
    
    if (!username) {
        alert('Введите имя пользователя');
        return;
    }
    
    const success = await addNewChat(username);
    if (success) {
        closeModal();
        openChat(username);
    }
}

function setupEventListeners() {
    const newChatBtn = document.getElementById('newChatBtn');
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    
    if (newChatBtn) newChatBtn.onclick = showNewChatModal;
    if (sendBtn) {
        sendBtn.onclick = () => {
            sendMessage(messageInput.value);
        };
    }
    if (messageInput) {
        messageInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                sendMessage(messageInput.value);
            }
        };
    }
    
    let typingTimeout;
    if (messageInput) {
        messageInput.oninput = () => {
            if (currentChat && !currentChat.startsWith('tg_')) {
                const peerId = getPeerId(currentChat);
                const conn = connections.get(peerId);
                if (conn && conn.open) {
                    conn.send({
                        type: 'typing',
                        isTyping: true
                    });
                    
                    if (typingTimeout) clearTimeout(typingTimeout);
                    typingTimeout = setTimeout(() => {
                        if (conn && conn.open) {
                            conn.send({
                                type: 'typing',
                                isTyping: false
                            });
                        }
                    }, 1500);
                }
            }
        };
    }
}

function addTelegramConnectButton() {
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (!sidebarHeader) return;
    
    const tgConnectBtn = document.createElement('button');
    tgConnectBtn.className = 'tg-connect-btn';
    tgConnectBtn.style.cssText = `
        background: #29a9e9;
        border: none;
        color: white;
        cursor: pointer;
        padding: 8px 12px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 5px;
        margin-left: 10px;
    `;
    tgConnectBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 4.5L2.5 12.5L9.5 14.5L13.5 21.5L21.5 4.5Z"/>
            <path d="M9.5 14.5L13.5 21.5L21.5 4.5L9.5 14.5Z"/>
        </svg>
        <span>Telegram</span>
    `;
    
    tgConnectBtn.onclick = async () => {
        tgConnectBtn.disabled = true;
        tgConnectBtn.style.opacity = '0.7';
        tgConnectBtn.innerHTML = '<span class="loading"></span> Подключение...';
        
        await loadTelegramCredentials();
        const success = await initTelegramClient();
        
        if (success) {
            tgConnectBtn.style.background = '#4caf50';
            tgConnectBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Telegram</span>
            `;
        } else {
            tgConnectBtn.style.background = '#f44336';
            tgConnectBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>Ошибка</span>
            `;
            setTimeout(() => {
                tgConnectBtn.style.background = '#29a9e9';
                tgConnectBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21.5 4.5L2.5 12.5L9.5 14.5L13.5 21.5L21.5 4.5Z"/>
                        <path d="M9.5 14.5L13.5 21.5L21.5 4.5L9.5 14.5Z"/>
                    </svg>
                    <span>Telegram</span>
                `;
            }, 3000);
        }
        
        tgConnectBtn.disabled = false;
        tgConnectBtn.style.opacity = '1';
    };
    
    sidebarHeader.appendChild(tgConnectBtn);
}

function startOfflineMessageChecker() {
    if (offlineCheckInterval) {
        clearInterval(offlineCheckInterval);
    }
    offlineCheckInterval = setInterval(async () => {
        await checkOfflineMessages();
    }, 5000);
    console.log('Запущена проверка офлайн сообщений (каждые 5 секунд)');
}

async function init() {
    await loadCurrentUser();
    await loadChats();
    await initPeer();
    await syncChatsFromServer();
    updateUI();
    setupEventListeners();
    addTelegramConnectButton();
    startOfflineMessageChecker();
    
    await loadTelegramCredentials();
    const savedSession = localStorage.getItem('telegram_session_data');
    if (savedSession) {
        const success = await initTelegramClient();
        if (success) {
            updateTelegramButtonStatus(true);
        }
    }
}

init();
