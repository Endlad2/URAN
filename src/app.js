let currentUser = null;
let currentChat = null;
let peer = null;
let connections = new Map();
let chats = new Map();
let encryptionKey = null;
let pendingMessages = new Map();
let chatKeys = new Map();

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

function generateRandomCode() {
    return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

function getPeerId(username) {
    const storedId = localStorage.getItem(`peer_id_${username}`);
    if (storedId) {
        return storedId;
    }
    const newId = `${generateRandomCode()}-${username}-uranchat`;
    localStorage.setItem(`peer_id_${username}`, newId);
    return newId;
}

function getInitials(username) {
    return username.charAt(0).toUpperCase();
}

async function generateChatKey(chatWith) {
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    
    const keys = JSON.parse(localStorage.getItem('chat_keys') || '{}');
    keys[chatWith] = exportedKey;
    localStorage.setItem('chat_keys', JSON.stringify(keys));
    
    chatKeys.set(chatWith, key);
    return key;
}

async function getChatKey(chatWith) {
    if (chatKeys.has(chatWith)) {
        return chatKeys.get(chatWith);
    }
    
    const keys = JSON.parse(localStorage.getItem('chat_keys') || '{}');
    const storedKey = keys[chatWith];
    
    if (storedKey) {
        const key = await crypto.subtle.importKey(
            'jwk',
            storedKey,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
        chatKeys.set(chatWith, key);
        return key;
    }
    return null;
}

async function encryptMessage(message, key) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(message);
    
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

async function decryptMessage(encryptedData, key) {
    const iv = new Uint8Array(encryptedData.iv);
    const data = new Uint8Array(encryptedData.data);
    
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
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
            
            console.log('Загрузка фото по URL:', zipUrl);
            
            const response = await fetch(zipUrl);
            if (!response.ok) throw new Error('Failed to fetch photo');
            
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
                                reader.onloadend = () => {
                                    const dataUrl = reader.result;
                                    console.log('Фото преобразовано в data:url, длина:', String(dataUrl).length);
                                    resolve(dataUrl);
                                };
                                reader.onerror = () => {
                                    console.error('Ошибка чтения фото');
                                    resolve(null);
                                };
                                reader.readAsDataURL(fileBlob);
                            });
                        }
                    }
                } else {
                    console.warn('JSZip не загружен');
                    return null;
                }
            } else {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const dataUrl = reader.result;
                        console.log('Прямое фото в data:url, длина:', String(dataUrl).length);
                        resolve(dataUrl);
                    };
                    reader.onerror = () => {
                        console.error('Ошибка чтения прямого фото');
                        resolve(null);
                    };
                    reader.readAsDataURL(blob);
                });
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
    }
    
    return null;
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
            
            if (currentUser.photo) {
                const avatarDataUrl = await loadUserAvatar(currentUser.username, currentUser.photo);
                currentUser.avatarDataUrl = avatarDataUrl;
                const avatarImg = document.getElementById('currentUserAvatar');
                if (avatarImg && avatarDataUrl) {
                    avatarImg.src = avatarDataUrl;
                    console.log('Аватар текущего пользователя установлен');
                } else if (avatarImg) {
                    avatarImg.style.display = 'none';
                }
            } else {
                const avatarImg = document.getElementById('currentUserAvatar');
                if (avatarImg) {
                    avatarImg.style.display = 'none';
                }
            }
        } else {
            throw new Error('No session found');
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        currentUser = {
            id: Date.now(),
            username: 'DemoUser' + Math.floor(Math.random() * 1000),
            photo: null
        };
        const avatarImg = document.getElementById('currentUserAvatar');
        if (avatarImg) {
            avatarImg.style.display = 'none';
        }
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
        
        peer.on('open', (id) => {
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
            
            if (err.type === 'unavailable-id' && peer) {
                console.warn('ID занят, переподключаемся с другим ID');
                peer.destroy();
                peer = new Peer(getPeerId(currentUser.username), peerConfig);
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
        
        const pending = pendingMessages.get(conn.peer);
        if (pending && pending.length > 0) {
            console.log(`Отправляем ${pending.length} накопленных сообщений для ${conn.peer}`);
            for (const msg of pending) {
                conn.send({
                    type: 'message',
                    from: currentUser?.username,
                    encryptedData: msg.encryptedData,
                    time: msg.time,
                    messageId: msg.id
                });
            }
            pendingMessages.delete(conn.peer);
            savePendingToLocalStorage();
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
        case 'chat_key':
            await receiveChatKey(peerId, data);
            break;
        case 'typing':
            if (data.isTyping) {
                updateTypingStatus(peerId, data.isTyping);
            }
            break;
    }
}

async function receiveChatKey(peerId, data) {
    if (!data.chatWith || !data.encryptedKey) return;
    
    const username = data.chatWith;
    
    try {
        const privateKey = await getPrivateKey();
        const decryptedKeyData = await decryptWithPrivateKey(data.encryptedKey, privateKey);
        const key = await crypto.subtle.importKey(
            'jwk',
            decryptedKeyData,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
        
        chatKeys.set(username, key);
        const keys = JSON.parse(localStorage.getItem('chat_keys') || '{}');
        keys[username] = decryptedKeyData;
        localStorage.setItem('chat_keys', JSON.stringify(keys));
        
        console.log('Получен ключ для чата с:', username);
    } catch (error) {
        console.error('Ошибка получения ключа:', error);
    }
}

async function sendChatKey(to, chatWith, key) {
    const conn = connections.get(getPeerId(to));
    if (!conn || !conn.open) return;
    
    const publicKey = await getPublicKey(to);
    if (!publicKey) return;
    
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    const encryptedKey = await encryptWithPublicKey(exportedKey, publicKey);
    
    conn.send({
        type: 'chat_key',
        chatWith: chatWith,
        encryptedKey: encryptedKey
    });
}

async function getPrivateKey() {
    let privateKey = localStorage.getItem('private_key');
    if (!privateKey) {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        
        const exportedPrivate = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
        const exportedPublic = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        
        localStorage.setItem('private_key', JSON.stringify(exportedPrivate));
        localStorage.setItem('public_key', JSON.stringify(exportedPublic));
        
        return keyPair.privateKey;
    }
    
    return await crypto.subtle.importKey(
        'jwk',
        JSON.parse(privateKey),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
    );
}

async function getPublicKey(username) {
    const publicKeyData = localStorage.getItem(`public_key_${username}`);
    if (publicKeyData) {
        return await crypto.subtle.importKey(
            'jwk',
            JSON.parse(publicKeyData),
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            false,
            ['encrypt']
        );
    }
    return null;
}

async function encryptWithPublicKey(data, publicKey) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        encoded
    );
    return Array.from(new Uint8Array(encrypted));
}

async function decryptWithPrivateKey(encryptedData, privateKey) {
    const encrypted = new Uint8Array(encryptedData);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        encrypted
    );
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
}

async function receiveMessage(peerId, data) {
    if (!currentUser || !data.from) return;
    
    const senderUsername = data.from;
    
    let decryptedText = null;
    const chatKey = await getChatKey(senderUsername);
    
    if (chatKey && data.encryptedData) {
        try {
            decryptedText = await decryptMessage(data.encryptedData, chatKey);
        } catch (error) {
            console.error('Ошибка расшифровки:', error);
            decryptedText = '[Зашифрованное сообщение]';
        }
    } else if (data.text) {
        decryptedText = data.text;
    }
    
    if (!decryptedText) return;
    
    const message = {
        id: data.messageId || Date.now(),
        text: decryptedText,
        time: data.time || new Date().toISOString(),
        sender: senderUsername,
        receiver: currentUser.username,
        isRead: false,
        isDelivered: true
    };
    
    await saveMessage(senderUsername, message);
    
    if (currentChat === senderUsername) {
        displayMessage(message);
    }
    
    await refreshChatsList();
    playNotification();
    
    const conn = connections.get(peerId);
    if (conn && conn.open) {
        conn.send({
            type: 'delivery_ack',
            messageId: message.id,
            from: currentUser.username
        });
    }
}

async function sendUserInfo(peerId) {
    const conn = connections.get(peerId);
    if (conn && conn.open && currentUser) {
        const publicKey = localStorage.getItem('public_key');
        conn.send({
            type: 'user_info',
            username: currentUser.username,
            photo: currentUser.photo,
            publicKey: publicKey ? JSON.parse(publicKey) : null
        });
    }
}

async function saveUserInfo(peerId, data) {
    if (!data.username) return;
    
    const username = data.username;
    
    if (data.publicKey) {
        localStorage.setItem(`public_key_${username}`, JSON.stringify(data.publicKey));
    }
    
    if (!chats.has(username)) {
        const avatarDataUrl = await loadUserAvatar(username, data.photo || null);
        chats.set(username, {
            messages: [],
            avatar: avatarDataUrl,
            lastMessage: ''
        });
        await saveToLocalStorage();
        await refreshChatsList();
    }
    
    let chatKey = await getChatKey(username);
    if (!chatKey) {
        chatKey = await generateChatKey(username);
        await sendChatKey(username, username, chatKey);
    }
}

async function sendMessage(text) {
    if (!currentChat || !text.trim() || !currentUser) return;
    
    const chatKey = await getChatKey(currentChat);
    let encryptedData = null;
    
    if (chatKey) {
        encryptedData = await encryptMessage(text.trim(), chatKey);
    }
    
    const message = {
        id: Date.now(),
        text: chatKey ? null : text.trim(),
        encryptedData: encryptedData,
        time: new Date().toISOString(),
        sender: currentUser.username,
        receiver: currentChat,
        isRead: true,
        isDelivered: false
    };
    
    if (!chatKey) {
        message.text = text.trim();
    }
    
    await saveMessage(currentChat, message);
    displayMessage({
        ...message,
        text: text.trim()
    });
    
    const peerId = getPeerId(currentChat);
    const conn = connections.get(peerId);
    
    if (conn && conn.open) {
        conn.send({
            type: 'message',
            from: currentUser.username,
            encryptedData: encryptedData,
            time: message.time,
            messageId: message.id
        });
        message.isDelivered = true;
        await saveMessage(currentChat, message);
    } else {
        if (!pendingMessages.has(currentChat)) {
            pendingMessages.set(currentChat, []);
        }
        pendingMessages.get(currentChat).push({
            id: message.id,
            encryptedData: encryptedData,
            time: message.time
        });
        await savePendingToLocalStorage();
        showMessageQueued(currentChat, text);
        
        setTimeout(() => {
            connectToUser(currentChat);
        }, 1000);
    }
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.value = '';
    }
    await refreshChatsList();
}

