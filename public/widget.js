(function() {
  let containerSelector = '#gavion-chat-widget';
  let containerEl = null;
  let title = 'Chat';
  let welcomeMessage = 'Hello! How can I help you?';
  let language = 'en';
  let socket = null;
  let isOpen = false;

  const createStyles = () => {
    if (document.getElementById('gavion-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'gavion-chat-styles';
    style.textContent = `
      #gavion-chat-widget-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%);
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(255, 107, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
        z-index: 99999;
      }
      #gavion-chat-widget-btn:hover { transform: scale(1.1); }
      #gavion-chat-widget-btn svg { width: 30px; height: 30px; fill: white; }
      #gavion-chat-widget-window {
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 360px;
        height: 500px;
        background: #111;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 100000;
      }
      #gavion-chat-widget-header {
        background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%);
        padding: 16px;
        color: white;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #gavion-chat-widget-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .gavion-message {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.4;
        word-wrap: break-word;
      }
      .gavion-assistant {
        background: #222;
        color: #fff;
        align-self: flex-start;
        border-bottom-left-radius: 4px;
      }
      .gavion-user {
        background: #ff6b00;
        color: #fff;
        align-self: flex-end;
        border-bottom-right-radius: 4px;
      }
      .gavion-input-area {
        padding: 12px;
        border-top: 1px solid #333;
        display: flex;
        gap: 8px;
      }
      #gavion-chat-widget-input {
        flex: 1;
        background: #222;
        border: 1px solid #333;
        border-radius: 20px;
        padding: 10px 16px;
        color: #fff;
        font-size: 14px;
        outline: none;
      }
      #gavion-chat-widget-input:focus { border-color: #ff6b00; }
      #gavion-chat-widget-send {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #ff6b00;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
      }
      #gavion-chat-widget-send:hover { background: #e65c00; }
      #gavion-chat-widget-close {
        background: transparent;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  };

  const createWidget = () => {
    if (!containerEl) return;

    const btn = document.createElement('button');
    btn.id = 'gavion-chat-widget-btn';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
    btn.onclick = toggle;

    const win = document.createElement('div');
    win.id = 'gavion-chat-widget-window';
    win.style.display = 'none';
    win.innerHTML = `
      <div id="gavion-chat-widget-header">
        <span>${title}</span>
        <button id="gavion-chat-widget-close">&times;</button>
      </div>
      <div id="gavion-chat-widget-messages"></div>
      <div class="gavion-input-area">
        <input type="text" id="gavion-chat-widget-input" placeholder="Type a message..." />
        <button id="gavion-chat-widget-send">&#10148;</button>
      </div>
    `;

    containerEl.appendChild(btn);
    containerEl.appendChild(win);

    document.getElementById('gavion-chat-widget-close').onclick = toggle;
    document.getElementById('gavion-chat-widget-send').onclick = sendMessage;
    document.getElementById('gavion-chat-widget-input').onkeypress = (e) => {
      if (e.key === 'Enter') sendMessage();
    };

    initSocket();
  };

  const initSocket = () => {
    const socketIo = window.io;
    if (!socketIo) {
      console.error('Socket.IO not loaded');
      return;
    }
    socket = socketIo();
    socket.on('connect', () => {
      console.log('Socket connected');
      socket.emit('join', { language });
    });
    socket.on('message', (msg) => {
      addMessage('assistant', msg.text || msg);
    });
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
    socket.on('connect_error', (err) => {
      console.error('Socket error:', err);
    });
  };

  const toggle = () => {
    const win = document.getElementById('gavion-chat-widget-window');
    if (!win) return;
    isOpen = !isOpen;
    win.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      document.getElementById('gavion-chat-widget-input').focus();
    }
  };

  const addMessage = (role, text) => {
    const messages = document.getElementById('gavion-chat-widget-messages');
    if (!messages) return;
    const msg = document.createElement('div');
    msg.className = `gavion-message gavion-${role}`;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  };

  const sendMessage = () => {
    const input = document.getElementById('gavion-chat-widget-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    if (socket && socket.connected) {
      socket.emit('message', { text, language });
    } else {
      addMessage('assistant', 'Not connected. Please refresh the page.');
    }
  };

  const init = (options = {}) => {
    containerSelector = options.container || '#gavion-chat-widget';
    title = options.title || title;
    welcomeMessage = options.welcomeMessage || welcomeMessage;
    language = options.language || language;

    // Find or create container element
    containerEl = document.querySelector(containerSelector);
    if (!containerEl) {
      containerEl = document.createElement('div');
      containerEl.id = containerSelector.replace('#', '');
      document.body.appendChild(containerEl);
    }

    if (document.getElementById('gavion-chat-widget-root')) return; // Already initialized

    createStyles();
    createWidget();
    addMessage('assistant', welcomeMessage);
  };

  window.GavionChat = { init };
})();