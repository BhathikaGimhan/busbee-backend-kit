const fs = require('fs');
const file = 'src/bus/bus.service.ts';
let code = fs.readFileSync(file, 'utf8');

const targetSeatFn = `    async getSeatAvailability(busId: string, travelDate: string) {
      const firestore = this.firebaseService.getFirestore();
      const seatAvailabilityRef = firestore
        .collection('seatAvailability')
        .doc(\`\${busId}_\${travelDate}\`);

      const seatDoc = await seatAvailabilityRef.get();

      if (!seatDoc.exists) {
        // Return default seat layout if no bookings exist yet
        return this.generateDefaultSeats(busId, travelDate);
      }

      return seatDoc.data();
    }`;

const replaceSeatFn = `    async getSeatAvailability(busId: string, travelDate: string) {
      const firestore = this.firebaseService.getFirestore();
      const seatAvailabilityRef = firestore
        .collection('seatAvailability')
        .doc(\`\${busId}_\${travelDate}\`);

      const seatDoc = await seatAvailabilityRef.get();
      const defaultLayout = this.generateDefaultSeats(busId, travelDate);

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
    }`;

const oldBookingCheck = `          } else {
            // Handle regular bus booking
            console.log('🚌 Handling regular bus booking...');
            // Prepare all the writes
            const seatUpdate = {};
            bookingData.seats.forEach((seat) => {
              seatUpdate[\`seats.\${seat.seatId}\`] = {
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
          }`;

const newBookingCheck = `          } else {
            // Handle regular bus booking
            console.log('🚌 Handling regular bus booking...');

            // TRANSACTIONAL SEAT CHECK: Prevent double-booking
            const currentSeatDoc = await transaction.get(seatAvailabilityRef);
            if (currentSeatDoc.exists) {
              const currentSeatData = currentSeatDoc.data();
              for (const seat of bookingData.seats) {
                if (currentSeatData?.seats && currentSeatData.seats[seat.seatId]?.status === 'booked') {
                  throw new BadRequestException(\`Seat \${seat.seatNumber} is already booked.\`);
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
          }`;

if (code.includes(targetSeatFn)) {
  code = code.replace(targetSeatFn, replaceSeatFn);
  console.log("SEAT FN REPLACED");
} else {
  console.log("SEAT FN NOT FOUND");
}

if (code.includes(oldBookingCheck)) {
  code = code.replace(oldBookingCheck, newBookingCheck);
  console.log("BOOKING FN REPLACED");
} else {
  console.log("BOOKING FN NOT FOUND");
}

fs.writeFileSync(file, code);

