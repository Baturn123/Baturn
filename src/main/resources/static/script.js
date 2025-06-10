document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const authSection = document.getElementById('auth-section');
    const chatSection = document.getElementById('chat-section');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginButton = document.getElementById('loginButton');
    const registerButton = document.getElementById('registerButton');
    const toggleAuthModeLink = document.getElementById('toggleAuthModeLink');
    const authStatusP = document.getElementById('auth-status');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');

    const logoutButton = document.getElementById('logoutButton');
    const currentUserDisplaySpan = document.getElementById('currentUserDisplay');
    const userAvatarSpan = document.getElementById('user-avatar');

    const messagesDiv = document.getElementById('messages');
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');

    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const roomListUl = document.getElementById('room-list');
    const currentRoomNameSpan = document.getElementById('current-room-name');
    const chatRoomIconSpan = document.getElementById('chat-room-icon');
    const newRoomNameInput = document.getElementById('newRoomNameInput');
    const createRoomBtn = document.getElementById('createRoomBtn');
    const themeToggleCheckbox = document.getElementById('theme-checkbox');

    // --- App State ---
    let currentUsername = null;
    let currentSessionToken = null;
    let currentRoomId = 'general';
    let pollingInterval = null;
    let isRegisterMode = false;
    const BAD_WORDS_CLIENT = ["darn", "heck", "badword", "crap", "poop", "stupid"];

    // --- SERVER URLs (Relative Paths) ---
    const REGISTER_URL = `/register`;
    const LOGIN_URL = `/login`;
    const CREATE_ROOM_URL = `/createRoom`;
    const GET_ROOMS_URL = `/getRooms`;
    const MESSAGES_URL_TEMPLATE = (roomId) => `/getMessages?room=${roomId}`;
    const POST_MESSAGE_URL = `/postMessage`;
    const DELETE_MESSAGE_URL = `/deleteMessage`;

    // --- Utility to safely attach listener ---
    function safeAddEventListener(element, eventType, handler) {
        if (element) {
            element.addEventListener(eventType, handler);
        } else {
            console.warn(`Element for event '${eventType}' not found (was null):`, element);
        }
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        safeAddEventListener(loginButton, 'click', handleAuthAttempt);
        safeAddEventListener(registerButton, 'click', handleAuthAttempt);
        safeAddEventListener(usernameInput, 'keypress', (event) => { if (event.key === 'Enter' && passwordInput) passwordInput.focus(); });
        safeAddEventListener(passwordInput, 'keypress', (event) => { if (event.key === 'Enter') handleAuthAttempt(); });
        safeAddEventListener(toggleAuthModeLink, 'click', toggleAuthMode);
        safeAddEventListener(logoutButton, 'click', handleLogout);
        safeAddEventListener(messageForm, 'submit', (event) => { event.preventDefault(); postNewMessage(); });
        safeAddEventListener(createRoomBtn, 'click', handleCreateRoom);
        safeAddEventListener(roomListUl, 'click', handleRoomSelection);
        safeAddEventListener(sidebarToggleBtn, 'click', toggleSidebar);
        safeAddEventListener(themeToggleCheckbox, 'change', handleThemeToggle);
        safeAddEventListener(messagesDiv, 'click', handleDeleteMessageClick);

        document.addEventListener('click', (event) => {
            if (sidebar && sidebar.classList.contains('open') &&
                !sidebar.contains(event.target) && // Click was outside sidebar
                sidebarToggleBtn && !sidebarToggleBtn.contains(event.target)) { // And not on the toggle button itself
                sidebar.classList.remove('open');
            }
        });
    }

    // --- Initialization ---
    function init() {
        updateAuthUI();
        loadTheme(); // Load and apply theme first
        currentSessionToken = localStorage.getItem('chatSessionToken');
        currentUsername = localStorage.getItem('chatUsername');
        if (currentSessionToken && currentUsername) {
            console.log("Found stored session, attempting to show chat screen.");
            showChatScreen();
        } else {
            showAuthScreen();
        }
    }

    // --- Theme Management ---
    function loadTheme() {
        const savedTheme = localStorage.getItem('chatTheme') || 'light'; // Default to light
        applyTheme(savedTheme);
        if (themeToggleCheckbox) {
            themeToggleCheckbox.checked = (savedTheme === 'dark');
        }
    }

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
        localStorage.setItem('chatTheme', theme);
    }

    function handleThemeToggle() {
        if (themeToggleCheckbox && themeToggleCheckbox.checked) {
            applyTheme('dark');
        } else {
            applyTheme('light');
        }
    }

    // --- Sidebar Toggle for Mobile ---
    function toggleSidebar() {
        if (sidebar) {
            sidebar.classList.toggle('open');
        }
    }

    // --- Auth UI and Logic ---
    function toggleAuthMode(event) {
        if (event) event.preventDefault();
        isRegisterMode = !isRegisterMode;
        updateAuthUI();
    }

    function updateAuthUI() {
        if (isRegisterMode) {
            if(authTitle) authTitle.textContent = 'Register New Account';
            if(authSubtitle) authSubtitle.textContent = 'Create your username and password.';
            if(loginButton) loginButton.classList.add('hidden');
            if(registerButton) registerButton.classList.remove('hidden');
            if(toggleAuthModeLink) toggleAuthModeLink.textContent = 'Already have an account? Login.';
        } else {
            if(authTitle) authTitle.textContent = 'Login to Chat';
            if(authSubtitle) authSubtitle.textContent = 'Enter your credentials below.';
            if(loginButton) loginButton.classList.remove('hidden');
            if(registerButton) registerButton.classList.add('hidden');
            if(toggleAuthModeLink) toggleAuthModeLink.textContent = 'Need an account? Register.';
        }
        if(authStatusP) { authStatusP.textContent = ''; authStatusP.className = 'status-message'; }
        if(passwordInput) passwordInput.value = '';
    }

    async function handleAuthAttempt() {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) { authStatusP.textContent = 'User/Pass required.'; authStatusP.className = 'status-message error'; return; }
        if (username.length < 3 || username.length > 20) { authStatusP.textContent = 'Username 3-20 chars.'; authStatusP.className = 'status-message error'; return; }
        if (password.length < 6) { authStatusP.textContent = 'Password min 6 chars.'; authStatusP.className = 'status-message error'; return; }
        if (isRegisterMode && !username.match(/^[a-zA-Z0-9_-]+$/)) { authStatusP.textContent = 'Username: letters,nums,_, - only.'; authStatusP.className = 'status-message error'; return; }

        const url = isRegisterMode ? REGISTER_URL : LOGIN_URL;
        const actionText = isRegisterMode ? 'Registering...' : 'Logging in...';
        authStatusP.textContent = actionText; authStatusP.className = 'status-message';
        if(loginButton) loginButton.disabled = true; if(registerButton) registerButton.disabled = true;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || `Auth failed (${response.status})`);
            
            currentUsername = data.username; currentSessionToken = data.token;
            localStorage.setItem('chatUsername', currentUsername);
            localStorage.setItem('chatSessionToken', currentSessionToken);
            authStatusP.textContent = data.message || (isRegisterMode ? 'Registered!' : 'Logged in!');
            authStatusP.className = 'status-message success';
            setTimeout(() => showChatScreen(), 500);
        } catch (error) {
            console.error('Auth error:', error);
            authStatusP.textContent = `Error: ${error.message}`;
            authStatusP.className = 'status-message error';
        } finally {
            if(loginButton) loginButton.disabled = false; if(registerButton) registerButton.disabled = false;
        }
    }

    function handleLogout() {
        currentUsername = null; currentSessionToken = null;
        localStorage.removeItem('chatUsername'); localStorage.removeItem('chatSessionToken');
        stopMessagePolling(); showAuthScreen();
        if (messagesDiv) messagesDiv.innerHTML = '';
        displaySystemMessage("You have been logged out. Login or register to continue.", "info", true);
    }

    // --- UI State Changers (Auth vs Chat) ---
    function showAuthScreen() {
        if(authSection) authSection.classList.remove('hidden');
        if(chatSection) chatSection.classList.add('hidden');
        if(passwordInput) passwordInput.value = '';
        if(authStatusP) { authStatusP.textContent = ''; authStatusP.className = 'status-message'; }
        if(messageInput) messageInput.disabled = true;
        if(sendMessageBtn) sendMessageBtn.disabled = true;
        if(usernameInput && !usernameInput.value && document.activeElement !== usernameInput) {
             setTimeout(() => usernameInput.focus(), 0);
        }
        if(roomListUl) roomListUl.innerHTML = '';
        if(sidebar) sidebar.classList.remove('open');
    }
    
    async function showChatScreen() {
        if(authSection) authSection.classList.add('hidden');
        if(chatSection) chatSection.classList.remove('hidden');
        if(currentUserDisplaySpan) currentUserDisplaySpan.textContent = currentUsername || 'Guest';
        if(userAvatarSpan) {
            userAvatarSpan.textContent = currentUsername ? currentUsername.charAt(0).toUpperCase() : '?';
            userAvatarSpan.style.backgroundColor = generateAvatarColor(currentUsername || 'Guest');
        }
        if(messageInput) { messageInput.disabled = false; messageInput.value = ''; messageInput.focus(); }
        if(sendMessageBtn) sendMessageBtn.disabled = false;
        if(messagesDiv) messagesDiv.innerHTML = '';
        await fetchAndRenderRooms();
    }
    
    // --- Room Management ---
    async function fetchAndRenderRooms() {
        if (!currentSessionToken) { if (currentUsername) handleLogout(); return; }
        try {
            const response = await fetch(GET_ROOMS_URL, { headers: { 'Authorization': 'Bearer ' + currentSessionToken }});
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Failed to get rooms (${response.status})` }));
                 if (response.status === 401 && chatSection && !chatSection.classList.contains('hidden')) { 
                    handleLogout(); displaySystemMessage(errorData.message || "Session invalid. Logged out.", "error", true); 
                }
                throw new Error(errorData.message);
            }
            const roomsFromServer = await response.json();
            if(roomListUl) roomListUl.innerHTML = '';
            let activeRoomStillInList = false;
            let roomsToDisplay = (roomsFromServer && roomsFromServer.length > 0) ? roomsFromServer : ['general'];
            if (!roomsToDisplay.includes('general')) roomsToDisplay.unshift('general');
            roomsToDisplay = [...new Set(roomsToDisplay)];

            roomsToDisplay.forEach(roomId => {
                const li = document.createElement('li'); li.dataset.roomid = roomId; li.textContent = `# ${roomId}`;
                if (roomId === currentRoomId) { li.classList.add('active-room'); activeRoomStillInList = true; }
                if(roomListUl) roomListUl.appendChild(li);
            });

            if (!activeRoomStillInList && roomListUl && roomListUl.firstChild) switchRoom(roomListUl.firstChild.dataset.roomid);
            else if (roomListUl && roomListUl.firstChild) switchRoom(currentRoomId);
            else { 
                if(roomListUl) { const li = document.createElement('li');li.dataset.roomid = 'general';li.textContent = '# general';li.classList.add('active-room');roomListUl.appendChild(li); }
                switchRoom('general');
            }
        } catch (error) {
            console.error("Error fetching/rendering rooms:", error);
            displaySystemMessage(`Error loading rooms: ${error.message}`, "error");
            if(roomListUl) { roomListUl.innerHTML = ''; const li = document.createElement('li');li.dataset.roomid = 'general';li.textContent = '# general';li.classList.add('active-room');roomListUl.appendChild(li); }
            switchRoom('general');
        }
    }

    async function handleCreateRoom() {
        if(!newRoomNameInput || !createRoomBtn) return;
        const roomNameRaw = newRoomNameInput.value.trim();
        if (!roomNameRaw || roomNameRaw.length < 3 || roomNameRaw.length > 15) { alert("Room name: 3-15 chars."); return; }
        const roomId = roomNameRaw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!roomId || roomId.length < 3) { alert("Valid room ID: 3-15 letters, numbers, hyphens."); return; }
        if (!currentSessionToken) { handleLogout(); return; }
        createRoomBtn.disabled = true;
        try {
            const response = await fetch(CREATE_ROOM_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Bearer ' + currentSessionToken },
                body: `roomName=${encodeURIComponent(roomId)}`
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "Failed to create room.");
            newRoomNameInput.value = '';
            await fetchAndRenderRooms(); 
            switchRoom(data.roomId || roomId); 
        } catch (error) { console.error("Error creating room:", error); alert(`Create room error: ${error.message}`);
        } finally { createRoomBtn.disabled = false; }
    }

    function handleRoomSelection(event) {
        const targetLi = event.target.closest('li');
        if (targetLi && targetLi.dataset.roomid) {
            const newRoomId = targetLi.dataset.roomid;
            if (newRoomId !== currentRoomId) switchRoom(newRoomId);
            if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
        }
    }

    function switchRoom(newRoomId) {
        console.log(`Switching to room: ${newRoomId}`); currentRoomId = newRoomId;
        if(roomListUl) document.querySelectorAll('#room-list li').forEach(li => {li.classList.toggle('active-room', li.dataset.roomid === currentRoomId);});
        updateCurrentRoomDisplay(); 
        if(messagesDiv) messagesDiv.innerHTML = '';
        displaySystemMessage(`Joined #${currentRoomNameSpan ? currentRoomNameSpan.textContent : newRoomId} as ${currentUsername}.`, "success");
        fetchMessages();
        if (currentUsername && currentSessionToken) { stopMessagePolling(); startMessagePolling(); }
    }
    
    function updateCurrentRoomDisplay() {
        const activeRoomLi = roomListUl ? roomListUl.querySelector('.active-room') : null;
        const roomName = activeRoomLi ? activeRoomLi.dataset.roomid : currentRoomId;
        if(currentRoomNameSpan) currentRoomNameSpan.textContent = roomName;
        if(chatRoomIconSpan) chatRoomIconSpan.textContent = '#';
    }

    // --- Chat Functionality ---
    async function postNewMessage() {
    // ... (initial checks for messageInput, currentUsername, currentSessionToken, messageText, bad words) ...
    
    const originalMessageInputValue = messageInput.value.trim(); // Use trimmed value for sending
    messageInput.value = ''; 

    console.log("postNewMessage: Attempting to send:", originalMessageInputValue, "to room:", currentRoomId, "by:", currentUsername); // Debug log

    try {
        const response = await fetch(POST_MESSAGE_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + currentSessionToken 
            },
            // Username comes from the token on the server side
            // Only send message and room
            body: `message=${encodeURIComponent(originalMessageInputValue)}&room=${encodeURIComponent(currentRoomId)}` 
        });

        // ... (the rest of your existing !response.ok, data parsing, and error handling) ...
        // ... (including the fetchMessages() call and the scroll to bottom if successful) ...

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `Server error (${response.status})` }));
            if (response.status === 401 && chatSection && !chatSection.classList.contains('hidden')) {
                handleLogout(); 
                displaySystemMessage(errorData.message || "Session invalid. Logged out.", "error", true);
            }
            throw new Error(errorData.message);
        }

        const serverResponse = await response.json();
        if (serverResponse.censored) {
            displaySystemMessage("Your message was modified by server moderation.", "info");
        }

        await fetchMessages(); 

        if (messagesDiv) { // Ensure scroll after messages are fetched and rendered
            messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
        }

    } catch (error) {
        console.error('Error posting message:', error);
        displaySystemMessage(`Send Error: ${error.message}.`, 'error');
        if (messageInput) messageInput.value = originalMessageInputValue; // Restore message on error
    }
}


    function addMessageToDOM(msgData) {
    if (!messagesDiv) {
        console.error("messagesDiv is not available to add message.");
        return null; // Return null or the element if needed by caller
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    if (msgData.id) {
        messageElement.dataset.messageId = msgData.id;
    }

    const isCurrentUserMsg = msgData.sender === currentUsername;
    const senderDisplayName = isCurrentUserMsg ? 'You' : (msgData.sender || 'Anonymous');
    messageElement.classList.add(isCurrentUserMsg ? 'user-message' : 'other-message');

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('sender');
    senderSpan.textContent = senderDisplayName;
    messageElement.appendChild(senderSpan);

    const textWrapper = document.createElement('div');
    textWrapper.classList.add('text-content-wrapper');
    const textSpan = document.createElement('span');
    textSpan.classList.add('text-content');
    textSpan.textContent = msgData.text || "";
    textWrapper.appendChild(textSpan);
    
    if (isCurrentUserMsg && msgData.id) {
        const actionsSpan = document.createElement('span');
        actionsSpan.classList.add('message-actions');
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-message-btn');
        deleteBtn.title = 'Delete message';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M5 3.25V4H2.75a.75.75 0 000 1.5h.31l.94 7.624A2.251 2.251 0 006.228 15h3.544c1.123 0 2.09-.813 2.228-1.876l.94-7.624h.31a.75.75 0 000-1.5H11v-.75A2.25 2.25 0 008.75 1h-1.5A2.25 2.25 0 005 3.25zm2.25-.75a.75.75 0 00-.75.75V4h3v-.75a.75.75 0 00-.75-.75h-1.5z" clip-rule="evenodd" /><path d="M3.938 5.5H12.06l-.89 7.125A.75.75 0 0110.43 13.5H5.57a.75.75 0 01-.74-.875L3.938 5.5z" /></svg>`;
        actionsSpan.appendChild(deleteBtn);
        textWrapper.appendChild(actionsSpan);
    }
    messageElement.appendChild(textWrapper);

    messagesDiv.appendChild(messageElement);
    return messageElement; // Return the element in case caller wants to do something with it
}

    async function handleDeleteMessageClick(event) {
        const deleteButton = event.target.closest('.delete-message-btn');
        if (!deleteButton) {
            return; // Click was not on a delete button or its child
        }

        const messageElement = deleteButton.closest('.message');
        if (!messageElement || !messageElement.dataset.messageId) {
            console.error("Could not find message element or message ID to delete.");
            return;
        }
        
        const messageId = messageElement.dataset.messageId;
        const roomOfMessage = currentRoomId; // Assumes deletion is for messages in the currently active room

        if (!confirm("Are you sure you want to delete this message?")) {
            return;
        }

        console.log(`Attempting to delete message: ${messageId} from room: ${roomOfMessage}`);

        try {
            const response = await fetch(DELETE_MESSAGE_URL, {
                method: 'DELETE', // Your Java server's DeleteMessageHandler needs to support DELETE
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded', // If sending data in body
                    'Authorization': 'Bearer ' + currentSessionToken
                },
                // For DELETE with fetch, body is sometimes problematic or not standard.
                // It's often better to send IDs as query params or path params for DELETE.
                // However, since our Java parseFormData reads the body for POST,
                // we can try sending it in the body for consistency if your server handles it.
                // If your Java handler expects query params:
                // const deleteUrl = `${DELETE_MESSAGE_URL}?messageId=${encodeURIComponent(messageId)}&roomId=${encodeURIComponent(roomOfMessage)}`;
                // const response = await fetch(deleteUrl, { method: 'DELETE', headers: { 'Authorization': ... } });
                // For now, assuming Java handler can parse body for DELETE:
                body: `messageId=${encodeURIComponent(messageId)}&roomId=${encodeURIComponent(roomOfMessage)}`
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "Failed to delete message from server.");
            }

            // Successfully deleted from server, now remove from DOM
            messageElement.remove();
            displaySystemMessage("Message deleted.", "success");

        } catch (error) {
            console.error("Error deleting message:", error);
            displaySystemMessage(`Error deleting message: ${error.message}`, "error");
        }
    }

    function displaySystemMessage(text, type = 'info', clearPrevious = false) {
        const targetContainer = chatSection && !chatSection.classList.contains('hidden') ? messagesDiv : authStatusP;
        if (!targetContainer) return;
        if (clearPrevious && targetContainer === messagesDiv) targetContainer.innerHTML = '';
        
        const messageElement = document.createElement('p');
        messageElement.classList.add('system-message');
        if (type === 'error') messageElement.style.color = 'var(--error-color)';
        else if (type === 'success') messageElement.style.color = 'var(--success-color)';
        messageElement.textContent = text;
        
        targetContainer.appendChild(messageElement);
        if (targetContainer === messagesDiv && (type !== "info" || !clearPrevious || targetContainer.querySelectorAll('.message').length === 0 || text.startsWith("Welcome!"))) {
             targetContainer.scrollTop = targetContainer.scrollHeight;
        } else if (targetContainer === authStatusP) {
            targetContainer.className = `status-message ${type === 'info' ? '' : type}`; // Reset if info, else set error/success
        }
    }

    async function fetchMessages() {
    if (!currentUsername || !currentSessionToken) {
        if (!currentSessionToken && currentUsername && chatSection && !chatSection.classList.contains('hidden')) {
            handleLogout();
            displaySystemMessage("Session ended. Please log in.", "error", true);
        }
        return;
    }

    if (!messagesDiv) return; // Early exit if messagesDiv isn't there

    // --- CAPTURE SCROLL STATE BEFORE MODIFYING DOM ---
    const scrollBuffer = 30;
    const userWasNearBottom = (messagesDiv.scrollHeight - messagesDiv.clientHeight) <= (messagesDiv.scrollTop + scrollBuffer);
    const oldScrollTop = messagesDiv.scrollTop; // Store current scroll position

    try {
        const response = await fetch(MESSAGES_URL_TEMPLATE(currentRoomId), {
            headers: { 'Authorization': 'Bearer ' + currentSessionToken }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `Error loading messages (Status: ${response.status})` }));
            if (response.status === 401 && chatSection && !chatSection.classList.contains('hidden')) {
                handleLogout();
                displaySystemMessage(errorData.message || "Your session is invalid. Please log in again.", "error", true);
            } else if (chatSection && !chatSection.classList.contains('hidden')) {
                displaySystemMessage(`Could not load new messages: ${errorData.message}`, 'error', false);
            }
            // No need to throw error here if we've already displayed it, just return
            return;
        }

        const messagesFromServer = await response.json();
        
        // Preserve system messages (same as before)
        const systemMessagesToPreserve = [];
        messagesDiv.querySelectorAll('.system-message').forEach(sm => {
            if (!sm.textContent.includes(`as ${currentUsername}`)) {
                systemMessagesToPreserve.push(sm.cloneNode(true));
            }
        });
        
        messagesDiv.innerHTML = ''; // Clear all previous messages
        systemMessagesToPreserve.forEach(sm => messagesDiv.appendChild(sm)); // Re-add preserved

        let hasJoinMessage = false;
        messagesDiv.querySelectorAll('.system-message').forEach(sm => {
           if (sm.textContent.includes(`as ${currentUsername}`)) hasJoinMessage = true;
        });
        if (currentUsername && !hasJoinMessage) {
            displaySystemMessage(`You are in #${currentRoomNameSpan ? currentRoomNameSpan.textContent : currentRoomId} as ${currentUsername}.`, "info", false);
        }
        
        // Render the fetched messages
        if (messagesFromServer.length === 0) {
            if (messagesDiv.querySelectorAll('.message').length === 0 && messagesDiv.querySelectorAll('.system-message').length <= 1) {
                displaySystemMessage(`No messages in #${currentRoomNameSpan ? currentRoomNameSpan.textContent : currentRoomId}. Send one!`);
            }
        } else {
            messagesFromServer.forEach(msg => addMessageToDOM(msg)); // addMessageToDOM does NOT scroll for other users
        }

        // --- APPLY SCROLL POSITION ---
        if (userWasNearBottom) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight; // Scroll to new bottom
        } else {
            // If user was scrolled up, try to restore their previous scroll position.
            // This might not be perfect if the content height changed significantly,
            // but it's better than always scrolling to top or bottom.
            messagesDiv.scrollTop = oldScrollTop;
        }
        // --- END OF APPLY SCROLL POSITION ---

    } catch (error) {
        console.error('Error fetching messages:', error.message);
        // Error already handled if it was a !response.ok, otherwise this is a network/JS error
        if (currentUsername && chatSection && !chatSection.classList.contains('hidden') && !messagesDiv.querySelector('.system-message.error')) {
             displaySystemMessage(`Could not connect to load messages.`, 'error', false);
        }
    }
}

    function startMessagePolling() { if(pollingInterval)clearInterval(pollingInterval); pollingInterval=setInterval(fetchMessages,3000); console.log("Polling started for:",currentRoomId); }
    function stopMessagePolling() { if(pollingInterval){clearInterval(pollingInterval);pollingInterval=null;console.log("Polling stopped.");}}
    function generateAvatarColor(u){if(!u)return'#ccc';let h=0;for(let i=0;i<u.length;i++){h=u.charCodeAt(i)+((h<<5)-h);h=h&h;}const r=(h&0xFF0000)>>16;const g=(h&0x00FF00)>>8;const b=h&0x0000FF;return`hsl(${(h%360)},${60+(h%25)}%,${45+(h%10)}%)`;}
    
    // --- Initialize App ---
    setupEventListeners(); // Must be called to attach listeners
    init();
});
