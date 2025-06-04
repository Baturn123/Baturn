import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern; // For Pattern.quote
import java.util.stream.Collectors;

public class SimpleChatServer {

    private static final Map<String, List<MessageObject>> roomMessages = new ConcurrentHashMap<>();
    static {
        roomMessages.put("general", new ArrayList<>());
    }

    private static final List<String> FORBIDDEN_WORDS = Arrays.asList(
            "darn", "heck", "badword", "crap", "poop", "stupid" // Added one more
    );
    private static final String MODERATION_REPLACEMENT = "[censored]";


    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(8000), 0);

        server.createContext("/", new StaticFileHandler());
        server.createContext("/postMessage", new PostMessageHandler());
        server.createContext("/getMessages", new GetMessagesHandler());

        server.setExecutor(null);
        server.start();

        System.out.println("Simple Chat Server started on port 8000.");
        System.out.println("Open http://localhost:8000 in your browser.");
    }

    private static class MessageObject {
        String sender;
        String text;
        String timestamp;
        String room;

        public MessageObject(String sender, String text, String room) {
            this.sender = sender;
            this.text = text;
            this.room = room;
            this.timestamp = Instant.now().atOffset(ZoneOffset.UTC).format(DateTimeFormatter.ISO_INSTANT);
        }

        public String toJSON() {
            return String.format("{\"sender\":\"%s\", \"text\":\"%s\", \"timestamp\":\"%s\", \"room\":\"%s\"}",
                    escapeJsonString(sender),
                    escapeJsonString(text),
                    escapeJsonString(timestamp),
                    escapeJsonString(room)
            );
        }
    }

    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String requestedPath = exchange.getRequestURI().getPath();
            String filePathString;
            if (requestedPath.equals("/") || requestedPath.isEmpty()) filePathString = "src/main/resources/static/index.html";
            else {
                if (requestedPath.contains("..")) { sendTextResponse(exchange, 400, "400 (Bad Request) Invalid path."); return; }
                filePathString = "src/main/resources/static" + (requestedPath.startsWith("/") ? requestedPath : "/" + requestedPath);
            }
            Path filePath = Paths.get(filePathString);
            if (Files.exists(filePath) && !Files.isDirectory(filePath)) {
                String contentType = "text/plain";
                if (filePathString.endsWith(".html")) contentType = "text/html";
                else if (filePathString.endsWith(".css")) contentType = "text/css";
                else if (filePathString.endsWith(".js")) contentType = "application/javascript";
                sendResponse(exchange, 200, contentType, Files.readAllBytes(filePath));
            } else {
                System.err.println("StaticFileHandler: File not found: " + filePath.toAbsolutePath());
                sendTextResponse(exchange, 404, "404 (Not Found)\nFile not found: " + filePathString);
            }
        }
    }

    static class PostMessageHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJsonResponse(exchange, 405, "{\"success\": false, \"message\": \"Method Not Allowed. Please use POST.\"}"); return;
            }
            Map<String, String> params = parseFormData(exchange);
            String username = params.get("username");
            String messageText = params.get("message");
            String roomId = params.get("room");

            if (username == null || messageText == null || roomId == null ||
                username.trim().isEmpty() || messageText.trim().isEmpty() || roomId.trim().isEmpty()) {
                sendJsonResponse(exchange, 400, "{\"success\": false, \"message\": \"Username, message, or room ID missing.\"}");
                return;
            }
            System.out.println("PostMessage: User='" + username + "', Room='" + roomId + "', Msg='" + messageText + "'");
            String originalMessageText = messageText; // Keep original for comparison
            String moderatedMessageText = moderateMessage(originalMessageText);
            boolean wasCensored = !originalMessageText.equals(moderatedMessageText);

            if (moderatedMessageText == null) { // Should only happen if moderateMessage is changed to block
                 sendJsonResponse(exchange, 400, "{\"success\": false, \"message\": \"Your message was blocked by moderation.\"}");
                 System.out.println("PostMessage: Message from " + username + " (original: '"+originalMessageText+"') was fully blocked.");
                 return;
            }
            if (wasCensored) {
                System.out.println("PostMessage: Message from " + username + " (original: '"+originalMessageText+"') was censored to: '" + moderatedMessageText + "'");
            }

            MessageObject newMessage = new MessageObject(username, moderatedMessageText, roomId);
            List<MessageObject> messagesInRoom = roomMessages.computeIfAbsent(roomId, k -> new ArrayList<>()); // Thread-safe way to get/create room list
            synchronized (messagesInRoom) { // Synchronize on the specific room's list for adding
                messagesInRoom.add(newMessage);
            }
            System.out.println("PostMessage: Message added to room " + roomId);
            sendJsonResponse(exchange, 200, "{\"success\": true, \"message\": \"Message posted\"" + (wasCensored ? ", \"censored\": true" : "") + "}");
        }
    }

    static class GetMessagesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJsonResponse(exchange, 405, "{\"success\": false, \"message\": \"Method Not Allowed. Please use GET.\"}"); return;
            }
            String query = exchange.getRequestURI().getQuery();
            String roomId = "general";
            if (query != null && query.startsWith("room=")) {
                try {
                    roomId = URLDecoder.decode(query.substring("room=".length()), StandardCharsets.UTF_8.name());
                } catch (Exception e) { /* Ignore malformed room, default to general */ }
            }
            System.out.println("GetMessages: Requested messages for room: " + roomId);
            List<MessageObject> messagesInRoom = roomMessages.getOrDefault(roomId, new ArrayList<>());
            List<MessageObject> messagesCopy;
            synchronized (messagesInRoom) { // Synchronize while copying
                messagesCopy = new ArrayList<>(messagesInRoom);
            }
            String jsonResponse = messagesCopy.stream().map(MessageObject::toJSON).collect(Collectors.joining(",", "[", "]"));
            sendJsonResponse(exchange, 200, jsonResponse);
        }
    }

    private static String moderateMessage(String message) {
        String tempMessage = message;
        for (String word : FORBIDDEN_WORDS) {
            // (?i) for case-insensitive, Pattern.quote to treat word literally
            tempMessage = tempMessage.replaceAll("(?i)" + Pattern.quote(word), MODERATION_REPLACEMENT);
        }
        return tempMessage;
    }

    private static Map<String, String> parseFormData(HttpExchange exchange) throws IOException {
        Map<String, String> map = new HashMap<>();
        try (InputStreamReader isr = new InputStreamReader(exchange.getRequestBody(), StandardCharsets.UTF_8);
             BufferedReader br = new BufferedReader(isr)) {
            String formData = br.readLine();
            if (formData == null || formData.isEmpty()) return map;
            for (String pair : formData.split("&")) {
                String[] keyValue = pair.split("=", 2);
                if (keyValue.length == 2) map.put(URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8.name()), URLDecoder.decode(keyValue[1], StandardCharsets.UTF_8.name()));
                else if (keyValue.length == 1 && !keyValue[0].isEmpty()) map.put(URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8.name()), "");
            }
        } return map;
    }

    private static void sendJsonResponse(HttpExchange exchange, int sc, String json) throws IOException {
        sendResponse(exchange, sc, "application/json", json.getBytes(StandardCharsets.UTF_8));
    }
    private static void sendTextResponse(HttpExchange exchange, int sc, String text) throws IOException {
        sendResponse(exchange, sc, "text/plain", text.getBytes(StandardCharsets.UTF_8));
    }
    private static void sendResponse(HttpExchange exchange, int sc, String ct, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", ct + "; charset=utf-8");
        exchange.sendResponseHeaders(sc, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) { os.write(bytes); }
    }
    private static String escapeJsonString(String str) {
        if (str == null) return null;
        return str.replace("\\", "\\\\").replace("\"", "\\\"").replace("\b", "\\b").replace("\f", "\\f").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
