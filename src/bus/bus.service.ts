import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { BusStatus } from '../auth/dto/register.dto';
import { AddBusDto } from './dto/add-bus.dto';
import * as admin from 'firebase-admin';

@Injectable()
export class BusService {
  constructor(private firebaseService: FirebaseService) {}

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
        if (userData?.busDetails && userData.busDetails.status === BusStatus.PENDING) {
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
        if (userData?.busDetails && userData.busDetails.status === BusStatus.PENDING) {
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
    
    snapshot.forEach(doc => {
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
    const busDoc = await firestore.collection('users').doc(bookingData.busId).get();
    if (!busDoc.exists) {
      throw new NotFoundException('Bus not found');
    }

    const busData = busDoc.data();
    if (busData?.busDetails?.operatingDays) {
      // Convert travel date to day of week
      const travelDate = new Date(bookingData.travelDate);
      const dayOfWeek = travelDate.toLocaleDateString('en-US', {
        weekday: 'long',
      }).toUpperCase();

      // Check if bus operates on this day
      if (!busData.busDetails.operatingDays.includes(dayOfWeek)) {
        throw new BadRequestException(
          `This bus does not operate on ${dayOfWeek}s. Operating days: ${busData.busDetails.operatingDays.join(', ')}`
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

            console.log('✅ Trip seats updated');
          } else {
            // Handle regular bus booking
            console.log('🚌 Handling regular bus booking...');
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

            // Update seat availability
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
          fromMatch = routeFrom.toLowerCase().includes(searchFrom) ||
                     (routeTo.toLowerCase().includes(searchFrom) && route.includes('return'));
        }

        if (searchCriteria.to) {
          const searchTo = searchCriteria.to.toLowerCase().trim();
          // For "to" searches, match if the bus route goes to the searched location
          // OR if it's a round trip and starts from the searched location
          toMatch = routeTo.toLowerCase().includes(searchTo) ||
                   (routeFrom.toLowerCase().includes(searchTo) && route.includes('return'));
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
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
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

    console.log('📝 Creating Routine Payload:', JSON.stringify(newRoutine, null, 2));

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
      snapshot.forEach((doc) => {
        routines.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      console.log(`✅ [getApprovedRoutines] Found ${routines.length} routines via primary query.`);
      return routines;
    } catch (error) {
      console.warn('🔥 [getApprovedRoutines] Primary query failed (index?), running fallback:', error.message);
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

    await routineRef.update({
      ...updateData,
      updatedAt: new Date(),
    });

    console.log(`✅ Routine ${routineId} updated`);

    return {
      message: 'Routine updated successfully',
    };
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
      // Filter routines that are scheduled for this day
      if (data.daysOfWeek && data.daysOfWeek.includes(dayOfWeek)) {
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
      const dailyStatus = dailyDoc.exists ? dailyDoc.data() : null;

      return {
        ...routine,
        dailyStatus: dailyStatus || {
          availability: 'available',
          date,
        },
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

  async searchBusesWithSchedules(route: string, date: string) {
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

      // Check if day matches
      const dayMatches =
        routineData.daysOfWeek && routineData.daysOfWeek.includes(dayOfWeek);

      if (routeMatches && dayMatches) {
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
          
          const lastUpdate = busData.lastLocationUpdate?.toDate?.().getTime() || 0;
          
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
                  type: 'standard'
              });
          }
      }

      // Process legacy buses
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        if (userData.busDetails && userData.busDetails.currentLocation) {
            const lastUpdate = userData.busDetails.lastLocationUpdate?.toDate?.().getTime() || 0;
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
                    type: 'legacy'
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
      tripData.to
    ];

    const currentStopIndex = Math.floor(progress * (routeStops.length - 1));
    const currentLocation = routeStops[Math.min(currentStopIndex, routeStops.length - 1)];
    const nextStop = currentStopIndex < routeStops.length - 1 ? routeStops[currentStopIndex + 1] : null;

    // Calculate delay (random for demo)
    const delay = Math.random() > 0.8 ? Math.floor(Math.random() * 15) + 1 : 0;

    // Estimated arrival
    const estimatedArrivalTime = new Date(arrivalTime.getTime() + (delay * 60 * 1000));
    const estimatedArrival = estimatedArrivalTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Determine status
    let status: 'on-route' | 'delayed' | 'arrived' = 'on-route';
    if (delay > 0) status = 'delayed';
    if (progress >= 1) status = 'arrived';

    // Mock coordinates (would come from GPS in real implementation)
    const coordinates = {
      lat: 6.9271 + (Math.random() - 0.5) * 0.1, // Colombo area
      lng: 79.8612 + (Math.random() - 0.5) * 0.1
    };

    return {
      currentLocation,
      nextStop,
      estimatedArrival,
      delay,
      status,
      coordinates
    };
  }

  async getTrackableBuses(passengerId: string) {
    const firestore = this.firebaseService.getFirestore();

    try {
      // Get all bookings for the passenger
      const bookingsRef = firestore.collection('bookings');
    
    // Look for bookings from yesterday onwards to handle timezone differences
    // and ensuring we catch ongoing trips that might have started "yesterday" in UTC but are still active.
    const searchDate = new Date();
    searchDate.setDate(searchDate.getDate() - 1);
    searchDate.setHours(0, 0, 0, 0);

    const bookingsSnapshot = await bookingsRef
      .where('userId', '==', passengerId)
      .get();
      
      const trackableBusesMap = new Map();

      for (const bookingDoc of bookingsSnapshot.docs) {
        const bookingData = bookingDoc.data();
        const bStatus = bookingData.status;
        const bDate = bookingData.travelDate?.toDate ? bookingData.travelDate.toDate() : new Date(bookingData.travelDate);
        
        if (!['confirmed', 'pending'].includes(bStatus)) {
            continue;
        }

        if (bDate < searchDate) {
            continue;
        }
        
        // Avoid re-fetching/processing if we already have this bus
        if (trackableBusesMap.has(bookingData.busId)) {
            continue;
        }

        // Get bus details from the driver (busId is the driver's userId)
        const driverDoc = await firestore.collection('users').doc(bookingData.busId).get();

        if (!driverDoc.exists) {
           continue;
        }
        
        const driverData = driverDoc.data();
        if (!driverData.busDetails) {
           continue;
        }
        
        const busDetails = driverData.busDetails;
        const currentLocation = busDetails?.currentLocation;
        
        // Check if the location is stale? (Optional, but good practice. For now, assume if it exists, it's valid).
        
        // Determine status based on live data availability
        // If no location data, we assume the bus hasn't started or is scheduled.
        const status = currentLocation ? 'on-route' : 'scheduled';

        // Create trackable bus object
        const trackableBus = {
          id: bookingData.busId,
          busName: busDetails.busName,
          busNumber: busDetails.busNumber,
          route: busDetails.route,
          currentLocation: currentLocation, // Pass the object or string
          coordinates: (currentLocation && typeof currentLocation === 'object' && 'lat' in currentLocation) ? currentLocation : undefined,
          estimatedArrival: 'Calculating...', // Could be enhanced with Distance Matrix later
          status: status,
          driverName: driverData.displayName || 'Unknown Driver',
          driverPhone: driverData.phoneNumber || '',
          bookingId: bookingDoc.id,
          travelDate: bookingData.travelDate?.toDate?.() || bookingData.travelDate,
          departureTime: bookingData.departureTime || 'TBD'
        };

        trackableBusesMap.set(bookingData.busId, trackableBus);
      }
    
    console.log(`[DEBUG] Returning ${trackableBusesMap.size} trackable buses.`);

      return Array.from(trackableBusesMap.values());
    } catch (error) {
      console.error('Error getting trackable buses:', error);
      throw new BadRequestException('Failed to get trackable buses');
    }
  }

  // ==================== LIVE LOCATION TRACKING ====================

  async updateBusLocation(
    busId: string,
    location: { lat: number; lng: number; heading?: number; speed?: number },
  ) {
    const firestore = this.firebaseService.getFirestore();
    
    const busRef = firestore.collection('buses').doc(busId);
    const busDoc = await busRef.get();

    if (busDoc.exists) {
        await busRef.update({
            currentLocation: location,
            lastLocationUpdate: admin.firestore.FieldValue.serverTimestamp(),
        });
    } else {
        const userRef = firestore.collection('users').doc(busId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
             await userRef.update({
                'busDetails.currentLocation': location,
                'busDetails.lastLocationUpdate': admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    return { success: true };
  }
}
