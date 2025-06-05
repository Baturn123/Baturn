document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const loginSection = document.getElementById('login-section');
    const chatSection = document.getElementById('chat-section');
    const usernameInput = document.getElementById('usernameInput');
    const joinChatButton = document.getElementById('joinChatButton');
    const loginStatusP = document.getElementById('login-status');
    const leaveChatButton = document.getElementById('leaveChatButton');
    const currentUserDisplaySpan = document.getElementById('currentUserDisplay');
    const userAvatarSpan = document.getElementById('user-avatar');

    const messagesDiv = document.getElementById('messages');
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const roomListUl = document.getElementById('room-list');
    const currentRoomNameSpan = document.getElementById('current-room-name');
    const chatRoomIconSpan = document.getElementById('chat-room-icon');

    // --- App State (Client-Side) ---
    let currentUsername = null;
    let currentRoomId = 'general';
    let pollingInterval = null;
    const BAD_WORDS_CLIENT = ["darn", "heck", "badword", "crap", "poop"];

    const BASE_URL = 'https://baturn.koyeb.app';
    const MESSAGES_URL_TEMPLATE = (roomId) => `${BASE_URL}/getMessages?room=${roomId}`;
    const POST_MESSAGE_URL = `${BASE_URL}/postMessage`;

    // --- Event Listeners ---
    joinChatButton.addEventListener('click', handleJoinChat);
    usernameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') handleJoinChat();
    });
    leaveChatButton.addEventListener('click', handleLeaveChat);
    
    messageForm.addEventListener('submit', (event) => {
        event.preventDefault();
        postNewMessage();
    });

    // --- Initialization ---
    function init() {
        showLoginScreen();
        updateCurrentRoomDisplay();
        const rememberedUsername = localStorage.getItem('chatUsername');
        if (rememberedUsername) {
            usernameInput.value = rememberedUsername;
        }
        displaySystemMessage("Welcome! Please enter a display name to join the chat.", "info", true);
    }

    function showLoginScreen() {
        loginSection.classList.remove('hidden');
        chatSection.classList.add('hidden');
        loginStatusP.textContent = '';
        loginStatusP.className = 'status-message'; // Reset class
        messageInput.disabled = true;
        sendMessageBtn.disabled = true;
        if (document.activeElement !== usernameInput) { // Avoid stealing focus if user is typing
             setTimeout(() => usernameInput.focus(), 0);
        }
    }

    function showChatScreen() {
        loginSection.classList.add('hidden');
        chatSection.classList.remove('hidden');
        currentUserDisplaySpan.textContent = currentUsername || 'Guest';
        userAvatarSpan.textContent = currentUsername ? currentUsername.charAt(0).toUpperCase() : '?';
        userAvatarSpan.style.backgroundColor = generateAvatarColor(currentUsername || 'Guest');

        messageInput.disabled = false;
        sendMessageBtn.disabled = false;
        messageInput.value = '';
        messageInput.focus();
        messagesDiv.innerHTML = ''; // Clear previous messages or login prompts
        displaySystemMessage(`Joined #${currentRoomNameSpan.textContent} as ${currentUsername}.`, "success");
        fetchMessages();
        startMessagePolling();
    }

    function handleJoinChat() {
        const username = usernameInput.value.trim();
        if (username.length < 2 || username.length > 20) {
            loginStatusP.textContent = 'Username must be 2-20 characters.';
            loginStatusP.className = 'status-message error';
            return;
        }
        if (/[^a-zA-Z0-9_-\s]/.test(username)) {
            loginStatusP.textContent = 'Invalid characters in username.';
            loginStatusP.className = 'status-message error';
            return;
        }
        currentUsername = username;
        localStorage.setItem('chatUsername', currentUsername);
        showChatScreen();
    }

    function handleLeaveChat() {
        currentUsername = null;
        stopMessagePolling();
        showLoginScreen();
        messagesDiv.innerHTML = ''; // Clear messages
        displaySystemMessage("You have left the chat. Enter a name to rejoin.", "info", true);
    }

    function updateCurrentRoomDisplay() {
        const activeRoomLi = roomListUl.querySelector('.active-room');
        const roomName = activeRoomLi ? activeRoomLi.dataset.roomid : 'data-roomid'; // Use data-roomid for consistency
        currentRoomNameSpan.textContent = roomName;
        chatRoomIconSpan.textContent = '#';
    }

    async function postNewMessage() {
        const messageText = messageInput.value.trim();
        if (!messageText || !currentUsername) return;

        for (const badWord of BAD_WORDS_CLIENT) {
            if (messageText.toLowerCase().includes(badWord.toLowerCase())) {
                displaySystemMessage(`Your message contains a forbidden word ('${badWord}') and was not sent.`, 'error');
                return;
            }
        }
        const tempMessageId = `temp_${Date.now()}`; // For optimistic update tracking
        const messageDataForUI = {
            id: tempMessageId, // Temporary ID
            sender: currentUsername,
            text: messageText,
            timestamp: new Date().toISOString(),
            optimistic: true
        };
        addMessageToDOM(messageDataForUI);
        messageInput.value = '';

        try {
            const response = await fetch(POST_MESSAGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `username=${encodeURIComponent(currentUsername)}&message=${encodeURIComponent(messageText)}&room=${encodeURIComponent(currentRoomId)}`
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Server error (${response.status})` }));
                throw new Error(errorData.message);
            }
            const serverResponse = await response.json();
            if (serverResponse.censored) {
                displaySystemMessage("Your message was modified by server moderation.", "info");
            }
            // Server success, no need to re-add, fetchMessages will get it or we can update optimistic one
            const tempMsgElement = document.getElementById(tempMessageId);
            if (tempMsgElement) tempMsgElement.classList.remove('optimistic'); // Mark as confirmed
            fetchMessages(); // Refresh to get confirmed messages list
        } catch (error) {
            console.error('Error posting message:', error);
            displaySystemMessage(`Error: ${error.message}. Message not sent.`, 'error');
            const failedMsgElement = document.getElementById(tempMessageId);
            if (failedMsgElement) failedMsgElement.classList.add('failed'); // Style failed messages
        }
    }

    function addMessageToDOM(msgData) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        if (msgData.id) messageElement.id = msgData.id; // For optimistic updates
        if (msgData.optimistic) messageElement.classList.add('optimistic');


        const isCurrentUser = msgData.sender === currentUsername;
        const senderDisplayName = isCurrentUser ? 'You' : (msgData.sender || 'Anonymous');
        messageElement.classList.add(isCurrentUser ? 'user-message' : 'other-message');

        const senderSpan = document.createElement('span');
        senderSpan.classList.add('sender');
        senderSpan.textContent = senderDisplayName;
        messageElement.appendChild(senderSpan);

        const textWrapper = document.createElement('div');
        textWrapper.classList.add('text-content-wrapper');
        const textSpan = document.createElement('span');
        textSpan.classList.add('text-content');
        textSpan.textContent = msgData.text;
        textWrapper.appendChild(textSpan);
        messageElement.appendChild(textWrapper);
        
        const isScrolledToBottom = messagesDiv.scrollHeight - messagesDiv.clientHeight <= messagesDiv.scrollTop + 1;
        messagesDiv.appendChild(messageElement);
        if (isScrolledToBottom || isCurrentUser) {
            messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
        }
    }

    function displaySystemMessage(text, type = 'info', clearPrevious = false) {
        if(clearPrevious) messagesDiv.innerHTML = ''; // Clear existing messages first
        const messageElement = document.createElement('p');
        messageElement.classList.add('system-message');
        if (type === 'error') messageElement.style.color = 'var(--error-color)';
        else if (type === 'success') messageElement.style.color = 'var(--success-color)';
        messageElement.textContent = text;
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    async function fetchMessages() {
        if (!currentUsername) return;
        try {
            const response = await fetch(MESSAGES_URL_TEMPLATE(currentRoomId));
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Error loading (Status: ${response.status})` }));
                throw new Error(errorData.message);
            }
            const messagesFromServer = await response.json();
            
            const isScrolledToBottom = messagesDiv.scrollHeight - messagesDiv.clientHeight <= messagesDiv.scrollTop + 5; // 5px buffer

            messagesDiv.innerHTML = ''; // Simplest way to refresh: clear and re-add
            if(currentUsername) displaySystemMessage(`You are in #${currentRoomNameSpan.textContent} as ${currentUsername}.`, "info");


            if (messagesFromServer.length === 0) {
                displaySystemMessage(`No messages yet. Be the first!`);
            } else {
                messagesFromServer.forEach(msg => addMessageToDOM(msg));
            }
             if (isScrolledToBottom) {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

        } catch (error) {
            console.error('Error fetching messages:', error);
            if (currentUsername) {
                displaySystemMessage(`Could not load messages: ${error.message}`, 'error');
            }
        }
    }

    function startMessagePolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        // fetchMessages(); // Initial fetch is now handled by showChatScreen
        pollingInterval = setInterval(fetchMessages, 3000);
        console.log("Message polling started for room:", currentRoomId);
    }

    function stopMessagePolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            console.log("Message polling stopped.");
        }
    }

    function generateAvatarColor(username) {
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; // Convert to 32bit integer
        }
        const R_MASK = 0xFF0000;
        const G_MASK = 0x00FF00;
        const B_MASK = 0x0000FF;
        // Ensure colors are not too light by limiting the lower bound of each component
        const r = (hash & R_MASK) >> 16;
        const g = (hash & G_MASK) >> 8;
        const b = hash & B_MASK;
        // A simple way to make colors a bit more saturated and not too pale
        const R = (r % 156) + 50; // 50-205
        const G = (g % 156) + 50; // 50-205
        const B = (b % 156) + 50; // 50-205
        return `rgb(${R}, ${G}, ${B})`;
    }

    init();
});
