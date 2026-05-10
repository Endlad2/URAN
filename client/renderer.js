(function() {
  let currentPhone = '';
  let currentAppId = '';
  let currentAppHash = '';
  let isConfigured = false;
  let isAuthorized = false;
  let currentChatId = null;
  let currentChatName = '';
  let currentUserId = null;
  let chatsList = [];
  let messagesCache = {};
  let avatarCache = {};
  let mediaCache = {};
  let currentMessagesLimit = 50;
  let isLoadingMoreMessages = false;
  let hasMoreMessages = true;

  const elements = {
    logoContainer: document.getElementById('logoContainer'),
    initialNextBtn: document.getElementById('initialNextBtn'),
    instructionContainer: document.getElementById('instructionContainer'),
    appIdInput: document.getElementById('appIdInput'),
    appHashInput: document.getElementById('appHashInput'),
    configNextBtn: document.getElementById('configNextBtn'),
    configError: document.getElementById('configError'),
    phoneContainer: document.getElementById('phoneContainer'),
    phoneInput: document.getElementById('phoneInput'),
    phoneNextBtn: document.getElementById('phoneNextBtn'),
    phoneError: document.getElementById('phoneError'),
    codeContainer: document.getElementById('codeContainer'),
    codeInput: document.getElementById('codeInput'),
    codeNextBtn: document.getElementById('codeNextBtn'),
    codeError: document.getElementById('codeError'),
    successContainer: document.getElementById('successContainer'),
    successNextBtn: document.getElementById('successNextBtn'),
    messengerContainer: document.getElementById('messengerContainer'),
    chatsList: document.getElementById('chatsList'),
    chatAvatar: document.getElementById('chatAvatar'),
    chatName: document.getElementById('chatName'),
    messagesArea: document.getElementById('messagesArea'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton')
  };

  function hideAll() {
    const containers = [
      elements.logoContainer,
      elements.instructionContainer,
      elements.phoneContainer,
      elements.codeContainer,
      elements.successContainer,
      elements.messengerContainer
    ];
    containers.forEach(container => {
      if (container) {
        container.style.display = 'none';
      }
    });
  }

  function showContainer(container) {
    if (!container) return;
    container.style.display = 'flex';
  }

  function showLoadingSpinner(element, size = 32) {
    if (!element) return;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    let angle = 0;
    const spinner = setInterval(() => {
      if (!element.isConnected) {
        clearInterval(spinner);
        return;
      }
      angle = (angle + 0.1) % (Math.PI * 2);
      ctx.clearRect(0, 0, size, size);
      
      ctx.beginPath();
      ctx.arc(size/2, size/2, size/3, angle, angle + Math.PI / 2);
      ctx.strokeStyle = '#7c70fa';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      element.src = canvas.toDataURL();
    }, 50);
    
    element.dataset.spinnerInterval = spinner;
    return () => clearInterval(spinner);
  }

  function hideLoadingSpinner(element) {
    if (element && element.dataset.spinnerInterval) {
      clearInterval(parseInt(element.dataset.spinnerInterval));
      delete element.dataset.spinnerInterval;
    }
  }

  async function getLocalPhotoUrl(identifier) {
    try {
      const localPath = await window.electronAPI.getLocalPhoto(identifier);
      if (localPath) {
        return localPath;
      }
    } catch (error) {
      console.error('Error getting local photo:', error);
    }
    return null;
  }

  async function saveAvatarLocally(chatId, imageUrl) {
    try {
      const localPath = await window.electronAPI.saveAvatar(chatId, imageUrl);
      if (localPath) {
        avatarCache[chatId] = localPath;
        return localPath;
      }
    } catch (error) {
      console.error('Error saving avatar locally:', error);
    }
    return null;
  }

  async function saveMediaLocally(assetId, imageUrl, type) {
    try {
      const localPath = await window.electronAPI.saveMedia(assetId, imageUrl, type);
      if (localPath) {
        mediaCache[imageUrl] = localPath;
        return localPath;
      }
    } catch (error) {
      console.error('Error saving media locally:', error);
    }
    return null;
  }

  async function fetchImageAsDataUrl(url, retries = 2) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP error');
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        if (i === retries - 1) return null;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return null;
  }

  async function getAvatarWithCache(chatId, chatName, chatType, username = null) {
    if (avatarCache[chatId]) {
      return avatarCache[chatId];
    }

    const defaultAvatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="%23cbd5e1"%3E%3Ccircle cx="12" cy="12" r="12"%3E%3C/circle%3E%3C/svg%3E';
    
    try {
      let localUrl = await getLocalPhotoUrl(chatId.toString());
      if (localUrl) {
        avatarCache[chatId] = localUrl;
        return localUrl;
      }
    } catch (e) {}
    
    setTimeout(async () => {
      const serverUrls = [];
      
      if (username) {
        serverUrls.push(`http://localhost:9870/get_asset/avatar?username=${encodeURIComponent(username.replace('@', ''))}`);
        serverUrls.push(`http://localhost:9870/get_asset/avatar?username=${encodeURIComponent(username)}`);
      }
      
      if (chatName && chatType === 'user') {
        serverUrls.push(`http://localhost:9870/get_asset/avatar?username=${encodeURIComponent(chatName)}`);
      }
      
      serverUrls.push(`http://localhost:9870/get_asset/avatar?id=${chatId}`);
      
      for (const url of serverUrls) {
        const dataUrl = await fetchImageAsDataUrl(url, 1);
        if (dataUrl) {
          const savedPath = await saveAvatarLocally(chatId.toString(), url);
          if (savedPath) {
            avatarCache[chatId] = savedPath;
            const imgElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .chat-avatar-mini`);
            if (imgElement) {
              hideLoadingSpinner(imgElement);
              imgElement.src = savedPath;
            }
            if (currentChatId === chatId && elements.chatAvatar) {
              elements.chatAvatar.src = savedPath;
            }
            return;
          }
          avatarCache[chatId] = dataUrl;
          const imgElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .chat-avatar-mini`);
          if (imgElement) {
            hideLoadingSpinner(imgElement);
            imgElement.src = dataUrl;
          }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      avatarCache[chatId] = defaultAvatar;
      const imgElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"] .chat-avatar-mini`);
      if (imgElement) {
        hideLoadingSpinner(imgElement);
        imgElement.src = defaultAvatar;
      }
    }, 10);
    
    return defaultAvatar;
  }

  async function getMediaWithCache(mediaUrl, messageId) {
    if (!mediaUrl) return null;
    
    const urlParts = mediaUrl.split('?');
    const assetIdMatch = urlParts[1]?.match(/asset_id=([^&]+)/);
    const assetId = assetIdMatch ? assetIdMatch[1] : `${messageId}_${Date.now()}`;
    
    let mediaType = 'photo';
    if (mediaUrl.includes('/sticker')) mediaType = 'sticker';
    if (mediaUrl.includes('/video')) mediaType = 'video';
    if (mediaUrl.includes('/document')) mediaType = 'document';
    
    try {
      let localUrl = await getLocalPhotoUrl(assetId);
      if (localUrl) {
        if (mediaCache[mediaUrl]) return mediaCache[mediaUrl];
        mediaCache[mediaUrl] = localUrl;
        return localUrl;
      }
    } catch (e) {}
    
    const dataUrl = await fetchImageAsDataUrl(mediaUrl, 2);
    if (dataUrl) {
      const savedPath = await saveMediaLocally(assetId, mediaUrl, mediaType);
      if (savedPath) {
        mediaCache[mediaUrl] = savedPath;
        return savedPath;
      }
      mediaCache[mediaUrl] = dataUrl;
      return dataUrl;
    }
    
    return mediaUrl;
  }

  function loadAvatarsInBackground(chats) {
    setTimeout(() => {
      chats.forEach(chat => {
        if (!avatarCache[chat.id]) {
          const avatarDiv = document.querySelector(`.chat-item[data-chat-id="${chat.id}"] .chat-avatar-mini`);
          if (avatarDiv && !avatarDiv.dataset.spinnerInterval) {
            showLoadingSpinner(avatarDiv, 48);
          }
          getAvatarWithCache(chat.id, chat.name, chat.type, chat.username);
        }
      });
    }, 2000);
  }

  async function checkConfiguration() {
    try {
      const response = await fetch('http://localhost:9870/test/configure');
      const data = await response.json();
      isConfigured = data.status === true;
      return isConfigured;
    } catch (error) {
      console.error('Ошибка проверки конфигурации:', error);
      isConfigured = false;
      return false;
    }
  }

  async function checkAuthorization() {
    try {
      const response = await fetch('http://localhost:9870/test/auth');
      const data = await response.json();
      isAuthorized = data.status === true;
      return isAuthorized;
    } catch (error) {
      console.error('Ошибка проверки авторизации:', error);
      isAuthorized = false;
      return false;
    }
  }

  async function getCurrentUser() {
    try {
      const response = await fetch('http://localhost:9870/get_me');
      const data = await response.json();
      if (data.status === 'success' && data.user) {
        currentUserId = data.user.id;
        console.log('Current user ID:', currentUserId);
      }
    } catch (error) {
      console.error('Ошибка получения текущего пользователя:', error);
    }
  }

  async function configureApp() {
    const appId = elements.appIdInput.value.trim();
    const appHash = elements.appHashInput.value.trim();
    
    if (!appId || !appHash) {
      elements.configError.style.display = 'block';
      elements.configError.innerText = 'Заполните оба поля';
      return false;
    }

    elements.configError.style.display = 'none';
    
    try {
      const url = `http://localhost:9870/configure?app_id=${encodeURIComponent(appId)}&app_hash=${encodeURIComponent(appHash)}`;
      const response = await fetch(url, { method: 'POST' });
      const data = await response.json();
      
      if (response.status === 200 && data.status === 'success') {
        isConfigured = true;
        return true;
      } else {
        elements.configError.style.display = 'block';
        elements.configError.innerText = data.message || 'Ошибка при конфигурации';
        return false;
      }
    } catch (error) {
      elements.configError.style.display = 'block';
      elements.configError.innerText = 'Ошибка подключения к серверу';
      return false;
    }
  }

  async function sendPhone() {
    const phone = elements.phoneInput.value.trim();
    if (!phone) {
      elements.phoneError.style.display = 'block';
      elements.phoneError.innerText = 'Введите номер телефона';
      return false;
    }
    
    elements.phoneError.style.display = 'none';
    
    try {
      const url = `http://localhost:9870/login/tel?number=${encodeURIComponent(phone)}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (response.status === 200 && data.status === 'code_sent') {
        currentPhone = phone;
        return true;
      } else {
        elements.phoneError.style.display = 'block';
        elements.phoneError.innerText = data.message || data.error || 'Ошибка отправки кода';
        return false;
      }
    } catch (error) {
      elements.phoneError.style.display = 'block';
      elements.phoneError.innerText = 'Ошибка подключения к серверу';
      return false;
    }
  }

  async function sendCode() {
    const code = elements.codeInput.value.trim();
    if (!code) {
      elements.codeError.style.display = 'block';
      elements.codeError.innerText = 'Введите код подтверждения';
      return false;
    }
    
    elements.codeError.style.display = 'none';
    
    try {
      const url = `http://localhost:9870/login/tel/code?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(currentPhone)}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (response.status === 200 && data.status === 'success') {
        isAuthorized = true;
        return true;
      } else if (data.status === 'password_needed') {
        elements.codeError.style.display = 'block';
        elements.codeError.innerText = 'Требуется двухфакторная аутентификация';
        return false;
      } else {
        elements.codeError.style.display = 'block';
        elements.codeError.innerText = data.message || data.error || 'Неверный код. Попробуйте снова';
        return false;
      }
    } catch (error) {
      elements.codeError.style.display = 'block';
      elements.codeError.innerText = 'Ошибка подключения к серверу';
      return false;
    }
  }

  async function loadChats() {
    try {
      const response = await fetch('http://localhost:9870/chat_list');
      const data = await response.json();
      chatsList = data.chats || [];
      
      renderChatsList();
      
      loadAvatarsInBackground(chatsList);
    } catch (error) {
      console.error('Ошибка загрузки чатов:', error);
    }
  }

  function renderChatsList() {
    if (!elements.chatsList) return;
    
    elements.chatsList.innerHTML = '';
    
    chatsList.forEach(chat => {
      const chatDiv = document.createElement('div');
      chatDiv.className = 'chat-item';
      chatDiv.dataset.chatId = chat.id;
      if (currentChatId === chat.id) {
        chatDiv.classList.add('active');
      }
      
      const avatar = document.createElement('img');
      avatar.className = 'chat-avatar-mini';
      
      if (avatarCache[chat.id]) {
        avatar.src = avatarCache[chat.id];
      } else {
        showLoadingSpinner(avatar, 48);
      }
      
      const infoDiv = document.createElement('div');
      infoDiv.className = 'chat-info';
      
      const nameSpan = document.createElement('div');
      nameSpan.className = 'chat-name';
      nameSpan.textContent = chat.name;
      
      infoDiv.appendChild(nameSpan);
      
      chatDiv.appendChild(avatar);
      chatDiv.appendChild(infoDiv);
      
      if (chat.unread > 0) {
        const unreadSpan = document.createElement('div');
        unreadSpan.className = 'chat-unread';
        unreadSpan.textContent = chat.unread;
        chatDiv.appendChild(unreadSpan);
      }
      
      chatDiv.addEventListener('click', () => selectChat(chat.id, chat.name, chat.type, chat.username));
      
      elements.chatsList.appendChild(chatDiv);
    });
  }

  async function selectChat(chatId, chatName, chatType, username) {
    if (currentChatId === chatId) return;
    
    currentChatId = chatId;
    currentChatName = chatName;
    currentMessagesLimit = 50;
    hasMoreMessages = true;
    
    elements.messagesArea.innerHTML = '';
    
    elements.chatName.textContent = chatName;
    
    if (avatarCache[chatId]) {
      elements.chatAvatar.src = avatarCache[chatId];
    } else {
      showLoadingSpinner(elements.chatAvatar, 40);
      getAvatarWithCache(chatId, chatName, chatType, username).then(avatarUrl => {
        hideLoadingSpinner(elements.chatAvatar);
        elements.chatAvatar.src = avatarUrl;
      });
    }
    
    await loadMessages(chatId, true);
    
    renderChatsList();
  }

  async function loadMessages(chatId, reset = false) {
    if (isLoadingMoreMessages) return;
    
    try {
      isLoadingMoreMessages = true;
      console.log('Загрузка сообщений для чата:', chatId, 'limit:', currentMessagesLimit);
      const url = `http://localhost:9870/get_messages/id?id=${chatId}&limit=${currentMessagesLimit}`;
      const response = await fetch(url);
      const data = await response.json();
      console.log('Получены сообщения:', data.messages?.length || 0);
      
      let newMessages = data.messages || [];
      newMessages = newMessages.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      if (reset) {
        messagesCache[chatId] = newMessages;
      } else {
        const existingIds = new Set(messagesCache[chatId].map(m => m.id));
        const uniqueNewMessages = newMessages.filter(m => !existingIds.has(m.id));
        messagesCache[chatId] = [...uniqueNewMessages, ...messagesCache[chatId]];
        messagesCache[chatId].sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      
      if (data.messages && data.messages.length < currentMessagesLimit) {
        hasMoreMessages = false;
      } else {
        hasMoreMessages = true;
      }
      
      if (currentChatId === chatId) {
        renderMessages(chatId);
      }
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error);
    } finally {
      isLoadingMoreMessages = false;
    }
  }

  async function loadMoreMessages() {
    if (!hasMoreMessages || isLoadingMoreMessages || !currentChatId) return;
    
    const oldScrollHeight = elements.messagesArea.scrollHeight;
    const oldScrollTop = elements.messagesArea.scrollTop;
    
    currentMessagesLimit += 50;
    await loadMessages(currentChatId, false);
    
    setTimeout(() => {
      const newScrollHeight = elements.messagesArea.scrollHeight;
      if (newScrollHeight > oldScrollHeight) {
        elements.messagesArea.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
      }
    }, 100);
  }

  function isOwnMessage(senderId) {
    return senderId === currentUserId;
  }

  function getMediaType(mediaUrl) {
    if (!mediaUrl) return null;
    if (mediaUrl.includes('/photo')) return 'photo';
    if (mediaUrl.includes('/video')) return 'video';
    if (mediaUrl.includes('/sticker')) return 'sticker';
    if (mediaUrl.includes('/document')) return 'document';
    return null;
  }

  async function renderMedia(mediaUrl, isOwn, messageId) {
    const mediaType = getMediaType(mediaUrl);
    const mediaDiv = document.createElement('div');
    mediaDiv.className = 'message-media';
    
    if (mediaType === 'photo') {
      const img = document.createElement('img');
      img.style.maxWidth = '300px';
      img.style.maxHeight = '300px';
      img.style.borderRadius = '12px';
      img.style.cursor = 'pointer';
      
      const localUrl = await getMediaWithCache(mediaUrl, messageId);
      img.src = localUrl;
      img.addEventListener('click', () => window.open(mediaUrl, '_blank'));
      mediaDiv.appendChild(img);
    } else if (mediaType === 'video') {
      const video = document.createElement('video');
      video.src = mediaUrl;
      video.controls = true;
      video.style.maxWidth = '300px';
      video.style.maxHeight = '300px';
      video.style.borderRadius = '12px';
      mediaDiv.appendChild(video);
    } else if (mediaType === 'sticker') {
      const img = document.createElement('img');
      const localUrl = await getMediaWithCache(mediaUrl, messageId);
      img.src = localUrl;
      img.className = 'message-sticker';
      mediaDiv.appendChild(img);
    } else if (mediaType === 'document') {
      const link = document.createElement('a');
      link.href = mediaUrl;
      link.textContent = '📎 Скачать файл';
      link.target = '_blank';
      link.style.color = isOwn ? 'white' : '#7c70fa';
      mediaDiv.appendChild(link);
    }
    
    return mediaDiv;
  }

  async function renderMessages(chatId) {
    if (!elements.messagesArea || currentChatId !== chatId) return;
    
    const messages = messagesCache[chatId] || [];
    const fragment = document.createDocumentFragment();
    
    for (const msg of messages) {
      const isOwn = isOwnMessage(msg.sender_id);
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
      messageDiv.dataset.messageId = msg.id;
      
      const avatar = document.createElement('img');
      avatar.className = 'message-avatar';
      const senderName = msg.sender || (msg.sender_id === currentUserId ? 'Вы' : 'Пользователь');
      
      if (!isOwn) {
        if (avatarCache[msg.sender_id]) {
          avatar.src = avatarCache[msg.sender_id];
        } else {
          showLoadingSpinner(avatar, 32);
          getAvatarWithCache(msg.sender_id, senderName, 'user', senderName).then(url => {
            hideLoadingSpinner(avatar);
            avatar.src = url;
          });
        }
        messageDiv.appendChild(avatar);
      }
      
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      
      if (msg.text) {
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = msg.text;
        bubble.appendChild(textDiv);
      }
      
      if (msg.media) {
        const mediaElement = await renderMedia(msg.media, isOwn, msg.id);
        bubble.appendChild(mediaElement);
      }
      
      if (msg.sticker_emoji) {
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = msg.sticker_emoji;
        emojiSpan.style.fontSize = '20px';
        emojiSpan.style.marginRight = '8px';
        bubble.insertBefore(emojiSpan, bubble.firstChild);
      }
      
      if (msg.date) {
        const dateDiv = document.createElement('div');
        dateDiv.className = 'message-date';
        const date = new Date(msg.date);
        dateDiv.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bubble.appendChild(dateDiv);
      }
      
      messageDiv.appendChild(bubble);
      
      if (isOwn) {
        const ownAvatar = document.createElement('img');
        ownAvatar.className = 'message-avatar';
        if (avatarCache[currentUserId]) {
          ownAvatar.src = avatarCache[currentUserId];
        } else {
          showLoadingSpinner(ownAvatar, 32);
          getAvatarWithCache(currentUserId, 'Вы', 'user', 'me').then(url => {
            hideLoadingSpinner(ownAvatar);
            ownAvatar.src = url;
          });
        }
        messageDiv.appendChild(ownAvatar);
      }
      
      fragment.appendChild(messageDiv);
    }
    
    elements.messagesArea.innerHTML = '';
    elements.messagesArea.appendChild(fragment);
    
    elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
  }

  function handleScroll() {
    if (!elements.messagesArea) return;
    
    if (elements.messagesArea.scrollTop < 100 && hasMoreMessages && !isLoadingMoreMessages) {
      loadMoreMessages();
    }
  }

  async function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !currentChatId) return;
    
    try {
      const url = `http://localhost:9870/send_message/id?id=${currentChatId}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      
      if (response.status === 200) {
        elements.messageInput.value = '';
        currentMessagesLimit = 50;
        await loadMessages(currentChatId, true);
        elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
      }
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
    }
  }

  async function initializeApp() {
    hideAll();
    
    const configured = await checkConfiguration();
    const authorized = await checkAuthorization();
    
    if (configured && authorized) {
      await getCurrentUser();
      showContainer(elements.messengerContainer);
      await loadChats();
      return;
    }
    
    if (configured && !authorized) {
      showContainer(elements.phoneContainer);
      return;
    }
    
    showContainer(elements.logoContainer);
  }

  elements.initialNextBtn.addEventListener('click', () => {
    hideAll();
    showContainer(elements.instructionContainer);
  });

  elements.configNextBtn.addEventListener('click', async () => {
    const success = await configureApp();
    if (success) {
      hideAll();
      showContainer(elements.phoneContainer);
    }
  });

  elements.phoneNextBtn.addEventListener('click', async () => {
    const success = await sendPhone();
    if (success) {
      hideAll();
      showContainer(elements.codeContainer);
    }
  });

  elements.codeNextBtn.addEventListener('click', async () => {
    const success = await sendCode();
    if (success) {
      hideAll();
      await getCurrentUser();
      showContainer(elements.messengerContainer);
      await loadChats();
    }
  });

  elements.successNextBtn.addEventListener('click', async () => {
    hideAll();
    await getCurrentUser();
    showContainer(elements.messengerContainer);
    await loadChats();
  });

  elements.sendButton.addEventListener('click', sendMessage);
  elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  elements.messagesArea.addEventListener('scroll', handleScroll);

  initializeApp();
})();