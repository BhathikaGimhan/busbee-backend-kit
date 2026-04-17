const fs = require('fs');
const file = 'src/bus/bus.service.ts';
let code = fs.readFileSync(file, 'utf8');

// Use regex matching to be whitespace-agnostic

const regex1 = /\s*\}\s*else\s*\{\s*\/\/\s*Handle\s+regular\s+bus\s+booking[\s\S]*?merge:\s*true\s*\}\s*,\s*\);\s*\}/;

const r1 = `          } else {
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

const regex2 = /\s*async\s+getSeatAvailability\s*\(\s*busId[\s\S]*?return\s+seatDoc\.data\s*\(\s*\)\s*;\s*\}/;

const r2 = `
    async getSeatAvailability(busId: string, travelDate: string) {
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

code = code.replace(regex1, r1);
code = code.replace(regex2, r2);

fs.writeFileSync(file, code);
console.log("Written via regex!");

