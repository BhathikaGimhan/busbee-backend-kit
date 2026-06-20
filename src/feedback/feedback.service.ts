import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class FeedbackService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async submitFeedback(
    userId: string,
    feedbackData: { 
      message: string; 
      rating?: number;
      bookingId?: string;
      busId?: string;
      driverId?: string;
      route?: string;
      travelDate?: string;
    },
  ) {
    const firestore = this.firebaseService.getFirestore();

    // Logic to ensure driverId is captured if not provided but busId is available
    let resolvedDriverId = feedbackData.driverId || null;

    if (!resolvedDriverId && feedbackData.busId) {
       try {
         // Case 1: Standard Bus (in 'buses' collection)
         const busDoc = await firestore.collection('buses').doc(feedbackData.busId).get();
         if (busDoc.exists) {
            const busData = busDoc.data();
            if (busData.driverId) {
                resolvedDriverId = busData.driverId;
            }
         } else {
             // Case 2: Legacy Bus (where busId = driverId, in 'users' collection)
             const userDoc = await firestore.collection('users').doc(feedbackData.busId).get();
             if (userDoc.exists && userDoc.data().userType === 'driver') {
                 resolvedDriverId = feedbackData.busId;
             }
         }
       } catch (error) {
           console.error("Error resolving driverId from busId in feedback:", error);
       }
    }

    const feedbackRef = firestore.collection('feedback').doc();
    const feedback = {
      id: feedbackRef.id,
      userId,
      message: feedbackData.message,
      rating: feedbackData.rating || null,
      bookingId: feedbackData.bookingId || null,
      busId: feedbackData.busId || null,
      driverId: resolvedDriverId,
      route: feedbackData.route || null,
      travelDate: feedbackData.travelDate || null,
      status: 'pending', // pending, responded
      response: null,
      respondedBy: null,
      respondedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await feedbackRef.set(feedback);
    return { success: true, feedbackId: feedbackRef.id };
  }

  async getDriverFeedback(driverId: string) {
    const firestore = this.firebaseService.getFirestore();

    let feedback = [];
    try {
      // Create a composite index for this query: driverId Ascending, createdAt Descending
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .where('driverId', '==', driverId)
        .orderBy('createdAt', 'desc')
        .get();

      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });
    } catch (error) {
      console.warn('Index might be missing for getDriverFeedback, falling back:', error);
       const feedbackSnapshot = await firestore
        .collection('feedback')
        .where('driverId', '==', driverId)
        .get();

      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });
      // Sort in memory
      feedback.sort((a, b) => {
         const aTime = a.createdAt?.seconds || a.createdAt?.getTime?.() || new Date(a.createdAt).getTime();
         const bTime = b.createdAt?.seconds || b.createdAt?.getTime?.() || new Date(b.createdAt).getTime();
         return bTime - aTime;
      });
    }

    try {
      const userIds = new Set<string>();
      feedback.forEach((item) => {
        if (item.userId) {
          userIds.add(item.userId);
        }
      });
      
      const userDetailsMap = new Map();
      if (userIds.size > 0) {
        const userPromises = Array.from(userIds).map(async (uid) => {
            const userDoc = await firestore.collection('users').doc(uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                return { 
                    userId: uid, 
                    displayName: userData.displayName || 'Anonymous User',
                    photoURL: userData.photoURL || null
                };
            }
            return null;
        });

        const users = await Promise.all(userPromises);
        users.forEach(user => {
            if (user) {
                userDetailsMap.set(user.userId, user);
            }
        });
      }

      const enrichedFeedback = feedback.map(item => {
          const user = userDetailsMap.get(item.userId);
          return {
              ...item,
              userName: user?.displayName || 'Anonymous Passenger',
              userPhoto: user?.photoURL || null
          };
      });

      return enrichedFeedback;
    } catch (enrichError) {
      console.error('Error enriching driver feedback with user details:', enrichError);
      return feedback;
    }
  }

  async getUserFeedback(userId: string) {
    const firestore = this.firebaseService.getFirestore();

    try {
      // First try with composite index (userId + createdAt)
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });

      return feedback;
    } catch (error) {
      // If composite index doesn't exist, fallback to getting all and filtering client-side
      console.warn('Composite index not found, falling back to client-side filtering:', error);
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.userId === userId) {
          feedback.push({ id: doc.id, ...data });
        }
      });

      // Sort by createdAt descending
      return feedback.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt;
        const bTime = b.createdAt?.seconds || b.createdAt;
        return bTime - aTime;
      });
    }
  }

  async getAllFeedback() {
    const firestore = this.firebaseService.getFirestore();

    try {
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .orderBy('createdAt', 'desc')
        .get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });

      return feedback;
    } catch (error) {
      // Fallback if index doesn't exist
      console.warn('Index not found for getAllFeedback, falling back to unordered query:', error);
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });

      // Sort by createdAt descending
      return feedback.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt;
        const bTime = b.createdAt?.seconds || b.createdAt;
        return bTime - aTime;
      });
    }
  }

  async respondToFeedback(
    feedbackId: string,
    adminId: string,
    response: string,
  ) {
    const firestore = this.firebaseService.getFirestore();

    const feedbackRef = firestore.collection('feedback').doc(feedbackId);
    await feedbackRef.update({
      status: 'responded',
      response,
      respondedBy: adminId,
      respondedAt: new Date(),
      updatedAt: new Date(),
    });

    return { success: true };
  }
}