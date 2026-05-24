import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  runTransaction,
  Timestamp,
  onSnapshot,
  deleteDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  
  // If it's a specific Firestore connectivity error, we log it differently
  if (message.includes('offline') || message.includes('Unavailable')) {
    console.warn(`Firestore connectivity issue during ${operationType} on ${path}: ${message}`);
    // Don't throw for simple connectivity issues if it's a read, just log it
    if (operationType === OperationType.GET || operationType === OperationType.LIST) {
      return; 
    }
  }

  const errInfo = {
    error: message,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', errInfo);
  throw new Error(message);
}

function cleanData(data: any) {
  const cleaned: any = {};
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined) {
      cleaned[key] = data[key];
    }
  });
  return cleaned;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'borrower' | 'creditor';
  displayName?: string;
  phone?: string;
  dashboardPassword?: string;
  linkedCreditorId?: string;
  createdAt?: any;
}

export interface Ledger {
  id: string;
  borrowerId?: string;
  borrowerEmail?: string;
  borrowerPhone?: string;
  creditorId: string;
  borrowerName: string;
  creditorName: string;
  currentBalance: number;
  principalBalance: number;
  interestBalance: number;
  unallocatedBalance: number; // The "payment pot"
  interestRate?: number;
  lastInterestCalculatedAt?: any;
  createdAt: any;
  dueDate?: string;
}

export interface Transaction {
  id: string;
  ledgerId: string;
  type: 'loan' | 'payment' | 'interest' | 'allocation';
  amount: number;
  description: string;
  allocation?: {
    principal: number;
    interest: number;
  };
  paymentMethod?: 'cash' | 'transfer';
  createdBy: string;
  createdAt: any;
  status?: 'pending_allocation' | 'allocated';
  dueDate?: string;
  allocatedAmount?: number;
  retrospectiveDate?: string;
}

export interface LoanRequest {
  id: string;
  borrowerId: string;
  borrowerName: string;
  borrowerEmail: string;
  creditorId: string;
  creditorEmail: string;
  creditorName?: string;
  amount: number;
  dateRequired: string;
  description?: string;
  status: 'pending' | 'approved' | 'rejected';
  interestRate?: number;
  createdAt: any;
  updatedAt?: any;
}

export interface Invitation {
  id: string;
  creditorId: string;
  borrowerEmail: string;
  tempPassword?: string;
  status: 'pending' | 'accepted';
  createdAt: any;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  read: boolean;
  createdAt: any;
}

