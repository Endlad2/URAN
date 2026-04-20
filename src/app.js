let currentUser = null;
let currentChat = null;
let peer = null;
let connections = new Map();
let chats = new Map();
let encryptionKey = null;
let offlineCheckInterval = null;

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
        const peer = currentChat.replace('tg_', '');
        const success = await sendTelegramMessage(peer, text);
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

    const chatData = chats.get(chatWith);
    const existingIndex = chatData.messages.findIndex(m => m.id === message.id);

    if (existingIndex !== -1) {
        chatData.messages[existingIndex] = message;
    } else {
        chatData.messages.push(message);
    }

    chatData.lastMessage = message.text.substring(0, 50);
    chatData.messages.sort((a, b) => new Date(a.time) - new Date(b.time));

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
        const dataToSave = Array.from(chats.entries()).map(([username, chatData]) => [
            username,
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

async function loadChatAvatar(username, photoUrl, avatarImg, initialsSpan) {
    if (!photoUrl || !avatarImg) return false;

    console.log(`Загрузка аватара для чата: ${username}`);
    const avatarDataUrl = await loadUserAvatar(username, photoUrl);
    if (avatarDataUrl) {
        avatarImg.src = avatarDataUrl;
        avatarImg.style.display = 'block';
        if (initialsSpan) {
            initialsSpan.style.display = 'none';
        }
        console.log(`Аватар загружен для ${username}`);
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
            displayName = chatData.tgData.name || chatId;
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
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'chat-name';
    nameDiv.textContent = displayName;
    
    // Иконка мессенджера после имени чата
    const messengerIcon = document.createElement('img');
    messengerIcon.style.width = '16px';
    messengerIcon.style.height = '16px';
    messengerIcon.style.marginLeft = '8px';
    messengerIcon.style.verticalAlign = 'middle';
    messengerIcon.style.borderRadius = '50%';
    
    if (chatData.source === 'telegram') {
        messengerIcon.src = 'https://www.uran-chat.space/tg.ico';
        messengerIcon.title = 'Telegram';
    } else {
        messengerIcon.src = 'https://www.uran-chat.space/favicon.ico';
        messengerIcon.title = 'Uran Chat';
    }
    nameDiv.appendChild(messengerIcon);
    
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
    const currentChatData = chats.get(chatId);
    
    if (currentChatData && currentChatData.source === 'telegram' && currentChatData.tgData) {
        displayName = currentChatData.tgData.name || chatId;
        if (headerName) headerName.textContent = displayName;
        
        const statusDiv = document.getElementById('chatHeaderStatus');
        if (statusDiv) {
            statusDiv.textContent = 'Telegram';
            statusDiv.style.color = '#888';
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
        
        if (currentChatData && currentChatData.source === 'telegram') {
            headerAvatar.style.background = '#29a9e9';
        } else {
            headerAvatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
        headerAvatar.style.color = 'white';
        headerAvatar.style.width = '45px';
        headerAvatar.style.height = '45px';
        headerAvatar.style.borderRadius = '50%';
        
        if (currentChatData && currentChatData.avatar) {
            const img = document.createElement('img');
            img.src = currentChatData.avatar;
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
    
    const peerId = getPeerId(chatId);
    const conn = connections.get(peerId);
    updateConnectionStatus(conn && conn.open);
    
    if (currentChatData) {
        const unreadMessages = currentChatData.messages.filter(m => m.sender === chatId && !m.isRead);
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
    
    // Загружаем сообщения Telegram если это Telegram чат
    if (currentChatData && currentChatData.source === 'telegram') {
        const session = await loadTelegramSession();
        if (session) {
            const peer = chatId.replace('tg_', '');
            const tgMessages = await getTelegramMessages(peer);
            if (tgMessages && tgMessages.length > 0) {
                for (const msg of tgMessages) {
                    const exists = currentChatData.messages.some(m => m.id === msg.id);
                    if (!exists) {
                        await saveMessage(chatId, msg);
                    }
                }
                await displayChatMessages(chatId);
            }
        }
    }
}

function displayChatMessages(chatId) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    const chatData = chats.get(chatId);
    if (chatData && chatData.messages) {
        for (const msg of chatData.messages) {
            let displayText = msg.text;
            
            displayMessage({ ...msg, text: displayText });
        }
    }
    
    container.scrollTop = container.scrollHeight;
}

function displayMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container || !currentUser) return;
    
    const messageDiv = document.createElement('div');
    const isSent = message.sender === currentUser.username;
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

function startOfflineMessageChecker() {
    if (offlineCheckInterval) {
        clearInterval(offlineCheckInterval);
    }
    offlineCheckInterval = setInterval(async () => {
        await checkOfflineMessages();
    }, 5000);
    console.log('Запущена проверка офлайн сообщений (каждые 5 секунд)');
}

// ==================== Telegram Integration ====================

async function initTelegramIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('UranTelegramDB', 1);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'userId' });
            }
        };
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            console.log('IndexedDB инициализирована для Telegram');
            resolve(db);
        };
        
        request.onerror = (event) => {
            console.error('Ошибка открытия IndexedDB:', event);
            reject(event);
        };
    });
}

