(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
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

  function syncStatusState() {
    var status = $("chatHeaderStatus");
    if (!status) {
      return;
    }

    var text = (status.textContent || "").toLowerCase();
    var state = "idle";

    if (text.indexOf("печатает") !== -1 || text.indexOf("typing") !== -1) {
      state = "typing";
    } else if (text.indexOf("онлайн") !== -1 || text.indexOf("online") !== -1) {
      state = "online";
    } else if (text.indexOf("оффлайн") !== -1 || text.indexOf("offline") !== -1 || text.indexOf("не выбран") !== -1) {
      state = "offline";
    } else if (text.indexOf("сохран") !== -1 || text.indexOf("queued") !== -1) {
      state = "queued";
    }

    status.dataset.state = state;
  }

  function syncComposerState() {
    var input = $("messageInput");
    var area = document.querySelector(".input-area");

    if (!input || !area) {
      return;
    }

    var isActive = Boolean(input.value && input.value.trim()) || document.activeElement === input;
    area.classList.toggle("is-composing", isActive);
  }

  function styleEmptyState() {
    var chatsList = $("chatsList");
    if (!chatsList) {
      return;
    }

    Array.from(chatsList.children).forEach(function (node) {
      if (!node.classList.contains("chat-item")) {
        var text = (node.textContent || "").trim().toLowerCase();
        node.classList.toggle("uran-empty-state", text.indexOf("нет чат") !== -1);
      }
    });
  }

  function upgradeChatItem(item) {
    if (!item || !item.classList.contains("chat-item")) {
      return;
    }

    var badge = item.querySelector(".chat-name span");
    if (badge) {
      item.dataset.hasUnread = "1";
    } else {
      delete item.dataset.hasUnread;
    }

    animateIn(item);
  }

  function upgradeMessage(message) {
    if (!message || !message.classList.contains("message")) {
      return;
    }

    animateIn(message);
  }

  function bootTheme() {
    document.body.classList.add("uran-telegram-theme");
    syncStatusState();
    syncComposerState();
    styleEmptyState();

    document.querySelectorAll(".chat-item").forEach(upgradeChatItem);
    document.querySelectorAll(".message").forEach(upgradeMessage);
  }

  function observeDom() {
    var chatsList = $("chatsList");
    var messagesContainer = $("messagesContainer");
    var status = $("chatHeaderStatus");
    var input = $("messageInput");

    if (chatsList) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) {
              return;
            }

            if (node.classList.contains("chat-item")) {
              upgradeChatItem(node);
            } else {
              node.querySelectorAll(".chat-item").forEach(upgradeChatItem);
            }
          });
        });

        styleEmptyState();
      }).observe(chatsList, { childList: true, subtree: true });
    }

    if (messagesContainer) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) {
              return;
            }

            if (node.classList.contains("message")) {
              upgradeMessage(node);
            } else {
              node.querySelectorAll(".message").forEach(upgradeMessage);
            }
          });
        });
      }).observe(messagesContainer, { childList: true, subtree: true });
    }

    if (status) {
      new MutationObserver(syncStatusState).observe(status, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (input) {
      ["input", "focus", "blur", "change", "keyup"].forEach(function (eventName) {
        input.addEventListener(eventName, syncComposerState);
      });
    }
  }

  ready(function () {
    bootTheme();
    observeDom();
  });
})();
