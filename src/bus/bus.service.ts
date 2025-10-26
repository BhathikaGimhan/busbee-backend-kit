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

  async bookSeats(bookingData: {
    userId: string;
    busId: string;
    seats: Array<{
      seatId: string;
      seatNumber: string;
      price: number;
      type: string;
    }>;
    totalPrice: number;
    travelDate: string;
    route: string;
  }) {
    console.log(
      '📝 Starting seat booking process for user:',
      bookingData.userId,
    );

    const firestore = this.firebaseService.getFirestore();

    // Check if seats are available before booking
    const seatAvailabilityRef = firestore
      .collection('seatAvailability')
      .doc(`${bookingData.busId}_${bookingData.travelDate}`);
    const seatDoc = await seatAvailabilityRef.get();

    if (seatDoc.exists) {
      const seatData = seatDoc.data();
      console.log(
        '🔍 Checking seat availability for',
        bookingData.seats.length,
        'seats',
      );

      for (const seat of bookingData.seats) {
        if (seatData?.seats?.[seat.seatId]?.status === 'booked') {
          console.log('❌ Seat already booked:', seat.seatNumber);
          throw new Error(`Seat ${seat.seatNumber} is no longer available`);
        }
      }
    }

    // Create booking record
    const bookingRef = firestore.collection('bookings').doc();
    const bookingId = bookingRef.id;

    const booking = {
      id: bookingId,
      userId: bookingData.userId,
      busId: bookingData.busId,
      seats: bookingData.seats,
      totalPrice: bookingData.totalPrice,
      travelDate: bookingData.travelDate,
      route: bookingData.route,
      status: 'confirmed',
      bookedAt: new Date(),
      paymentStatus: 'pending',
    };

    console.log('🔄 Starting Firestore transaction for booking:', bookingId);

    // Use transaction to ensure atomic seat booking
    await firestore
      .runTransaction(async (transaction) => {
        console.log('📊 Updating seat availability...');

        try {
          // FIRST: Read the user document to check if it exists
          console.log('👤 Checking user document...');
          const userRef = firestore.collection('users').doc(bookingData.userId);
          const userDoc = await transaction.get(userRef);

          // Prepare all the writes
          const seatUpdate = {};
          bookingData.seats.forEach((seat) => {
            seatUpdate[`seats.${seat.seatId}`] = {
              seatNumber: seat.seatNumber,
              status: 'booked',
              bookedBy: bookingData.userId,
              bookedAt: new Date(),
              price: seat.price,
              type: seat.type,
            };
          });

          // NOW: Execute all writes
          transaction.set(
            seatAvailabilityRef,
            {
              busId: bookingData.busId,
              travelDate: bookingData.travelDate,
              route: bookingData.route,
              lastUpdated: new Date(),
              ...seatUpdate,
            },
            { merge: true },
          );

          console.log('📋 Creating booking record...');
          // Create booking record
          transaction.set(bookingRef, booking);

          console.log('👤 Updating user bookings...');
          // Update user's bookings
          if (userDoc.exists) {
            const userData = userDoc.data();
            const existingBookings = userData?.bookings || [];
            existingBookings.push(bookingId);

            transaction.update(userRef, {
              bookings: existingBookings,
            });
            console.log('✅ User bookings updated');
          } else {
            console.log('❌ User document not found, creating it...');
            // Create user document if it doesn't exist
            transaction.set(userRef, {
              uid: bookingData.userId,
              email: '', // We don't have email here, but this should be set during registration
              displayName: '',
              userType: 'passenger',
              bookings: [bookingId],
              createdAt: new Date(),
            });
            console.log('✅ User document created with booking');
          }
        } catch (transactionError) {
          console.error('❌ Transaction error:', transactionError);
          throw transactionError;
        }
      })
      .catch((error) => {
        console.error('❌ Transaction failed:', error);
        throw error;
      });

    console.log('🎉 Booking completed successfully:', bookingId);
    return {
      bookingId,
      message: 'Seats booked successfully',
      booking,
    };
  }

  async getSeatAvailability(busId: string, travelDate: string) {
    const firestore = this.firebaseService.getFirestore();
    const seatAvailabilityRef = firestore
      .collection('seatAvailability')
      .doc(`${busId}_${travelDate}`);

    const seatDoc = await seatAvailabilityRef.get();

    if (!seatDoc.exists) {
      // Return default seat layout if no bookings exist yet
      return this.generateDefaultSeats(busId, travelDate);
    }

    return seatDoc.data();
  }

  private generateDefaultSeats(busId: string, travelDate: string) {
    // Get bus details to know total seats
    // For now, return a default layout - in real app, this would come from bus configuration
    const defaultSeats = {};
    const totalSeats = 54; // This should come from bus data
    const seatsPerRow = 4;
    const rows = Math.ceil(totalSeats / seatsPerRow);

    for (let row = 1; row <= rows; row++) {
      for (let seat = 1; seat <= seatsPerRow; seat++) {
        const seatNumber = `${row}${String.fromCharCode(64 + seat)}`;
        const seatId = `seat-${row}-${seat}`;

        let seatType: 'regular' | 'premium' | 'wheelchair' = 'regular';
        let price = 850; // Base price

        if (row === 1) {
          seatType = 'premium';
          price = Math.round(850 * 1.2); // 20% more for front row
        } else if (seat === 1 && row % 3 === 0) {
          // Every 3rd row, first seat is wheelchair
          seatType = 'wheelchair';
          price = 850; // Same price for wheelchair
        }

        defaultSeats[seatId] = {
          seatNumber,
          status: 'available',
          price,
          type: seatType,
        };
      }
    }

    return {
      busId,
      travelDate,
      seats: defaultSeats,
      lastUpdated: new Date(),
    };
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
          !searchCriteria.to || route.includes(searchCriteria.to.toLowerCase());

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
