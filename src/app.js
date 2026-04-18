let currentUser = null;
let currentChat = null;
let peer = null;
let connections = new Map();
let chats = new Map();
let encryptionKey = null;
let pendingMessages = new Map();

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

async function loadUserAvatar(username, photoUrl) {
    if (!photoUrl) {
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff&rounded=true&size=128`;
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
                                    resolve(`https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff&rounded=true&size=128`);
                                };
                                reader.readAsDataURL(fileBlob);
                            });
                        }
                    }
                } else {
                    console.warn('JSZip не загружен');
                    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff&rounded=true&size=128`;
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
                        resolve(`https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff&rounded=true&size=128`);
                    };
                    reader.readAsDataURL(blob);
                });
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
    }
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=667eea&color=fff&rounded=true&size=128`;
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
                if (avatarImg) {
                    avatarImg.src = avatarDataUrl;
                    console.log('Аватар текущего пользователя установлен (data:url)');
                }
            } else {
                const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}&background=667eea&color=fff&rounded=true&size=128`;
                const avatarImg = document.getElementById('currentUserAvatar');
                if (avatarImg) {
                    avatarImg.src = defaultAvatar;
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
            avatarImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}&background=667eea&color=fff&rounded=true&size=128`;
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
        
        peer = new Peer(currentUser.id.toString(), peerConfig);
        
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
                peer = new Peer(crypto.randomUUID(), peerConfig);
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
                    text: msg.text,
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
        const avatarDataUrl = await loadUserAvatar(username, data.photo || null);
        chats.set(username, {
            messages: [],
            avatar: avatarDataUrl,
            lastMessage: ''
        });
        await saveToLocalStorage();
        await refreshChatsList();
    }
}

async function sendMessage(text) {
    if (!currentChat || !text.trim() || !currentUser) return;
    
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
    
    const conn = connections.get(currentChat);
    if (conn && conn.open) {
        conn.send({
            type: 'message',
            from: currentUser.username,
            text: text.trim(),
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
            text: text.trim(),
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
            const conn = connections.get(username);
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
    const key = await generateKey();
    const encrypted = await encryptData(pendingArray, key);
    localStorage.setItem('pending_messages', JSON.stringify(encrypted));
}

async function loadPendingFromLocalStorage() {
    const encryptedData = localStorage.getItem('pending_messages');
    if (encryptedData) {
        try {
            const key = await generateKey();
            const decrypted = await decryptData(JSON.parse(encryptedData), key);
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

async function generateKey() {
    if (!encryptionKey) {
        const storedKey = localStorage.getItem('encryption_key');
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
            localStorage.setItem('encryption_key', JSON.stringify(exportedKey));
        }
    }
    return encryptionKey;
}

async function saveToLocalStorage() {
    const key = await generateKey();
    const encrypted = await encryptData(Array.from(chats.entries()), key);
    localStorage.setItem('chats_data', JSON.stringify(encrypted));
}

async function loadChats() {
    const encryptedData = localStorage.getItem('chats_data');
    if (encryptedData) {
        try {
            const key = await generateKey();
            const decrypted = await decryptData(JSON.parse(encryptedData), key);
            chats = new Map(decrypted);
            
            // Обновляем старые blob URL на data URL
            for (const [username, chatData] of chats) {
                if (chatData.avatar && !chatData.avatar.startsWith('data:') && !chatData.avatar.startsWith('http')) {
                    console.log('Обновляем устаревший аватар для:', username);
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
                    const avatarDataUrl = userInfo.photo ? await loadUserAvatar(chatUsername, userInfo.photo) : await loadUserAvatar(chatUsername, null);
                    chats.set(chatUsername, {
                        messages: [],
                        avatar: avatarDataUrl,
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
            const avatarDataUrl = userInfo.photo ? await loadUserAvatar(chatWith, userInfo.photo) : await loadUserAvatar(chatWith, null);
            chats.set(chatWith, {
                messages: [],
                avatar: avatarDataUrl,
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
    
    try {
        const userInfo = await fetchUserInfo(username);
        if (!userInfo.success && !userInfo.username) {
            console.error('Пользователь не найден:', username);
            return null;
        }
    } catch (error) {
        console.error('Ошибка проверки пользователя:', error);
    }
    
    if (connections.has(username)) {
        const conn = connections.get(username);
        if (conn && conn.open) {
            return conn;
        }
    }
    
    const conn = peer.connect(username, {
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
            }
        } else if (currentUser.photo) {
            loadUserAvatar(currentUser.username, currentUser.photo).then(url => {
                const avatarImg = document.getElementById('currentUserAvatar');
                if (avatarImg) {
                    avatarImg.src = url;
                }
            });
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
    
    if (chatData.avatar && (chatData.avatar.startsWith('data:') || chatData.avatar.startsWith('http'))) {
        const img = document.createElement('img');
        img.src = chatData.avatar;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
        avatarDiv.appendChild(img);
    } else {
        avatarDiv.textContent = username.charAt(0).toUpperCase();
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
        headerAvatar.textContent = username.charAt(0).toUpperCase();
    }
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    
    const chat = chats.get(username);
    if (chat && chat.avatar && headerAvatar && (chat.avatar.startsWith('data:') || chat.avatar.startsWith('http'))) {
        const avatarImg = document.createElement('img');
        avatarImg.src = chat.avatar;
        avatarImg.style.width = '45px';
        avatarImg.style.height = '45px';
        avatarImg.style.borderRadius = '50%';
        avatarImg.style.objectFit = 'cover';
        headerAvatar.innerHTML = '';
        headerAvatar.appendChild(avatarImg);
    }
    
    displayChatMessages(username);
    
    const conn = connections.get(username);
    updateConnectionStatus(conn && conn.open);
    
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
        chat.messages.forEach(msg => displayMessage(msg));
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

function updateUserStatus(username, isOnline) {
    if (currentChat === username) {
        updateConnectionStatus(isOnline);
    }
}

function updateTypingStatus(username, isTyping) {
    if (currentChat === username) {
        const statusDiv = document.getElementById('chatHeaderStatus');
        if (statusDiv && isTyping) {
            statusDiv.textContent = 'Печатает...';
            statusDiv.style.color = '#ff9800';
            setTimeout(() => {
                const conn = connections.get(username);
                if (conn && conn.open) {
                    statusDiv.textContent = 'Онлайн';
                    statusDiv.style.color = '#4caf50';
                } else {
                    statusDiv.textContent = 'Оффлайн';
                    statusDiv.style.color = '#f44336';
                }
            }, 2000);
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
            if (currentChat && connections.has(currentChat)) {
                const conn = connections.get(currentChat);
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
        for (const [username, conn] of connections) {
            if (!conn.open) {
                connections.delete(username);
                if (currentChat === username) {
                    updateConnectionStatus(false);
                }
            }
        }
        
        for (const [username, pending] of pendingMessages) {
            if (pending.length > 0) {
                const conn = connections.get(username);
                if (conn && conn.open && currentUser) {
                    for (const msg of pending) {
                        conn.send({
                            type: 'message',
                            from: currentUser.username,
                            text: msg.text,
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

async function clearOldBlobUrls() {
    // Очищаем localStorage от старых blob URL
    try {
        const encryptedData = localStorage.getItem('chats_data');
        if (encryptedData) {
            const key = await generateKey();
            const decrypted = await decryptData(JSON.parse(encryptedData), key);
            let needUpdate = false;
            
            for (const [username, chatData] of decrypted) {
                if (chatData.avatar && !chatData.avatar.startsWith('data:') && !chatData.avatar.startsWith('http')) {
                    console.log('Найден устаревший blob URL для:', username);
                    chatData.avatar = await loadUserAvatar(username, null);
                    needUpdate = true;
                }
            }
            
            if (needUpdate) {
                const newEncrypted = await encryptData(decrypted, key);
                localStorage.setItem('chats_data', JSON.stringify(newEncrypted));
                console.log('Очищены устаревшие blob URL');
            }
        }
    } catch (error) {
        console.error('Ошибка очистки blob URL:', error);
    }
}

async function init() {
    await clearOldBlobUrls();
    await loadCurrentUser();
    await loadChats();
    await initPeer();
    await syncChatsFromServer();
    updateUI();
    setupEventListeners();
    startMessageChecker();
}

init();
