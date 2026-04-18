import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { BusStatus } from '../auth/dto/register.dto';
import { AddBusDto } from './dto/add-bus.dto';
import * as admin from 'firebase-admin';
import * as moment from 'moment-timezone';

@Injectable()
export class BusService implements OnModuleInit {
  // In-memory cache for trackable buses to avoid hammering Firestore
  // Key: passengerId, Value: { result, expiresAt }
  private trackableBusesCache = new Map<
    string,
    { result: any[]; expiresAt: number }
  >();

  // Global high-performance location cache (shared across all passengers)
  // Key: busId or driverId, Value: { lat, lng, updatedAt }
  private static GLOBAL_BUS_LOCATION_CACHE = new Map<string, any>();

  private static TRACKER_CACHE_TTL_MS = 600_000; // 10 minutes (upgraded from 30s)

  async getAdminDashboardStats() {
    const firestore = this.firebaseService.getFirestore();

    // 1. Total Buses (Approved)
    const busesRef = firestore.collection('buses');
    const busesSnapshot = await busesRef
      .where('status', '==', BusStatus.APPROVED)
      .get();

    const usersRef = firestore.collection('users');
    const legacyBusesSnapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.APPROVED)
      .get();

    const totalBuses = busesSnapshot.size + legacyBusesSnapshot.size;

