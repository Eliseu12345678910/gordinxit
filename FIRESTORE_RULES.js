// Firestore Security Rules for production.
// Publish these in Firebase Console > Firestore Database > Rules.

rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdminEmail() {
      return signedIn()
        && request.auth.token.email == "admin99193816@admin.com";
    }

    function isAdminDoc() {
      return signedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
        && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true;
    }

    function isAdmin() {
      return isAdminEmail() || isAdminDoc();
    }

    function chatPath(chatId) {
      return /databases/$(database)/documents/chats/$(chatId);
    }

    function chatNotBlocked(chat) {
      return (!("accessBlocked" in chat) || chat.accessBlocked != true)
        && (!("accountBlock" in chat) || chat.accountBlock.active != true);
    }

    function isParticipant(chatId) {
      return signedIn()
        && exists(chatPath(chatId))
        && ("participantUids" in get(chatPath(chatId)).data)
        && get(chatPath(chatId)).data.participantUids.hasAny([request.auth.uid])
        && chatNotBlocked(get(chatPath(chatId)).data);
    }

    function validClientChatUpdate(chatId) {
      let changed = request.resource.data.diff(resource.data).affectedKeys();

      return isParticipant(chatId)
        && changed.hasOnly([
          "lastMessage",
          "lastSender",
          "lastMessageAt",
          "updatedAt"
        ])
        && request.resource.data.lastSender == "client"
        && request.resource.data.lastMessage is string
        && request.resource.data.lastMessage.size() > 0
        && request.resource.data.lastMessage.size() <= 2000;
    }

    function validClientMessage(chatId) {
      return isParticipant(chatId)
        && request.resource.data.keys().hasOnly(["text", "sender", "createdAt"])
        && request.resource.data.sender == "client"
        && request.resource.data.text is string
        && request.resource.data.text.size() > 0
        && request.resource.data.text.size() <= 2000;
    }

    match /admins/{adminId} {
      allow get, list: if isAdmin() || (signedIn() && request.auth.uid == adminId);
      allow create, update, delete: if isAdmin();
    }

    match /accounts/{accountId} {
      allow read, write: if isAdmin();
    }

    match /settings/{settingId} {
      allow get: if isAdmin() || (signedIn() && settingId == "app-update");
      allow list: if isAdmin();
      allow create, update, delete: if isAdmin();
    }

    match /kiwifyEvents/{eventId} {
      allow read, write: if isAdmin();
    }

    match /perfectPayEvents/{eventId} {
      allow read, write: if isAdmin();
    }

    match /chats/{chatId} {
      allow get: if isAdmin() || isParticipant(chatId);
      allow list: if isAdmin();
      allow create: if false;
      allow update: if isAdmin() || validClientChatUpdate(chatId);
      allow delete: if isAdmin();

      match /messages/{messageId} {
        allow get, list: if isAdmin() || isParticipant(chatId);
        allow create: if isAdmin() || validClientMessage(chatId);
        allow update, delete: if isAdmin();
      }

      match /activity/{activityId} {
        allow get, list: if isAdmin();
        allow create, update, delete: if false;
      }

      match /{subdocument=**} {
        allow read, write: if isAdmin();
      }
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
