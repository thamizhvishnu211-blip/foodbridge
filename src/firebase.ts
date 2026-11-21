import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { User } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

void setPersistence(auth, browserLocalPersistence).catch(() => {
  // Fallback to default persistence if restricted by embedded browser settings
});

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function mapFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled before completing.';
    case 'auth/popup-blocked':
      return 'Pop-up window was blocked by your browser. Please allow pop-ups for VERDORA and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In in Firebase Authentication.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to Google authentication. Please check your connection.';
    case 'auth/user-disabled':
      return 'This Google account has been disabled in authentication settings.';
    default:
      return error instanceof Error ? error.message : 'Unable to sign in with Google.';
  }
}

export async function signInWithGoogleDirect(): Promise<FirebaseUser> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // Ignore client Firebase signOut errors during logout cleanup
  }
}

export async function syncFirestoreUserProfile(fbUser: FirebaseUser, verdoraUser: User): Promise<void> {
  if (!fbUser.uid || !fbUser.email || !fbUser.emailVerified) return;

  const userDocPath = `users/${fbUser.uid}`;
  const ref = doc(db, 'users', fbUser.uid);
  const safeName = (verdoraUser.name || fbUser.displayName || fbUser.email.split('@')[0]).trim().slice(0, 80);
  const safeAccountType = verdoraUser.accountType === 'admin' ? 'general_user' : verdoraUser.accountType;
  const safeAvatar = (verdoraUser.avatarUrl || fbUser.photoURL || '').trim().slice(0, 500);

  let existsOnServer = false;
  try {
    const snap = await getDocFromServer(ref);
    existsOnServer = snap.exists();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('missing or insufficient permissions')) {
      handleFirestoreError(error, OperationType.GET, userDocPath);
    }
    // Non-blocking if offline or transient
    return;
  }

  try {
    if (!existsOnServer) {
      await setDoc(ref, {
        uid: fbUser.uid,
        name: safeName,
        email: fbUser.email,
        ...(safeAvatar ? { avatarUrl: safeAvatar } : {}),
        accountType: safeAccountType,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        name: safeName,
        ...(safeAvatar ? { avatarUrl: safeAvatar } : {}),
        accountType: safeAccountType,
        lastLoginAt: serverTimestamp(),
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('missing or insufficient permissions')) {
      handleFirestoreError(error, existsOnServer ? OperationType.UPDATE : OperationType.CREATE, userDocPath);
    }
  }
}

export { onAuthStateChanged };
