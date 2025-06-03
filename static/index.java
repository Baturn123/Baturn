<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>School Chat Deluxe</title>
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💬</text></svg>">
</head>
<body>
    <div id="page-wrapper">
        <div id="app-container">

            <!-- Login Section -->
            <div id="login-section">
                <div class="form-container">
                    <span class="app-icon">💬</span>
                    <h2>Join the Conversation</h2>
                    <p class="subtitle">Enter a display name to start chatting!</p>
                    <input type="text" id="usernameInput" placeholder="Your Display Name" maxlength="20" autocomplete="off">
                    <button id="joinChatButton">Join Chat</button>
                    <p id="login-status" class="status-message"></p>
                </div>
            </div>

            <!-- Chat Section (Initially Hidden) -->
            <div id="chat-section" class="hidden">
                <header>
                    <div class="header-content">
                        <h1><span id="chat-room-icon">#</span><span id="current-room-name">general</span></h1>
                        <div id="user-info">
                            <span id="user-avatar">?</span>
                            User: <span id="currentUserDisplay"></span>
                            <button id="leaveChatButton" title="Leave Chat">✕</button>
                        </div>
                    </div>
                </header>

                <div class="main-content">
                    <aside class="sidebar">
                        <h3>Rooms</h3>
                        <ul id="room-list">
                            <li class="active-room" data-roomid="general"># general</li>
                            <!-- <li data-roomid="random"># random</li> -->
                            <!-- <li data-roomid="homework"># homework</li> -->
                        </ul>
                    </aside>

                    <main class="chat-area">
                        <div id="messages">
                            <!-- Messages will appear here -->
                        </div>
                        <form id="messageForm" class="message-input-area">
                            <input type="text" id="messageInput" placeholder="Type your message and press Enter..." disabled autocomplete="off">
                            <button id="sendMessageBtn" type="submit" disabled title="Send Message">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
                            </button>
                        </form>
                    </main>
                </div>
            </div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>
