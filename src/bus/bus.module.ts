import { Module } from '@nestjs/common';
import { BusService } from './bus.service';
import { BusController } from './bus.controller';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  controllers: [BusController],
  providers: [BusService],
  exports: [BusService],
})
export class BusModule {}
