import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import * as moment from 'moment-timezone';
import * as admin from 'firebase-admin';

export interface EligibleJourney {
  id: string;
  route: string;
  travelDate: string;
  busId: string;
  driverId?: string;
  journeyType: 'regular' | 'private_hire' | 'trip';
  label: string;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly firebaseService: FirebaseService) {}

  private normalizeDateStr(value: unknown): string {
    if (!value) return '';
    let dateValue = value;
    if (
      typeof dateValue === 'object' &&
      dateValue !== null &&
      'toDate' in dateValue &&
      typeof (dateValue as { toDate: () => Date }).toDate === 'function'
    ) {
      dateValue = (dateValue as { toDate: () => Date }).toDate();
    }
    if (dateValue instanceof Date) {
      return moment(dateValue).tz('Asia/Colombo').format('YYYY-MM-DD');
    }
    if (typeof dateValue === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return dateValue;
      }
      const parsed = moment(dateValue);
      if (parsed.isValid()) {
        return parsed.tz('Asia/Colombo').format('YYYY-MM-DD');
      }
    }
    return '';
  }

  private getDayOfWeek(dateStr: string): string {
    return moment.tz(dateStr, 'YYYY-MM-DD', 'Asia/Colombo').format('dddd');
  }

  private getTodayColombo(): string {
    return moment.tz('Asia/Colombo').format('YYYY-MM-DD');
  }

  private getDateKeyVariants(dateStr: string): string[] {
    const variants = new Set<string>([dateStr]);
    variants.add(
      moment.tz(dateStr, 'YYYY-MM-DD', 'Asia/Colombo').utc().format('YYYY-MM-DD'),
    );

    // TodaySchedule marks completion using UTC calendar date.
    if (dateStr === this.getTodayColombo()) {
      variants.add(moment.utc().format('YYYY-MM-DD'));
    }

    return [...variants];
  }

  private getDailyScheduleAvailability(
    routineId: string,
    dateStr: string,
    dailyScheduleMap: Map<string, string>,
  ): string {
    for (const dateKey of this.getDateKeyVariants(dateStr)) {
      const availability = dailyScheduleMap.get(`${routineId}_${dateKey}`);
      if (availability) return availability;
    }
    return 'available';
  }

  private routesMatch(bookingRoute: string, routineRoute: string): boolean {
    const booking = (bookingRoute || '').toLowerCase().trim();
    const routine = (routineRoute || '').toLowerCase().trim();
    if (!booking || !routine) return false;
    if (booking.includes(routine) || routine.includes(booking)) return true;

    const tokenize = (value: string) =>
      value
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2);

    const bookingTokens = new Set(tokenize(booking));
    const overlap = tokenize(routine).filter((token) => bookingTokens.has(token));
    return overlap.length >= 2;
  }

  private getRoutinesForBooking(
    booking: any,
    routinesByKey: Map<string, any[]>,
  ): any[] {
    const seen = new Set<string>();
    const routines: any[] = [];

    for (const key of [booking.busId, booking.driverId].filter(Boolean)) {
      for (const routine of routinesByKey.get(key) || []) {
        if (!seen.has(routine.id)) {
          seen.add(routine.id);
          routines.push(routine);
        }
      }
    }

    return routines;
  }

  private isEndOfTravelDayPassed(dateStr: string): boolean {
    const endOfDay = moment
      .tz(dateStr, 'YYYY-MM-DD', 'Asia/Colombo')
      .endOf('day');
    return moment.tz('Asia/Colombo').isAfter(endOfDay);
  }

  private isRoutineEndTimePassed(routine: any, dateStr: string): boolean {
    if (!routine?.timeSlot?.endTime || !routine?.timeSlot?.startTime) {
      return false;
    }

    const [endH, endM] = routine.timeSlot.endTime.split(':').map(Number);
    const [startH, startM] = routine.timeSlot.startTime.split(':').map(Number);

    let endTime = moment
      .tz(dateStr, 'YYYY-MM-DD', 'Asia/Colombo')
      .set({ hour: endH, minute: endM, second: 0, millisecond: 0 });
    const startTime = moment
      .tz(dateStr, 'YYYY-MM-DD', 'Asia/Colombo')
      .set({ hour: startH, minute: startM, second: 0, millisecond: 0 });

    if (endTime.isBefore(startTime)) {
      endTime = endTime.add(1, 'day');
    }

    return moment.tz('Asia/Colombo').isAfter(endTime);
  }

  private resolveDriverIdLocal(
    busId: string,
    explicitDriverId?: string,
  ): string | undefined {
    return explicitDriverId || busId;
  }

  private journeyTypeLabel(type: EligibleJourney['journeyType']): string {
    switch (type) {
      case 'private_hire':
        return 'Private Hire';
      case 'trip':
        return 'Trip';
      default:
        return 'Regular Route';
    }
  }

  private formatJourneyLabel(
    route: string,
    travelDate: string,
    journeyType: EligibleJourney['journeyType'],
  ): string {
    const formattedDate = moment
      .tz(travelDate, 'YYYY-MM-DD', 'Asia/Colombo')
      .format('MMM D, YYYY');
    return `${route} (${this.journeyTypeLabel(journeyType)}) - ${formattedDate}`;
  }

  private async getReviewedJourneyIds(userId: string): Promise<Set<string>> {
    const firestore = this.firebaseService.getFirestore();
    const reviewed = new Set<string>();

    try {
      const snapshot = await firestore
        .collection('feedback')
        .where('userId', '==', userId)
        .get();

      snapshot.forEach((doc) => {
        const bookingId = doc.data().bookingId;
        if (bookingId) reviewed.add(bookingId);
      });
    } catch (error) {
      this.logger.warn('Failed to load reviewed journey ids', error);
    }

    return reviewed;
  }

  private async getCompletedHireRequests(userId: string) {
    const firestore = this.firebaseService.getFirestore();

    try {
      const snapshot = await firestore
        .collection('hireRequests')
        .where('userId', '==', userId)
        .where('status', '==', 'completed')
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
    } catch (error) {
      this.logger.warn(
        'Composite index missing for hireRequests feedback query, falling back',
        error,
      );
      const snapshot = await firestore
        .collection('hireRequests')
        .where('userId', '==', userId)
        .get();

      return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as any))
        .filter((request: any) => request.status === 'completed');
    }
  }

  private async batchGetDocuments<T>(
    collectionName: string,
    ids: string[],
  ): Promise<Map<string, T>> {
    const firestore = this.firebaseService.getFirestore();
    const result = new Map<string, T>();
    if (ids.length === 0) return result;

    const uniqueIds = [...new Set(ids)];
    const refs = uniqueIds.map((id) =>
      firestore.collection(collectionName).doc(id),
    );

    const docs = await firestore.getAll(...refs);
    docs.forEach((doc) => {
      if (doc.exists) {
        result.set(doc.id, doc.data() as T);
      }
    });

    return result;
  }

  private isTripBookingEligibleSync(
    booking: any,
    tripsMap: Map<string, admin.firestore.DocumentData>,
  ): boolean {
    if (booking.status !== 'confirmed' || !booking.isTripBooking || !booking.tripId) {
      return false;
    }

    const trip = tripsMap.get(booking.tripId);
    if (!trip) return false;

    const arrivalTime =
      trip.arrivalTime?.toDate?.() || new Date(trip.arrivalTime);
    return moment.tz('Asia/Colombo').isAfter(moment(arrivalTime).tz('Asia/Colombo'));
  }

  private isPrivateHireBookingEligibleSync(booking: any): boolean {
    if (booking.status !== 'confirmed' || !booking.isPrivateHire) return false;

    const dateStr = this.normalizeDateStr(booking.travelDate);
    if (!dateStr) return false;

    return this.isEndOfTravelDayPassed(dateStr);
  }

  private isRegularBookingEligibleSync(
    booking: any,
    routinesByKey: Map<string, any[]>,
    dailyScheduleMap: Map<string, string>,
  ): boolean {
    if (booking.status !== 'confirmed') return false;
    if (booking.isTripBooking || booking.isPrivateHire) return false;

    const dateStr = this.normalizeDateStr(booking.travelDate);
    if (!dateStr) return false;

    const todayStr = this.getTodayColombo();
    if (dateStr < todayStr) return true;

    const dayOfWeek = this.getDayOfWeek(dateStr);
    const routines = this.getRoutinesForBooking(booking, routinesByKey);
    const routinesForDay = routines.filter((routine: any) =>
      routine.daysOfWeek?.some(
        (day: string) => day.toLowerCase() === dayOfWeek.toLowerCase(),
      ),
    );

    const routeMatched = routinesForDay.filter((routine: any) =>
      this.routesMatch(booking.route, routine.route),
    );
    const candidates =
      routeMatched.length > 0 ? routeMatched : routinesForDay;

    for (const routine of candidates) {
      const availability = this.getDailyScheduleAvailability(
        routine.id,
        dateStr,
        dailyScheduleMap,
      );
      if (availability === 'completed') return true;
      if (this.isRoutineEndTimePassed(routine, dateStr)) return true;
    }

    if (dateStr === todayStr) {
      return false;
    }

    return this.isEndOfTravelDayPassed(dateStr);
  }

  private async loadRoutinesByKeys(
    keys: string[],
  ): Promise<Map<string, any[]>> {
    const firestore = this.firebaseService.getFirestore();
    const routinesByKey = new Map<string, any[]>();
    const uniqueRoutineIds = new Map<string, Map<string, any>>();

    await Promise.all(
      keys.map(async (key) => {
        const [byDriverSnapshot, byBusSnapshot] = await Promise.all([
          firestore
            .collection('routines')
            .where('driverId', '==', key)
            .where('status', '==', 'approved')
            .get(),
          firestore
            .collection('routines')
            .where('busId', '==', key)
            .where('status', '==', 'approved')
            .get(),
        ]);

        if (!uniqueRoutineIds.has(key)) {
          uniqueRoutineIds.set(key, new Map());
        }
        const routineMap = uniqueRoutineIds.get(key)!;

        [...byDriverSnapshot.docs, ...byBusSnapshot.docs].forEach((doc) => {
          if (!routineMap.has(doc.id)) {
            routineMap.set(doc.id, { id: doc.id, ...doc.data() });
          }
        });

        routinesByKey.set(key, [...routineMap.values()]);
      }),
    );

    return routinesByKey;
  }

  private collectDailyScheduleIds(
    bookings: any[],
    routinesByKey: Map<string, any[]>,
  ): string[] {
    const ids = new Set<string>();

    for (const booking of bookings) {
      if (booking.status !== 'confirmed' || booking.isTripBooking || booking.isPrivateHire) {
        continue;
      }

      const dateStr = this.normalizeDateStr(booking.travelDate);
      if (!dateStr) continue;

      const dayOfWeek = this.getDayOfWeek(dateStr);
      const routines = this.getRoutinesForBooking(booking, routinesByKey).filter(
        (routine: any) =>
          routine.daysOfWeek?.some(
            (day: string) => day.toLowerCase() === dayOfWeek.toLowerCase(),
          ),
      );

      for (const routine of routines) {
        for (const dateKey of this.getDateKeyVariants(dateStr)) {
          ids.add(`${routine.id}_${dateKey}`);
        }
      }
    }

    return [...ids];
  }

  async getEligibleJourneys(userId: string): Promise<EligibleJourney[]> {
    const firestore = this.firebaseService.getFirestore();

    const [reviewedIds, bookingsSnapshot, hireRequests] = await Promise.all([
      this.getReviewedJourneyIds(userId),
      firestore.collection('bookings').where('userId', '==', userId).get(),
      this.getCompletedHireRequests(userId),
    ]);

    const bookings = bookingsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    const tripIds = bookings
      .filter((booking) => booking.isTripBooking && booking.tripId)
      .map((booking) => booking.tripId as string);

    const lookupKeys = [
      ...new Set(
        bookings
          .flatMap((booking) => [booking.busId, booking.driverId])
          .filter(Boolean),
      ),
    ] as string[];

    const [tripsMap, routinesByKey] = await Promise.all([
      this.batchGetDocuments<admin.firestore.DocumentData>('trips', tripIds),
      this.loadRoutinesByKeys(lookupKeys),
    ]);

    const dailyScheduleIds = this.collectDailyScheduleIds(bookings, routinesByKey);
    const dailyScheduleDocs = await this.batchGetDocuments<{
      availability?: string;
    }>('dailySchedules', dailyScheduleIds);

    const dailyScheduleMap = new Map<string, string>();
    dailyScheduleDocs.forEach((data, docId) => {
      dailyScheduleMap.set(docId, data.availability || 'available');
    });

    const journeys: EligibleJourney[] = [];

    for (const booking of bookings) {
      let eligible = false;
      let journeyType: EligibleJourney['journeyType'] = 'regular';

      if (booking.isTripBooking) {
        eligible = this.isTripBookingEligibleSync(booking, tripsMap);
        journeyType = 'trip';
      } else if (booking.isPrivateHire) {
        eligible = this.isPrivateHireBookingEligibleSync(booking);
        journeyType = 'private_hire';
      } else {
        eligible = this.isRegularBookingEligibleSync(
          booking,
          routinesByKey,
          dailyScheduleMap,
        );
        journeyType = 'regular';
      }

      if (!eligible || reviewedIds.has(booking.id)) continue;

      const travelDate = this.normalizeDateStr(booking.travelDate);
      const driverId = this.resolveDriverIdLocal(booking.busId, booking.driverId);

      journeys.push({
        id: booking.id,
        route: booking.route,
        travelDate,
        busId: booking.busId,
        driverId,
        journeyType,
        label: this.formatJourneyLabel(booking.route, travelDate, journeyType),
      });
    }

    for (const request of hireRequests) {
      const journeyId = `hire_${request.id}`;
      if (reviewedIds.has(journeyId)) continue;

      const travelDate = this.normalizeDateStr(request.departureDate);
      const route = `${request.pickupLocation} → ${request.destination}`;
      const driverId = this.resolveDriverIdLocal(request.busId, request.driverId);

      journeys.push({
        id: journeyId,
        route,
        travelDate,
        busId: request.busId,
        driverId,
        journeyType: 'private_hire',
        label: this.formatJourneyLabel(route, travelDate, 'private_hire'),
      });
    }

    journeys.sort((a, b) => b.travelDate.localeCompare(a.travelDate));
    return journeys;
  }

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
    if (!feedbackData.bookingId) {
      throw new BadRequestException('A completed journey must be selected');
    }

    const eligibleJourneys = await this.getEligibleJourneys(userId);
    const selectedJourney = eligibleJourneys.find(
      (journey) => journey.id === feedbackData.bookingId,
    );

    if (!selectedJourney) {
      throw new BadRequestException(
        'Selected journey is not eligible for feedback or has already been reviewed',
      );
    }

    const firestore = this.firebaseService.getFirestore();
    const resolvedDriverId =
      feedbackData.driverId ||
      selectedJourney.driverId ||
      this.resolveDriverIdLocal(feedbackData.busId || selectedJourney.busId);

    const feedbackRef = firestore.collection('feedback').doc();
    const feedback = {
      id: feedbackRef.id,
      userId,
      message: feedbackData.message,
      rating: feedbackData.rating || null,
      bookingId: feedbackData.bookingId,
      busId: feedbackData.busId || selectedJourney.busId || null,
      driverId: resolvedDriverId,
      route: feedbackData.route || selectedJourney.route || null,
      travelDate: feedbackData.travelDate || selectedJourney.travelDate || null,
      journeyType: selectedJourney.journeyType,
      status: 'pending',
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
      feedback.sort((a, b) => {
        const aTime =
          a.createdAt?.seconds ||
          a.createdAt?.getTime?.() ||
          new Date(a.createdAt).getTime();
        const bTime =
          b.createdAt?.seconds ||
          b.createdAt?.getTime?.() ||
          new Date(b.createdAt).getTime();
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
        const userRefs = [...userIds].map((uid) =>
          firestore.collection('users').doc(uid),
        );
        const userDocs = await firestore.getAll(...userRefs);
        userDocs.forEach((userDoc) => {
          if (userDoc.exists) {
            const userData = userDoc.data();
            userDetailsMap.set(userDoc.id, {
              userId: userDoc.id,
              displayName: userData.displayName || 'Anonymous User',
              photoURL: userData.photoURL || null,
            });
          }
        });
      }

      return feedback.map((item) => {
        const user = userDetailsMap.get(item.userId);
        return {
          ...item,
          userName: user?.displayName || 'Anonymous Passenger',
          userPhoto: user?.photoURL || null,
        };
      });
    } catch (enrichError) {
      console.error('Error enriching driver feedback with user details:', enrichError);
      return feedback;
    }
  }

  async getUserFeedback(userId: string) {
    const firestore = this.firebaseService.getFirestore();

    try {
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
      this.logger.warn(
        'Composite index not found for getUserFeedback, using filtered query',
        error,
      );
      const feedbackSnapshot = await firestore
        .collection('feedback')
        .where('userId', '==', userId)
        .get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });

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
      console.warn('Index not found for getAllFeedback, falling back to unordered query:', error);
      const feedbackSnapshot = await firestore.collection('feedback').get();

      const feedback = [];
      feedbackSnapshot.forEach((doc) => {
        feedback.push({ id: doc.id, ...doc.data() });
      });

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
