let currentUser = null;
let currentChat = null;
let peer = null;
let connections = new Map();
let chats = new Map();
let encryptionKey = null;
let offlineCheckInterval = null;
let telegramClient = null;
let telegramReady = false;
let telegramCredentials = null;
let telegramAuthState = null;
let telegramUsers = new Map();
let telegramAuthRequested = false;
let telegramSyncInProgress = false;

const TELEGRAM_CHAT_PREFIX = 'tg:';
const TELEGRAM_CHAT_LIST_MAIN = { '@type': 'chatListMain' };
const TELEGRAM_WASM_PATH = '/telegram-react/2a79a539dfbe607fd685d6ccdd16b5df.wasm';
const TELEGRAM_SYNC_LIMIT = 50;

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

function isTelegramChat(chatKey) {
    return typeof chatKey === 'string' && chatKey.startsWith(TELEGRAM_CHAT_PREFIX);
}

function getTelegramChatKey(chatId) {
    return `${TELEGRAM_CHAT_PREFIX}${chatId}`;
}

function getTelegramChatId(chatKey) {
    if (!isTelegramChat(chatKey)) return null;
    const rawId = Number(chatKey.slice(TELEGRAM_CHAT_PREFIX.length));
    return Number.isFinite(rawId) ? rawId : null;
}

function ensureChatShape(chatData = {}, chatKey = '') {
    const provider = chatData.provider || (isTelegramChat(chatKey) ? 'telegram' : 'peer');
    return {
        messages: Array.isArray(chatData.messages) ? chatData.messages : [],
        avatar: chatData.avatar || null,
        lastMessage: chatData.lastMessage || '',
        source: chatData.source || 'me',
        provider,
        title: chatData.title || '',
        subtitle: chatData.subtitle || '',
        telegramChatId: chatData.telegramChatId || getTelegramChatId(chatKey),
        telegramUserId: chatData.telegramUserId || null,
        unreadCount: Number.isFinite(chatData.unreadCount) ? chatData.unreadCount : 0
    };
}

function ensureChatEntry(chatKey, overrides = {}) {
    const current = ensureChatShape(chats.get(chatKey), chatKey);
    const next = {
        ...current,
        ...overrides
    };

    if (!Array.isArray(next.messages)) {
        next.messages = current.messages;
    }

    chats.set(chatKey, next);
    return next;
}

function getChatDisplayName(chatKey, chatData) {
    if (chatData?.provider === 'telegram') {
        return chatData.title || `Telegram ${chatData.telegramChatId || ''}`.trim();
    }

    return chatKey;
}

function getChatStatusText(chatKey, chatData) {
    if (chatData?.provider === 'telegram') {
        return chatData.subtitle || 'Telegram';
    }

    return '';
}

function getTelegramClientClass() {
    if (!window.tdweb) {
        throw new Error('tdweb не загружен');
    }

    return window.tdweb.default || window.tdweb;
}

async function loadTelegramCredentials() {
    if (telegramCredentials) {
        return telegramCredentials;
    }

    const response = await fetch('/app_cred.php', {
        credentials: 'same-origin'
    });

    if (!response.ok) {
        throw new Error(`Не удалось загрузить app_cred.php (${response.status})`);
    }

    telegramCredentials = await response.json();
    return telegramCredentials;
}

async function telegramSend(query) {
    if (!telegramClient) {
        throw new Error('Telegram client не инициализирован');
    }

    return telegramClient.send(query);
}

async function ensureTelegramUser(userId) {
    if (!userId) return null;
    if (telegramUsers.has(userId)) {
        return telegramUsers.get(userId);
    }

    try {
        const user = await telegramSend({
            '@type': 'getUser',
            user_id: userId
        });

        telegramUsers.set(userId, user);
        return user;
    } catch (error) {
        console.error('Ошибка получения пользователя Telegram:', error);
        return null;
    }
}

function getTelegramUserLabel(user) {
    if (!user) return 'Telegram';

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (user.usernames?.active_usernames?.length) return user.usernames.active_usernames[0];
    if (user.username) return user.username;
    return `User ${user.id}`;
}

