import { Injectable, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { BusStatus } from '../auth/dto/register.dto';

@Injectable()
export class BusService {
  constructor(private firebaseService: FirebaseService) {}

  async getPendingBusRegistrations() {
    const firestore = this.firebaseService.getFirestore();
    const usersRef = firestore.collection('users');

    const snapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.PENDING)
      .get();

    const pendingBuses = [];
    snapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails) {
        pendingBuses.push({
          userId: doc.id,
          userEmail: userData.email,
          userDisplayName: userData.displayName,
          busDetails: userData.busDetails,
          submittedAt: userData.busDetails.submittedAt,
        });
      }
    });

    return pendingBuses;
  }

  async approveBusRegistration(userId: string) {
    const firestore = this.firebaseService.getFirestore();
    const userRef = firestore.collection('users').doc(userId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.busDetails) {
      throw new NotFoundException('Bus details not found');
    }

    await userRef.update({
      'busDetails.status': BusStatus.APPROVED,
      'busDetails.approvedAt': new Date(),
    });

    return { message: 'Bus registration approved successfully' };
  }

  async rejectBusRegistration(userId: string, reason?: string) {
    const firestore = this.firebaseService.getFirestore();
    const userRef = firestore.collection('users').doc(userId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.busDetails) {
      throw new NotFoundException('Bus details not found');
    }

    await userRef.update({
      'busDetails.status': BusStatus.REJECTED,
      'busDetails.rejectedAt': new Date(),
      'busDetails.rejectionReason': reason || 'No reason provided',
    });

    return { message: 'Bus registration rejected' };
  }

  async getApprovedBuses() {
    const firestore = this.firebaseService.getFirestore();
    const usersRef = firestore.collection('users');

    const snapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.APPROVED)
      .get();

    const approvedBuses = [];
    snapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails) {
        approvedBuses.push({
          userId: doc.id,
          userEmail: userData.email,
          userDisplayName: userData.displayName,
          busDetails: userData.busDetails,
        });
      }
    });

    return approvedBuses;
  }
}
