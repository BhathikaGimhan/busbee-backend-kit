const fs = require('fs');
const FILE = 'src/bus/bus.service.ts';
let code = fs.readFileSync(FILE, 'utf8');

const targetIndex = code.indexOf("console.log('🚌 Handling regular bus booking...');");
if (targetIndex > -1) {
    const afterIndex = code.indexOf('const seatUpdate = {};', targetIndex);
    if (afterIndex > -1) {
        const replacement = `console.log('🚌 Handling regular bus booking...');

              // TRANSACTIONAL SEAT CHECK: Prevent double-booking
              const currentSeatDoc = await transaction.get(seatAvailabilityRef);
              if (currentSeatDoc.exists) {
                const currentSeatData = currentSeatDoc.data();
                for (const seat of bookingData.seats) {
                  if (currentSeatData?.seats && currentSeatData.seats[seat.seatId]?.status === 'booked') {
                    throw new BadRequestException(\`Seat \${seat.seatNumber} is already booked by someone else.\`);
                  }
                }
              }
              // Prepare all the writes`;
        
        let subStr = code.substring(targetIndex, afterIndex);
        code = code.replace(subStr, replacement + "\n              ");
        fs.writeFileSync(FILE, code);
        console.log('Patch 2 applied successfully.');
    } else {
        console.log("Could not find second target");
    }
}