function getTelegramMessageText(content) {
    if (!content) return 'Сообщение';

    switch (content['@type']) {
        case 'messageText':
            return content.text?.text || '';
        case 'messagePhoto':
            return content.caption?.text || 'Фото';
        case 'messageVideo':
            return content.caption?.text || 'Видео';
        case 'messageAnimation':
            return content.caption?.text || 'GIF';
        case 'messageDocument':
            return content.caption?.text || content.document?.file_name || 'Файл';
        case 'messageSticker':
            return content.sticker?.emoji ? `Стикер ${content.sticker.emoji}` : 'Стикер';
        case 'messageVoiceNote':
            return 'Голосовое сообщение';
        case 'messageAudio':
            return content.caption?.text || content.audio?.title || 'Аудио';
        case 'messageCall':
            return 'Звонок';
        default:
            return 'Сообщение';
    }
}

function getTelegramChatSubtitle(chat) {
    if (!chat || !chat.type) {
        return 'Telegram';
    }

    if (chat.unread_count > 0) {
        return `${chat.unread_count} непрочитанных`;
    }

    switch (chat.type['@type']) {
        case 'chatTypePrivate':
            return 'Telegram';
        case 'chatTypeBasicGroup':
            return 'Группа';
        case 'chatTypeSupergroup':
            return chat.type.is_channel ? 'Канал' : 'Супергруппа';
        case 'chatTypeSecret':
            return 'Секретный чат';
        default:
            return 'Telegram';
    }
}

async function getTelegramSenderName(message, chatData) {
    if (message?.is_outgoing) {
        return currentUser?.username || 'Вы';
    }

    const senderId = message?.sender_id;
    if (!senderId) {
        return chatData?.title || 'Telegram';
    }

    if (senderId['@type'] === 'messageSenderUser') {
        const user = await ensureTelegramUser(senderId.user_id);
        return getTelegramUserLabel(user);
    }

    return chatData?.title || 'Telegram';
}

async function normalizeTelegramMessage(message, chatData = null) {
    if (!message) return null;

    const text = getTelegramMessageText(message.content);
    const sender = await getTelegramSenderName(message, chatData);

    return {
        id: message.id,
        text,
        time: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        sender,
        receiver: message.is_outgoing ? (chatData?.title || 'Telegram') : (currentUser?.username || 'me'),
        isRead: message.is_outgoing ? true : currentChat === getTelegramChatKey(message.chat_id),
        isDelivered: true,
        provider: 'telegram'
    };
}

function setTelegramModalContent(html) {
    const container = document.getElementById('telegramAuthContainer');
    if (!container) return null;
    container.innerHTML = html;
    container.style.display = 'block';
    return container;
}

function resetNewChatModalView() {
    const input = document.getElementById('newChatUsername');
    const authContainer = document.getElementById('telegramAuthContainer');
    const connectBtn = document.getElementById('connectTelegramBtn');
    const createBtn = document.getElementById('createChatConfirmBtn');

    if (input) {
        input.style.display = '';
        input.value = '';
    }

    if (authContainer) {
        authContainer.style.display = 'none';
        authContainer.innerHTML = '';
    }

    if (connectBtn) {
        connectBtn.textContent = telegramReady ? 'Синхронизировать Telegram' : 'Telegram';
        connectBtn.style.display = '';
    }

    if (createBtn) {
        createBtn.style.display = '';
    }
}

async function submitTelegramTdlibParameters() {
    const config = await loadTelegramCredentials();
    const apiId = Number(config.telegram?.api_id);
    const apiHash = config.telegram?.api_hash;

    await telegramSend({
        '@type': 'setTdlibParameters',
        parameters: {
            '@type': 'tdParameters',
            use_test_dc: false,
            api_id: apiId,
            api_hash: apiHash,
            system_language_code: navigator.language || 'ru',
            device_model: config.device_model || 'Web',
            system_version: config.system_version || navigator.userAgent,
            application_version: config.version || '1.0.0',
            use_secret_chats: false,
            use_message_database: true,
            use_file_database: false,
            database_directory: '/db',
            files_directory: '/'
        }
    });

    await telegramSend({
        '@type': 'setOption',
        name: 'use_quick_ack',
        value: {
            '@type': 'optionValueBoolean',
            value: true
        }
    });
}

async function loadTelegramProfile() {
    try {
        const me = await telegramSend({ '@type': 'getMe' });
        telegramUsers.set(me.id, me);
    } catch (error) {
        console.error('Ошибка загрузки профиля Telegram:', error);
    }
}

