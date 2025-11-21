import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class InquiryService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async submitInquiry(
    userId: string,
    inquiryData: { subject: string; message: string; category?: string },
  ) {
    const firestore = this.firebaseService.getFirestore();

    const inquiryRef = firestore.collection('inquiries').doc();
    const inquiry = {
      id: inquiryRef.id,
      userId,
      subject: inquiryData.subject,
      message: inquiryData.message,
      category: inquiryData.category || 'general',
      status: 'pending', // pending, responded
      response: null,
      respondedBy: null,
      respondedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await inquiryRef.set(inquiry);
    return { success: true, inquiryId: inquiryRef.id };
  }

  async getUserInquiries(userId: string) {
    const firestore = this.firebaseService.getFirestore();

    try {
      // First try with composite index (userId + createdAt)
      const inquirySnapshot = await firestore
        .collection('inquiries')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const inquiries = [];
      inquirySnapshot.forEach((doc) => {
        inquiries.push({ id: doc.id, ...doc.data() });
      });

      return inquiries;
    } catch (error) {
      // If composite index doesn't exist, fallback to getting all and filtering client-side
      console.warn('Composite index not found, falling back to client-side filtering:', error);
      const inquirySnapshot = await firestore
        .collection('inquiries')
        .get();

      const inquiries = [];
      inquirySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.userId === userId) {
          inquiries.push({ id: doc.id, ...data });
        }
      });

      // Sort by createdAt descending
      return inquiries.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt;
        const bTime = b.createdAt?.seconds || b.createdAt;
        return bTime - aTime;
      });
    }
  }

  async getAllInquiries() {
    const firestore = this.firebaseService.getFirestore();

    try {
      const inquirySnapshot = await firestore
        .collection('inquiries')
        .orderBy('createdAt', 'desc')
        .get();

      const inquiries = [];
      inquirySnapshot.forEach((doc) => {
        inquiries.push({ id: doc.id, ...doc.data() });
      });

      return inquiries;
    } catch (error) {
      // Fallback if index doesn't exist
      console.warn('Index not found for getAllInquiries, falling back to unordered query:', error);
      const inquirySnapshot = await firestore
        .collection('inquiries')
        .get();

      const inquiries = [];
      inquirySnapshot.forEach((doc) => {
        inquiries.push({ id: doc.id, ...doc.data() });
      });

      // Sort by createdAt descending
      return inquiries.sort((a, b) => {
        const aTime = a.createdAt?.seconds || a.createdAt;
        const bTime = b.createdAt?.seconds || b.createdAt;
        return bTime - aTime;
      });
    }
  }

  async respondToInquiry(
    inquiryId: string,
    adminId: string,
    response: string,
  ) {
    const firestore = this.firebaseService.getFirestore();

    const inquiryRef = firestore.collection('inquiries').doc(inquiryId);
    await inquiryRef.update({
      status: 'responded',
      response,
      respondedBy: adminId,
      respondedAt: new Date(),
      updatedAt: new Date(),
    });

    return { success: true };
  }
}
