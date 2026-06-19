import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: privateKey,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

const firestore = admin.firestore();

async function run() {
  console.log('--- ROUTINES TIMING ---');
  const routinesRef = firestore.collection('routines');

  let t0 = Date.now();
  try {
    const snapshot = await routinesRef
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();
    console.log(`Primary query: fetched ${snapshot.size} docs in ${Date.now() - t0}ms`);
  } catch (error: any) {
    console.log(`Primary query failed in ${Date.now() - t0}ms: ${error.message}`);
    
    t0 = Date.now();
    const snapshot = await routinesRef
      .where('status', '==', 'approved')
      .get();
    console.log(`Fallback query: fetched ${snapshot.size} docs in ${Date.now() - t0}ms`);
  }
}

run().catch(console.error);