async function upsertTelegramChat(chatId) {
    const chat = await telegramSend({
        '@type': 'getChat',
        chat_id: chatId
    });

    const chatKey = getTelegramChatKey(chat.id);
    const existing = ensureChatEntry(chatKey, {
        provider: 'telegram',
        source: 'telegram',
        title: chat.title || 'Telegram',
        subtitle: getTelegramChatSubtitle(chat),
        telegramChatId: chat.id,
        unreadCount: chat.unread_count || 0
    });

    if (chat.last_message) {
        const lastMessage = await normalizeTelegramMessage(chat.last_message, existing);
        if (lastMessage) {
            const existingIndex = existing.messages.findIndex(message => message.id === lastMessage.id);
            if (existingIndex === -1) {
                existing.messages.push(lastMessage);
            } else {
                existing.messages[existingIndex] = lastMessage;
            }

            existing.messages.sort((a, b) => new Date(a.time) - new Date(b.time));
            existing.lastMessage = lastMessage.text.substring(0, 50);
        }
    }

    chats.set(chatKey, existing);
    return existing;
}

async function loadTelegramChatHistory(chatKey, limit = 50) {
    const chatData = chats.get(chatKey);
    if (!chatData?.telegramChatId) return;

    try {
        const history = await telegramSend({
            '@type': 'getChatHistory',
            chat_id: chatData.telegramChatId,
            from_message_id: 0,
            offset: 0,
            limit,
            only_local: false
        });

        const messages = [];
        for (const message of history.messages || []) {
            const normalized = await normalizeTelegramMessage(message, chatData);
            if (normalized) {
                messages.push(normalized);
            }
        }

        const next = ensureChatEntry(chatKey, {
            provider: 'telegram',
            messages: messages.sort((a, b) => new Date(a.time) - new Date(b.time)),
            lastMessage: messages.length ? messages[messages.length - 1].text.substring(0, 50) : chatData.lastMessage
        });

        next.unreadCount = 0;
        await saveToLocalStorage();

        if (currentChat === chatKey) {
            displayChatMessages(chatKey);
        }
    } catch (error) {
        console.error('Ошибка загрузки истории Telegram:', error);
    }
}

async function syncTelegramChats() {
    if (!telegramReady || telegramSyncInProgress) return;

    telegramSyncInProgress = true;

    try {
        await telegramSend({
            '@type': 'loadChats',
            chat_list: TELEGRAM_CHAT_LIST_MAIN,
            limit: TELEGRAM_SYNC_LIMIT
        }).catch(() => null);

        const result = await telegramSend({
            '@type': 'getChats',
            chat_list: TELEGRAM_CHAT_LIST_MAIN,
            limit: TELEGRAM_SYNC_LIMIT
        });

        for (const chatId of result.chat_ids || []) {
            await upsertTelegramChat(chatId);
        }

        await saveToLocalStorage();
        await refreshChatsList();
    } catch (error) {
        console.error('Ошибка синхронизации Telegram-чатов:', error);
    } finally {
        telegramSyncInProgress = false;
    }
}

async function handleTelegramAuthorizationState(state) {
    telegramAuthState = state;

    if (!state) {
        return;
    }

    if (state['@type'] === 'authorizationStateWaitTdlibParameters') {
        await submitTelegramTdlibParameters();
        return;
    }

    telegramReady = state['@type'] === 'authorizationStateReady';

    if (telegramReady) {
        await loadTelegramProfile();
        await syncTelegramChats();

        if (telegramAuthRequested) {
            closeModal();
        }
    }

    if (telegramAuthRequested) {
        renderTelegramAuthState();
    } else {
        resetNewChatModalView();
    }
}

async function handleTelegramUpdate(update) {
    switch (update['@type']) {
        case 'updateAuthorizationState':
            await handleTelegramAuthorizationState(update.authorization_state);
            break;
        case 'updateNewMessage': {
            const chatKey = getTelegramChatKey(update.message.chat_id);
            const chatData = await upsertTelegramChat(update.message.chat_id);
            const normalized = await normalizeTelegramMessage(update.message, chatData);
            if (!normalized) break;
            await saveMessage(chatKey, normalized);
            const next = chats.get(chatKey);
            if (next) {
                next.unreadCount = update.message.is_outgoing ? next.unreadCount : (next.unreadCount || 0) + (currentChat === chatKey ? 0 : 1);
            }
            if (currentChat === chatKey) {
                displayChatMessages(chatKey);
            }
            await refreshChatsList();
            if (!update.message.is_outgoing) {
                playNotification();
            }
            break;
        }
        case 'updateChatLastMessage':
        case 'updateChatTitle':
        case 'updateChatPosition':
        case 'updateChatReadInbox':
            if (update.chat_id) {
                await upsertTelegramChat(update.chat_id);
                await refreshChatsList();
            }
            break;
    }
}