function showMessageQueued(username, text) {
    const statusDiv = document.getElementById('chatHeaderStatus');
    if (currentChat === username && statusDiv) {
        statusDiv.textContent = 'Сообщение будет доставлено при появлении онлайн';
        statusDiv.style.color = '#ff9800';
        setTimeout(() => {
            const peerId = getPeerId(username);
            const conn = connections.get(peerId);
            if (conn && conn.open) {
                statusDiv.textContent = 'Онлайн';
                statusDiv.style.color = '#4caf50';
            } else {
                statusDiv.textContent = 'Оффлайн';
                statusDiv.style.color = '#f44336';
            }
        }, 3000);
    }
}

async function savePendingToLocalStorage() {
    const pendingArray = Array.from(pendingMessages.entries());
    const key = await generateMasterKey();
    const encrypted = await encryptMasterData(pendingArray, key);
    localStorage.setItem('pending_messages', JSON.stringify(encrypted));
}

async function loadPendingFromLocalStorage() {
    const encryptedData = localStorage.getItem('pending_messages');
    if (encryptedData) {
        try {
            const key = await generateMasterKey();
            const decrypted = await decryptMasterData(JSON.parse(encryptedData), key);
            pendingMessages = new Map(decrypted);
        } catch (error) {
            console.error('Ошибка загрузки pending сообщений:', error);
            pendingMessages = new Map();
        }
    }
}

