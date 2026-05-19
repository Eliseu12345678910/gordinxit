// Firestore Security Rules for production.
// Publish these in Firebase Console > Firestore Database > Rules.

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
        && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true;
    }

    function isChatParticipant(chatId) {
      return signedIn()
        && request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participantUids;
    }

    match /chats/{chatId} {
      // Chat creation and account fields are handled by the Next.js API with Firebase Admin.
      allow create: if false;

      // Admins see all chats. Participants can read their own chat metadata,
      // including Firebase timestamps used by the client UI.
      allow read: if isAdmin() || isChatParticipant(chatId);

      // Participants can update only operational fields used by the client UI.
      allow update: if isAdmin()
        || (
          isChatParticipant(chatId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
            'answers',
            'automationComplete',
            'lastMessage',
            'lastSender',
            'status',
            'updatedAt'
          ])
          && !request.resource.data.diff(resource.data).affectedKeys().hasAny([
            'accessUsername',
            'usernameKey',
            'passwordHash',
            'passwordSalt',
            'ownerUid',
            'participantUids'
          ])
        );

      allow delete: if isAdmin();

      match /messages/{messageId} {
        allow read: if isAdmin() || isChatParticipant(chatId);

        allow create: if isAdmin()
          || (
            isChatParticipant(chatId)
            && request.resource.data.sender == 'client'
            && request.resource.data.text is string
            && request.resource.data.text.size() > 0
            && request.resource.data.text.size() <= 2000
          );

        allow update, delete: if isAdmin();
      }

      match /activity/{activityId} {
        allow read: if isAdmin();
        allow create, update, delete: if false;
      }
    }

    match /admins/{userId} {
      allow read: if signedIn() && (request.auth.uid == userId || isAdmin());
      allow write: if isAdmin();
    }

    match /accounts/{accountId} {
      // Contains credentials and app/profile fields. Keep access server-side or admin-only.
      allow read, write: if isAdmin();
    }
  }
}
