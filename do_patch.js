const fs = require('fs');
const FILE = 'src/bus/bus.service.ts';
let code = fs.readFileSync(FILE, 'utf8');

const target = `            } else {
              // Handle regular bus booking
              console.log('🚌 Handling regular bus booking...');
              // Prepare all the writes
              const seatUpdate = {};`;

const replacement = `            } else {
              // Handle regular bus booking
              console.log('🚌 Handling regular bus booking...');
              // TRANSACTIONAL SEAT CHECK: Prevent double-booking
              const currentSeatDoc = await transaction.get(seatAvailabilityRef);
              if (currentSeatDoc.exists) {
                const currentSeatData = currentSeatDoc.data();
                for (const seat of bookingData.seats) {
                  if (currentSeatData?.seats?.[seat.seatId]?.status === 'booked') {
                    throw new Error(\`Seat \${seat.seatNumber} is already booked by someone else.\`);
                  }
                }
              }
              // Prepare all the writes
              const seatUpdate = {};`;

if (code.includes(target) && !code.includes('TRANSACTIONAL SEAT CHECK')) {
    code = code.replace(target, replacement);
    fs.writeFileSync(FILE, code);
    console.log('Patch applied successfully.');
} else {
    console.log('Could not find target or already patched.');
}
