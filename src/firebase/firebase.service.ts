import { Inject, Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService {
  constructor(@Inject('FIREBASE_APP') private firebaseApp: admin.app.App) {}

  getAuth(): admin.auth.Auth {
    return this.firebaseApp.auth();
  }

  getFirestore(): admin.firestore.Firestore {
    return this.firebaseApp.firestore();
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    return this.getAuth().verifyIdToken(idToken);
  }

  async getUserByEmail(email: string): Promise<admin.auth.UserRecord> {
    return this.getAuth().getUserByEmail(email);
  }

  async createUser(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<admin.auth.UserRecord> {
    return this.getAuth().createUser({
      email,
      password,
      displayName,
    });
  }

  async updateUser(
    uid: string,
    properties: admin.auth.UpdateRequest,
  ): Promise<admin.auth.UserRecord> {
    return this.getAuth().updateUser(uid, properties);
  }

  async deleteUser(uid: string): Promise<void> {
    return this.getAuth().deleteUser(uid);
  }
}