    // 2. Active Trips
    const tripsRef = firestore.collection('trips');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];
    let activeTrips = 0;
    try {
      // Query trips from today onwards
      const tripsSnapshot = await tripsRef
        .where('travelDate', '>=', dateStr)
        .get();
      activeTrips = tripsSnapshot.size;
    } catch (e) {
      // Catch index issues
      console.error(e);
    }

    // 3. Total Bookings & Revenue
    const bookingsRef = firestore.collection('bookings');
    let totalBookings = 0;
    let revenue = 0;
    const monthlyDataMap = new Map();

    // Initialize last 6 months
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      let d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = monthNames[d.getMonth()];
      monthlyDataMap.set(monthName, {
        month: monthName,
        revenue: 0,
        bookings: 0,
      });
    }

    try {
      const bookingsSnapshot = await bookingsRef
        .where('status', '==', 'confirmed')
        .get();
      bookingsSnapshot.forEach((doc) => {
        const data = doc.data();
        totalBookings++;
        const price = data.totalPrice || 0;
        revenue += price;

        let bookedAtDate = new Date();
        if (data.bookedAt) {
          bookedAtDate = data.bookedAt.toDate
            ? data.bookedAt.toDate()
            : new Date(data.bookedAt);
        }

        const monthName = monthNames[bookedAtDate.getMonth()];
        if (monthlyDataMap.has(monthName)) {
          monthlyDataMap.get(monthName).revenue += price;
          monthlyDataMap.get(monthName).bookings += 1;
        }
      });
    } catch (e) {
      console.error(e);
    }

    return {
      summaryData: {
        totalBuses,
        activeTrips,
        totalBookings,
        revenue,
      },
      chartData: Array.from(monthlyDataMap.values()),
    };
  }

  constructor(private firebaseService: FirebaseService) {}

  onModuleInit() {
    // Periodically clean up expired cache entries (every 10 minutes)
    // This prevents the trackableBusesCache from growing indefinitely
    // if users only call it once.
    setInterval(() => {
      const now = Date.now();
      let deleteCount = 0;
      for (const [key, value] of this.trackableBusesCache.entries()) {
        if (now > value.expiresAt) {
          this.trackableBusesCache.delete(key);
          deleteCount++;
        }
      }
      if (deleteCount > 0) {
        console.log(
          `[CacheCleanup] Pruned ${deleteCount} expired entries from trackableBusesCache`,
        );
      }
    }, 600000); // 10 minutes
  }

  async getPendingBusRegistrations() {
    const firestore = this.firebaseService.getFirestore();
    const pendingBuses = [];

    // 1. Fetch from 'users' collection (Legacy buses)
    const usersRef = firestore.collection('users');
    const usersSnapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.PENDING)
      .get();

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails) {
        pendingBuses.push({
          id: doc.id, // Use userId as busId for legacy buses
          userId: doc.id,
          userEmail: userData.email,
          userDisplayName: userData.displayName,
          busDetails: userData.busDetails,
          submittedAt: userData.busDetails.submittedAt,
          isLegacy: true,
        });
      }
    });

    // 2. Fetch from 'buses' collection (New buses)
    const busesRef = firestore.collection('buses');
    const busesSnapshot = await busesRef
      .where('status', '==', BusStatus.PENDING)
      .get();

    for (const doc of busesSnapshot.docs) {
      const busData = doc.data();
      // Fetch driver details
      let driverName = 'Unknown';
      let driverEmail = '';
      try {
        const driverDoc = await usersRef.doc(busData.driverId).get();
        if (driverDoc.exists) {
          const driverData = driverDoc.data();
          driverName = driverData.displayName;
          driverEmail = driverData.email;
        }
      } catch (e) {
        console.error(`Error fetching driver for bus ${doc.id}:`, e);
      }

      pendingBuses.push({
        id: doc.id,
        userId: busData.driverId,
        userEmail: driverEmail,
        userDisplayName: driverName,
        busDetails: {
          ...busData,
          status: busData.status, // Ensure status is present in busDetails structure for frontend compatibility
        },
        submittedAt: busData.submittedAt,
        isLegacy: false,
      });
    }

    return pendingBuses;
  }

  async approveBusRegistration(id: string) {
    const firestore = this.firebaseService.getFirestore();

    // Check if it's a legacy bus (userId) or new bus (busId)
    // We try 'users' collection first. If user exists and has a bus, we assume it's legacy approval if the bus is pending.
    // However, if the ID passed isn't a user ID, or user doesn't have pending bus, we check 'buses' collection.

    const userRef = firestore.collection('users').doc(id);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const userData = userDoc.data();
      if (
        userData?.busDetails &&
        userData.busDetails.status === BusStatus.PENDING
      ) {
        // It is a legacy bus registration on the user profile
        await userRef.update({
          'busDetails.status': BusStatus.APPROVED,
          'busDetails.approvedAt': new Date(),
        });
        return { message: 'Bus registration approved successfully (Legacy)' };
      }
    }

    // If not a legacy bus, check 'buses' collection
    const busRef = firestore.collection('buses').doc(id);
    const busDoc = await busRef.get();

    if (busDoc.exists) {
      await busRef.update({
        status: BusStatus.APPROVED,
        approvedAt: new Date(),
      });
      return { message: 'Bus registration approved successfully' };
    }

    throw new NotFoundException('Bus registration not found');
  }

  async rejectBusRegistration(id: string, reason?: string) {
    const firestore = this.firebaseService.getFirestore();

    // Check legacy first
    const userRef = firestore.collection('users').doc(id);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const userData = userDoc.data();
      if (
        userData?.busDetails &&
        userData.busDetails.status === BusStatus.PENDING
      ) {
        await userRef.update({
          'busDetails.status': BusStatus.REJECTED,
          'busDetails.rejectedAt': new Date(),
          'busDetails.rejectionReason': reason || 'No reason provided',
        });
        return { message: 'Bus registration rejected (Legacy)' };
      }
    }

    // Check new buses
    const busRef = firestore.collection('buses').doc(id);
    const busDoc = await busRef.get();

    if (busDoc.exists) {
      await busRef.update({
        status: BusStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: reason || 'No reason provided',
      });
      return { message: 'Bus registration rejected' };
    }

    throw new NotFoundException('Bus registration not found');
  }

  async getApprovedBuses() {
    const firestore = this.firebaseService.getFirestore();
    const approvedBuses = [];

    // 1. Legacy Buses
    const usersRef = firestore.collection('users');
    const usersSnapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.APPROVED)
      .get();

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails) {
        approvedBuses.push({
          id: doc.id,
          userId: doc.id,
          userEmail: userData.email,
          userDisplayName: userData.displayName,
          busDetails: userData.busDetails,
          isLegacy: true,
        });
      }
    });

    // 2. New Buses
    const busesRef = firestore.collection('buses');
    const busesSnapshot = await busesRef
      .where('status', '==', BusStatus.APPROVED)
      .get();

    for (const doc of busesSnapshot.docs) {
      const busData = doc.data();
      let driverName = 'Unknown';
      let driverEmail = '';
      try {
        const driverDoc = await usersRef.doc(busData.driverId).get();
        if (driverDoc.exists) {
          const driverData = driverDoc.data();
          driverName = driverData.displayName;
          driverEmail = driverData.email;
        }
      } catch (e) {
        console.error(`Error fetching driver for bus ${doc.id}:`, e);
      }

      approvedBuses.push({
        id: doc.id,
        userId: busData.driverId,
        userEmail: driverEmail,
        userDisplayName: driverName,
        busDetails: {
          ...busData,
          status: busData.status,
        },
        isLegacy: false,
      });
    }

    return approvedBuses;
  }

  async getRejectedBuses() {
    const firestore = this.firebaseService.getFirestore();
    const rejectedBuses = [];

    // 1. Legacy Buses
    const usersRef = firestore.collection('users');
    const usersSnapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.REJECTED)
      .get();

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails) {
        rejectedBuses.push({
          id: doc.id,
          userId: doc.id,
          userEmail: userData.email,
          userDisplayName: userData.displayName,
          busDetails: userData.busDetails,
          isLegacy: true,
        });
      }
    });

    // 2. New Buses
    const busesRef = firestore.collection('buses');
    const busesSnapshot = await busesRef
      .where('status', '==', BusStatus.REJECTED)
      .get();

    for (const doc of busesSnapshot.docs) {
      const busData = doc.data();
      let driverName = 'Unknown';
      let driverEmail = '';
      try {
        const driverDoc = await usersRef.doc(busData.driverId).get();
        if (driverDoc.exists) {
          const driverData = driverDoc.data();
          driverName = driverData.displayName;
          driverEmail = driverData.email;
        }
      } catch (e) {
        console.error(`Error fetching driver for bus ${doc.id}:`, e);
      }

      rejectedBuses.push({
        id: doc.id,
        userId: busData.driverId,
        userEmail: driverEmail,
        userDisplayName: driverName,
        busDetails: {
          ...busData,
          status: busData.status,
        },
        isLegacy: false,
      });
    }

    return rejectedBuses;
  }

  async addBus(driverId: string, addBusDto: AddBusDto) {
    const firestore = this.firebaseService.getFirestore();
    const busesRef = firestore.collection('buses');

    const newBusRef = busesRef.doc();
    const busData = {
      ...addBusDto,
      id: newBusRef.id,
      driverId: driverId,
      status: BusStatus.PENDING,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await newBusRef.set(busData);

    return {
      message: 'Bus registered successfully',
      busId: newBusRef.id,
      bus: busData,
    };
  }

  async getMyBuses(driverId: string) {
    const firestore = this.firebaseService.getFirestore();
    const buses = [];

    // 1. Fetch Legacy Bus
    const userRef = firestore.collection('users').doc(driverId);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData?.busDetails) {
        buses.push({
          id: driverId, // Legacy bus ID is user ID
          ...userData.busDetails,
          isLegacy: true,
        });
      }
    }

    // 2. Fetch New Buses
    const busesRef = firestore.collection('buses');
    const snapshot = await busesRef.where('driverId', '==', driverId).get();

    snapshot.forEach((doc) => {
      buses.push({
        id: doc.id,
        ...doc.data(),
        isLegacy: false,
      });
    });

    return buses;
  }

  async getPrivateHireBuses() {
    const firestore = this.firebaseService.getFirestore();
    const busesRef = firestore.collection('buses');

    // Query buses that are approved and available for trips
    const snapshot = await busesRef
      .where('availableForTrips', '==', true)
      .where('status', '==', BusStatus.APPROVED)
      .get();

    const buses = [];
    for (const doc of snapshot.docs) {
      const busData = doc.data();

      // Optionally fetch driver details if needed
      // For now returning the bus data directly
      buses.push({
        id: doc.id,
        ...busData,
      });
    }

    return buses;
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
    tripId?: string;
    isTripBooking?: boolean;
    isPrivateHire?: boolean;
  }) {
    console.log(
      '📝 Starting seat booking process for user:',
      bookingData.userId,
    );

    const firestore = this.firebaseService.getFirestore();

    // Validate operating days before proceeding
    const busDoc = await firestore
      .collection('users')
      .doc(bookingData.busId)
      .get();
    if (!busDoc.exists) {
      throw new NotFoundException('Bus not found');
    }

    const busData = busDoc.data();
    if (busData?.busDetails?.operatingDays) {
      // Convert travel date to day of week
      const travelDate = new Date(bookingData.travelDate);
      const dayOfWeek = travelDate
        .toLocaleDateString('en-US', {
          weekday: 'long',
        })
        .toUpperCase();

      // Check if bus operates on this day
      if (!busData.busDetails.operatingDays.includes(dayOfWeek)) {
        throw new BadRequestException(
          `This bus does not operate on ${dayOfWeek}s. Operating days: ${busData.busDetails.operatingDays.join(', ')}`,
        );
      }
    }

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
      ...(bookingData.isTripBooking &&
        bookingData.tripId && {
          tripId: bookingData.tripId,
          isTripBooking: true,
        }),
      ...(bookingData.isPrivateHire && {
        isPrivateHire: true,
        hireType: 'full_bus',
      }),
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

          if (bookingData.isPrivateHire) {
            // Handle private bus hire - book entire bus
            console.log('🚌 Handling private bus hire...');
            const busDoc = await transaction.get(
              firestore.collection('users').doc(bookingData.busId),
            );

            if (!busDoc.exists) {
              throw new Error('Bus not found');
            }

            const busData = busDoc.data();
            const totalSeats = busData.busDetails?.numberOfSeats || 0;

            // Create seat entries for all seats on the bus
            const allSeats = [];
            for (let i = 1; i <= totalSeats; i++) {
              allSeats.push({
                seatId: `seat_${i}`,
                seatNumber: i.toString(),
                status: 'booked',
                bookedBy: bookingData.userId,
                bookedAt: new Date(),
                price: bookingData.totalPrice / totalSeats, // Distribute price across seats
                type: 'private_hire',
              });
            }

            // Update seat availability with all seats booked
            transaction.set(
              seatAvailabilityRef,
              {
                busId: bookingData.busId,
                travelDate: bookingData.travelDate,
                route: bookingData.route,
                seats: allSeats.reduce((acc, seat) => {
                  acc[seat.seatId] = seat;
                  return acc;
                }, {}),
                lastUpdated: new Date(),
                isPrivateHire: true,
                hiredBy: bookingData.userId,
              },
              { merge: true },
            );

            console.log('✅ Private hire booking completed');
          } else if (bookingData.isTripBooking && bookingData.tripId) {
            // Handle trip booking
            console.log('🚌 Handling trip booking...');
            const tripRef = firestore
              .collection('trips')
              .doc(bookingData.tripId);
            const tripDoc = await transaction.get(tripRef);

            if (!tripDoc.exists) {
              throw new Error('Trip not found');
            }

            const tripData = tripDoc.data();
            const seatsToBook = bookingData.seats.length;
            const availableSeats =
              tripData.availableSeats - tripData.bookedSeats;

            if (availableSeats < seatsToBook) {
              throw new Error('Not enough seats available for this trip');
            }

            // Update trip booked seats
            transaction.update(tripRef, {
              bookedSeats: tripData.bookedSeats + seatsToBook,
            });

            console.log('✅ Trip seats updated');          } else {
            // Handle regular bus booking
            console.log('🚌 Handling regular bus booking...');

            // TRANSACTIONAL SEAT CHECK: Prevent double-booking
            const currentSeatDoc = await transaction.get(seatAvailabilityRef);
            if (currentSeatDoc.exists) {
              const currentSeatData = currentSeatDoc.data();
              for (const seat of bookingData.seats) {
                if (currentSeatData?.seats && currentSeatData.seats[seat.seatId]?.status === 'booked') {
                  throw new BadRequestException(`Seat ${seat.seatNumber} is already booked.`);
                }
              }
            }

            // Prepare all the writes as a nested object, not dotted strings
            const seatUpdates = {};
            bookingData.seats.forEach((seat) => {
              seatUpdates[seat.seatId] = {
                seatNumber: seat.seatNumber,
                status: 'booked',
                bookedBy: bookingData.userId,
                bookedAt: new Date(),
                price: seat.price,
                type: seat.type,
              };
            });

            // Update seat availability
            transaction.set(
              seatAvailabilityRef,
              {
                busId: bookingData.busId,
                travelDate: bookingData.travelDate,
                route: bookingData.route,
                lastUpdated: new Date(),
                seats: seatUpdates,
              },
              { merge: true },
            );
          }

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
      const defaultLayout = await this.generateDefaultSeats(busId, travelDate);

      if (!seatDoc.exists) {
        // Return default seat layout if no bookings exist yet
        return defaultLayout;
      }

      const bookedData = seatDoc.data();
      
      // Merge the booked seats over the available default seats
      // to ensure the frontend receives all 54 seats.
      if (bookedData && bookedData.seats) {
        for (const [seatId, seatInfo] of Object.entries(bookedData.seats)) {
          // @ts-ignore
          defaultLayout.seats[seatId] = seatInfo;
        }
      }

      // Return the complete merged layout
      bookedData.seats = defaultLayout.seats;
      return bookedData;
    }

