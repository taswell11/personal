{
  "entities": {
    "User": {
      "title": "User",
      "description": "User profile information",
      "type": "object",
      "properties": {
        "uid": { "type": "string" },
        "email": { "type": "string" },
        "displayName": { "type": "string" },
        "role": { "type": "string", "enum": ["borrower", "creditor"] },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["uid", "email", "role"]
    },
    "Ledger": {
      "title": "Ledger",
      "description": "A shared ledger between a borrower and a creditor",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "borrowerId": { "type": "string" },
        "creditorId": { "type": "string" },
        "borrowerName": { "type": "string" },
        "creditorName": { "type": "string" },
        "currentBalance": { "type": "number" },
        "principalBalance": { "type": "number" },
        "interestBalance": { "type": "number" },
        "lastInterestCalculatedAt": { "type": "string", "format": "date-time" },
        "status": { "type": "string", "enum": ["active", "archived"] },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["borrowerId", "creditorId", "currentBalance"]
    },
    "Transaction": {
      "title": "Transaction",
      "description": "A single transaction entry in a ledger",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "ledgerId": { "type": "string" },
        "type": { "type": "string", "enum": ["loan", "payment", "interest"] },
        "amount": { "type": "number" },
        "description": { "type": "string" },
        "createdBy": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["ledgerId", "type", "amount", "createdBy", "createdAt"]
    },
    "LoanRequest": {
      "title": "LoanRequest",
      "description": "A request for a loan from a borrower to a creditor",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "borrowerId": { "type": "string" },
        "borrowerName": { "type": "string" },
        "creditorId": { "type": "string" },
        "amount": { "type": "number" },
        "status": { "type": "string", "enum": ["pending", "approved", "rejected"] },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["borrowerId", "creditorId", "amount", "status", "createdAt"]
    }
  },
  "firestore": {
    "/users/{userId}": {
      "schema": "User",
      "description": "User profiles"
    },
    "/ledgers/{ledgerId}": {
      "schema": "Ledger",
      "description": "Shared ledgers"
    },
    "/ledgers/{ledgerId}/transactions/{transactionId}": {
      "schema": "Transaction",
      "description": "Transaction history for a ledger"
    },
    "/requests/{requestId}": {
      "schema": "LoanRequest",
      "description": "Pending loan requests"
    }
  }
}
