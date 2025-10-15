import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'FIREBASE_APP',
      useFactory: () => {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
          /\\n/g,
          '\n',
        );

        if (!privateKey) {
          throw new Error(
            'FIREBASE_PRIVATE_KEY environment variable is not set',
          );
        }

        if (!process.env.FIREBASE_CLIENT_EMAIL) {
          throw new Error(
            'FIREBASE_CLIENT_EMAIL environment variable is not set',
          );
        }

        if (!process.env.FIREBASE_PROJECT_ID) {
          throw new Error(
            'FIREBASE_PROJECT_ID environment variable is not set',
          );
        }

        if (!admin.apps.length) {
          try {
            console.log('🔥 Initializing Firebase Admin SDK...');
            console.log('Project ID:', process.env.FIREBASE_PROJECT_ID);
            console.log('Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
            console.log('Private Key Length:', privateKey?.length);

            // Check if emulators are configured
            const useEmulator =
              process.env.FIREBASE_AUTH_EMULATOR_HOST ||
              process.env.FIRESTORE_EMULATOR_HOST;

            if (useEmulator) {
              console.log('🎭 Using Firebase Emulators...');
              console.log(
                'Auth Emulator:',
                process.env.FIREBASE_AUTH_EMULATOR_HOST,
              );
              console.log(
                'Firestore Emulator:',
                process.env.FIRESTORE_EMULATOR_HOST,
              );

              // IMPORTANT: Set FIREBASE_AUTH_EMULATOR_HOST before creating the app
              // This tells Admin SDK to use the emulator
              if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
                // Admin SDK expects the format without http://
                process.env.FIREBASE_AUTH_EMULATOR_HOST =
                  process.env.FIREBASE_AUTH_EMULATOR_HOST.replace(
                    'http://',
                    '',
                  ).replace('https://', '');
              }

              // Initialize with emulator configuration (no credentials needed for emulator)
              const app = admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID,
              });

              // Connect to Firestore emulator
              if (process.env.FIRESTORE_EMULATOR_HOST) {
                const [host, port] =
                  process.env.FIRESTORE_EMULATOR_HOST.split(':');
                app.firestore().settings({
                  host: `${host}:${port}`,
                  ssl: false,
                });
                console.log(
                  `🔌 Connected to Firestore Emulator at ${host}:${port}`,
                );
              }

              console.log('✅ Firebase Admin SDK initialized with emulators');
              return app;
            } else {
              // Use real Firebase with service account
              const app = admin.initializeApp({
                credential: admin.credential.cert({
                  projectId: process.env.FIREBASE_PROJECT_ID,
                  privateKey: privateKey,
                  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                }),
              });

              console.log('✅ Firebase Admin SDK initialized successfully');
              return app;
            }
          } catch (error) {
            console.error(
              '❌ Firebase Admin SDK initialization failed:',
              error,
            );
            throw error;
          }
        }
        return admin.app();
      },
    },
  ],
  exports: ['FIREBASE_APP'],
})
export class FirebaseModule {}