async function ensureTelegramClient() {
    if (telegramClient) {
        return telegramClient;
    }

    await loadTelegramCredentials();

    const TdWeb = getTelegramClientClass();
    telegramClient = new TdWeb({
        logVerbosityLevel: 0,
        jsLogVerbosityLevel: 0,
        mode: 'wasm',
        instanceName: `uran_${currentUser?.id || 'default'}_telegram`,
        readOnly: false,
        isBackground: false,
        useDatabase: true,
        wasmUrl: TELEGRAM_WASM_PATH
    });

    telegramClient.onUpdate = (update) => {
        handleTelegramUpdate(update).catch(error => {
            console.error('Telegram update error:', error);
        });
    };

    return telegramClient;
}

function renderTelegramAuthState() {
    if (!telegramAuthRequested) {
        return;
    }

    const input = document.getElementById('newChatUsername');
    const connectBtn = document.getElementById('connectTelegramBtn');
    const createBtn = document.getElementById('createChatConfirmBtn');
    if (input) input.style.display = 'none';
    if (connectBtn) connectBtn.style.display = 'none';
    if (createBtn) createBtn.style.display = 'none';

    if (!telegramAuthState) {
        setTelegramModalContent('<div style="padding:12px; color:#fff;">Запуск Telegram...</div>');
        return;
    }

    const type = telegramAuthState['@type'];

    if (type === 'authorizationStateWaitPhoneNumber' || type === 'authorizationStateWaitTdlib') {
        const container = setTelegramModalContent(`
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div style="color:#fff; font-weight:600;">Вход в Telegram</div>
                <input id="telegramPhoneInput" type="tel" class="modal-input" placeholder="+79991234567">
                <div style="display:flex; gap:8px;">
                    <button type="button" class="modal-btn confirm" id="telegramPhoneSubmit">Далее</button>
                    <button type="button" class="modal-btn cancel" id="telegramQrSubmit">QR</button>
                </div>
            </div>
        `);

        container.querySelector('#telegramPhoneSubmit')?.addEventListener('click', async () => {
            const phone = container.querySelector('#telegramPhoneInput')?.value.trim();
            if (!phone) {
                alert('Введите номер телефона');
                return;
            }

            try {
                await telegramSend({
                    '@type': 'setAuthenticationPhoneNumber',
                    phone_number: phone,
                    settings: {
                        '@type': 'phoneNumberAuthenticationSettings',
                        allow_flash_call: false,
                        allow_missed_call: false,
                        is_current_phone_number: false,
                        allow_sms_retriever_api: false
                    }
                });
            } catch (error) {
                console.error('Ошибка отправки номера Telegram:', error);
                alert(error.message || 'Не удалось отправить номер');
            }
        });

        container.querySelector('#telegramQrSubmit')?.addEventListener('click', async () => {
            try {
                await telegramSend({
                    '@type': 'requestQrCodeAuthentication',
                    other_user_ids: []
                });
            } catch (error) {
                console.error('Ошибка запроса QR:', error);
                alert(error.message || 'Не удалось запросить QR');
            }
        });

        return;
    }

    if (type === 'authorizationStateWaitCode') {
        const container = setTelegramModalContent(`
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div style="color:#fff; font-weight:600;">Код Telegram</div>
                <input id="telegramCodeInput" type="text" class="modal-input" placeholder="Введите код">
                <button type="button" class="modal-btn confirm" id="telegramCodeSubmit">Подтвердить</button>
            </div>
        `);

        container.querySelector('#telegramCodeSubmit')?.addEventListener('click', async () => {
            const code = container.querySelector('#telegramCodeInput')?.value.trim();
            if (!code) {
                alert('Введите код');
                return;
            }

            try {
                await telegramSend({
                    '@type': 'checkAuthenticationCode',
                    code
                });
            } catch (error) {
                console.error('Ошибка подтверждения кода Telegram:', error);
                alert(error.message || 'Неверный код');
            }
        });

        return;
    }

    if (type === 'authorizationStateWaitPassword') {
        const container = setTelegramModalContent(`
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div style="color:#fff; font-weight:600;">Пароль Telegram</div>
                <input id="telegramPasswordInput" type="password" class="modal-input" placeholder="Пароль 2FA">
                <button type="button" class="modal-btn confirm" id="telegramPasswordSubmit">Войти</button>
            </div>
        `);

        container.querySelector('#telegramPasswordSubmit')?.addEventListener('click', async () => {
            const password = container.querySelector('#telegramPasswordInput')?.value;
            if (!password) {
                alert('Введите пароль');
                return;
            }

            try {
                await telegramSend({
                    '@type': 'checkAuthenticationPassword',
                    password
                });
            } catch (error) {
                console.error('Ошибка подтверждения пароля Telegram:', error);
                alert(error.message || 'Неверный пароль');
            }
        });

        return;
    }

    if (type === 'authorizationStateWaitOtherDeviceConfirmation') {
        setTelegramModalContent(`
            <div style="display:flex; flex-direction:column; gap:10px; color:#fff;">
                <div style="font-weight:600;">Подтвердите вход в Telegram</div>
                <a href="${telegramAuthState.link}" target="_blank" rel="noopener" style="color:#8ecaff; word-break:break-all;">${telegramAuthState.link}</a>
                <div style="font-size:13px; opacity:0.85;">Откройте ссылку в приложении Telegram или запросите вход по номеру телефона.</div>
            </div>
        `);
        return;
    }

    if (type === 'authorizationStateReady') {
        setTelegramModalContent('<div style="padding:12px; color:#fff;">Telegram подключен. Синхронизирую чаты...</div>');
        return;
    }

    setTelegramModalContent('<div style="padding:12px; color:#fff;">Ожидание ответа Telegram...</div>');
}

