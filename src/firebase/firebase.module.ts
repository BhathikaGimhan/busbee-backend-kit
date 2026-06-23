import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FirebaseService } from './firebase.service';
import * as admin from 'firebase-admin';

@Module({
  imports: [ConfigModule],
  providers: [
    FirebaseService,
    {
      provide: 'FIREBASE_APP',
      useFactory: (configService: ConfigService) => {
        const privateKey = configService
          .get<string>('FIREBASE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n');

        const projectId = configService.get<string>('FIREBASE_PROJECT_ID');
        const clientEmail = configService.get<string>('FIREBASE_CLIENT_EMAIL');

        if (!privateKey) {
          throw new Error(
            'FIREBASE_PRIVATE_KEY environment variable is not set',
          );
        }

        if (!clientEmail) {
          throw new Error(
            'FIREBASE_CLIENT_EMAIL environment variable is not set',
          );
        }

        if (!projectId) {
          throw new Error(
            'FIREBASE_PROJECT_ID environment variable is not set',
          );
        }

        if (!admin.apps.length) {
          try {
            console.log('🔥 Initializing Firebase Admin SDK...');
            console.log('Project ID:', projectId);
            console.log('Client Email:', clientEmail);
            console.log('Private Key Length:', privateKey?.length);

            const useEmulator =
              configService.get<string>('FIREBASE_AUTH_EMULATOR_HOST') ||
              configService.get<string>('FIRESTORE_EMULATOR_HOST');

            if (useEmulator) {
              console.log('🎭 Using Firebase Emulators...');
              console.log(
                'Auth Emulator:',
                configService.get<string>('FIREBASE_AUTH_EMULATOR_HOST'),
              );
              console.log(
                'Firestore Emulator:',
                configService.get<string>('FIRESTORE_EMULATOR_HOST'),
              );

              const authEmulatorHost = configService.get<string>(
                'FIREBASE_AUTH_EMULATOR_HOST',
              );
              if (authEmulatorHost) {
                process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulatorHost
                  .replace('http://', '')
                  .replace('https://', '');
              }

              const app = admin.initializeApp({
                projectId,
              });

              const firestoreEmulatorHost = configService.get<string>(
                'FIRESTORE_EMULATOR_HOST',
              );
              if (firestoreEmulatorHost) {
                const [host, port] = firestoreEmulatorHost.split(':');
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
            }

            const app = admin.initializeApp({
              credential: admin.credential.cert({
                projectId,
                privateKey,
                clientEmail,
              }),
            });

            console.log('✅ Firebase Admin SDK initialized successfully');
            return app;
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
      inject: [ConfigService],
    },
  ],
  exports: ['FIREBASE_APP', FirebaseService],
})
export class FirebaseModule {}