async function saveMessage(chatWith, message) {
    if (!chats.has(chatWith)) {
        const avatarDataUrl = await loadUserAvatar(chatWith, null);
        chats.set(chatWith, {
            messages: [],
            avatar: avatarDataUrl,
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
    
    const displayText = message.text || '[Зашифрованное сообщение]';
    chat.lastMessage = displayText.substring(0, 50);
    chat.messages.sort((a, b) => new Date(a.time) - new Date(b.time));
    
    await saveToLocalStorage();
    updateLastMessage(chatWith, displayText);
}

async function encryptMasterData(data, key) {
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

async function decryptMasterData(encryptedData, key) {
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

async function generateMasterKey() {
    if (!encryptionKey) {
        const storedKey = localStorage.getItem('master_key');
        if (storedKey) {
            const keyData = JSON.parse(storedKey);
            encryptionKey = await crypto.subtle.importKey(
                'jwk',
                keyData,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
        } else {
            encryptionKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            const exportedKey = await crypto.subtle.exportKey('jwk', encryptionKey);
            localStorage.setItem('master_key', JSON.stringify(exportedKey));
        }
    }
    return encryptionKey;
}

async function saveToLocalStorage() {
    const key = await generateMasterKey();
    const dataToSave = Array.from(chats.entries()).map(([username, chatData]) => [
        username,
        {
            messages: chatData.messages,
            avatar: chatData.avatar,
            lastMessage: chatData.lastMessage,
            source: chatData.source
        }
    ]);
    const encrypted = await encryptMasterData(dataToSave, key);
    localStorage.setItem('chats_data', JSON.stringify(encrypted));
}

async function loadChats() {
    const encryptedData = localStorage.getItem('chats_data');
    if (encryptedData) {
        try {
            const key = await generateMasterKey();
            const decrypted = await decryptMasterData(JSON.parse(encryptedData), key);
            chats = new Map(decrypted);
            
            for (const [username, chatData] of chats) {
                if (!chatData.avatar || !chatData.avatar.startsWith('data:')) {
                    console.log('Загружаем аватар для:', username);
                    const newAvatar = await loadUserAvatar(username, null);
                    chatData.avatar = newAvatar;
                }
            }
            await saveToLocalStorage();
        } catch (error) {
            console.error('Ошибка расшифровки:', error);
            chats = new Map();
        }
    } else {
        chats = new Map();
    }
    
    const keys = JSON.parse(localStorage.getItem('chat_keys') || '{}');
    for (const [username, keyData] of Object.entries(keys)) {
        try {
            const key = await crypto.subtle.importKey(
                'jwk',
                keyData,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
            chatKeys.set(username, key);
        } catch (error) {
            console.error('Ошибка загрузки ключа для', username, error);
        }
    }
    
    await loadPendingFromLocalStorage();
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
                    const avatarDataUrl = userInfo.photo ? await loadUserAvatar(chatUsername, userInfo.photo) : null;
                    chats.set(chatUsername, {
                        messages: [],
                        avatar: avatarDataUrl,
                        lastMessage: '',
                        source: result.my_chats?.includes(chatUsername) ? 'me' : 'another'
                    });
                    
                    let chatKey = await getChatKey(chatUsername);
                    if (!chatKey) {
                        chatKey = await generateChatKey(chatUsername);
                        const peerId = getPeerId(chatUsername);
                        const conn = connections.get(peerId);
                        if (conn && conn.open) {
                            await sendChatKey(chatUsername, chatUsername, chatKey);
                        }
                    }
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
            const avatarDataUrl = userInfo.photo ? await loadUserAvatar(chatWith, userInfo.photo) : null;
            chats.set(chatWith, {
                messages: [],
                avatar: avatarDataUrl,
                lastMessage: '',
                source: 'me'
            });
            await saveToLocalStorage();
        }
        
        let chatKey = await getChatKey(chatWith);
        if (!chatKey) {
            chatKey = await generateChatKey(chatWith);
        }
        
        await refreshChatsList();
        const conn = await connectToUser(chatWith);
        if (conn && conn.open) {
            await sendChatKey(chatWith, chatWith, chatKey);
        }
        return true;
    } else {
        alert('Ошибка: ' + (result.error || 'Не удалось создать чат'));
        return false;
    }
}

async function connectToUser(username) {
    if (!peer) return null;
    
    try {
        const userInfo = await fetchUserInfo(username);
        if (!userInfo.success && !userInfo.username) {
            console.error('Пользователь не найден:', username);
            return null;
        }
    } catch (error) {
        console.error('Ошибка проверки пользователя:', error);
    }
    
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
        
        if (currentUser.avatarDataUrl) {
            const avatarImg = document.getElementById('currentUserAvatar');
            if (avatarImg) {
                avatarImg.src = currentUser.avatarDataUrl;
                avatarImg.style.display = 'block';
            }
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
    
    for (const [username, chatData] of sortedChats) {
        const chatItem = createChatItem(username, chatData);
        chatsList.appendChild(chatItem);
    }
    
    if (chats.size === 0) {
        chatsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">Нет чатов. Нажмите + чтобы добавить</div>';
    }
}

function createChatItem(username, chatData) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (currentChat === username) div.classList.add('active');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'chat-avatar';
    
    if (chatData.avatar && chatData.avatar.startsWith('data:')) {
        const img = document.createElement('img');
        img.src = chatData.avatar;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
        avatarDiv.appendChild(img);
    } else {
        avatarDiv.textContent = getInitials(username);
        avatarDiv.style.display = 'flex';
        avatarDiv.style.alignItems = 'center';
        avatarDiv.style.justifyContent = 'center';
        avatarDiv.style.fontSize = '20px';
        avatarDiv.style.fontWeight = 'bold';
        avatarDiv.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        avatarDiv.style.color = 'white';
    }
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'chat-name';
    nameDiv.textContent = username;
    
    const lastMsgDiv = document.createElement('div');
    lastMsgDiv.className = 'last-message';
    const lastMsg = chatData.lastMessage || 'Нет сообщений';
    lastMsgDiv.textContent = lastMsg.length > 50 ? lastMsg.substring(0, 47) + '...' : lastMsg;
    
    const unreadCount = chatData.messages.filter(m => m.sender === username && !m.isRead).length;
    if (unreadCount > 0) {
        const unreadBadge = document.createElement('span');
        unreadBadge.style.cssText = 'background: #667eea; color: white; border-radius: 10px; padding: 2px 6px; font-size: 10px; margin-left: 5px;';
        unreadBadge.textContent = unreadCount;
        nameDiv.appendChild(unreadBadge);
    }
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(lastMsgDiv);
    
    div.appendChild(avatarDiv);
    div.appendChild(infoDiv);
    
    div.onclick = () => openChat(username);
    
    return div;
}

function openChat(username) {
    currentChat = username;
    
    const headerName = document.getElementById('chatHeaderName');
    const headerAvatar = document.getElementById('chatHeaderAvatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (headerName) headerName.textContent = username;
    if (headerAvatar) {
        headerAvatar.innerHTML = '';
        
        const chat = chats.get(username);
        if (chat && chat.avatar && chat.avatar.startsWith('data:')) {
            const avatarImg = document.createElement('img');
            avatarImg.src = chat.avatar;
            avatarImg.style.width = '45px';
            avatarImg.style.height = '45px';
            avatarImg.style.borderRadius = '50%';
            avatarImg.style.objectFit = 'cover';
            headerAvatar.appendChild(avatarImg);
        } else {
            headerAvatar.textContent = getInitials(username);
            headerAvatar.style.display = 'flex';
            headerAvatar.style.alignItems = 'center';
            headerAvatar.style.justifyContent = 'center';
            headerAvatar.style.fontSize = '20px';
            headerAvatar.style.fontWeight = 'bold';
            headerAvatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            headerAvatar.style.color = 'white';
        }
    }
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    
    displayChatMessages(username);
    
    const peerId = getPeerId(username);
    const conn = connections.get(peerId);
    updateConnectionStatus(conn && conn.open);
    
    const chat = chats.get(username);
    if (chat) {
        const unreadMessages = chat.messages.filter(m => m.sender === username && !m.isRead);
        for (const msg of unreadMessages) {
            msg.isRead = true;
        }
        saveToLocalStorage();
    }
    
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        const nameDiv = item.querySelector('.chat-name');
        if (nameDiv && nameDiv.textContent === username) {
            item.classList.add('active');
        }
    });
}

function displayChatMessages(username) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    const chat = chats.get(username);
    if (chat && chat.messages) {
        chat.messages.forEach(msg => {
            let displayText = msg.text;
            if (!displayText && msg.encryptedData) {
                displayText = '[Зашифрованное сообщение]';
            }
            displayMessage({ ...msg, text: displayText });
        });
    }
    
    container.scrollTop = container.scrollHeight;
}

function displayMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container || !currentUser) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender === currentUser.username ? 'sent' : 'received'}`;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = message.text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    const time = new Date(message.time);
    timeDiv.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (message.sender === currentUser.username) {
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

function updateLastMessage(username, text) {
    const items = document.querySelectorAll('.chat-item');
    for (const item of items) {
        const nameDiv = item.querySelector('.chat-name');
        if (nameDiv && nameDiv.textContent === username) {
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
    for (const [username, chatData] of chats) {
        if (getPeerId(username) === peerId && currentChat === username) {
            updateConnectionStatus(isOnline);
            break;
        }
    }
}

function updateTypingStatus(peerId, isTyping) {
    for (const [username, chatData] of chats) {
        if (getPeerId(username) === peerId && currentChat === username) {
            const statusDiv = document.getElementById('chatHeaderStatus');
            if (statusDiv && isTyping) {
                statusDiv.textContent = 'Печатает...';
                statusDiv.style.color = '#ff9800';
                setTimeout(() => {
                    const conn = connections.get(peerId);
                    if (conn && conn.open) {
                        statusDiv.textContent = 'Онлайн';
                        statusDiv.style.color = '#4caf50';
                    } else {
                        statusDiv.textContent = 'Оффлайн';
                        statusDiv.style.color = '#f44336';
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
            if (currentChat) {
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

function startMessageChecker() {
    setInterval(() => {
        for (const [peerId, conn] of connections) {
            if (!conn.open) {
                connections.delete(peerId);
                for (const [username, chatData] of chats) {
                    if (getPeerId(username) === peerId && currentChat === username) {
                        updateConnectionStatus(false);
                        break;
                    }
                }
            }
        }
        
        for (const [username, pending] of pendingMessages) {
            if (pending.length > 0) {
                const peerId = getPeerId(username);
                const conn = connections.get(peerId);
                if (conn && conn.open && currentUser) {
                    for (const msg of pending) {
                        conn.send({
                            type: 'message',
                            from: currentUser.username,
                            encryptedData: msg.encryptedData,
                            time: msg.time,
                            messageId: msg.id
                        });
                    }
                    pendingMessages.delete(username);
                    savePendingToLocalStorage();
                }
            }
        }
    }, 30000);
}

async function init() {
    await loadCurrentUser();
    await loadChats();
    await initPeer();
    await syncChatsFromServer();
    updateUI();
    setupEventListeners();
    startMessageChecker();
}

init();
