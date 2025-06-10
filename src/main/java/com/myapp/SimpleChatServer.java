import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public class SimpleChatServer {
  private static final Map<String, UserObject> users =
      new ConcurrentHashMap<>();
  private static final Map<String, String> activeSessions =
      new ConcurrentHashMap<>();
  private static final Map<String, List<MessageObject>> roomMessages =
      new ConcurrentHashMap<>();

  static {
    roomMessages.computeIfAbsent(
        "general", k -> Collections.synchronizedList(new ArrayList<>()));
  }

  private static final List<String> FORBIDDEN_WORDS =
      Arrays.asList("darn", "heck", "badword", "crap", "poop", "stupid", "job", "employment", "job application");
  private static final String MODERATION_REPLACEMENT = "[censored]";

  public static void main(String[] args) throws IOException {
    int port = 8000;
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

    server.createContext("/", new StaticFileHandler());
    server.createContext("/register", new RegisterHandler());
    server.createContext("/login", new LoginHandler());
    server.createContext("/postMessage", new PostMessageHandler());
    server.createContext("/getMessages", new GetMessagesHandler());
    server.createContext("/createRoom", new CreateRoomHandler());
    server.createContext("/getRooms", new GetRoomsHandler());
    server.createContext("/deleteMessage", new DeleteMessageHandler());

    server.setExecutor(null);
    server.start();

    System.out.println(
        "Secure Chat Server with Dynamic Rooms started on port " + port + ".");
    System.out.println("Open http://localhost:" + port + " in your browser.");
  }

  private static class UserObject {
    String username;
    String hashedPassword;
    String salt;

    public UserObject(String username, String password) {
      this.username = username;
      this.salt = generateSalt();
      this.hashedPassword = hashPassword(password, this.salt);
    }

    public boolean verifyPassword(String passwordAttempt) {
      if (passwordAttempt == null || this.hashedPassword == null) {
        return false;
      }
      return this.hashedPassword.equals(
          hashPassword(passwordAttempt, this.salt));
    }
  }

  private static class MessageObject {
    String id; // <<< NEW: Unique ID for the message
    String sender;
    String text;
    String timestamp;
    String room;

    public MessageObject(String sender, String text, String room) {
        this.id = UUID.randomUUID().toString(); // Assign a unique ID on creation
        this.sender = sender;
        this.text = text;
        this.room = room;
        this.timestamp = Instant.now().atOffset(ZoneOffset.UTC).format(DateTimeFormatter.ISO_INSTANT);
    }

    // Getter for ID (optional, but good practice if other parts need it)
    public String getId() {
        return id;
    }

    public String getSender() { // Good to have getters if needed elsewhere
        return sender;
    }

    @Override
    public String toString() { // For debugging on server
        return "MessageObject{" +
                "id='" + id + '\'' +
                ", sender='" + sender + '\'' +
                ", text='" + text + '\'' +
                ", timestamp='" + timestamp + '\'' +
                ", room='" + room + '\'' +
                '}';
    }

    public String toJSON() {
        // Include the ID in the JSON sent to the client
        return String.format("{\"id\":\"%s\",\"sender\":\"%s\",\"text\":\"%s\",\"timestamp\":\"%s\",\"room\":\"%s\"}",
                escapeJsonString(id), // Add ID here
                escapeJsonString(sender),
                escapeJsonString(text),
                escapeJsonString(timestamp),
                escapeJsonString(room)
        );
    }
  }

  static class DeleteMessageHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String authenticatedUser = getAuthenticatedUsername(exchange);
        if (authenticatedUser == null) {
            sendJsonResponse(exchange, 401, "{\"success\":false,\"message\":\"Unauthorized. Please login.\"}");
            return;
        }

        // We expect DELETE method, but HTML forms can't easily send DELETE.
        // So, we'll accept POST and look for a _method=DELETE param, or just use POST.
        // For simplicity with client-side fetch, client will send a DELETE request.
        if (!"DELETE".equalsIgnoreCase(exchange.getRequestMethod())) {
             // Or if you decide to use POST from client with a special parameter:
             // if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJsonResponse(exchange, 405, "{\"success\":false,\"message\":\"Method Not Allowed. Please use DELETE (or POST with _method=DELETE).\"}");
            return;
        }

        // Message ID will be sent as a query parameter or in the path.
        // Let's assume it's in the path for a more RESTful style: /deleteMessage/{roomId}/{messageId}
        // Or simpler for now, as a query parameter: /deleteMessage?roomId=general&messageId=xyz
        // The JavaScript will send it in the body for DELETE for simplicity with fetch.
        Map<String, String> params = parseFormData(exchange); // We'll send it as form data in the body
        String roomId = params.get("roomId");
        String messageId = params.get("messageId");

        if (roomId == null || messageId == null || roomId.trim().isEmpty() || messageId.trim().isEmpty()) {
            sendJsonResponse(exchange, 400, "{\"success\":false,\"message\":\"Room ID and Message ID are required.\"}");
            return;
        }

        System.out.println("DeleteMessageHandler: User '" + authenticatedUser + "' attempting to delete message '" + messageId + "' in room '" + roomId + "'");

        List<MessageObject> messagesInRoom = roomMessages.get(roomId);

        if (messagesInRoom == null) {
            sendJsonResponse(exchange, 404, "{\"success\":false,\"message\":\"Room not found.\"}");
            return;
        }

        boolean removed = false;
        synchronized (messagesInRoom) { // Ensure thread-safe removal
            // Find the message and verify ownership before removing
            // Using removeIf is a concise way to do this
            removed = messagesInRoom.removeIf(msg -> 
                msg.getId().equals(messageId) && msg.getSender().equals(authenticatedUser)
            );
        }

        if (removed) {
            System.out.println("DeleteMessageHandler: Message '" + messageId + "' deleted successfully by '" + authenticatedUser + "'.");
            sendJsonResponse(exchange, 200, "{\"success\":true,\"message\":\"Message deleted.\"}");
        } else {
            System.out.println("DeleteMessageHandler: Message '" + messageId + "' not found, or user '" + authenticatedUser + "' not authorized to delete.");
            // Send 404 if not found, or 403 Forbidden if found but not authorized (though our check combines these)
            sendJsonResponse(exchange, 404, "{\"success\":false,\"message\":\"Message not found or you are not authorized to delete it.\"}");
        }
    }
  }
  
  static class StaticFileHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String requestedPath = exchange.getRequestURI().getPath();
      String filePathString;
      if (requestedPath.equals("/") || requestedPath.isEmpty()) {
        filePathString = "src/main/resources/static/index.html";
      } else {
        if (requestedPath.contains("..")) {
          sendTextResponse(exchange, 400, "400 (Bad Request) Invalid path.");
          return;
        }
        filePathString = "src/main/resources/static"
            + (requestedPath.startsWith("/") ? requestedPath
                                             : "/" + requestedPath);
      }
      Path filePath = Paths.get(filePathString);
      if (Files.exists(filePath) && !Files.isDirectory(filePath)) {
        String contentType = "text/plain";
        if (filePathString.endsWith(".html"))
          contentType = "text/html";
        else if (filePathString.endsWith(".css"))
          contentType = "text/css";
        else if (filePathString.endsWith(".js"))
          contentType = "application/javascript";
        sendResponse(exchange, 200, contentType, Files.readAllBytes(filePath));
      } else {
        System.err.println(
            "StaticFileHandler: File not found: " + filePath.toAbsolutePath());
        sendTextResponse(exchange, 404,
            "404 (Not Found)\nFile not found: " + filePathString);
      }
    }
  }

  static class RegisterHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(exchange, 405,
            "{\"success\":false,\"message\":\"Method Not Allowed. Please use "
            + "POST.\"}");
        return;
      }
      Map<String, String> params = parseFormData(exchange);
      String username = params.get("username");
      String password = params.get("password");

      if (username == null || password == null || username.trim().isEmpty()
          || password.trim().isEmpty()) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Username and password are "
            + "required.\"}");
        return;
      }
      username = username.trim();
      if (username.length() < 3 || username.length() > 20) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Username must be 3-20 "
            + "characters.\"}");
        return;
      }
      if (password.length() < 6) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Password must be at least 6 "
            + "characters.\"}");
        return;
      }
      if (!username.matches("^[a-zA-Z0-9_-]+$")) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Username can only contain "
            + "letters, numbers, underscore, and hyphen.\"}");
        return;
      }

      if (users.containsKey(username.toLowerCase())) {
        sendJsonResponse(exchange, 409,
            "{\"success\":false,\"message\":\"Username already exists.\"}");
        return;
      }
      UserObject newUser = new UserObject(username, password);
      users.put(username.toLowerCase(), newUser);
      String sessionToken = UUID.randomUUID().toString();
      activeSessions.put(sessionToken, newUser.username);
      System.out.println("RegisterHandler: User '" + newUser.username
          + "' registered and logged in.");
      sendJsonResponse(exchange, 201,
          String.format(
              "{\"success\":true,\"message\":\"Registration successful! "
              + "Logging you in...\",\"username\":\"%s\",\"token\":\"%s\"}",
              escapeJsonString(newUser.username), sessionToken));
    }
  }

  static class LoginHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(exchange, 405,
            "{\"success\":false,\"message\":\"Method Not Allowed. Please use "
            + "POST.\"}");
        return;
      }
      Map<String, String> params = parseFormData(exchange);
      String username = params.get("username");
      String password = params.get("password");
      if (username == null || password == null || username.trim().isEmpty()
          || password.trim().isEmpty()) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Username and password are "
            + "required.\"}");
        return;
      }
      UserObject user = users.get(username.trim().toLowerCase());
      if (user == null || !user.verifyPassword(password)) {
        sendJsonResponse(exchange, 401,
            "{\"success\":false,\"message\":\"Invalid username or "
            + "password.\"}");
        return;
      }
      String sessionToken = UUID.randomUUID().toString();
      activeSessions.put(sessionToken, user.username);
      System.out.println(
          "LoginHandler: User '" + user.username + "' logged in.");
      sendJsonResponse(exchange, 200,
          String.format("{\"success\":true,\"message\":\"Login "
                        + "successful!\",\"username\":\"%s\",\"token\":\"%s\"}",
              escapeJsonString(user.username), sessionToken));
    }
  }

  private static String getAuthenticatedUsername(HttpExchange exchange) {
    Headers headers = exchange.getRequestHeaders();
    List<String> authHeaders = headers.get("Authorization");
    if (authHeaders == null || authHeaders.isEmpty())
      return null;
    String authHeader = authHeaders.get(0);
    if (authHeader != null && authHeader.startsWith("Bearer ")) {
      String token = authHeader.substring("Bearer ".length());
      return activeSessions.get(token);
    }
    return null;
  }

  static class PostMessageHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String authenticatedUser = getAuthenticatedUsername(exchange);
      if (authenticatedUser == null) {
        sendJsonResponse(exchange, 401,
            "{\"success\":false,\"message\":\"Unauthorized. Please login "
            + "again.\"}");
        return;
      }
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(exchange, 405,
            "{\"success\":false,\"message\":\"Method Not Allowed. Please use "
            + "POST.\"}");
        return;
      }
      Map<String, String> params = parseFormData(exchange);
      String messageText = params.get("message");
      String roomId = params.get("room");
      if (messageText == null || roomId == null || messageText.trim().isEmpty()
          || roomId.trim().isEmpty()) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Message or room ID missing.\"}");
        return;
      }
      System.out.println("PostMessageHandler: AuthUser='" + authenticatedUser
          + "', Room='" + roomId + "', Msg='" + messageText + "'");
      String originalMessageText = messageText;
      String moderatedMessageText = moderateMessage(originalMessageText);
      boolean wasCensored = !originalMessageText.equals(moderatedMessageText);
      if (wasCensored) {
        System.out.println("PostMessageHandler: Message from '"
            + authenticatedUser + "' (original: '" + originalMessageText
            + "') censored to: '" + moderatedMessageText + "'");
      }
      MessageObject newMessage =
          new MessageObject(authenticatedUser, moderatedMessageText, roomId);
      List<MessageObject> messagesInRoom = roomMessages.computeIfAbsent(
          roomId, k -> Collections.synchronizedList(new ArrayList<>()));
      messagesInRoom.add(newMessage);
      System.out.println("PostMessageHandler: Message added to room " + roomId);
      sendJsonResponse(exchange, 200,
          "{\"success\":true,\"message\":\"Message posted\""
              + (wasCensored ? ",\"censored\":true" : "") + "}");
    }
  }

  static class GetMessagesHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String authenticatedUser = getAuthenticatedUsername(exchange);
      if (authenticatedUser == null) {
        sendJsonResponse(exchange, 401,
            "{\"success\":false,\"message\":\"Unauthorized. Please login "
            + "again.\"}");
        return;
      }
      if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(exchange, 405,
            "{\"success\":false,\"message\":\"Method Not Allowed. Please use "
            + "GET.\"}");
        return;
      }
      String query = exchange.getRequestURI().getQuery();
      String roomId = "general";
      if (query != null && query.startsWith("room=")) {
        try {
          roomId = URLDecoder.decode(query.substring("room=".length()),
              StandardCharsets.UTF_8.name());
        } catch (Exception e) {
          System.err.println(
              "GetMessagesHandler: Malformed room query: " + query);
        }
      }
      System.out.println("GetMessagesHandler: AuthUser='" + authenticatedUser
          + "' requested messages for room: " + roomId);
      List<MessageObject> messagesInRoom =
          roomMessages.getOrDefault(roomId, Collections.emptyList());
      List<MessageObject> messagesCopy;
      synchronized (messagesInRoom) {
        messagesCopy = new ArrayList<>(messagesInRoom);
      }
      String jsonResponse = messagesCopy.stream()
                                .map(MessageObject::toJSON)
                                .collect(Collectors.joining(",", "[", "]"));
      sendJsonResponse(exchange, 200, jsonResponse);
    }
  }

  static class CreateRoomHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String authenticatedUser = getAuthenticatedUsername(exchange);
      if (authenticatedUser == null) {
        sendJsonResponse(
            exchange, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
      }
      if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(
            exchange, 405, "{\"success\":false,\"message\":\"POST only\"}");
        return;
      }
      Map<String, String> params = parseFormData(exchange);
      String roomNameParam = params.get("roomName");
      if (roomNameParam == null || roomNameParam.trim().isEmpty()) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Room name cannot be empty.\"}");
        return;
      }
      String roomId = roomNameParam.trim()
                          .toLowerCase()
                          .replaceAll("\\s+", "-")
                          .replaceAll("[^a-z0-9-]", "");
      if (roomId.length() < 3 || roomId.length() > 15) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Room name: 3-15 valid chars "
            + "(letters, numbers, hyphens).\"}");
        return;
      }
      if (FORBIDDEN_WORDS.contains(roomId)) {
        sendJsonResponse(exchange, 400,
            "{\"success\":false,\"message\":\"Room name contains forbidden "
            + "words.\"}");
        return;
      }
      if (roomMessages.containsKey(roomId)) {
        sendJsonResponse(exchange, 409,
            "{\"success\":false,\"message\":\"Room '" + escapeJsonString(roomId)
                + "' already exists.\"}");
        return;
      }
      roomMessages.computeIfAbsent(
          roomId, k -> Collections.synchronizedList(new ArrayList<>()));
      System.out.println("CreateRoomHandler: User '" + authenticatedUser
          + "' created room: " + roomId);
      sendJsonResponse(exchange, 201,
          String.format("{\"success\":true,\"message\":\"Room '%s' "
                        + "created.\",\"roomId\":\"%s\"}",
              escapeJsonString(roomId), escapeJsonString(roomId)));
    }
  }

  static class GetRoomsHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      String authenticatedUser = getAuthenticatedUsername(exchange);
      if (authenticatedUser == null) {
        sendJsonResponse(
            exchange, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
        return;
      }
      if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
        sendJsonResponse(
            exchange, 405, "{\"success\":false,\"message\":\"GET only\"}");
        return;
      }
      Set<String> roomIdsSet = roomMessages.keySet();
      List<String> sortedRoomIds = new ArrayList<>(roomIdsSet);
      Collections.sort(sortedRoomIds);
      String jsonResponse = sortedRoomIds.stream()
                                .map(s -> "\"" + escapeJsonString(s) + "\"")
                                .collect(Collectors.joining(",", "[", "]"));
      System.out.println("GetRoomsHandler: User '" + authenticatedUser
          + "' requested room list. Sending " + sortedRoomIds.size()
          + " rooms.");
      sendJsonResponse(exchange, 200, jsonResponse);
    }
  }

  // --- Helper Methods ---
  private static String generateSalt() {
    SecureRandom random = new SecureRandom();
    byte[] salt = new byte[16];
    random.nextBytes(salt);
    return Base64.getEncoder().encodeToString(salt);
  }
  private static String hashPassword(String password, String salt) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      md.update(Base64.getDecoder().decode(salt));
      byte[] hashedPasswordBytes =
          md.digest(password.getBytes(StandardCharsets.UTF_8));
      return Base64.getEncoder().encodeToString(hashedPasswordBytes);
    } catch (NoSuchAlgorithmException e) {
      System.err.println("CRITICAL: SHA-256 Hashing algorithm not found!");
      throw new RuntimeException("Password hashing error", e);
    }
  }
  private static String moderateMessage(String message) {
    String tempMessage = message;
    for (String word : FORBIDDEN_WORDS) {
      tempMessage = tempMessage.replaceAll(
          "(?i)" + Pattern.quote(word), MODERATION_REPLACEMENT);
    }
    return tempMessage;
  }
  private static Map<String, String> parseFormData(HttpExchange exchange)
      throws IOException {
    Map<String, String> map = new HashMap<>();
    try (InputStreamReader isr = new InputStreamReader(
             exchange.getRequestBody(), StandardCharsets.UTF_8);
         BufferedReader br = new BufferedReader(isr)) {
      String formData = br.readLine();
      if (formData == null || formData.isEmpty())
        return map;
      for (String pair : formData.split("&")) {
        String[] keyValue = pair.split("=", 2);
        if (keyValue.length == 2) {
          map.put(URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8.name()),
              URLDecoder.decode(keyValue[1], StandardCharsets.UTF_8.name()));
        } else if (keyValue.length == 1 && !keyValue[0].isEmpty()) {
          map.put(URLDecoder.decode(keyValue[0], StandardCharsets.UTF_8.name()),
              "");
        }
      }
    }
    return map;
  }
  private static void sendJsonResponse(HttpExchange ex, int sc, String json)
      throws IOException {
    sendResponse(
        ex, sc, "application/json", json.getBytes(StandardCharsets.UTF_8));
  }
  private static void sendTextResponse(HttpExchange ex, int sc, String text)
      throws IOException {
    sendResponse(ex, sc, "text/plain", text.getBytes(StandardCharsets.UTF_8));
  }
  private static void sendResponse(
      HttpExchange ex, int sc, String ct, byte[] bytes) throws IOException {
    ex.getResponseHeaders().set("Content-Type", ct + ";charset=utf-8");
    ex.sendResponseHeaders(sc, bytes.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(bytes);
    }
  }
  private static String escapeJsonString(String s) {
    if (s == null)
      return null;
    return s.replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\b", "\\b")
        .replace("\f", "\\f")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t");
  }
}
