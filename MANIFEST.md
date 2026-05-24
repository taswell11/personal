rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default Deny
    match /{document=**} {
      allow read, write: if false;
    }

    // --- Global Helpers ---
    function isSignedIn() { return request.auth != null; }
    function isOwner(userId) { return isSignedIn() && request.auth.uid == userId; }
    function incoming() { return request.resource.data; }
    function existing() { return resource.data; }
    function isValidId(id) { return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$'); }

    // --- User Profiles ---
    match /users/{userId} {
      function isValidUser(data) {
        return data.uid == userId
          && data.email is string
          && data.role in ['borrower', 'creditor'];
      }
      allow get: if isSignedIn();
      allow list: if isSignedIn();
      allow create: if isSignedIn();
      allow update: if isSignedIn();
      allow delete: if isSignedIn();
    }

    // --- Ledgers & Transactions ---
    // A party is either the creditor or the explicitly linked borrower
    function isLedgerParty(ledger) {
      return isSignedIn() && (
        ledger.creditorId == request.auth.uid || 
        ledger.borrowerId == request.auth.uid ||
        ledger.borrowerEmail == request.auth.token.email
      );
    }

    match /ledgers/{ledgerId} {
      function isValidLedger(data) {
        return data.creditorId is string
          && data.currentBalance is number
          && (data.borrowerId is string || data.borrowerEmail is string);
      }

      allow get: if isLedgerParty(resource.data);
      allow list: if isSignedIn() && (
        resource.data.creditorId == request.auth.uid || 
        resource.data.borrowerId == request.auth.uid ||
        resource.data.borrowerEmail == request.auth.token.email
      );
      allow create: if isSignedIn() && incoming().creditorId == request.auth.uid && isValidLedger(incoming());
      allow update: if isLedgerParty(resource.data);
      allow delete: if isLedgerParty(resource.data) && resource.data.currentBalance == 0;

      match /transactions/{txId} {
        function isValidTransaction(data) {
          return data.ledgerId == ledgerId
            && data.type in ['loan', 'payment', 'interest', 'allocation']
            && data.amount is number;
        }
        allow get: if isLedgerParty(get(/databases/$(database)/documents/ledgers/$(ledgerId)).data);
        allow list: if isLedgerParty(get(/databases/$(database)/documents/ledgers/$(ledgerId)).data);
        allow create: if isLedgerParty(get(/databases/$(database)/documents/ledgers/$(ledgerId)).data) && isValidTransaction(incoming());
        allow update: if isLedgerParty(get(/databases/$(database)/documents/ledgers/$(ledgerId)).data);
        allow delete: if isLedgerParty(get(/databases/$(database)/documents/ledgers/$(ledgerId)).data);
      }
    }

    // --- Loan Requests ---
    match /requests/{requestId} {
      function isValidRequest(data) {
        return data.borrowerId is string 
          && data.creditorId is string
          && data.amount is number 
          && data.status in ['pending', 'approved', 'rejected'];
      }
      function isRequestParty(req) {
        return isSignedIn() && (req.borrowerId == request.auth.uid || req.creditorId == request.auth.uid);
      }

      allow list, get: if isRequestParty(existing());
      allow create: if isSignedIn() && incoming().borrowerId == request.auth.uid && isValidRequest(incoming());
      allow update: if isRequestParty(existing()) && (
        // Borrower can reject/cancel their own
        (existing().borrowerId == request.auth.uid && incoming().status == 'rejected') ||
        // Creditor can approve/reject
        (existing().creditorId == request.auth.uid)
      );
    }

    // --- Notifications ---
    match /notifications/{noteId} {
      allow list, get: if isOwner(resource.data.userId);
      allow create: if isSignedIn(); 
      allow update: if isOwner(resource.data.userId) && incoming().diff(existing()).affectedKeys().hasOnly(['read']);
      allow delete: if isOwner(resource.data.userId);
    }
  }
}