private async generateDefaultSeats(busId: string, travelDate: string) {
      // Get bus details to know total seats
      const firestore = this.firebaseService.getFirestore();
      const busDoc = await firestore.collection('users').doc(busId).get();
      
      let totalSeats = 54; // default fallback
      if (busDoc.exists) {
        const busData = busDoc.data();
        if (busData?.busDetails?.numberOfSeats) {
          totalSeats = Number(busData.busDetails.numberOfSeats);
        }
      }

      const defaultSeats = {};
      const seatsPerRow = 4;
      const rows = Math.ceil(totalSeats / seatsPerRow);
      let generatedCount = 0;

      for (let row = 1; row <= rows; row++) {
        for (let seat = 1; seat <= seatsPerRow; seat++) {
          if (generatedCount >= totalSeats) break;

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

          generatedCount++;
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
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      if (userData.busDetails && userData.busDetails.route) {
        const route = userData.busDetails.route.toLowerCase();

        // Parse route to extract from and to locations
        const separators = [' to ', ' - ', ' → ', ' -> ', ' | '];
        let routeFrom = '';
        let routeTo = '';

        for (const separator of separators) {
          if (route.includes(separator)) {
            const parts = route.split(separator);
            if (parts.length >= 2) {
              routeFrom = parts[0].trim();
              routeTo = parts[1].trim();
              break;
            }
          }
        }

        // If we couldn't parse with separators, check if it's a single location
        if (!routeFrom && !routeTo) {
          routeFrom = route.trim();
        }

        // Enhanced matching logic - more precise route matching
        let fromMatch = true;
        let toMatch = true;

        if (searchCriteria.from) {
          const searchFrom = searchCriteria.from.toLowerCase().trim();
          // For "from" searches, match if the bus route starts from the searched location
          // OR if it's a round trip and goes to the searched location
          fromMatch =
            routeFrom.toLowerCase().includes(searchFrom) ||
            (routeTo.toLowerCase().includes(searchFrom) &&
              route.includes('return'));
        }

        if (searchCriteria.to) {
          const searchTo = searchCriteria.to.toLowerCase().trim();
          // For "to" searches, match if the bus route goes to the searched location
          // OR if it's a round trip and starts from the searched location
          toMatch =
            routeTo.toLowerCase().includes(searchTo) ||
            (routeFrom.toLowerCase().includes(searchTo) &&
              route.includes('return'));
        }

        // If both from and to are specified, require exact route match
        if (searchCriteria.from && searchCriteria.to) {
          const searchFrom = searchCriteria.from.toLowerCase().trim();
          const searchTo = searchCriteria.to.toLowerCase().trim();
          fromMatch = routeFrom.toLowerCase().includes(searchFrom);
          toMatch = routeTo.toLowerCase().includes(searchTo);
        }

        if (fromMatch && toMatch) {
          const busData = {
            id: doc.id,
            busName: userData.busDetails.busName,
            busNumber: userData.busDetails.busNumber,
            route: userData.busDetails.route,
            numberOfSeats: userData.busDetails.numberOfSeats,
            busType: userData.busDetails.busType,
            driverName: userData.displayName,
            driverEmail: userData.email,
            availableForTrips: userData.busDetails.availableForTrips || false,
            operatingDays: userData.busDetails.operatingDays || [],
          };

          // If bus is available for trips, include available trips
          if (userData.busDetails.busType === 'trip_available') {
            const trips = await this.getBusTrips(doc.id, searchCriteria.date);
            if (trips.length > 0) {
              matchingBuses.push({
                ...busData,
                isTripBooking: true,
                availableTrips: trips,
              });
            }
          } else {
            // Regular route bus
            matchingBuses.push({
              ...busData,
              isTripBooking: false,
              // Mock additional data for regular routes
              departureTime: '08:30 AM',
              arrivalTime: '12:45 PM',
              duration: '4h 15m',
              price: 850,
              availableSeats: Math.floor(
                Math.random() * userData.busDetails.numberOfSeats,
              ),
            });
          }
        }
      }
    }

    return matchingBuses;
  }

  async getBusTrips(busId: string, date?: string) {
    const firestore = this.firebaseService.getFirestore();
    const tripsRef = firestore.collection('trips');

    let query = tripsRef.where('busId', '==', busId);

    if (date) {
      // Filter by date if provided
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      query = query
        .where('departureTime', '>=', startOfDay)
        .where('departureTime', '<=', endOfDay);
    }

    const snapshot = await query.get();
    const trips = [];

    for (const doc of snapshot.docs) {
      const tripData = doc.data();
      trips.push({
        id: doc.id,
        ...tripData,
        departureTime: tripData.departureTime.toDate(),
        arrivalTime: tripData.arrivalTime.toDate(),
      });
    }

    return trips;
  }

  async createTrip(tripData: {
    busId: string;
    from: string;
    to: string;
    departureTime: Date;
    arrivalTime: Date;
    price: number;
    availableSeats: number;
  }) {
    const firestore = this.firebaseService.getFirestore();

    // Verify bus exists and is available for trips
    const busDoc = await firestore
      .collection('users')
      .doc(tripData.busId)
      .get();
    if (!busDoc.exists) {
      throw new NotFoundException('Bus not found');
    }

    const busData = busDoc.data();
    if (
      !busData.busDetails ||
      busData.busDetails.busType !== 'trip_available'
    ) {
      throw new BadRequestException('Bus is not available for trips');
    }

    // Create trip
    const tripRef = firestore.collection('trips').doc();
    await tripRef.set({
      id: tripRef.id,
      busId: tripData.busId,
      from: tripData.from,
      to: tripData.to,
      departureTime: tripData.departureTime,
      arrivalTime: tripData.arrivalTime,
      price: tripData.price,
      availableSeats: tripData.availableSeats,
      bookedSeats: 0,
      status: 'active',
      createdAt: new Date(),
    });

    return {
      tripId: tripRef.id,
      message: 'Trip created successfully',
    };
  }

  async createHireRequest(requestData: any) {
    const firestore = this.firebaseService.getFirestore();

    // Verify bus exists
    const busDoc = await firestore
      .collection('buses')
      .doc(requestData.busId)
      .get();

    if (!busDoc.exists) {
      throw new NotFoundException('Bus not found');
    }

    const busData = busDoc.data();

    // Create hire request
    const requestRef = firestore.collection('hireRequests').doc();
    await requestRef.set({
      id: requestRef.id,
      ...requestData,
      driverId: busData?.driverId, // Ensure driverId is linked
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('✅ Hire request created:', requestRef.id);

    return {
      requestId: requestRef.id,
      message: 'Hire request submitted successfully',
    };
  }

  async getHireRequests(userId: string, role: 'passenger' | 'driver') {
    const firestore = this.firebaseService.getFirestore();
    const requestsRef = firestore.collection('hireRequests');

    let query;
    if (role === 'passenger') {
      query = requestsRef.where('userId', '==', userId);
    } else {
      // For driver, get requests where they are the driver
      query = requestsRef.where('driverId', '==', userId);
    }

    let snapshot;
    try {
      snapshot = await query.orderBy('createdAt', 'desc').get();
    } catch (e) {
      console.warn('Index missing, falling back to unordered query');
      snapshot = await query.get();
    }

    const requests: any[] = [];
    snapshot.forEach((doc) => {
      requests.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Ensure sorted (needed if fallback used)
    requests.sort((a, b) => {
      const dateA = a.createdAt?.toDate
        ? a.createdAt.toDate().getTime()
        : new Date(a.createdAt).getTime();
      const dateB = b.createdAt?.toDate
        ? b.createdAt.toDate().getTime()
        : new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    return requests;
  }

  async updateHireRequestStatus(
    requestId: string,
    status:
      | 'price_quoted'
      | 'price_accepted'
      | 'confirmed'
      | 'rejected'
      | 'completed',
    finalPrice?: number,
    driverNotes?: string,
  ) {
    const firestore = this.firebaseService.getFirestore();
    const requestRef = firestore.collection('hireRequests').doc(requestId);

    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      throw new NotFoundException('Hire request not found');
    }

    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (driverNotes) {
      updateData.driverNotes = driverNotes;
    }

    if (finalPrice !== undefined) {
      updateData.finalPrice = finalPrice;
    }

    if (status === 'price_quoted') {
      updateData.respondedAt = new Date();
    } else if (status === 'price_accepted') {
      updateData.acceptedAt = new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    await requestRef.update(updateData);

    console.log(`✅ Hire request ${requestId} status updated to: ${status}`);

    return {
      message: `Hire request ${status.replace('_', ' ')} successfully`,
    };
  }

  // Booking management methods
  async getDriverBookings(driverId: string) {
    const firestore = this.firebaseService.getFirestore();

    // Get driver's buses
    const usersRef = firestore.collection('users').doc(driverId);
    const userDoc = await usersRef.get();

    if (!userDoc.exists) {
      throw new NotFoundException('Driver not found');
    }

    // Use driverId directly as busId since that's how the system works
    const busId = driverId;

    // Get all bookings for this bus
    const bookingsRef = firestore.collection('bookings');

    try {
      const snapshot = await bookingsRef
        .where('busId', '==', busId)
        .orderBy('bookedAt', 'desc')
        .get();

      const bookings = [];
      for (const doc of snapshot.docs) {
        const bookingData = doc.data();

        // Get passenger details
        const passengerDoc = await firestore
          .collection('users')
          .doc(bookingData.userId)
          .get();
        const passengerData = passengerDoc.data();

        bookings.push({
          id: doc.id,
          ...bookingData,
          passengerName: passengerData?.displayName || 'Unknown',
          passengerEmail: passengerData?.email || '',
          passengerPhone: passengerData?.phoneNumber || '',
          // Transform data for frontend
          seatsBooked: bookingData.seats?.length || 0,
          totalAmount: bookingData.totalPrice || 0,
          // Parse route to extract from and to locations
          from: bookingData.route
            ? bookingData.route.split(' to ')[0]?.trim() || ''
            : '',
          to: bookingData.route
            ? bookingData.route.split(' to ')[1]?.trim() || ''
            : '',
          bookingDate: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          bookedAt: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          travelDate:
            bookingData.travelDate?.toDate?.() || bookingData.travelDate,
        });
      }

      return bookings;
    } catch (error) {
      // If index doesn't exist, fetch without orderBy
      console.warn(
        'Firestore index not found for driver bookings query, fetching without ordering:',
        error.message,
      );
      const snapshot = await bookingsRef.where('busId', '==', busId).get();

      const bookings = [];
      for (const doc of snapshot.docs) {
        const bookingData = doc.data();

        // Get passenger details
        const passengerDoc = await firestore
          .collection('users')
          .doc(bookingData.userId)
          .get();
        const passengerData = passengerDoc.data();

        bookings.push({
          id: doc.id,
          ...bookingData,
          passengerName: passengerData?.displayName || 'Unknown',
          passengerEmail: passengerData?.email || '',
          passengerPhone: passengerData?.phoneNumber || '',
          // Transform data for frontend
          seatsBooked: bookingData.seats?.length || 0,
          totalAmount: bookingData.totalPrice || 0,
          // Parse route to extract from and to locations
          from: bookingData.route
            ? bookingData.route.split(' to ')[0]?.trim() || ''
            : '',
          to: bookingData.route
            ? bookingData.route.split(' to ')[1]?.trim() || ''
            : '',
          bookingDate: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          bookedAt: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          travelDate:
            bookingData.travelDate?.toDate?.() || bookingData.travelDate,
        });
      }

      // Sort in memory by bookedAt (most recent first)
      bookings.sort((a, b) => {
        const aTime = a.bookedAt?.seconds || a.bookedAt || 0;
        const bTime = b.bookedAt?.seconds || b.bookedAt || 0;
        return bTime - aTime;
      });

      return bookings;
    }
  }

  async getPassengerBookings(passengerId: string) {
    const firestore = this.firebaseService.getFirestore();
    const bookingsRef = firestore.collection('bookings');

    try {
      const snapshot = await bookingsRef
        .where('userId', '==', passengerId)
        .orderBy('bookedAt', 'desc')
        .get();

      const bookings = [];
      snapshot.forEach((doc) => {
        const bookingData = doc.data();
        bookings.push({
          id: doc.id,
          ...bookingData,
          bookedAt: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          travelDate:
            bookingData.travelDate?.toDate?.() || bookingData.travelDate,
        });
      });

      return bookings;
    } catch (error) {
      // If index doesn't exist, fetch without orderBy
      console.warn(
        'Firestore index not found for bookings query, fetching without ordering:',
        error.message,
      );
      const snapshot = await bookingsRef
        .where('userId', '==', passengerId)
        .get();

      const bookings = [];
      snapshot.forEach((doc) => {
        const bookingData = doc.data();
        bookings.push({
          id: doc.id,
          ...bookingData,
          bookedAt: bookingData.bookedAt?.toDate?.() || bookingData.bookedAt,
          travelDate:
            bookingData.travelDate?.toDate?.() || bookingData.travelDate,
        });
      });

      // Sort in memory by bookedAt (most recent first)
      bookings.sort((a, b) => {
        const aTime = a.bookedAt?.seconds || a.bookedAt || 0;
        const bTime = b.bookedAt?.seconds || b.bookedAt || 0;
        return bTime - aTime;
      });

      return bookings;
    }
  }

  async updateBookingStatus(
    bookingId: string,
    status: 'confirmed' | 'cancelled',
  ) {
    const firestore = this.firebaseService.getFirestore();
    const bookingRef = firestore.collection('bookings').doc(bookingId);

    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      throw new NotFoundException('Booking not found');
    }

    await bookingRef.update({
      status,
      updatedAt: new Date(),
      ...(status === 'confirmed' && { confirmedAt: new Date() }),
      ...(status === 'cancelled' && { cancelledAt: new Date() }),
    });

    console.log(`✅ Booking ${bookingId} status updated to: ${status}`);

    return {
      message: `Booking ${status} successfully`,
    };
  }

  // ==================== ROUTINE MANAGEMENT ====================

  async createRoutine(createRoutineDto: any) {
    const firestore = this.firebaseService.getFirestore();
    const routinesRef = firestore.collection('routines');

    const newRoutine = {
      ...createRoutineDto,
      status: 'pending_approval',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log(
      '📝 Creating Routine Payload:',
      JSON.stringify(newRoutine, null, 2),
    );

    const docRef = await routinesRef.add(newRoutine);

    console.log(`✅ Routine created with ID: ${docRef.id}`);

    return {
      id: docRef.id,
      ...newRoutine,
    };
  }

  async getPendingRoutines() {
    const firestore = this.firebaseService.getFirestore();
    const routinesRef = firestore.collection('routines');

    try {
      const snapshot = await routinesRef
        .where('status', '==', 'pending_approval')
        .orderBy('createdAt', 'desc')
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return routines;
    } catch (error) {
      console.warn(
        'Firestore index not found, fetching without ordering:',
        error.message,
      );
      const snapshot = await routinesRef
        .where('status', '==', 'pending_approval')
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Sort in memory
      routines.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });

      return routines;
    }
  }

  async getRoutinesByDriver(driverId: string) {
    const firestore = this.firebaseService.getFirestore();
    const routinesRef = firestore.collection('routines');

    try {
      const snapshot = await routinesRef
        .where('driverId', '==', driverId)
        .orderBy('createdAt', 'desc')
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return routines;
    } catch (error) {
      // If index doesn't exist, fetch without orderBy
      console.warn(
        'Firestore index not found, fetching without ordering:',
        error.message,
      );
      const snapshot = await routinesRef
        .where('driverId', '==', driverId)
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Sort in memory
      routines.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });

      return routines;
    }
  }

  async getRoutinesByBus(busId: string) {
    const firestore = this.firebaseService.getFirestore();
    const routinesRef = firestore.collection('routines');

    try {
      const snapshot = await routinesRef
        .where('busId', '==', busId)
        .where('status', '==', 'approved')
        .orderBy('createdAt', 'asc')
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      return routines;
    } catch (error) {
      console.warn(
        'Firestore index not found, fetching without ordering:',
        error.message,
      );
      const snapshot = await routinesRef
        .where('busId', '==', busId)
        .where('status', '==', 'approved')
        .get();

      const routines = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      routines.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });

      return routines;
    }
  }

  async getApprovedRoutines() {
    const firestore = this.firebaseService.getFirestore();
    const routinesRef = firestore.collection('routines');

    try {
      const snapshot = await routinesRef
        .where('status', '==', 'approved')
        .orderBy('createdAt', 'desc')
        .get();

      const routines: any[] = [];
      const busIds = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data();
        busIds.add(data.busId);
        routines.push({
          id: doc.id,
          ...data,
        });
      });

      // Fetch details for all relevant buses
      const busDetailsMap = new Map();
      if (busIds.size > 0) {
        // Firestore 'in' query supports up to 10 items. For robustness, we'll fetch individually or ideally allow up to 10 batches.
        // For simplicity/safety with larger sets, let's fetch individual user docs concurrently or use batches.
        // Given potentially many buses, fetching individually with Promise.all is reasonable for now if not massive scale.
        const busPromises = Array.from(busIds).map(async (busId) => {
          const userDoc = await firestore.collection('users').doc(busId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            return {
              busId,
              busName: userData.busDetails?.busName || 'Unknown Bus',
              busNumber: userData.busDetails?.busNumber || 'N/A',
              driverName: userData.displayName || 'Unknown Driver',
            };
          }
          return null;
        });

        const buses = await Promise.all(busPromises);
        buses.forEach((bus) => {
          if (bus) {
            busDetailsMap.set(bus.busId, bus);
          }
        });
      }

      // Attach bus details to routines
      const enrichedRoutines = routines.map((routine) => ({
        ...routine,
        busDetails: busDetailsMap.get(routine.busId) || {
          busName: 'Unknown',
          busNumber: 'N/A',
          driverName: 'Unknown',
        },
      }));

      console.log(
        `✅ [getApprovedRoutines] Found ${enrichedRoutines.length} routines.`,
      );
      return enrichedRoutines;
    } catch (error) {
      console.warn(
        '🔥 [getApprovedRoutines] Primary query failed (index?), running fallback:',
        error.message,
      );
      const snapshot = await routinesRef
        .where('status', '==', 'approved')
        .get();

      const routines: any[] = [];
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });
      return routines;
    }
  }

  async updateRoutine(routineId: string, updateData: any) {
    const firestore = this.firebaseService.getFirestore();
    const routineRef = firestore.collection('routines').doc(routineId);

    const routineDoc = await routineRef.get();
    if (!routineDoc.exists) {
      throw new NotFoundException('Routine not found');
    }

    const routineData = routineDoc.data();
    const finalUpdateData = {
      ...updateData,
      updatedAt: new Date(),
    };

    if (
      routineData.status === 'approved' ||
      routineData.status === 'rejected'
    ) {
      finalUpdateData.status = 'pending_approval';
      if (routineData.status === 'approved') {
        finalUpdateData.isUpdateRequested = true;
      }
    }

    await routineRef.update(finalUpdateData);
    return { message: 'Routine updated successfully' };
  }

  async updateRoutineStatus(
    routineId: string,
    status: string,
    rejectionReason?: string,
  ) {
    const firestore = this.firebaseService.getFirestore();
    const routineRef = firestore.collection('routines').doc(routineId);

    const routineDoc = await routineRef.get();
    if (!routineDoc.exists) {
      throw new NotFoundException('Routine not found');
    }

    const updateData: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'approved') {
      updateData.isUpdateRequested = false;
      updateData.approvedAt = new Date();
    } else if (status === 'rejected' && rejectionReason) {
      updateData.rejectionReason = rejectionReason;
      updateData.rejectedAt = new Date();
    }

    await routineRef.update(updateData);

    console.log(`✅ Routine ${routineId} status updated to: ${status}`);

    return {
      message: `Routine ${status} successfully`,
    };
  }

  async deleteRoutine(routineId: string) {
    const firestore = this.firebaseService.getFirestore();
    const routineRef = firestore.collection('routines').doc(routineId);

    const routineDoc = await routineRef.get();
    if (!routineDoc.exists) {
      throw new NotFoundException('Routine not found');
    }

    await routineRef.delete();

    console.log(`✅ Routine ${routineId} deleted`);

    return {
      message: 'Routine deleted successfully',
    };
  }

  // ==================== DAILY SCHEDULE MANAGEMENT ====================

  async getTodaySchedule(driverId: string, date: string) {
    const firestore = this.firebaseService.getFirestore();

    // Get day of week from date
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
    });

    // Get all approved routines for this driver
    const routinesSnapshot = await firestore
      .collection('routines')
      .where('driverId', '==', driverId)
      .where('status', '==', 'approved')
      .get();

    const routines = [];
    routinesSnapshot.forEach((doc) => {
      const data = doc.data();
      // Filter routines that are scheduled for this day (case-insensitive)
      if (
        data.daysOfWeek &&
        data.daysOfWeek.some(
          (d: string) => d.toLowerCase() === dayOfWeek.toLowerCase(),
        )
      ) {
        routines.push({
          id: doc.id,
          ...data,
        });
      }
    });

    // Get daily status for each routine
    const schedulePromises = routines.map(async (routine) => {
      const dailyStatusRef = firestore
        .collection('dailySchedules')
        .doc(`${routine.id}_${date}`);

      const dailyDoc = await dailyStatusRef.get();
      const dailyStatus = dailyDoc.exists
        ? dailyDoc.data()
        : { availability: 'available', date };

      // Calculate if this routine is currently active (SL time)
      const slNow = moment.tz('Asia/Colombo');
      const [startH, startM] = routine.timeSlot.startTime
        .split(':')
        .map(Number);
      const [endH, endM] = routine.timeSlot.endTime.split(':').map(Number);

      const startTime = moment
        .tz('Asia/Colombo')
        .set({ hour: startH, minute: startM, second: 0, millisecond: 0 });
      let endTime = moment
        .tz('Asia/Colombo')
        .set({ hour: endH, minute: endM, second: 0, millisecond: 0 });

      if (endTime.isBefore(startTime)) {
        endTime.add(1, 'day'); // Handle overnight routines
      }

      // Buffer: consider it active 15 mins before and 15 mins after
      const isActive =
        dailyStatus.availability === 'started' ||
        (dailyStatus.availability === 'available' &&
          slNow.isBetween(
            startTime.clone().subtract(15, 'minutes'),
            endTime.clone().add(15, 'minutes'),
          ));

      const isUpcoming =
        dailyStatus.availability === 'available' && slNow.isBefore(startTime);

      return {
        ...routine,
        isActive,
        isUpcoming,
        dailyStatus,
      };
    });

    const schedule = await Promise.all(schedulePromises);

    return schedule.sort((a, b) => {
      const timeA = a.timeSlot.startTime;
      const timeB = b.timeSlot.startTime;
      return timeA.localeCompare(timeB);
    });
  }

  async updateDailyRoutineStatus(
    routineId: string,
    date: string,
    availability: string,
    notes?: string,
  ) {
    const firestore = this.firebaseService.getFirestore();
    const dailyScheduleRef = firestore
      .collection('dailySchedules')
      .doc(`${routineId}_${date}`);

    const updateData: any = {
      routineId,
      date,
      availability,
      updatedAt: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    if (availability === 'started') {
      updateData.startedAt = new Date();
    } else if (availability === 'completed') {
      updateData.completedAt = new Date();
    }

    await dailyScheduleRef.set(updateData, { merge: true });

    console.log(
      `✅ Daily routine ${routineId} for ${date} updated to: ${availability}`,
    );

    return {
      message: `Routine ${availability} successfully`,
    };
  }

  // ==================== PASSENGER SEARCH WITH SCHEDULES ====================

  async searchBusesWithSchedules(
    route: string,
    date: string,
    departureTime?: string,
  ) {
    const firestore = this.firebaseService.getFirestore();
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
    });

    // Search for approved routines matching the route and day
    const routinesSnapshot = await firestore
      .collection('routines')
      .where('status', '==', 'approved')
      .get();

    const matchingRoutines = [];

    for (const doc of routinesSnapshot.docs) {
      const routineData: any = doc.data();
      const routine = { id: doc.id, ...routineData };

      // Check if route matches (case-insensitive partial match)
      const routeMatches =
        routineData.route?.toLowerCase().includes(route.toLowerCase()) ||
        route.toLowerCase().includes(routineData.route?.toLowerCase() || '');

      // Check if day matches (case-insensitive)
      const dayMatches = routineData.daysOfWeek?.some(
        (day: string) => day.toLowerCase() === dayOfWeek.toLowerCase(),
      );

      if (routeMatches && dayMatches) {
        // --- Departure Time Filter (Sri Lankan Time) ---
        if (
          departureTime &&
          routineData.timeSlot?.startTime &&
          routineData.timeSlot?.endTime
        ) {
          try {
            const baseDate = '2026-04-04'; // Use a dummy date for time comparison
            const depMoment = moment.tz(
              `${baseDate} ${departureTime}`,
              'YYYY-MM-DD HH:mm',
              'Asia/Colombo',
            );
            const startMoment = moment.tz(
              `${baseDate} ${routineData.timeSlot.startTime}`,
              'YYYY-MM-DD HH:mm',
              'Asia/Colombo',
            );
            let endMoment = moment.tz(
              `${baseDate} ${routineData.timeSlot.endTime}`,
              'YYYY-MM-DD HH:mm',
              'Asia/Colombo',
            );

            if (endMoment.isBefore(startMoment)) {
              endMoment.add(1, 'day');
              // If departure time is in the early hours of the next day, adjust it for the range check
              if (depMoment.hour() < startMoment.hour()) {
                depMoment.add(1, 'day');
              }
            }

            if (!depMoment.isBetween(startMoment, endMoment, null, '[]')) {
              console.log(
                `[Search] Routine ${doc.id} skipped: ${departureTime} is outside ${routineData.timeSlot.startTime}-${routineData.timeSlot.endTime}`,
              );
              continue;
            }
          } catch (err) {
            console.error('[Search] Error comparing times:', err);
          }
        }

        // Check daily availability
        const dailyScheduleRef = firestore
          .collection('dailySchedules')
          .doc(`${routine.id}_${date}`);

        const dailyDoc = await dailyScheduleRef.get();
        const dailyStatus = dailyDoc.exists
          ? dailyDoc.data()
          : { availability: 'available' };

        // Only include if available or not marked as unavailable
        if (dailyStatus.availability !== 'unavailable') {
          // Get bus details
          const busRef = firestore
            .collection('users')
            .doc(routineData.driverId);
          const busDoc = await busRef.get();
          const busData = busDoc.data();

          matchingRoutines.push({
            ...routine,
            dailyAvailability: dailyStatus.availability,
            busDetails: busData?.busDetails || {},
            driverName: busData?.displayName || 'Unknown Driver',
            driverEmail: busData?.email,
          });
        }
      }
    }

    // Sort by start time
    return matchingRoutines.sort((a, b) => {
      const timeA = a.timeSlot.startTime;
      const timeB = b.timeSlot.startTime;
      return timeA.localeCompare(timeB);
    });
  }

  // ==================== BUS PRICING ====================

  async updateBusPricing(driverId: string, pricingData: any) {
    const firestore = this.firebaseService.getFirestore();
    const userRef = firestore.collection('users').doc(driverId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new NotFoundException('Driver not found');
    }

    await userRef.update({
      'busDetails.pricing': {
        ...pricingData,
        updatedAt: new Date(),
      },
    });

    console.log(`✅ Bus pricing updated for driver: ${driverId}`);

    return {
      message: 'Bus pricing updated successfully',
    };
  }

  async getBusPricing(driverId: string) {
    const firestore = this.firebaseService.getFirestore();
    const userRef = firestore.collection('users').doc(driverId);

    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new NotFoundException('Driver not found');
    }

    const userData = userDoc.data();
    const pricing = userData?.busDetails?.pricing;

    // Return default pricing if not set
    if (!pricing) {
      return {
        defaultPricePerPerson: 0,
        bookingCommission: 0,
        updatedAt: null,
      };
    }

    return pricing;
  }

  // ==================== LOCATION SUGGESTIONS ====================

  async getLocationSuggestions() {
    const firestore = this.firebaseService.getFirestore();
    const usersRef = firestore.collection('users');

    const snapshot = await usersRef
      .where('userType', '==', 'driver')
      .where('busDetails.status', '==', BusStatus.APPROVED)
      .get();

    const locations = new Set<string>();

    snapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.busDetails && userData.busDetails.route) {
        const route = userData.busDetails.route;

        // Extract locations from route strings like "Colombo to Kandy", "Colombo - Kandy", "Colombo → Kandy"
        const separators = [' to ', ' - ', ' → ', ' -> ', ' | '];
        let fromLocation = '';
        let toLocation = '';

        for (const separator of separators) {
          if (route.includes(separator)) {
            const parts = route.split(separator);
            if (parts.length >= 2) {
              fromLocation = parts[0].trim();
              toLocation = parts[1].trim();
              break;
            }
          }
        }

        // If we couldn't parse with separators, try to extract common city names
        if (!fromLocation || !toLocation) {
          const commonCities = [
            'Colombo',
            'Kandy',
            'Galle',
            'Matara',
            'Jaffna',
            'Anuradhapura',
            'Polonnaruwa',
            'Sigiriya',
            'Dambulla',
            'Negombo',
            'Kalutara',
            'Beruwala',
            'Bentota',
            'Hikkaduwa',
            'Unawatuna',
            'Trincomalee',
            'Batticaloa',
            'Ampara',
            'Hambantota',
            'Tangalle',
            'Mirissa',
            'Weligama',
            'Ahangama',
            'Induruwa',
            'Aluthgama',
            'Kosgoda',
            'Balapitiya',
            'Ambalangoda',
            'Elpitiya',
            'Baddegama',
            'Rathgama',
            'Katukurunda',
            'Wadduwa',
            'Molligoda',
            'Moratuwa',
            'Panadura',
            'Horana',
            'Ingiriya',
            'Wathupitiwala',
            'Avissawella',
            'Ruwanwella',
            'Nittambuwa',
            'Gampaha',
            'Veyangoda',
            'Minuwangoda',
            'Ja-Ela',
            'Katunayake',
            'Seeduwa',
            'Negombo',
            'Kochchikade',
            'Peliyagoda',
            'Maharagama',
            'Kesbewa',
            'Boralesgamuwa',
            'Piliyandala',
            'Dehiwala',
            'Mount Lavinia',
            'Ratmalana',
            'Moratuwa',
            'Angulana',
            'Meegoda',
            'Homagama',
            'Godagama',
            'Battaramulla',
            'Kottawa',
            'Malabe',
            'Kaduwela',
            'Kothalawala',
            'Rajagiriya',
            'Battaramulla',
            'Nugegoda',
            'Kirulapone',
            'Narahenpita',
            'Havelock Town',
            'Bambalapitiya',
            'Wellawatta',
            'Dehiwala',
            'Mount Lavinia',
            'Ratmalana',
            'Moratuwa',
            'Angulana',
            'Meegoda',
            'Homagama',
            'Godagama',
            'Battaramulla',
            'Kottawa',
            'Malabe',
            'Kaduwela',
            'Kothalawala',
            'Rajagiriya',
            'Battaramulla',
            'Nugegoda',
            'Kirulapone',
            'Narahenpita',
            'Havelock Town',
            'Bambalapitiya',
            'Wellawatta',
            'Slave Island',
            'Fort',
            'Pettah',
            'Grandpass',
            'Modara',
            'Mattakkuliya',
            'Madampitiya',
            'Demata',
            'Kelaniya',
            'Wattala',
            'Ragama',
            'Kadawatha',
            'Kiribathgoda',
            'Pannipitiya',
            'Thalawathugoda',
            'Koswatte',
            'Nawala',
            'Wijerama',
            'Kohuwala',
            'Ethul Kotte',
            'Sri Jayawardenepura Kotte',
            'Pitakotte',
            'Gangodawila',
            'Nugegoda',
            'Kirulapone',
            'Narahenpita',
            'Havelock Town',
            'Bambalapitiya',
            'Wellawatta',
            'Slave Island',
            'Fort',
            'Pettah',
            'Grandpass',
            'Modara',
            'Mattakkuliya',
            'Madampitiya',
            'Demata',
            'Kelaniya',
            'Wattala',
            'Ragama',
            'Kadawatha',
            'Kiribathgoda',
            'Pannipitiya',
            'Thalawathugoda',
            'Koswatte',
            'Nawala',
            'Wijerama',
            'Kohuwala',
            'Ethul Kotte',
            'Sri Jayawardenepura Kotte',
            'Pitakotte',
            'Gangodawila',
            ' Mulleriyawa',
            'New Town',
            'Udahamulla',
            'Welikada',
            'Angoda',
            'Athurugiriya',
            'Kahanthota',
            'Kottawa',
            'Malabe',
            'Kaduwela',
            'Kothalawala',
            'Rajagiriya',
            'Battaramulla',
            'Nugegoda',
            'Kirulapone',
            'Narahenpita',
            'Havelock Town',
            'Bambalapitiya',
            'Wellawatta',
            'Slave Island',
            'Fort',
            'Pettah',
            'Grandpass',
            'Modara',
            'Mattakkuliya',
            'Madampitiya',
            'Demata',
            'Kelaniya',
            'Wattala',
            'Ragama',
            'Kadawatha',
            'Kiribathgoda',
            'Pannipitiya',
            'Thalawathugoda',
            'Koswatte',
            'Nawala',
            'Wijerama',
            'Kohuwala',
            'Ethul Kotte',
            'Sri Jayawardenepura Kotte',
            'Pitakotte',
            'Gangodawila',
            ' Mulleriyawa',
            'New Town',
            'Udahamulla',
            'Welikada',
            'Angoda',
            'Athurugiriya',
            'Kahanthota',
            'Kottawa',
            'Malabe',
            'Kaduwela',
            'Kothalawala',
            'Rajagiriya',
            'Battaramulla',
            'Nugegoda',
            'Kirulapone',
            'Narahenpita',
            'Havelock Town',
            'Bambalapitiya',
            'Wellawatta',
            'Slave Island',
            'Fort',
            'Pettah',
            'Grandpass',
            'Modara',
            'Mattakkuliya',
            'Madampitiya',
            'Demata',
            'Kelaniya',
            'Wattala',
            'Ragama',
            'Kadawatha',
            'Kiribathgoda',
            'Pannipitiya',
            'Thalawathugoda',
            'Koswatte',
            'Nawala',
            'Wijerama',
            'Kohuwala',
            'Ethul Kotte',
            'Sri Jayawardenepura Kotte',
            'Pitakotte',
            'Gangodawila',
            ' Mulleriyawa',
            'New Town',
            'Udahamulla',
            'Welikada',
            'Angoda',
            'Athurugiriya',
            'Kahanthota',
          ];

          for (const city of commonCities) {
            if (route.toLowerCase().includes(city.toLowerCase())) {
              locations.add(city);
            }
          }
        } else {
          // Add the parsed locations
          if (fromLocation) locations.add(fromLocation);
          if (toLocation) locations.add(toLocation);
        }
      }
    });

    // Also check routines for additional locations
    const routinesRef = firestore.collection('routines');
    const routinesSnapshot = await routinesRef
      .where('status', '==', 'approved')
      .get();

    routinesSnapshot.forEach((doc) => {
      const routineData = doc.data();
      if (routineData.route) {
        const route = routineData.route;

        // Extract locations from routine routes
        const separators = [' to ', ' - ', ' → ', ' -> ', ' | '];
        let fromLocation = '';
        let toLocation = '';

        for (const separator of separators) {
          if (route.includes(separator)) {
            const parts = route.split(separator);
            if (parts.length >= 2) {
              fromLocation = parts[0].trim();
              toLocation = parts[1].trim();
              break;
            }
          }
        }

        if (fromLocation) locations.add(fromLocation);
        if (toLocation) locations.add(toLocation);
      }
    });

    return Array.from(locations).sort();
  }

  // ==================== ROUTES MANAGEMENT METHODS ====================

  async getRoutes() {
    const firestore = this.firebaseService.getFirestore();
    const routesRef = firestore.collection('routes');
    const snapshot = await routesRef.get();

    const routes = [];
    snapshot.forEach((doc) => {
      routes.push(doc.data().name);
    });

    return routes;
  }

  async addRoute(routeName: string) {
    const firestore = this.firebaseService.getFirestore();
    const routesRef = firestore.collection('routes');

    // Check if route already exists
    const existingRoute = await routesRef.where('name', '==', routeName).get();
    if (!existingRoute.empty) {
      throw new BadRequestException('Route already exists');
    }

    const routeDoc = routesRef.doc();
    await routeDoc.set({
      name: routeName,
      createdAt: new Date(),
    });

    return { message: 'Route added successfully', route: routeName };
  }

  async updateRoute(oldRouteName: string, newRouteName: string) {
    const firestore = this.firebaseService.getFirestore();
    const routesRef = firestore.collection('routes');

    // Find the old route
    const oldRouteQuery = await routesRef
      .where('name', '==', oldRouteName)
      .get();
    if (oldRouteQuery.empty) {
      throw new NotFoundException('Route not found');
    }

    // Check if new route name already exists
    const existingRouteQuery = await routesRef
      .where('name', '==', newRouteName)
      .get();
    if (!existingRouteQuery.empty) {
      throw new BadRequestException('Route name already exists');
    }

    const oldRouteDoc = oldRouteQuery.docs[0];
    await oldRouteDoc.ref.update({
      name: newRouteName,
      updatedAt: new Date(),
    });

    return {
      message: 'Route updated successfully',
      oldRoute: oldRouteName,
      newRoute: newRouteName,
    };
  }

  async deleteRoute(routeName: string) {
    const firestore = this.firebaseService.getFirestore();
    const routesRef = firestore.collection('routes');

    const routeQuery = await routesRef.where('name', '==', routeName).get();
    if (routeQuery.empty) {
      throw new NotFoundException('Route not found');
    }

    const routeDoc = routeQuery.docs[0];
    await routeDoc.ref.delete();

    return { message: 'Route deleted successfully', route: routeName };
  }

  // ==================== ROUTE REQUESTS METHODS ====================

  async createRouteRequest(routeName: string, driverId: string) {
    const firestore = this.firebaseService.getFirestore();

    // Get driver info
    const userDoc = await firestore.collection('users').doc(driverId).get();
    if (!userDoc.exists) {
      throw new NotFoundException('Driver not found');
    }

    const userData = userDoc.data();
    const driverName =
      userData?.displayName || userData?.name || 'Unknown Driver';

    // Check if request already exists
    const existingRequest = await firestore
      .collection('routeRequests')
      .where('route', '==', routeName)
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .get();

    if (!existingRequest.empty) {
      throw new BadRequestException('Route request already exists');
    }

    const requestDoc = firestore.collection('routeRequests').doc();
    await requestDoc.set({
      id: requestDoc.id,
      route: routeName,
      driverId: driverId,
      driverName: driverName,
      status: 'pending',
      requestedAt: new Date(),
    });

    return {
      message: 'Route request submitted successfully',
      requestId: requestDoc.id,
    };
  }

  async getRouteRequests() {
    const firestore = this.firebaseService.getFirestore();
    const requestsRef = firestore.collection('routeRequests');
    const snapshot = await requestsRef.where('status', '==', 'pending').get();

    const requests = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      requests.push({
        id: doc.id,
        route: data.route,
        driverId: data.driverId,
        driverName: data.driverName,
        requestedAt: data.requestedAt,
      });
    });

    return requests;
  }

  async approveRouteRequest(requestId: string) {
    const firestore = this.firebaseService.getFirestore();
    const requestRef = firestore.collection('routeRequests').doc(requestId);

    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      throw new NotFoundException('Route request not found');
    }

    const requestData = requestDoc.data();

    // Add the route to routes collection
    await this.addRoute(requestData.route);

    // Update request status
    await requestRef.update({
      status: 'approved',
      approvedAt: new Date(),
    });

    return {
      message: 'Route request approved and route added',
      route: requestData.route,
    };
  }

  async rejectRouteRequest(requestId: string) {
    const firestore = this.firebaseService.getFirestore();
    const requestRef = firestore.collection('routeRequests').doc(requestId);

    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      throw new NotFoundException('Route request not found');
    }

    return { message: 'Route request rejected' };
  }

  async getAllLiveBuses() {
    const firestore = this.firebaseService.getFirestore();
    try {
      // 1. Fetch from 'buses' collection (New buses)
      const busesSnapshot = await firestore
        .collection('buses')
        .where('currentLocation', '!=', null)
        .get();

      // 2. Fetch from 'users' collection (Legacy buses)
      const usersSnapshot = await firestore
        .collection('users')
        .where('userType', '==', 'driver')
        .where('busDetails.currentLocation', '!=', null)
        .get();

      const liveBuses = [];
      const threshold = 10 * 60 * 1000; // 10 minutes timeout
      const now = Date.now();

      // Process new buses
      for (const busDoc of busesSnapshot.docs) {
        const busData = busDoc.data();
        if (!busData.currentLocation) continue;

        const lastUpdate =
          busData.lastLocationUpdate?.toDate?.().getTime() || 0;

        if (now - lastUpdate < threshold) {
          liveBuses.push({
            id: busDoc.id,
            busNumber: busData.busNumber || 'Unknown',
            busName: busData.busName || 'Unknown Bus',
            route: busData.route || 'Unknown Route',
            currentLocation: busData.currentLocation,
            coordinates: busData.currentLocation, // Backwards compatibility if needed
            status: 'active',
            passengers: 0, // TODO: fetch real count
            estimatedArrival: 'TBD',
            nextStop: 'Unknown',
            heading: busData.currentLocation.heading || 0,
            speed: busData.currentLocation.speed || 0,
            type: 'standard',
          });
        }
      }

      // Process legacy buses
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        if (userData.busDetails && userData.busDetails.currentLocation) {
          const lastUpdate =
            userData.busDetails.lastLocationUpdate?.toDate?.().getTime() || 0;
          if (now - lastUpdate < threshold) {
            liveBuses.push({
              id: userDoc.id,
              busNumber: userData.busDetails.busNumber || 'Unknown',
              busName: userData.busDetails.busName || 'Unknown Bus',
              route: userData.busDetails.route || 'Unknown Route',
              currentLocation: userData.busDetails.currentLocation,
              coordinates: userData.busDetails.currentLocation,
              status: 'active',
              passengers: 0,
              estimatedArrival: 'TBD',
              nextStop: 'Unknown',
              heading: userData.busDetails.currentLocation.heading || 0,
              speed: userData.busDetails.currentLocation.speed || 0,
              type: 'legacy',
            });
          }
        }
      }

      return liveBuses;
    } catch (error) {
      console.error('Error getting live buses:', error);
      return [];
    }
  }

  private generateMockLiveData(tripData: any, passengerCount: number) {
    const now = new Date();
    const departureTime = tripData.departureTime.toDate();
    const arrivalTime = tripData.arrivalTime.toDate();

    // Calculate progress based on current time vs trip duration
    const totalDuration = arrivalTime.getTime() - departureTime.getTime();
    const elapsedTime = now.getTime() - departureTime.getTime();
    const progress = Math.max(0, Math.min(1, elapsedTime / totalDuration));

    // Mock locations along the route
    const routeStops = [
      tripData.from,
      `Between ${tripData.from} and ${tripData.to}`,
      `Approaching ${tripData.to}`,
      tripData.to,
    ];

    const currentStopIndex = Math.floor(progress * (routeStops.length - 1));
    const currentLocation =
      routeStops[Math.min(currentStopIndex, routeStops.length - 1)];
    const nextStop =
      currentStopIndex < routeStops.length - 1
        ? routeStops[currentStopIndex + 1]
        : null;

    // Calculate delay (random for demo)
    const delay = Math.random() > 0.8 ? Math.floor(Math.random() * 15) + 1 : 0;

    // Estimated arrival
    const estimatedArrivalTime = new Date(
      arrivalTime.getTime() + delay * 60 * 1000,
    );
    const estimatedArrival = estimatedArrivalTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Determine status
    let status: 'on-route' | 'delayed' | 'arrived' = 'on-route';
    if (delay > 0) status = 'delayed';
    if (progress >= 1) status = 'arrived';

    // Mock coordinates (would come from GPS in real implementation)
    const coordinates = {
      lat: 6.9271 + (Math.random() - 0.5) * 0.1, // Colombo area
      lng: 79.8612 + (Math.random() - 0.5) * 0.1,
    };

    return {
      currentLocation,
      nextStop,
      estimatedArrival,
      delay,
      status,
      coordinates,
    };
  }

  async getTrackableBuses(passengerId: string) {
    const firestore = this.firebaseService.getFirestore();

    // ---- In-memory cache check ----
    const cached = this.trackableBusesCache.get(passengerId);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(
        `[Tracker] Cache HIT for passenger ${passengerId}. Returning cached result.`,
      );
      return cached.result;
    }

    try {
      console.log(
        `[Tracker] Cache MISS — Fetching live data for passenger: ${passengerId}`,
      );

      // Step 1: Get only CONFIRMED bookings for this passenger
      const bookingsSnapshot = await firestore
        .collection('bookings')
        .where('userId', '==', passengerId)
        .where('status', '==', 'confirmed')
        .get();

      console.log(
        `[Tracker] Found ${bookingsSnapshot.docs.length} confirmed bookings.`,
      );

      // Compute current time in Sri Lanka / IST timezone (UTC+5:30)
      // The backend server runs in UTC; routine times are stored in local Sri Lanka time
      const now = new Date();
      const SL_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30
      const nowSL = new Date(now.getTime() + SL_OFFSET_MS);

      const year = nowSL.getUTCFullYear();
      const month = String(nowSL.getUTCMonth() + 1).padStart(2, '0');
      const day = String(nowSL.getUTCDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;
      // Use SL time for day-of-week (so the query matches routine's daysOfWeek correctly)
      const todayDayOfWeek = nowSL.toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'Asia/Colombo',
      });
      const slHours = nowSL.getUTCHours();
      const slMinutes = nowSL.getUTCMinutes();

      console.log(
        `[Tracker] Today: ${todayStr} (${todayDayOfWeek}), SL time: ${slHours}:${String(slMinutes).padStart(2, '0')}`,
      );

      // Helper: check if current SL local time is within a routine time window "HH:MM"
      const isWithinTimeWindow = (
        startTime: string,
        endTime: string,
      ): boolean => {
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const currentMinutes = slHours * 60 + slMinutes;
        const startMinutes = sh * 60 + sm;
        let endMinutes = eh * 60 + em;
        if (endMinutes <= startMinutes) endMinutes += 24 * 60; // overnight
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      };

      // Use a Map keyed by driverId to de-duplicate (one entry per driver/bus)
      const trackableBusesMap = new Map<string, any>();

      for (const bookingDoc of bookingsSnapshot.docs) {
        const bookingData = bookingDoc.data();
        // bookingData.busId is actually the DRIVER's userId (legacy system)
        const driverId = bookingData.busId;

        // Skip if we already processed this driver
        if (trackableBusesMap.has(driverId)) continue;

        // Step 2: Get the driver's approved routines scheduled for today
        const routinesSnapshot = await firestore
          .collection('routines')
          .where('driverId', '==', driverId)
          .where('status', '==', 'approved')
          .get();

        let startedRoutine: any = null;

        for (const routineDoc of routinesSnapshot.docs) {
          const routineData = routineDoc.data();

          // Check if this routine is scheduled for today
          const isToday =
            routineData.daysOfWeek &&
            routineData.daysOfWeek.some(
              (d: string) => d.toLowerCase() === todayDayOfWeek.toLowerCase(),
            );

          if (!isToday) continue;

          // Step 3: Check dailySchedules for explicit started/unavailable/completed status
          const dailyStatusDoc = await firestore
            .collection('dailySchedules')
            .doc(`${routineDoc.id}_${todayStr}`)
            .get();

          const dailyStatus = dailyStatusDoc.exists
            ? dailyStatusDoc.data()
            : { availability: 'available' };

          const availability = dailyStatus?.availability || 'available';

          // Skip if driver explicitly marked unavailable or completed
          if (availability === 'unavailable' || availability === 'completed')
            continue;

          // ✅ DUAL CHECK:
          // 1. Driver explicitly started the routine via TodaySchedule UI
          const isExplicitlyStarted = availability === 'started';

          // 2. OR: current time falls within the scheduled time window (bus is active by schedule)
          const timeWindow = routineData.timeSlot;
          const isWithinWindow = timeWindow
            ? isWithinTimeWindow(timeWindow.startTime, timeWindow.endTime)
            : false;

          console.log(
            `[Tracker] Routine ${routineDoc.id} | availability: ${availability} | withinWindow: ${isWithinWindow} | window: ${timeWindow?.startTime}-${timeWindow?.endTime}`,
          );

          if (isExplicitlyStarted || isWithinWindow) {
            startedRoutine = { id: routineDoc.id, ...routineData };
            break;
          }
        }

        if (!startedRoutine) continue;

        // Step 4: Get the driver's bus details and LIVE location
        // In this system, busId === driverId (legacy), so location is at users/{driverId}.busDetails.currentLocation
        const driverDoc = await firestore
          .collection('users')
          .doc(driverId)
          .get();
        if (!driverDoc.exists) {
          console.log(`[Tracker] Driver user doc not found for ${driverId}`);
          continue;
        }

        const driverData = driverDoc.data();
        let busDetails = driverData.busDetails;
        let currentLocation =
          BusService.GLOBAL_BUS_LOCATION_CACHE.get(driverId) ??
          busDetails?.currentLocation ??
          null;
        let busId = driverId; // legacy: busId = driverId

        // Also check if there's a new-style bus in 'buses' collection for this driver
        // (which stores location separately)
        const newBusSnapshot = await firestore
          .collection('buses')
          .where('driverId', '==', driverId)
          .where('status', '==', 'approved')
          .limit(1)
          .get();

        if (!newBusSnapshot.empty) {
          const newBusDoc = newBusSnapshot.docs[0];
          const newBusData = newBusDoc.data();
          busId = newBusDoc.id;

          // Check global cache using new busId as well
          const cachedLocation =
            BusService.GLOBAL_BUS_LOCATION_CACHE.get(busId);
          if (cachedLocation) currentLocation = cachedLocation;

          // Use new bus details, preferring new-style currentLocation if it exists
          if (!busDetails) busDetails = newBusData;
          if (!cachedLocation && newBusData.currentLocation)
            currentLocation = newBusData.currentLocation;
        }

        if (!busDetails) {
          console.log(`[Tracker] No bus details found for driver ${driverId}`);
          continue;
        }

        console.log(
          `[Tracker] ✅ Bus ${busDetails.busNumber} | driverId: ${driverId} | currentLocation: ${JSON.stringify(currentLocation)}`,
        );

        const trackableBus = {
          id: busId,
          busName: busDetails.busName || 'Unknown Bus',
          busNumber: busDetails.busNumber || 'N/A',
          route: startedRoutine.route || busDetails.route || 'Unknown Route',
          currentLocation: currentLocation,
          coordinates:
            currentLocation &&
            typeof currentLocation === 'object' &&
            'lat' in currentLocation
              ? { lat: currentLocation.lat, lng: currentLocation.lng }
              : undefined,
          status: 'on-route' as const,
          driverName:
            driverData.displayName || driverData.name || 'Unknown Driver',
          driverPhone: driverData.phoneNumber || driverData.phone || '',
          bookingId: bookingDoc.id,
          travelDate:
            bookingData.travelDate?.toDate?.() || bookingData.travelDate,
          routineTimeSlot: startedRoutine.timeSlot || null,
          routineId: startedRoutine.id,
        };

        trackableBusesMap.set(driverId, trackableBus);
      }

      console.log(
        `[Tracker] Returning ${trackableBusesMap.size} active trackable buses.`,
      );
      const result = Array.from(trackableBusesMap.values());

      // Store in cache for 30 seconds
      this.trackableBusesCache.set(passengerId, {
        result,
        expiresAt: Date.now() + BusService.TRACKER_CACHE_TTL_MS,
      });

      return result;
    } catch (error) {
      console.error('[Tracker] Error getting trackable buses:', error);
      throw new BadRequestException('Failed to get trackable buses');
    }
  }

  // ==================== LIVE LOCATION TRACKING ====================

  async updateBusLocation(
    busId: string,
    location: { lat: number; lng: number; heading?: number; speed?: number },
  ) {
    const firestore = this.firebaseService.getFirestore();
    // Update high-performance global cache instantly
    BusService.GLOBAL_BUS_LOCATION_CACHE.set(busId, {
      ...location,
      updatedAt: Date.now(),
    });

    const busRef = firestore.collection('buses').doc(busId);
    const busDoc = await busRef.get();

    if (busDoc.exists) {
      console.log(
        `[LocationUpdate] Found new-style bus doc for busId: ${busId}. Updating 'buses' collection.`,
      );
      await busRef.update({
        currentLocation: location,
        lastLocationUpdate: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      console.log(
        `[LocationUpdate] No new-style bus found for busId: ${busId}. Checking 'users' collection.`,
      );
      const userRef = firestore.collection('users').doc(busId);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        console.log(
          `[LocationUpdate] Found driver/user doc for busId: ${busId}. Updating 'users' collection -> busDetails.currentLocation.`,
        );
        await userRef.update({
          'busDetails.currentLocation': location,
          'busDetails.lastLocationUpdate':
            admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        console.log(
          `[LocationUpdate] ERROR: Could not find any document (bus or user) to update location for busId: ${busId}`,
        );
      }
    }
    return { success: true };
  }
}
