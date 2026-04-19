(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function whenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
      return;
    }

    fn();
  }

  function animateIn(node) {
    if (!node || node.dataset.uranAnimated === "1") {
      return;
    }

    node.dataset.uranAnimated = "1";
    node.classList.add("uran-enter");
    requestAnimationFrame(function () {
      node.classList.add("uran-enter-active");
      window.setTimeout(function () {
        node.classList.remove("uran-enter");
        node.classList.remove("uran-enter-active");
      }, 320);
    });
  }

  function ensureModalLayout() {
    var modal = $("newChatModal");
    if (!modal || modal.querySelector(".uran-modal-card")) {
      return;
    }

    var children = Array.from(modal.childNodes).filter(function (node) {
      return node.nodeType === 1;
    });
    var card = document.createElement("div");
    card.className = "uran-modal-card";

    children.forEach(function (child) {
      card.appendChild(child);
    });

    var actions = card.querySelector(".modal-actions, .actions, .buttons");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "uran-modal-actions";

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "uran-secondary";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", function () {
        if (typeof window.closeModal === "function") {
          window.closeModal();
        } else {
          modal.classList.remove("active");
        }
      });

      var confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "uran-primary";
      confirm.textContent = "Create";
      confirm.addEventListener("click", function () {
        if (typeof window.createNewChat === "function") {
          window.createNewChat();
        }
      });

      actions.appendChild(cancel);
      actions.appendChild(confirm);
      card.appendChild(actions);
    }

    modal.appendChild(card);
  }

  function classifyStatus() {
    var status = $("chatHeaderStatus");
    if (!status) {
      return;
    }

    var text = (status.textContent || "").toLowerCase();
    var state = "idle";

    if (text.indexOf("typing") !== -1 || text.indexOf("печатает") !== -1) {
      state = "typing";
    } else if (text.indexOf("online") !== -1 || text.indexOf("онлайн") !== -1) {
      state = "online";
    } else if (text.indexOf("offline") !== -1 || text.indexOf("оффлайн") !== -1) {
      state = "offline";
    } else if (text.indexOf("saved") !== -1 || text.indexOf("сохран") !== -1) {
      state = "queued";
    }

    status.dataset.state = state;
  }

  function upgradeChatItems(root) {
    var scope = root || document;
    scope.querySelectorAll(".chat-item").forEach(function (item) {
      item.classList.add("uran-chat-row");

      var name = item.querySelector(".chat-name");
      var last = item.querySelector(".last-message");
      var unread = name ? name.querySelector("span") : null;

      if (unread) {
        item.dataset.hasUnread = "1";
      } else {
        delete item.dataset.hasUnread;
      }

      if (name && last && !item.dataset.uranAnimated) {
        animateIn(item);
      }
    });
  }

  function upgradeMessages(root) {
    var scope = root || document;
    scope.querySelectorAll(".message").forEach(function (message) {
      if (message.classList.contains("sent")) {
        message.dataset.side = "out";
      } else if (message.classList.contains("received")) {
        message.dataset.side = "in";
      }

      if (!message.dataset.uranAnimated) {
        animateIn(message);
      }
    });
  }

  function bindComposerState() {
    var input = $("messageInput");
    var sendBtn = $("sendBtn");
    var shell = document.querySelector(".uran-compose-shell");

    if (!input || !shell) {
      return;
    }

    function sync() {
      var hasValue = Boolean(input.value && input.value.trim());
      shell.classList.toggle("is-composing", hasValue || document.activeElement === input);
      if (sendBtn) {
        sendBtn.classList.toggle("is-ready", hasValue && !sendBtn.disabled);
      }
    }

    ["input", "focus", "blur", "keyup", "change"].forEach(function (eventName) {
      input.addEventListener(eventName, sync);
    });

    sync();
  }

  function markEmptyState() {
    var chatsList = $("chatsList");
    if (!chatsList) {
      return;
    }

    chatsList.querySelectorAll("div").forEach(function (node) {
      var text = (node.textContent || "").trim().toLowerCase();
      if (text && text.indexOf("нет чат") !== -1) {
        node.classList.add("uran-empty-state");
      }
    });
  }

  function mapStructure() {
    document.body.classList.add("uran-telegram-theme");

    var chatsList = $("chatsList");
    var messages = $("messagesContainer");
    var input = $("messageInput");
    var headerName = $("chatHeaderName");
    var status = $("chatHeaderStatus");
    var avatar = $("chatHeaderAvatar");
    var currentName = $("currentUsername");

    if (!chatsList || !messages || !input || !headerName || !status || !avatar) {
      return false;
    }

    var sidebar = chatsList.parentElement;
    var header = avatar.parentElement;
    var composerHost = input.parentElement;

    if (sidebar) {
      sidebar.classList.add("uran-sidebar");
    }

    if (header) {
      header.classList.add("uran-chat-header");
    }

    if (composerHost) {
      composerHost.classList.add("uran-compose-host");
      if (!composerHost.querySelector(".uran-compose-shell")) {
        var composeShell = document.createElement("div");
        composeShell.className = "uran-compose-shell";
        composerHost.insertBefore(composeShell, input);
        composeShell.appendChild(input);
        if ($("sendBtn")) {
          composeShell.appendChild($("sendBtn"));
        }
      }
    }

    var messageWrap = messages.parentElement;
    if (messageWrap) {
      messageWrap.classList.add("uran-messages-wrap");
    }

    var appShell = sidebar && sidebar.parentElement;
    if (appShell) {
      appShell.classList.add("uran-app-shell");
    }

    var chatPanel = header && messageWrap ? header.parentElement : null;
    if (chatPanel) {
      chatPanel.classList.add("uran-chat-panel");
    }

    if (sidebar && currentName) {
      var sidebarHeader = currentName.parentElement;
      if (sidebarHeader) {
        sidebarHeader.classList.add("uran-sidebar-header");
      }
    }

    ensureModalLayout();
    classifyStatus();
    upgradeChatItems(chatsList);
    upgradeMessages(messages);
    bindComposerState();
    markEmptyState();

    return true;
  }

  function observe() {
    var chatsList = $("chatsList");
    var messages = $("messagesContainer");
    var status = $("chatHeaderStatus");
    var modal = $("newChatModal");

    if (chatsList) {
      new MutationObserver(function () {
        upgradeChatItems(chatsList);
        markEmptyState();
      }).observe(chatsList, { childList: true, subtree: true });
    }

    if (messages) {
      new MutationObserver(function () {
        upgradeMessages(messages);
      }).observe(messages, { childList: true, subtree: true });
    }

    if (status) {
      new MutationObserver(classifyStatus).observe(status, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    if (modal) {
      new MutationObserver(function () {
        ensureModalLayout();
      }).observe(modal, { childList: true });
    }
  }

  function boot() {
    var attempts = 0;

    function tryInit() {
      attempts += 1;
      if (mapStructure()) {
        observe();
        return;
      }

      if (attempts < 80) {
        window.setTimeout(tryInit, 150);
      }
    }

    tryInit();
  }

  whenReady(boot);
})();