async function startTelegramFlow() {
    telegramAuthRequested = true;
    renderTelegramAuthState();

    try {
        await ensureTelegramClient();
        if (telegramAuthState) {
            renderTelegramAuthState();
        }
    } catch (error) {
        console.error('Ошибка инициализации Telegram:', error);
        setTelegramModalContent(`<div style="padding:12px; color:#fff;">${error.message || 'Не удалось запустить Telegram'}</div>`);
    }
}

async function sendTelegramMessage(chatKey, text) {
    const chatData = chats.get(chatKey);
    if (!chatData?.telegramChatId) {
        throw new Error('Чат Telegram не найден');
    }

    const result = await telegramSend({
        '@type': 'sendMessage',
        chat_id: chatData.telegramChatId,
        input_message_content: {
            '@type': 'inputMessageText',
            text: {
                '@type': 'formattedText',
                text: text.trim(),
                entities: []
            },
            clear_draft: true
        }
    });

    const normalized = await normalizeTelegramMessage(result, chatData);
    if (normalized) {
        await saveMessage(chatKey, normalized);
        displayChatMessages(chatKey);
    }

    await refreshChatsList();
}

function getPeerId(username) {
    return `${username}-uranchat`;
}

function getInitials(username) {
    return (username || '?').charAt(0).toUpperCase();
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
            console.error('Нет активной сессии, перенаправление на страницу входа');
            window.location.href = '/';
            return;
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        window.location.href = '/';
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
            lastMessage: '',
            provider: 'peer'
        });
        await saveToLocalStorage();
        await refreshChatsList();
    }
}

