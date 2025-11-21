import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class FeedbackService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async submitFeedback(
    userId: string,
    feedbackData: { message: string; rating?: number },
  ) {
    const firestore = this.firebaseService.getFirestore();

    const feedbackRef = firestore.collection('feedback').doc();
    const feedback = {
      id: feedbackRef.id,
      userId,
      message: feedbackData.message,
      rating: feedbackData.rating || null,
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