export const firebaseService = {
  async createNotification(notification: Omit<Notification, 'id' | 'read' | 'createdAt'>) {
    try {
      const newDoc = doc(collection(db, 'notifications'));
      await setDoc(newDoc, cleanData({
        ...notification,
        read: false,
        createdAt: serverTimestamp(),
      }));
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'notifications');
    }
  },

  subscribeToNotifications(userId: string, callback: (notes: Notification[]) => void) {
    const q = query(collection(db, 'notifications'), where('userId', '==', userId));
    return onSnapshot(q, (snap) => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification));
      notes.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return timeB - timeA;
      });
      callback(notes);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'notifications'));
  },

  async deleteTransaction(ledgerId: string, transactionId: string) {
    try {
      await runTransaction(db, async (transaction) => {
        const ledgerRef = doc(db, 'ledgers', ledgerId);
        const txRef = doc(db, `ledgers/${ledgerId}/transactions`, transactionId);
        
        const ledgerDoc = await transaction.get(ledgerRef);
        const txDoc = await transaction.get(txRef);
        
        if (!ledgerDoc.exists()) {
          console.warn(`Ledger not found: ${ledgerRef.path}`);
          return;
        }
        if (!txDoc.exists()) {
          console.warn(`Transaction not found: ${txRef.path}`);
          return;
        }
        
        const data = ledgerDoc.data();
        const currentBalance = data.currentBalance || 0;
        const principalBalance = data.principalBalance || 0;
        const interestBalance = data.interestBalance || 0;
        const unallocatedBalance = data.unallocatedBalance || 0;
        const tx = txDoc.data() as Transaction;
        
        let nextBalance = currentBalance;
        let nextPrincipal = principalBalance;
        let nextInterest = interestBalance;
        let nextUnallocated = unallocatedBalance;

        if (tx.type === 'loan') {
          nextBalance -= tx.amount;
          if (tx.allocation) {
            nextPrincipal -= (tx.allocation.principal || 0);
            nextInterest -= (tx.allocation.interest || 0);
          } else {
            nextPrincipal -= tx.amount;
          }
        } else if (tx.type === 'interest') {
          nextBalance -= tx.amount;
          if (tx.allocation) {
            nextPrincipal -= (tx.allocation.principal || 0);
            nextInterest -= (tx.allocation.interest || 0);
          } else {
            nextInterest -= tx.amount;
          }
        } else if (tx.type === 'payment') {
          nextUnallocated -= tx.amount;
        } else if (tx.type === 'allocation') {
          const alloc = tx.allocation || { principal: 0, interest: 0 };
          nextUnallocated += tx.amount;
          nextBalance += tx.amount;
          nextPrincipal += (alloc.principal || 0);
          nextInterest += (alloc.interest || 0);
        }
        
        transaction.delete(txRef);
        transaction.update(ledgerRef, { 
          currentBalance: nextBalance,
          principalBalance: nextPrincipal,
          interestBalance: nextInterest,
          unallocatedBalance: nextUnallocated
        });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `ledgers/${ledgerId}/transactions/${transactionId}`);
    }
  },

  async updateTransaction(ledgerId: string, transactionId: string, updates: { amount: number, description: string, type: 'loan' | 'payment' | 'interest' | 'allocation', date?: string, allocation?: { principal: number, interest: number } }) {
    try {
      await runTransaction(db, async (transaction) => {
        const ledgerRef = doc(db, 'ledgers', ledgerId);
        const txRef = doc(db, `ledgers/${ledgerId}/transactions`, transactionId);
        
        const ledgerDoc = await transaction.get(ledgerRef);
        const txDoc = await transaction.get(txRef);
        
        if (!ledgerDoc.exists()) {
          console.warn(`Ledger not found: ${ledgerRef.path}`);
          return;
        }
        if (!txDoc.exists()) {
          console.warn(`Transaction not found: ${txRef.path}`);
          return;
        }
        
        const data = ledgerDoc.data();
        const oldTx = txDoc.data() as Transaction;
        
        let nextBalance = data.currentBalance || 0;
        let nextPrincipal = data.principalBalance || 0;
        let nextInterest = data.interestBalance || 0;
        let nextUnallocated = data.unallocatedBalance || 0;

        // 1. Reverse old transaction
        if (oldTx.type === 'loan') {
          nextBalance -= oldTx.amount;
          if (oldTx.allocation) {
            nextPrincipal -= (oldTx.allocation.principal || 0);
            nextInterest -= (oldTx.allocation.interest || 0);
          } else {
            nextPrincipal -= oldTx.amount;
          }
        } else if (oldTx.type === 'interest') {
          nextBalance -= oldTx.amount;
          if (oldTx.allocation) {
            nextPrincipal -= (oldTx.allocation.principal || 0);
            nextInterest -= (oldTx.allocation.interest || 0);
          } else {
            nextInterest -= oldTx.amount;
          }
        } else if (oldTx.type === 'payment') {
          nextUnallocated -= oldTx.amount;
        } else if (oldTx.type === 'allocation') {
          const alloc = oldTx.allocation || { principal: 0, interest: 0 };
          nextUnallocated += oldTx.amount;
          nextBalance += oldTx.amount;
          nextPrincipal += (alloc.principal || 0);
          nextInterest += (alloc.interest || 0);
        }

        // 2. Apply new transaction
        let newAllocation: any = null;
        if (updates.type === 'loan') {
          nextBalance += updates.amount;
          if (updates.allocation) {
            nextPrincipal += updates.allocation.principal;
            nextInterest += updates.allocation.interest;
            newAllocation = updates.allocation;
          } else {
            nextPrincipal += updates.amount;
            newAllocation = { principal: updates.amount, interest: 0 };
          }
        } else if (updates.type === 'interest') {
          nextBalance += updates.amount;
          nextInterest += updates.amount;
          newAllocation = { principal: 0, interest: updates.amount };
        } else if (updates.type === 'payment') {
          nextUnallocated += updates.amount;
        } else if (updates.type === 'allocation') {
          // You could support allocation edits here, but we focus on loan edits.
          // Fallback if we just edit the amount/description of an allocation.
          if (updates.allocation) {
            nextUnallocated -= updates.amount;
            nextBalance -= updates.amount;
            nextPrincipal -= updates.allocation.principal;
            nextInterest -= updates.allocation.interest;
            newAllocation = updates.allocation;
          } else {
            nextUnallocated -= updates.amount;
            nextBalance -= updates.amount;
          }
        }

        const txUpdates: any = {
           amount: updates.amount,
           description: updates.description,
           type: updates.type,
           allocation: newAllocation
        };
        if (updates.date) {
           txUpdates.createdAt = Timestamp.fromDate(new Date(updates.date));
        }

        transaction.update(txRef, txUpdates);
        transaction.update(ledgerRef, { 
          currentBalance: nextBalance,
          principalBalance: nextPrincipal,
          interestBalance: nextInterest,
          unallocatedBalance: nextUnallocated
        });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `ledgers/${ledgerId}/transactions/${transactionId}`);
    }
  },

  async deleteLedger(ledgerId: string) {
    try {
      await deleteDoc(doc(db, 'ledgers', ledgerId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `ledgers/${ledgerId}`);
    }
  },

  async deleteAllNotifications(userId: string) {
    try {
      const q = query(collection(db, 'notifications'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `notifications`);
    }
  },

  async updateLedger(ledgerId: string, updates: Partial<Ledger>) {
    try {
      await updateDoc(doc(db, 'ledgers', ledgerId), cleanData(updates));
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `ledgers/${ledgerId}`);
    }
  },

  async markNotificationRead(notificationId: string) {
    try {
      await setDoc(doc(db, 'notifications', notificationId), { read: true }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `notifications/${notificationId}`);
    }
  },

  async getLoanRequests(userId: string, role: 'borrower' | 'creditor') {
    try {
      const field = role === 'borrower' ? 'borrowerId' : 'creditorId';
      const q = query(collection(db, 'requests'), where(field, '==', userId));
      const snap = await getDocs(q);
      const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LoanRequest));
      reqs.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return timeB - timeA;
      });
      return reqs;
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'requests');
      return [];
    }
  },

  async createLoanRequest(request: Omit<LoanRequest, 'id' | 'createdAt'>) {
    if (request.amount <= 0) throw new Error("Amount must be greater than 0");
    if (!request.borrowerId || !request.creditorId) throw new Error("Invalid IDs");
    
    try {
      const newDoc = doc(collection(db, 'requests'));
      await setDoc(newDoc, cleanData({
        ...request,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      return newDoc.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'requests');
    }
  },

  async approveLoanRequest(requestId: string, creditorId: string, customInterestRate?: number, customDueDate?: string) {
    try {
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, 'requests', requestId);
        const requestDoc = await transaction.get(requestRef);
        
        if (!requestDoc.exists()) throw new Error("Request not found");
        const reqData = requestDoc.data() as LoanRequest;
        
        if (reqData.status !== 'pending') throw new Error("Request already processed");
        if (reqData.creditorId !== creditorId) throw new Error("Unauthorised");

        const rate = customInterestRate !== undefined ? customInterestRate : (Number(reqData.interestRate) || 0);
        const dueDate = customDueDate !== undefined ? customDueDate : reqData.dateRequired;
        
        const interestAmount = 0; // Interest now manually managed
        const totalRepay = reqData.amount; // Interest now manually managed

        const ledgersRef = collection(db, 'ledgers');
        const q = query(ledgersRef, where('borrowerId', '==', reqData.borrowerId), where('creditorId', '==', creditorId));
        const existingLedgerSnap = await getDocs(q);
        
        let ledgerId: string;
        let ledgerRef: any;

        if (!existingLedgerSnap.empty) {
          ledgerRef = doc(db, 'ledgers', existingLedgerSnap.docs[0].id);
          ledgerId = existingLedgerSnap.docs[0].id;
          const ledgerData = existingLedgerSnap.docs[0].data();
          
          transaction.update(ledgerRef, {
            currentBalance: (ledgerData.currentBalance || 0) + totalRepay,
            principalBalance: (ledgerData.principalBalance || 0) + reqData.amount,
            interestBalance: (ledgerData.interestBalance || 0) + interestAmount,
          });
        } else {
          ledgerRef = doc(collection(db, 'ledgers'));
          ledgerId = ledgerRef.id;
          transaction.set(ledgerRef, cleanData({
            borrowerId: reqData.borrowerId,
            borrowerEmail: reqData.borrowerEmail,
            borrowerName: reqData.borrowerName,
            creditorId: reqData.creditorId,
            creditorName: reqData.creditorName || 'Creditor',
            currentBalance: totalRepay,
            principalBalance: reqData.amount,
            interestBalance: interestAmount,
            unallocatedBalance: 0,
            interestRate: rate,
            dueDate: dueDate,
            createdAt: serverTimestamp(),
          }));
        }

        const txRef = doc(collection(db, `ledgers/${ledgerId}/transactions`));
        transaction.set(txRef, cleanData({
          ledgerId,
          type: 'loan',
          amount: totalRepay,
          description: reqData.description || `Credit Issued`,
          allocation: { principal: reqData.amount, interest: interestAmount },
          createdBy: creditorId,
          createdAt: serverTimestamp(),
          dueDate: dueDate
        }));

        transaction.update(requestRef, { 
          status: 'approved',
          interestRate: rate,
          dateRequired: dueDate,
          updatedAt: serverTimestamp()
        });

        const notificationRef = doc(collection(db, 'notifications'));
        transaction.set(notificationRef, cleanData({
          userId: reqData.borrowerId,
          title: 'Loan Approved',
          message: `Your loan request for R${reqData.amount} (Total R${totalRepay}) has been approved.`,
          type: 'success',
          read: false,
          createdAt: serverTimestamp(),
        }));
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `requests/${requestId}/approve`);
    }
  },

  async getAllCreditors() {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'creditor'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'users');
      return [];
    }
  },

  async updateRequestStatus(requestId: string, status: 'approved' | 'rejected') {
    try {
      await setDoc(doc(db, 'requests', requestId), { status }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `requests/${requestId}`);
    }
  },

  subscribeToRequests(userId: string, role: 'borrower' | 'creditor', callback: (reqs: LoanRequest[]) => void) {
    const field = role === 'borrower' ? 'borrowerId' : 'creditorId';
    const q = query(collection(db, 'requests'), where(field, '==', userId));
    return onSnapshot(q, (snap) => {
      const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LoanRequest));
      reqs.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return timeB - timeA;
      });
      callback(reqs);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'requests'));
  },

  async getAllBorrowers() {
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'borrower'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'users');
      return [];
    }
  },
  async getUserProfile(uid: string, retryCount = 0): Promise<UserProfile | null> {
    try {
      console.log(`Getting user profile for ${uid}, attempt ${retryCount}`);
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      console.log(`Found doc: ${docSnap.exists()}`);
      return docSnap.exists() ? docSnap.data() as UserProfile : null;
    } catch (e: any) {
      console.error(`Error getting user profile for ${uid}:`, e);
      if (e.message?.includes('offline') && retryCount < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getUserProfile(uid, retryCount + 1);
      }
      handleFirestoreError(e, OperationType.GET, `users/${uid}`);
      return null;
    }
  },

  async ensureUserProfile(uid: string, data: Partial<UserProfile>) {
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, cleanData({
        uid,
        ...data,
        updatedAt: serverTimestamp(),
      }), { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${uid}`);
    }
  },

  async createUserProfile(profile: UserProfile) {
    try {
      await setDoc(doc(db, 'users', profile.uid), cleanData({
        ...profile,
        createdAt: serverTimestamp(),
      }));
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `users/${profile.uid}`);
    }
  },

  subscribeToLedgers(userId: string, role: 'borrower' | 'creditor', callback: (ledgers: Ledger[]) => void) {
    const field = role === 'borrower' ? 'borrowerId' : 'creditorId';
    const q = query(collection(db, 'ledgers'), where(field, '==', userId));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ledger)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'ledgers'));
  },

  async linkBorrowerLedgers(uid: string, email: string) {
    if (!email) return;
    try {
      const q = query(collection(db, 'ledgers'), where('borrowerEmail', '==', email.toLowerCase()), where('borrowerId', '==', ''));
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.forEach(docSnap => {
        batch.update(docSnap.ref, { borrowerId: uid });
      });
      await batch.commit();
    } catch (e) {
      console.error("Failed to link borrower ledgers:", e);
    }
  },

  async getBorrowerProfiles(creditorId: string) {
    try {
      const q = query(collection(db, 'ledgers'), where('creditorId', '==', creditorId));
      const snap = await getDocs(q);
      const borrowerEmails = [...new Set(snap.docs.map(d => d.data().borrowerEmail))];
      
      if (borrowerEmails.length === 0) return [];
      
      const userProfiles: UserProfile[] = [];
      for (const email of borrowerEmails) {
        if (!email) continue;
        const u = await this.findUserByEmail(email);
        if (u) userProfiles.push(u);
      }
      return userProfiles;
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'users');
      return [];
    }
  },

  async getLedgers(userId: string, role: 'borrower' | 'creditor') {
    try {
      const field = role === 'borrower' ? 'borrowerId' : 'creditorId';
      const q = query(collection(db, 'ledgers'), where(field, '==', userId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Ledger));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'ledgers');
      return [];
    }
  },

  async createLedger(ledger: Omit<Ledger, 'id' | 'createdAt'>, initialDescription?: string) {
    try {
      const newDoc = doc(collection(db, 'ledgers'));
      const ledgerId = newDoc.id;
      await setDoc(newDoc, cleanData({
        ...ledger,
        createdAt: serverTimestamp(),
      }));

      // Add initial transaction combining principal and interest
      if (ledger.principalBalance > 0 || ledger.interestBalance > 0) {
        const txRef = doc(collection(db, `ledgers/${ledgerId}/transactions`));
        await setDoc(txRef, cleanData({
          ledgerId,
          type: 'loan',
          amount: ledger.principalBalance + ledger.interestBalance,
          description: initialDescription || `Credit Issued`,
          allocation: { principal: ledger.principalBalance, interest: ledger.interestBalance },
          createdBy: auth.currentUser?.uid,
          createdAt: serverTimestamp(),
          dueDate: ledger.dueDate
        }));
      }

      return ledgerId;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'ledgers');
    }
  },

  async addTransaction(ledgerId: string, type: 'loan' | 'payment' | 'interest', amount: number, description: string, date?: string, paymentMethod?: 'cash' | 'transfer', customAllocation?: { principal: number, interest: number }, dueDate?: string, interestRate?: number, retrospectiveDate?: string) {
    try {
      await runTransaction(db, async (transaction) => {
        const ledgerRef = doc(db, 'ledgers', ledgerId);
        const ledgerDoc = await transaction.get(ledgerRef);
        
        if (!ledgerDoc.exists()) throw new Error("Ledger not found");
        const data = ledgerDoc.data();
        
        if (type === 'payment') {
          transaction.update(ledgerRef, {
            unallocatedBalance: (data.unallocatedBalance || 0) + amount
          });

          const txRef = doc(collection(db, `ledgers/${ledgerId}/transactions`));
          transaction.set(txRef, cleanData({
            ledgerId,
            type: 'payment',
            amount,
            description: description || 'Payment',
            paymentMethod,
            status: 'pending_allocation',
            createdBy: auth.currentUser?.uid,
            createdAt: date ? Timestamp.fromDate(new Date(date)) : serverTimestamp(),
            retrospectiveDate,
          }));
          return;
        }

        let currentBalance = data.currentBalance || 0;
        let principalBalance = data.principalBalance || 0;
        let interestBalance = data.interestBalance || 0;
        
        let allocPrincipal = customAllocation?.principal ?? 0;
        let allocInterest = customAllocation?.interest ?? 0;

        if (!customAllocation) {
          if (type === 'loan') {
            allocPrincipal = amount;
          } else if (type === 'interest') {
            allocInterest = amount;
          }
        }

        currentBalance += amount;
        principalBalance += allocPrincipal;
        interestBalance += allocInterest;

        const txRef = doc(collection(db, `ledgers/${ledgerId}/transactions`));
        transaction.set(txRef, cleanData({
          ledgerId,
          type,
          amount,
          description,
          paymentMethod,
          allocation: { principal: allocPrincipal, interest: allocInterest },
          createdBy: auth.currentUser?.uid,
          createdAt: date ? Timestamp.fromDate(new Date(date)) : serverTimestamp(),
          dueDate,
          interestRate,
          retrospectiveDate,
        }));
        
        transaction.update(ledgerRef, { 
          currentBalance,
          principalBalance,
          interestBalance
        });
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `ledgers/${ledgerId}/transactions`);
    }
  },

  async allocatePayment(ledgerId: string, amount: number, allocation: { principal: number, interest: number }, creditTransactionId?: string) {
    try {
      await runTransaction(db, async (transaction) => {
        const ledgerRef = doc(db, 'ledgers', ledgerId);
        const creditTxRef = creditTransactionId ? doc(db, `ledgers/${ledgerId}/transactions`, creditTransactionId) : null;
        
        const [ledgerDoc, creditTxDoc] = await Promise.all([
          transaction.get(ledgerRef),
          creditTxRef ? transaction.get(creditTxRef) : Promise.resolve(null),
        ]);
        
        if (!ledgerDoc.exists()) throw new Error("Ledger not found");
        const data = ledgerDoc.data();
        
        if ((data.unallocatedBalance || 0) < amount) throw new Error("Insufficient funds in payment pot");

        transaction.update(ledgerRef, {
          unallocatedBalance: data.unallocatedBalance - amount,
          currentBalance: data.currentBalance - amount,
          principalBalance: data.principalBalance - allocation.principal,
          interestBalance: data.interestBalance - allocation.interest,
        });

        const txRef = doc(collection(db, `ledgers/${ledgerId}/transactions`));
        transaction.set(txRef, cleanData({
          ledgerId,
          type: 'allocation',
          amount,
          description: `Allocation of R${amount} to credit ${creditTransactionId}`,
          allocatedToTransactionId: creditTransactionId,
          allocation,
          createdBy: auth.currentUser?.uid,
          createdAt: serverTimestamp(),
        }));

        if (creditTransactionId && creditTxRef && creditTxDoc && creditTxDoc.exists()) {
          const currentAllocated = creditTxDoc.data().allocatedAmount || 0;
          transaction.update(creditTxRef, {
            allocatedAmount: currentAllocated + amount
          });
        }
        
        if (data.borrowerEmail) {
          transaction.set(doc(collection(db, 'mail')), {
            to: data.borrowerEmail,
            message: {
              subject: 'Payment Allocated',
              text: `Your payment of R${amount} has been successfully allocated to credit transaction ${creditTransactionId}.`,
              html: `<p>Your payment of <strong>R${amount}</strong> has been successfully allocated to credit transaction <strong>${creditTransactionId}</strong>.</p>`
            }
          });
        }
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `ledgers/${ledgerId}/allocate`);
    }
  },

  async createInvitation(creditorId: string, borrowerEmail: string) {
    try {
      const newDoc = doc(collection(db, 'invitations'));
      await setDoc(newDoc, cleanData({
        creditorId,
        borrowerEmail,
        status: 'pending',
        createdAt: serverTimestamp(),
      }));
      return newDoc.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'invitations');
    }
  },

  async getInvitation(invitationId: string) {
    try {
      const snap = await getDoc(doc(db, 'invitations', invitationId));
      return snap.exists() ? { id: snap.id, ...snap.data() } as Invitation : null;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `invitations/${invitationId}`);
      return null;
    }
  },

  subscribeToLedger(ledgerId: string, callback: (ledger: Ledger) => void) {
    return onSnapshot(doc(db, 'ledgers', ledgerId), (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() } as Ledger);
    }, (e) => handleFirestoreError(e, OperationType.GET, `ledgers/${ledgerId}`));
  },

  subscribeToTransactions(ledgerId: string, callback: (txs: Transaction[]) => void) {
    const q = query(collection(db, `ledgers/${ledgerId}/transactions`), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)));
    }, (e) => handleFirestoreError(e, OperationType.LIST, `ledgers/${ledgerId}/transactions`));
  },

  async findUserByPhone(phone: string): Promise<UserProfile | null> {
    try {
      const q = query(collection(db, 'users'), where('phone', '==', phone));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return snap.docs[0].data() as UserProfile;
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'users');
      return null;
    }
  },

  async findUserByEmail(email: string): Promise<UserProfile | null> {
    try {
      const q = query(collection(db, 'users'), where('email', '==', email));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return snap.docs[0].data() as UserProfile;
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'users');
      return null;
    }
  },

  async signInWithGoogle() {
    try {
      const { loginWithGoogle } = await import('../lib/firebase');
      const result = await loginWithGoogle();
      return result.user;
    } catch (e) {
      console.error('Google Sign In Error:', e);
      return null;
    }
  },

  async signInWithEmail(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async signUpWithEmail(email: string, password: string, displayName: string, role: 'borrower' | 'creditor') {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    
    // Create their user profile document
    await this.ensureUserProfile(cred.user.uid, {
      uid: cred.user.uid,
      email: cred.user.email || email,
      displayName,
      role,
      phone: '',
    });
    
    return cred.user;
  },

  async updateUserProfile(uid: string, updates: Partial<UserProfile>) {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, cleanData({
        ...updates,
        updatedAt: serverTimestamp(),
      }));
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  },

  async logEmail(to: string, subject: string, bodyPreview: string, status: 'sent' | 'failed', errorMessage?: string) {
    try {
      if (!auth.currentUser) return;
      const logRef = doc(collection(db, 'email_logs'));
      await setDoc(logRef, {
        to,
        subject,
        bodyPreview: bodyPreview.replace(/<[^>]*>/g, '').substring(0, 150) + (bodyPreview.length > 150 ? '...' : ''),
        sentAt: serverTimestamp(),
        status,
        senderUid: auth.currentUser.uid,
        ...(errorMessage ? { errorMessage } : {})
      });
    } catch (e) {
      console.error('Failed to log email to Firestore:', e);
    }
  },

  subscribeToEmailLogs(userId: string, callback: (logs: any[]) => void) {
    const q = query(collection(db, 'email_logs'), where('senderUid', '==', userId));
    return onSnapshot(q, (snap) => {
      // Sort on client side safely
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      logs.sort((a: any, b: any) => {
        const timeA = a.sentAt ? a.sentAt.toMillis() : 0;
        const timeB = b.sentAt ? b.sentAt.toMillis() : 0;
        return timeB - timeA;
      });
      callback(logs);
    }, (e) => console.error('Failed to subscribe to email logs:', e));
  }
};
