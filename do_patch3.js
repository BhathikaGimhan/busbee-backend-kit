const fs = require('fs');
const FILE = 'src/bus/bus.service.ts';
let code = fs.readFileSync(FILE, 'utf8');

const target = `              // Prepare all the writes
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
              );`;

const replacement = `              // Prepare the seat changes
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

              // Update seat availability (Merge properly into the seats map)
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
              );`;

if (code.includes('const seatUpdate = {};')) {
    // We will do a generic replacement of the lines using regex or indexOf
    const prefix = 'const seatUpdate = {};';
    const suffix = '{ merge: true },\n              );';
    const start = code.indexOf(prefix);
    const end = code.indexOf(suffix, start) + suffix.length;
    if(start > -1 && end > -1) {
        code = code.substring(0, start) + replacement.substring(replacement.indexOf('const seatUpdates')) + code.substring(end);
        fs.writeFileSync(FILE, code);
        console.log('Patch 3 successful!');
    } else {
        console.log('Could not find start or end index.');
    }
}
