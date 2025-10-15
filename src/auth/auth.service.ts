import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FirebaseService } from '../firebase/firebase.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as admin from 'firebase-admin';

@Injectable()
export class AuthService {
  constructor(
    private firebaseService: FirebaseService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    try {
      const { email, password, displayName } = registerDto;
      console.log('📝 Registering user:', email);

      // Create user in Firebase
      console.log('🔧 Creating user in Firebase Auth...');
      const userRecord = await this.firebaseService.createUser(
        email,
        password,
        displayName,
      );
      console.log('✅ User created in Firebase Auth:', userRecord.uid);

      // Store additional user data in Firestore
      console.log('💾 Storing user data in Firestore...');
      const firestore = this.firebaseService.getFirestore();
      await firestore
        .collection('users')
        .doc(userRecord.uid)
        .set({
          email: userRecord.email,
          displayName: displayName || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          role: 'passenger', // Default role
        });
      console.log('✅ User data stored in Firestore');

      // Generate JWT token
      const payload = { email: userRecord.email, sub: userRecord.uid };
      const accessToken = this.jwtService.sign(payload);

      console.log('🎉 Registration successful for:', email);
      return {
        accessToken,
        user: {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
        },
      };
    } catch (error) {
      console.error('❌ Registration error:', error);
      throw new UnauthorizedException(error.message);
    }
  }

  async login(loginDto: LoginDto) {
    try {
      const { email, password } = loginDto;

      // Verify user credentials using Firebase Auth REST API
      const authResult = await this.signInWithEmailAndPassword(email, password);

      if (!authResult.localId) {
        throw new Error('Authentication failed');
      }

      // Get user data from Firestore
      const firestore = this.firebaseService.getFirestore();
      const userDoc = await firestore
        .collection('users')
        .doc(authResult.localId)
        .get();
      const userData = userDoc.data();

      // Generate JWT token
      const payload = { email: authResult.email, sub: authResult.localId };
      const accessToken = this.jwtService.sign(payload);

      return {
        accessToken,
        user: {
          uid: authResult.localId,
          email: authResult.email,
          displayName: userData?.displayName || authResult.displayName || '',
        },
      };
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  async validateUser(uid: string) {
    try {
      const userRecord = await this.firebaseService.getAuth().getUser(uid);
      const firestore = this.firebaseService.getFirestore();
      const userDoc = await firestore.collection('users').doc(uid).get();
      const userData = userDoc.data();

      return {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName || userData?.displayName,
        role: userData?.role || 'passenger',
      };
    } catch {
      return null;
    }
  }

  private async signInWithEmailAndPassword(
    email: string,
    password: string,
  ): Promise<any> {
    const apiKey =
      process.env.FIREBASE_API_KEY || process.env.FIREBASE_PROJECT_ID;

    // Use emulator URL if emulator is configured
    const isEmulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const baseUrl = isEmulator
      ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
      : 'https://identitytoolkit.googleapis.com/v1';

    const url = `${baseUrl}/accounts:signInWithPassword?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Authentication failed');
    }

    return response.json();
  }
}
