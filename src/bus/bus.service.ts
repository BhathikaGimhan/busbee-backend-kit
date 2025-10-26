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

  async searchBuses(searchCriteria: {
    from?: string;
    to?: string;
    date?: string;
  }) {
    const firestore = this.firebaseService.getFirestore();
    const usersRef = firestore.collection('users');

    const query = usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.APPROVED);

    const snapshot = await query.get();

    const matchingBuses = [];
    snapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails && userData.busDetails.route) {
        const route = userData.busDetails.route.toLowerCase();
        const fromMatch =
          !searchCriteria.from ||
          route.includes(searchCriteria.from.toLowerCase());
        const toMatch =
          !searchCriteria.to ||
          route.includes(searchCriteria.to.toLowerCase());

        if (fromMatch && toMatch) {
          matchingBuses.push({
            id: doc.id,
            busName: userData.busDetails.busName,
            busNumber: userData.busDetails.busNumber,
            route: userData.busDetails.route,
            numberOfSeats: userData.busDetails.numberOfSeats,
            busType: userData.busDetails.busType,
            driverName: userData.displayName,
            driverEmail: userData.email,
            // Mock additional data for now - in real app, this would come from bus schedules
            departureTime: '08:30 AM', // This should come from schedule data
            arrivalTime: '12:45 PM', // This should come from schedule data
            duration: '4h 15m', // This should be calculated
            price: 850, // This should come from pricing data
            availableSeats: Math.floor(
              Math.random() * userData.busDetails.numberOfSeats,
            ), // Mock available seats
          });
        }
      }
    });

    return matchingBuses;
  }
}