async function sendMessage(text) {
    if (!currentChat || !text.trim() || !currentUser) return;

    if (isTelegramChat(currentChat)) {
        await sendTelegramMessage(currentChat, text);

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
        }
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
            lastMessage: '',
            provider: isTelegramChat(chatWith) ? 'telegram' : 'peer'
        });
    }

    const chat = ensureChatEntry(chatWith);
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
        const dataToSave = Array.from(chats.entries()).map(([username, chatData]) => [
            username,
            {
                messages: chatData.messages,
                avatar: chatData.avatar,
                lastMessage: chatData.lastMessage,
                source: chatData.source,
                provider: chatData.provider,
                title: chatData.title,
                subtitle: chatData.subtitle,
                telegramChatId: chatData.telegramChatId,
                telegramUserId: chatData.telegramUserId,
                unreadCount: chatData.unreadCount
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
            chats = new Map(
                decrypted.map(([chatKey, chatData]) => [
                    chatKey,
                    ensureChatShape(chatData, chatKey)
                ])
            );
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
                        provider: 'peer',
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
                provider: 'peer',
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

    for (const [username, chatData] of sortedChats) {
        const userInfo = chatData.provider === 'telegram'
            ? { success: true, username: getChatDisplayName(username, chatData), photo: null }
            : await fetchUserInfo(username);
        const chatItem = createChatItem(username, chatData, userInfo);
        chatsList.appendChild(chatItem);
    }

    if (chats.size === 0) {
        chatsList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">Нет чатов. Нажмите + чтобы добавить</div>';
    }
}

function createChatItem(username, chatData, userInfo) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.dataset.chatKey = username;
    if (currentChat === username) div.classList.add('active');

    const displayName = getChatDisplayName(username, chatData);

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
    avatarDiv.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
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

    if (chatData.provider !== 'telegram' && userInfo && userInfo.photo) {
        loadChatAvatar(username, userInfo.photo, avatarImg, initialsSpan);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'chat-name';
    nameDiv.textContent = displayName;

    const lastMsgDiv = document.createElement('div');
    lastMsgDiv.className = 'last-message';
    const lastMsg = chatData.lastMessage || 'Нет сообщений';
    lastMsgDiv.textContent = lastMsg.length > 50 ? lastMsg.substring(0, 47) + '...' : lastMsg;

    const unreadCount = chatData.provider === 'telegram'
        ? (chatData.unreadCount || 0)
        : chatData.messages.filter(m => m.sender === username && !m.isRead).length;
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

    div.onclick = () => {
        openChat(username);
    };

    return div;
}

async function openChat(username) {
    currentChat = username;

    const chatData = ensureChatShape(chats.get(username), username);
    const displayName = getChatDisplayName(username, chatData);
    const isTelegram = chatData.provider === 'telegram';

    const headerName = document.getElementById('chatHeaderName');
    const headerAvatar = document.getElementById('chatHeaderAvatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    if (headerName) headerName.textContent = displayName;
    if (headerAvatar) {
        headerAvatar.innerHTML = '';
        headerAvatar.textContent = getInitials(displayName);
        headerAvatar.style.display = 'flex';
        headerAvatar.style.alignItems = 'center';
        headerAvatar.style.justifyContent = 'center';
        headerAvatar.style.fontSize = '20px';
        headerAvatar.style.fontWeight = 'bold';
        headerAvatar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        headerAvatar.style.color = 'white';
        headerAvatar.style.width = '45px';
        headerAvatar.style.height = '45px';
        headerAvatar.style.borderRadius = '50%';

        if (!isTelegram) {
            fetchUserInfo(username).then(userInfo => {
                if (userInfo && userInfo.photo) {
                    loadUserAvatar(username, userInfo.photo).then(avatarDataUrl => {
                        if (avatarDataUrl) {
                            headerAvatar.innerHTML = '';
                            const img = document.createElement('img');
                            img.src = avatarDataUrl;
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.borderRadius = '50%';
                            img.style.objectFit = 'cover';
                            headerAvatar.appendChild(img);
                            console.log(`Аватар загружен для шапки чата: ${username}`);
                        }
                    });
                }
            });
        }
    }
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    displayChatMessages(username);

    if (isTelegram) {
        const statusDiv = document.getElementById('chatHeaderStatus');
        if (statusDiv) {
            statusDiv.textContent = getChatStatusText(username, chatData);
            statusDiv.style.color = '#4caf50';
        }
        await loadTelegramChatHistory(username);
    } else {
        const peerId = getPeerId(username);
        const conn = connections.get(peerId);
        updateConnectionStatus(conn && conn.open);
    }

    const chat = chats.get(username);
    if (chat) {
        const unreadMessages = chat.messages.filter(m => m.sender !== currentUser.username && !m.isRead);
        for (const msg of unreadMessages) {
            msg.isRead = true;
        }
        if (isTelegram) {
            chat.unreadCount = 0;
        }
        saveToLocalStorage();
    }

    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.chatKey === username) {
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
        if (item.dataset.chatKey === username) {
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
    if (modal) modal.classList.add('active');
    telegramAuthRequested = false;
    resetNewChatModalView();
}

function closeModal() {
    const modal = document.getElementById('newChatModal');
    if (modal) modal.classList.remove('active');
    telegramAuthRequested = false;
    resetNewChatModalView();
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
    const connectTelegramBtn = document.getElementById('connectTelegramBtn');

    if (newChatBtn) newChatBtn.onclick = showNewChatModal;
    if (connectTelegramBtn) {
        connectTelegramBtn.onclick = () => {
            startTelegramFlow();
        };
    }
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
            if (currentChat && !isTelegramChat(currentChat)) {
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

async function init() {
    await loadCurrentUser();
    await loadChats();
    await initPeer();
    await syncChatsFromServer();
    updateUI();
    setupEventListeners();
    startOfflineMessageChecker();
    ensureTelegramClient().catch(error => {
        console.warn('Telegram не инициализирован автоматически:', error);
    });
}

init();
