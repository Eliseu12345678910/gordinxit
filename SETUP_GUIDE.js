#!/usr/bin/env node

/**
 * Firebase Project Setup Guide
 * 
 * This guide helps you set up the Firebase project for the Chat Application.
 * Run this as a reference - it's not executable code, just documentation.
 */

console.log(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘           Firebase Setup Guide - Chat Atendimento              â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

STEP 1: Create Firebase Project
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Enter project name: "chat-atendimento"
4. Accept the terms and click "Create project"
5. Wait for project creation to complete

STEP 2: Enable Authentication
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. In Firebase Console, go to "Authentication"
2. Click "Get Started"
3. Choose "Email/Password" sign-in method
4. Toggle "Enable" switch
5. Click "Save"

STEP 3: Create Firestore Database
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Go to "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode"
4. Select the closest region to you
5. Click "Create"

STEP 4: Get Firebase Configuration
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Go to Project Settings (gear icon)
2. Under "Your apps", click "</>" to add a web app
3. Register the app
4. Copy the Firebase configuration
5. Save it - you'll need it for the next step

STEP 5: Configure Environment Variables
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Create .env.local file (copy from .env.local.example)
2. Fill in the Firebase configuration:
   
   NEXT_PUBLIC_FIREBASE_API_KEY=<your_api_key>
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<your_project>.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=<your_project_id>
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<your_project>.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<your_sender_id>
   NEXT_PUBLIC_FIREBASE_APP_ID=<your_app_id>
   ADMIN_EMAIL=<your_admin_email>

STEP 6: Create Admin User
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Go to Firebase Console > Authentication
2. Click "Users" tab
3. Click "Add user"
4. Enter email: your-email@example.com
5. Enter password: secure-password-here
6. Click "Add user"

STEP 7: Configure Firestore Rules
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
1. Go to Firestore Database > Rules
2. Replace with content from FIRESTORE_RULES.js (test mode)
3. Click "Publish"

âš ï¸  For production, use the production-ready rules in FIRESTORE_RULES.js

STEP 8: Start Development Server
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
npm run dev

Your app will be available at:
- Client: http://localhost:3000
- Admin: http://localhost:3000/admin

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

QUICK REFERENCE
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

ðŸ“± Client Page:
   - URL: http://localhost:3000
   - Features: Automation flow (4 questions), chat interface
   - Storage: localStorage + Firestore

ðŸ› ï¸  Admin Panel:
   - URL: http://localhost:3000/admin
   - Authentication: enter from the client login page with admin email/password
   - Features: Chat list, real-time messaging, quick replies

ðŸ”¥ Firebase Collections:
   - /chats/{chatId}
   - /chats/{chatId}/messages

ðŸ“Š Data Flow:
   - Client â†’ Firestore â†’ Admin
   - Admin â†’ Firestore â†’ Client (real-time)

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

TROUBLESHOOTING
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

âŒ "Firebase App not initialized"
   â†’ Check .env.local file is configured correctly
   â†’ Restart the dev server

âŒ "Permission denied" errors
   â†’ Check Firestore rules are published
   â†’ Ensure user is authenticated
   â†’ Check browser console for details

âŒ Real-time updates not working
   â†’ Verify Firestore rules allow read access
   â†’ Check network tab in browser devtools
   â†’ Ensure collections exist in Firestore

âŒ Admin can't log in
   â†’ Verify user exists in Firebase Auth
   â†’ Check email/password are correct
   â†’ Ensure Email/Password auth method is enabled

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

For full documentation, see: README.md
`)