async function loadTelegramSession() {
    return new Promise((resolve) => {
        if (!currentUser) {
            resolve(null);
            return;
        }
        
        const request = indexedDB.open('UranTelegramDB', 1);
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['sessions'], 'readonly');
            const store = transaction.objectStore('sessions');
            const getRequest = store.get(currentUser.id.toString());
            
            getRequest.onsuccess = () => {
                if (getRequest.result) {
                    console.log('Telegram сессия загружена из IndexedDB');
                    resolve(getRequest.result.sessionData);
                } else {
                    resolve(null);
                }
            };
            
            getRequest.onerror = () => {
                resolve(null);
            };
        };
        
        request.onerror = () => {
            resolve(null);
        };
    });
}

async function saveTelegramSession(sessionData) {
    return new Promise((resolve) => {
        if (!currentUser) {
            resolve(false);
            return;
        }
        
        const request = indexedDB.open('UranTelegramDB', 1);
        
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['sessions'], 'readwrite');
            const store = transaction.objectStore('sessions');
            const putRequest = store.put({
                userId: currentUser.id.toString(),
                sessionData: sessionData,
                updatedAt: Date.now()
            });
            
            putRequest.onsuccess = () => {
                console.log('Telegram сессия сохранена в IndexedDB');
                resolve(true);
            };
            
            putRequest.onerror = () => {
                console.error('Ошибка сохранения сессии');
                resolve(false);
            };
        };
        
        request.onerror = () => {
            resolve(false);
        };
    });
}

async function getTelegramDialogs() {
    const session = await loadTelegramSession();
    if (!session) return [];
    
    try {
        const response = await fetch('/tg-api-proxy.php?action=get-dialogs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                session_data: session,
                limit: 100
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            for (const dialog of result.data) {
                const chatId = `tg_${dialog.id}`;
                if (!chats.has(chatId)) {
                    chats.set(chatId, {
                        messages: [],
                        avatar: null,
                        lastMessage: '',
                        source: 'telegram',
                        tgData: {
                            id: dialog.id,
                            name: dialog.name,
                            unread: dialog.unread || 0
                        }
                    });
                }
            }
            await saveToLocalStorage();
            await refreshChatsList();
            return result.data;
        }
    } catch (error) {
        console.error('Ошибка получения диалогов Telegram:', error);
    }
    return [];
}

async function getTelegramMessages(peer, limit = 100) {
    const session = await loadTelegramSession();
    if (!session) return [];
    
    try {
        const response = await fetch('/tg-api-proxy.php?action=get-messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_data: session,
                peer: peer,
                limit: limit
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            const formattedMessages = [];
            for (const msg of result.data) {
                formattedMessages.push({
                    id: msg.id,
                    text: msg.text || '[Медиа]',
                    time: new Date(msg.date * 1000).toISOString(),
                    sender: msg.out ? currentUser.username : `tg_${peer}`,
                    receiver: msg.out ? `tg_${peer}` : currentUser.username,
                    isRead: true,
                    isDelivered: true
                });
            }
            return formattedMessages;
        }
    } catch (error) {
        console.error('Ошибка получения сообщений Telegram:', error);
    }
    return [];
}

async function sendTelegramMessage(peer, text) {
    const session = await loadTelegramSession();
    if (!session) return false;
    
    try {
        const response = await fetch('/tg-api-proxy.php?action=send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_data: session,
                peer: peer,
                message: text
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const message = {
                id: Date.now(),
                text: text,
                time: new Date().toISOString(),
                sender: currentUser.username,
                receiver: `tg_${peer}`,
                isRead: true,
                isDelivered: true
            };
            await saveMessage(`tg_${peer}`, message);
            displayMessage(message);
            return true;
        }
    } catch (error) {
        console.error('Ошибка отправки сообщения в Telegram:', error);
    }
    return false;
}

function openTelegramConnectWindow() {
    const tgWindow = window.open('/connect-telegram.php', 'telegram_auth', 'width=500,height=650');
    
    window.addEventListener('message', async (event) => {
        if (event.data.type === 'telegram_connected') {
            console.log('Telegram подключен:', event.data.user);
            if (event.data.session) {
                await saveTelegramSession(event.data.session);
            }
            await getTelegramDialogs();
            showTelegramStatus('Telegram аккаунт успешно подключен!', 'success');
        }
    });
}

function showTelegramStatus(message, type) {
    let statusDiv = document.getElementById('telegram-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'telegram-status';
        statusDiv.style.cssText = 'position: fixed; bottom: 20px; right: 20px; padding: 10px 20px; border-radius: 10px; z-index: 1000; background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);';
        document.body.appendChild(statusDiv);
    }
    statusDiv.textContent = message;
    statusDiv.style.background = type === 'error' ? '#f8d7da' : (type === 'success' ? '#d4edda' : '#d1ecf1');
    statusDiv.style.color = type === 'error' ? '#721c24' : (type === 'success' ? '#155724' : '#0c5460');
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        if (statusDiv) statusDiv.style.display = 'none';
    }, 3000);
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
        const session = await loadTelegramSession();
        if (session) {
            if (confirm('У вас уже есть подключенный Telegram аккаунт. Хотите переподключиться?')) {
                openTelegramConnectWindow();
            }
        } else {
            openTelegramConnectWindow();
        }
    };
    
    sidebarHeader.appendChild(tgConnectBtn);
}

async function init() {
    await loadCurrentUser();
    await loadChats();
    await initPeer();
    await syncChatsFromServer();
    updateUI();
    setupEventListeners();
    startOfflineMessageChecker();
    await initTelegramIndexedDB();
    addTelegramConnectButton();
    
    const tgSession = await loadTelegramSession();
    if (tgSession) {
        await getTelegramDialogs();
    }
}

init();
