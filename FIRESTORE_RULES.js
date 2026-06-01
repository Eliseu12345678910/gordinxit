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

    match /mercadoPagoPayments/{paymentId} {
      allow read, write: if isAdmin();
    }

    match /chats/{chatId} {
      allow get: if isAdmin() || isParticipant(chatId);
      allow list: if isAdmin();
      allow create: if false;
      allow update: if isAdmin();
      allow delete: if isAdmin();

      match /messages/{messageId} {
        allow read, write: if false;
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
